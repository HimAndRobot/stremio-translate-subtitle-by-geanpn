const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const opensubtitles = require("../opensubtitles");
const dbConnection = require("../connection");
const fs = require("fs").promises;
const batchQueue = require("./batchQueue");
const { encryptCredential } = require("../utils/crypto");
const { getMetadata } = require("../utils/metadata");
const crypto = require("crypto");

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const translationQueue = new Queue("subtitle-translation", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

const worker = new Worker(
  "subtitle-translation",
  async (job) => {
    const {
      subs,
      imdbid,
      season,
      episode,
      oldisocode,
      provider,
      apikey,
      base_url,
      model_name,
      password,
      saveCredentials,
    } = job.data;

    await job.log(`[START] Processing translation for ${imdbid}`);
    await job.log(`[INFO] Provider: ${provider}, Target Language: ${oldisocode}`);
    await job.log(`[INFO] Season: ${season}, Episode: ${episode}`);
    await job.log(`[INFO] Subtitles found: ${subs?.length || 0}`);

    console.log(`Processing job ${job.id} for ${imdbid}`);

    let filepaths = [];

    try {
      let password_hash = null;
      let apikey_encrypted = null;
      let base_url_encrypted = null;
      let model_name_encrypted = null;

      if (password) {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (encryptionKey && encryptionKey.length === 32) {
          password_hash = crypto.createHash('sha256').update(password).digest('hex');

          if (saveCredentials) {
            if (apikey) apikey_encrypted = encryptCredential(apikey, encryptionKey);
            if (base_url) base_url_encrypted = encryptCredential(base_url, encryptionKey);
            if (model_name) model_name_encrypted = encryptCredential(model_name, encryptionKey);
          }
        }
      }

      const existingStatus = await dbConnection.checkForTranslation(imdbid, season, episode, oldisocode);

      let series_name = null;
      let poster = null;
      if (!existingStatus) {
        try {
          const type = season && episode ? "series" : "movie";
          const metadata = await getMetadata(imdbid, type);
          series_name = metadata.name;
          poster = metadata.poster;
        } catch (metaError) {
          console.error("Failed to fetch metadata:", metaError.message);
          series_name = imdbid;
        }

        await dbConnection.addToTranslationQueue(
          imdbid,
          season,
          episode,
          0,
          oldisocode,
          password_hash,
          apikey_encrypted,
          base_url_encrypted,
          model_name_encrypted,
          series_name,
          poster
        );
      } else if (password_hash) {
        await dbConnection.updateTranslationCredentials(
          imdbid,
          season,
          episode,
          oldisocode,
          password_hash,
          apikey_encrypted,
          base_url_encrypted,
          model_name_encrypted
        );
      }

      await job.updateProgress(10);
      await job.log('[STEP 1/4] Downloading subtitles from OpenSubtitles...');

      filepaths = await opensubtitles.downloadSubtitles(subs, imdbid, season, episode, oldisocode);

      if (!filepaths || filepaths.length === 0) {
        throw new Error('No subtitle files downloaded');
      }

      await job.updateProgress(20);
      await job.log('[STEP 2/4] Parsing SRT file...');

      const originalSubtitleFilePath = filepaths[0];
      const originalSubtitleContent = await fs.readFile(originalSubtitleFilePath, { encoding: "utf-8" });
      const lines = originalSubtitleContent.split("\n");

      const subcounts = [];
      const timecodes = [];
      const texts = [];

      let currentBlock = {
        iscount: true,
        istimecode: false,
        istext: false,
        textcount: 0,
      };

      for (const line of lines) {
        if (line.trim() === "") {
          currentBlock = {
            iscount: true,
            istimecode: false,
            istext: false,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.iscount) {
          subcounts.push(line);
          currentBlock = {
            iscount: false,
            istimecode: true,
            istext: false,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.istimecode) {
          timecodes.push(line);
          currentBlock = {
            iscount: false,
            istimecode: false,
            istext: true,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.istext) {
          if (currentBlock.textcount === 0) {
            texts.push(line);
          } else {
            texts[texts.length - 1] += "\n" + line;
          }
          currentBlock.textcount++;
        }
      }

      await job.log(`[INFO] Parsed ${subcounts.length} subtitle entries`);

      const adapter = await dbConnection.getAdapter();
      const queueResult = await adapter.query(
        `SELECT id FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?`,
        [imdbid, season, episode, oldisocode]
      );

      if (queueResult.length === 0) {
        throw new Error('Translation queue entry not found');
      }

      const translationQueueId = queueResult[0].id;

      await job.updateProgress(30);
      await job.log('[STEP 3/4] Creating batch records...');

      const batchSize = provider === "ChatGPT API" ? 50 : 60;
      const totalEntries = subcounts.length;
      const totalBatches = Math.ceil(totalEntries / batchSize);

      const batches = [];
      let globalIndex = 0;

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        const startIdx = (batchNum - 1) * batchSize;
        const endIdx = Math.min(startIdx + batchSize, totalEntries);

        const batchEntries = [];
        for (let i = startIdx; i < endIdx; i++) {
          batchEntries.push({
            index: globalIndex++,
            counter: subcounts[i],
            timecode: timecodes[i],
            text: texts[i]
          });
        }

        batches.push({
          batch_number: batchNum,
          subtitle_entries: batchEntries
        });
      }

      await dbConnection.createSubtitleBatches(translationQueueId, batches);

      await job.log(`[INFO] Created ${totalBatches} batch records`);

      await job.updateProgress(50);
      await job.log('[STEP 4/4] Queueing batch translation jobs...');

      const batchJobPromises = [];
      for (const batch of batches) {
        const batchResult = await adapter.query(
          `SELECT id FROM subtitle_batches WHERE translation_queue_id = ? AND batch_number = ?`,
          [translationQueueId, batch.batch_number]
        );

        if (batchResult.length > 0) {
          const batchJobData = {
            batchId: batchResult[0].id,
            provider,
            apikey,
            base_url,
            model_name,
            targetLanguage: oldisocode
          };

          batchJobPromises.push(
            batchQueue.add('translate-batch', batchJobData, {
              jobId: `batch-${translationQueueId}-${batch.batch_number}-${Date.now()}`
            })
          );
        }
      }

      await Promise.all(batchJobPromises);

      await job.updateProgress(100);
      await job.log(`[COMPLETE] Queued ${totalBatches} batch jobs for parallel processing`);

      return { success: true, totalBatches, translationQueueId };

    } catch (error) {
      await job.log(`[ERROR] ${error.message}`);

      await dbConnection.updateTranslationStatus(imdbid, season, episode, oldisocode, 'failed');

      throw error;
    } finally {
      for (const fp of filepaths) {
        try {
          await fs.unlink(fp);
          await job.log(`[CLEANUP] Removed temporary file: ${fp}`);
        } catch (unlinkError) {
          console.error(`Error cleaning up file ${fp}:`, unlinkError);
        }
      }
    }
  },
  {
    connection: connection.duplicate(),
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY) || 3,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
});

translationQueue.push = function (jobData) {
  return this.add("translate", jobData, {
    jobId: `${jobData.imdbid}-${jobData.season}-${jobData.episode}-${jobData.oldisocode}-${Date.now()}`,
  });
};

module.exports = translationQueue;
