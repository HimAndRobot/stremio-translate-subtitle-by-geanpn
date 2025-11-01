const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const connection = require("../connection");
const opensubtitles = require("../opensubtitles");
const translationQueue = require("./translationQueue");
const { createOrUpdateMessageSub } = require("../subtitles");
const { getMetadata } = require("../utils/metadata");

const redisConnection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
);

const downloadQueue = new Queue("download", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

const worker = new Worker(
  "download",
  async (job) => {
    const { imdbid, type, episodes, targetLanguage, provider, apikey, base_url, model_name, password_hash } = job.data;

    await job.log(`[START] Processing download request for ${imdbid}`);
    await job.log(`[INFO] Episodes: ${episodes.length}, Language: ${targetLanguage}, Provider: ${provider}`);
    await job.log(`[INFO] Password hash: ${password_hash ? password_hash.substring(0, 8) + '...' : 'NULL'}`);

    const providerPath = password_hash || 'translated';
    const total = episodes.length;

    await job.log(`[STEP 1] Creating ${total} translation_queue records...`);

    const translationQueueIds = [];
    let series_name = null;
    let poster = null;

    try {
      const metadata = await getMetadata(imdbid, type);
      series_name = metadata.name;
      poster = metadata.poster;
    } catch (metaError) {
      await job.log(`[WARN] Failed to fetch metadata: ${metaError.message}`);
      series_name = imdbid;
    }

    for (const ep of episodes) {
      const season = ep.season || null;
      const episode = ep.episode || null;

      try {
        const queueStatus = await connection.checkForTranslation(
          imdbid,
          season,
          episode,
          targetLanguage,
          password_hash
        );

        if (queueStatus === 'processing' || queueStatus === 'completed') {
          await job.log(`[SKIP] ${imdbid} S${season}E${episode} already ${queueStatus}`);
          continue;
        }

        await createOrUpdateMessageSub(
          "Translating subtitles. Please wait 1 minute and try again.",
          imdbid,
          season,
          episode,
          targetLanguage,
          providerPath
        );

        await connection.addsubtitle(
          imdbid,
          type,
          season,
          episode,
          `subtitles/${providerPath}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`,
          targetLanguage
        );

        await connection.addToTranslationQueue(
          imdbid,
          season,
          episode,
          0,
          targetLanguage,
          password_hash,
          null,
          null,
          null,
          series_name,
          poster
        );

        translationQueueIds.push({ season, episode });
        await job.log(`[CREATED] Translation record for S${season}E${episode}`);

      } catch (error) {
        await job.log(`[ERROR] Failed to create record for S${season}E${episode}: ${error.message}`);
      }
    }

    await job.log(`[STEP 2] Sending ${translationQueueIds.length} episodes to translation queue one by one...`);

    const adapter = await connection.getAdapter();
    let processed = 0;

    for (const ep of translationQueueIds) {
      const season = ep.season;
      const episode = ep.episode;

      await job.log(`[PROCESSING] ${imdbid} S${season}E${episode} (${processed + 1}/${translationQueueIds.length})`);

      try {
        const subs = await opensubtitles.getsubtitles(
          type,
          imdbid,
          season,
          episode,
          targetLanguage
        );

        if (!subs || subs.length === 0) {
          await job.log(`[SKIP] No subtitles found for S${season}E${episode}`);
          await createOrUpdateMessageSub(
            "No subtitles found on OpenSubtitles",
            imdbid,
            season,
            episode,
            targetLanguage,
            providerPath
          );
          processed++;
          continue;
        }

        const queueResult = await adapter.query(
          `SELECT id FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ? AND password_hash ${password_hash ? '= ?' : 'IS NULL'}`,
          password_hash ? [imdbid, season, episode, targetLanguage, password_hash] : [imdbid, season, episode, targetLanguage]
        );

        const existingTranslationQueueId = queueResult.length > 0 ? queueResult[0].id : null;

        await translationQueue.push({
          subs: [subs[0]],
          imdbid: imdbid,
          season: season,
          episode: episode,
          oldisocode: targetLanguage,
          provider: provider,
          apikey: apikey || null,
          base_url: base_url || null,
          model_name: model_name || null,
          password_hash: password_hash,
          saveCredentials: false,
          existingTranslationQueueId: existingTranslationQueueId,
        });

        await job.log(`[QUEUED] S${season}E${episode} added to translation queue (ID: ${existingTranslationQueueId})`);
        processed++;
        await job.updateProgress(Math.floor((processed / translationQueueIds.length) * 100));

        if (processed < translationQueueIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        await job.log(`[ERROR] Failed to process S${season}E${episode}: ${error.message}`);
        processed++;
      }
    }

    await job.log(`[COMPLETE] Processed ${processed}/${translationQueueIds.length} episodes`);
    return { success: true, processed, total: translationQueueIds.length };
  },
  {
    connection: redisConnection.duplicate(),
    concurrency: parseInt(process.env.DOWNLOAD_QUEUE_CONCURRENCY) || 10,
  }
);

worker.on("completed", (job) => {
  console.log(`Download job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Download job ${job.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Download worker error:", err);
});

module.exports = downloadQueue;
