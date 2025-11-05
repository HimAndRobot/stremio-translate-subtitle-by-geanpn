const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const opensubtitles = require("../opensubtitles");
const dbConnection = require("../connection");
const fs = require("fs").promises;
const path = require("path");
const batchQueue = require("./batchQueue");
const {
  translateSRTDocument,
  supportsDocumentTranslation
} = require("../translateProvider");
const {
  fetchSubtitlesFromOpenSubtitles,
  updateDatabaseWithResolvedData,
  parseSRTFile,
  getTranslationQueueId
} = require("./translationQueueHelpers");

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const translationQueue = new Queue("subtitle-translation", {
  connection,
  defaultJobOptions: {
    attempts: 1,
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
      stremioId,
      oldisocode,
      provider,
      apikey,
      base_url,
      model_name,
      password_hash: jobPasswordHash,
      existingTranslationQueueId,
      customSubtitle,
    } = job.data;

    let imdbid = null;
    let season = null;
    let episode = null;
    let type = null;
    let resolvedSubs = null;

    let filepaths = [];

    try {
      const adapter = await dbConnection.getAdapter();
      const queueInfo = await adapter.query(
        `SELECT series_imdbid, series_seasonno, series_episodeno, type, stremio_id
         FROM translation_queue
         WHERE stremio_id = ? AND langcode = ? AND password_hash ${jobPasswordHash ? '= ?' : 'IS NULL'}`,
        jobPasswordHash ? [stremioId, oldisocode, jobPasswordHash] : [stremioId, oldisocode]
      );

      if (queueInfo.length === 0) {
        throw new Error(`Translation queue entry not found for stremioId: ${stremioId}`);
      }

      imdbid = queueInfo[0].series_imdbid;
      season = queueInfo[0].series_seasonno;
      episode = queueInfo[0].series_episodeno;
      type = queueInfo[0].type;
      await job.log(`[DB] Pulled from database: ${imdbid} S${season}E${episode} (${type})`)

      if (!resolvedSubs && !customSubtitle) {
        const subtitleResult = await fetchSubtitlesFromOpenSubtitles(imdbid, season, episode, type, oldisocode, job);

        if (subtitleResult.skipped) {
          await job.log('[DOWNLOAD] Downloading subtitle (already in target language)');

          const downloadedFiles = await opensubtitles.downloadSubtitles(
            subtitleResult.subtitles,
            imdbid,
            season,
            episode,
            oldisocode
          );

          if (!downloadedFiles || downloadedFiles.length === 0) {
            throw new Error('Failed to download subtitle file');
          }

          const downloadedPath = downloadedFiles[0];
          await job.log(`[DOWNLOAD] Subtitle downloaded to: ${downloadedPath}`);

          const queuePathInfo = await adapter.query(
            `SELECT subtitle_path FROM translation_queue WHERE stremio_id = ? AND langcode = ? AND password_hash ${jobPasswordHash ? '= ?' : 'IS NULL'}`,
            jobPasswordHash ? [stremioId, oldisocode, jobPasswordHash] : [stremioId, oldisocode]
          );

          if (queuePathInfo.length === 0) {
            throw new Error('Translation queue entry not found');
          }

          const targetPath = `subtitles/${queuePathInfo[0].subtitle_path}`;
          const targetDir = targetPath.substring(0, targetPath.lastIndexOf('/'));

          await fs.mkdir(targetDir, { recursive: true });
          await fs.copyFile(downloadedPath, targetPath);
          await fs.unlink(downloadedPath);

          await job.log(`[SAVE] Copied to final location: ${targetPath}`);

          await adapter.query(
            `UPDATE translation_queue SET status = ? WHERE stremio_id = ? AND langcode = ? AND password_hash ${jobPasswordHash ? '= ?' : 'IS NULL'}`,
            jobPasswordHash ? ['completed', stremioId, oldisocode, jobPasswordHash] : ['completed', stremioId, oldisocode]
          );

          await job.log('[STATUS] Marked as completed');

          return {
            success: true,
            message: 'Subtitle already in target language',
            skipped: true
          };
        }

        if (subtitleResult.needsManualSearch) {
          await job.log('[OPENSUBTITLES] No subtitles found, marking as manual_search');

          const pathInfo = await adapter.query(
            `SELECT subtitle_path FROM translation_queue WHERE stremio_id = ? AND langcode = ? AND password_hash ${jobPasswordHash ? '= ?' : 'IS NULL'}`,
            jobPasswordHash ? [stremioId, oldisocode, jobPasswordHash] : [stremioId, oldisocode]
          );

          if (pathInfo.length > 0) {
            await adapter.query(
              `UPDATE translation_queue SET status = ? WHERE stremio_id = ? AND langcode = ? AND password_hash ${jobPasswordHash ? '= ?' : 'IS NULL'}`,
              jobPasswordHash ? ['manual_search', stremioId, oldisocode, jobPasswordHash] : ['manual_search', stremioId, oldisocode]
            );

            const { createOrUpdateMessageSub } = require('../subtitles');
            await createOrUpdateMessageSub(
              "We couldn't automatically identify this content. Please access the dashboard to search and add subtitles manually.",
              pathInfo[0].subtitle_path
            );
          }

          return {
            success: true,
            message: 'Manual search required',
            manual_search: true
          };
        }

        resolvedSubs = subtitleResult.subtitles;
      }

      await job.log(`[START] Processing translation for ${imdbid}`);
      await job.log(`[INFO] Provider: ${provider}, Target Language: ${oldisocode}`);
      await job.log(`[INFO] Season: ${season}, Episode: ${episode}`);
      await job.log(`[INFO] Subtitles found: ${resolvedSubs?.length || 0}`);

      console.log(`Processing job ${job.id} for ${imdbid}`);

      let password_hash = jobPasswordHash || null;
      let apikey_encrypted = null;
      let base_url_encrypted = null;
      let model_name_encrypted = null;

      let translationQueueId = existingTranslationQueueId;

      if (!translationQueueId) {
        await updateDatabaseWithResolvedData(
          stremioId,
          imdbid,
          season,
          episode,
          type,
          oldisocode,
          password_hash,
          apikey_encrypted,
          base_url_encrypted,
          model_name_encrypted,
          job
        );
      } else {
        await job.log(`[REPROCESS] Using existing translation_queue ID: ${translationQueueId}`);
      }

      await job.updateProgress(10);

      if (customSubtitle && customSubtitle.filePath) {
        await job.log('[STEP 1/4] Using uploaded custom subtitle file...');
        filepaths = [customSubtitle.filePath];
        await job.log(`[INFO] Using custom subtitle: ${customSubtitle.filename}`);
      } else if (resolvedSubs && resolvedSubs.length > 0) {
        await job.log('[STEP 1/4] Downloading subtitles from OpenSubtitles...');
        filepaths = await opensubtitles.downloadSubtitles(resolvedSubs, imdbid, season, episode, oldisocode);

        if (!filepaths || filepaths.length === 0) {
          throw new Error('No subtitle files downloaded');
        }
      } else {
        throw new Error('No subtitle source provided (neither custom file nor OpenSubtitles URL)');
      }

      await job.updateProgress(20);

      const originalSubtitleFilePath = filepaths[0];
      const { subcounts, timecodes, texts, originalContent: originalSubtitleContent } = await parseSRTFile(originalSubtitleFilePath, job);

      if (!translationQueueId) {
        translationQueueId = await getTranslationQueueId(imdbid, season, episode, oldisocode);
      }

      const useDocumentTranslation = supportsDocumentTranslation(provider);

      if (useDocumentTranslation) {
        await job.updateProgress(30);
        await job.log(`[${provider}] Using Document API for fast translation...`);
        await job.log(`[${provider}] Target language: ${oldisocode}`);

        try {
          const translatedSRT = await translateSRTDocument(
            originalSubtitleContent,
            oldisocode,
            provider,
            apikey
          );

          const queueInfo = await adapter.query(
            `SELECT subtitle_path FROM translation_queue WHERE id = ?`,
            [translationQueueId]
          );

          const subtitlePath = queueInfo[0]?.subtitle_path;
          if (!subtitlePath) {
            throw new Error('subtitle_path not found in translation_queue');
          }

          const fullPath = `subtitles/${subtitlePath}`;
          const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

          await fs.mkdir(dirPath, { recursive: true });

          await fs.writeFile(fullPath, translatedSRT, 'utf-8');

          await job.updateProgress(90);
          await job.log(`[${provider}] Translation completed successfully!`);
          await job.log(`[${provider}] Saved to: ${fullPath}`);

          const charCount = originalSubtitleContent.length;
          await adapter.query(
            `UPDATE translation_queue SET status = ?, token_usage_total = ? WHERE id = ?`,
            ['completed', charCount, translationQueueId]
          );

          await job.updateProgress(100);
          return {
            success: true,
            message: `Translation completed using ${provider} Document API`,
            method: 'document-api',
            characterCount: charCount
          };
        } catch (error) {
          await job.log(`[${provider}] Document API failed: ${error.message}`);
          await job.log(`[${provider}] Falling back to Text API (batch mode)...`);
        }
      }

      await job.updateProgress(30);
      await job.log('[STEP 3/4] Creating batch records...');

      await adapter.query(
        `DELETE FROM subtitle_batches WHERE translation_queue_id = ?`,
        [translationQueueId]
      );
      await job.log('[INFO] Cleared existing batch records');

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

      const adapter = await dbConnection.getAdapter();
      const queueInfo = await adapter.query(
        `SELECT subtitle_path FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?`,
        [imdbid, season, episode, oldisocode]
      );

      if (queueInfo.length > 0 && queueInfo[0].subtitle_path) {
        const { subtitle_path } = queueInfo[0];
        const { createOrUpdateMessageSub } = require('../subtitles');

        const errorMessage = error.message.includes('No subtitles found')
          ? 'No subtitles found on OpenSubtitles for this episode.'
          : 'An error occurred while generating your subtitle. We will try again.';

        await createOrUpdateMessageSub(errorMessage, subtitle_path);
        await job.log(`[ACTION] Created error message subtitle`);
      }

      await dbConnection.updateTranslationStatus(imdbid, season, episode, oldisocode, 'failed');

      throw error;
    } finally {
      for (const fp of filepaths) {
        try {
          if (customSubtitle && customSubtitle.filePath === fp) {
            await fs.unlink(fp);
            await job.log(`[CLEANUP] Removed uploaded subtitle file: ${fp}`);
          } else if (!customSubtitle) {
            await fs.unlink(fp);
            await job.log(`[CLEANUP] Removed temporary file: ${fp}`);
          }
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
  const identifier = jobData.stremioId || `${jobData.imdbid}-${jobData.season}-${jobData.episode}`;
  return this.add("translate", jobData, {
    jobId: `${identifier}-${jobData.oldisocode}-${Date.now()}`,
  });
};

module.exports = translationQueue;
