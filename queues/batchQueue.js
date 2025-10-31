const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const connection = require("../connection");
const { translateText } = require("../translateProvider");
const fs = require("fs").promises;

const redisConnection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
);

const batchQueue = new Queue("subtitle-batch", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
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
  "subtitle-batch",
  async (job) => {
    const { batchId, provider, apikey, base_url, model_name, targetLanguage } = job.data;

    await job.log(`[START] Processing batch ${batchId}`);

    await connection.updateBatchStatus(batchId, 'processing');

    const batch = await connection.getSubtitleBatch(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    await job.log(`[INFO] Batch ${batch.batch_number} with ${batch.subtitle_entries.length} entries`);

    const textsToTranslate = batch.subtitle_entries.map(entry => entry.text);

    await job.updateProgress(30);
    await job.log('[STEP] Translating batch...');

    const result = await translateText(
      textsToTranslate,
      targetLanguage,
      provider,
      apikey,
      base_url,
      model_name
    );

    await job.updateProgress(80);
    await job.log(`[INFO] Translation completed. Tokens used: ${result.tokenUsage}`);

    const translatedEntries = batch.subtitle_entries.map((entry, idx) => ({
      index: entry.index,
      counter: entry.counter,
      timecode: entry.timecode,
      text: result.translatedText[idx]
    }));

    await connection.updateBatchTranslation(batchId, translatedEntries, result.tokenUsage);

    await job.updateProgress(90);
    await job.log('[COMPLETE] Batch translation saved');

    const translationQueueId = await connection.getTranslationQueueIdFromBatch(batchId);
    const allComplete = await connection.areAllBatchesComplete(translationQueueId);

    if (allComplete) {
      await job.log('[TRIGGER] All batches complete - assembling final subtitle');
      await assembleFinalSubtitle(translationQueueId);
    }

    await job.updateProgress(100);

    return { success: true, tokenUsage: result.tokenUsage };
  },
  {
    connection: redisConnection.duplicate(),
    concurrency: parseInt(process.env.BATCH_QUEUE_CONCURRENCY) || 20,
  }
);

async function assembleFinalSubtitle(translationQueueId) {
  console.log(`[ASSEMBLY] Starting final subtitle assembly for translation ${translationQueueId}`);

  const adapter = await connection.getAdapter();
  const queueInfo = await adapter.query(
    `SELECT series_imdbid, series_seasonno, series_episodeno, langcode, password_hash FROM translation_queue WHERE id = ?`,
    [translationQueueId]
  );

  if (queueInfo.length === 0) {
    throw new Error(`Translation queue ${translationQueueId} not found`);
  }

  const { series_imdbid, series_seasonno, series_episodeno, langcode, password_hash } = queueInfo[0];

  const batches = await connection.getBatchesForTranslation(translationQueueId);

  if (batches.length === 0) {
    throw new Error('No batches found');
  }

  console.log(`[ASSEMBLY] Found ${batches.length} batches`);

  const allEntries = [];
  let totalTokens = 0;

  for (const batch of batches) {
    allEntries.push(...batch.translated_entries);
    totalTokens += batch.token_usage || 0;
  }

  allEntries.sort((a, b) => a.index - b.index);

  console.log(`[ASSEMBLY] Assembled ${allEntries.length} subtitle entries`);

  const output = [];
  for (const entry of allEntries) {
    output.push(
      entry.counter,
      entry.timecode,
      entry.text,
      ""
    );
  }

  const provider = password_hash || `translated-${langcode}`;
  const dirPath = series_seasonno !== null && series_episodeno !== null
    ? `subtitles/${provider}/${langcode}/${series_imdbid}/season${series_seasonno}`
    : `subtitles/${provider}/${langcode}/${series_imdbid}`;

  await fs.mkdir(dirPath, { recursive: true });

  const type = series_seasonno && series_episodeno ? "series" : "movie";
  const newSubtitleFilePath = series_seasonno && series_episodeno
    ? `${dirPath}/${series_imdbid}-translated-${series_episodeno}-1.srt`
    : `${dirPath}/${series_imdbid}-translated-1.srt`;

  await fs.writeFile(newSubtitleFilePath, output.join("\n"), { flag: "w" });

  console.log(`[ASSEMBLY] File written: ${newSubtitleFilePath}`);

  if (!(await connection.checkseries(series_imdbid))) {
    await connection.addseries(series_imdbid, type);
  }

  if (totalTokens > 0) {
    await connection.updateTokenUsage(
      series_imdbid,
      series_seasonno,
      series_episodeno,
      langcode,
      totalTokens
    );
  }

  await connection.updateTranslationStatus(
    series_imdbid,
    series_seasonno,
    series_episodeno,
    langcode,
    'completed'
  );

  console.log(`[ASSEMBLY] Subtitle assembly finished successfully!`);
}

worker.on("completed", (job) => {
  console.log(`Batch job ${job.id} completed successfully`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Batch job ${job.id} failed:`, err.message);
  console.error(`   Attempts made: ${job.attemptsMade}, Max attempts: 3`);

  try {
    if (job?.log) {
      await job.log(`[FAILED] Batch failed after attempt ${job.attemptsMade}: ${err.message}`);
    }

    if (job.data.batchId && job.attemptsMade >= 3) {
      console.log(`🚨 Batch ${job.data.batchId} failed all attempts - CANCELING ALL BATCHES AND MARKING AS FAILED`);
      if (job?.log) await job.log(`[CRITICAL] Batch ${job.data.batchId} failed all 3 attempts - Canceling remaining batches`);

      await connection.updateBatchStatus(job.data.batchId, 'failed');
      console.log(`   ✓ Batch ${job.data.batchId} marked as failed`);

      const translationQueueId = await connection.getTranslationQueueIdFromBatch(job.data.batchId);
      console.log(`   Translation Queue ID: ${translationQueueId}`);
      if (job?.log) await job.log(`[INFO] Translation Queue ID: ${translationQueueId}`);

      if (translationQueueId) {
        const adapter = await connection.getAdapter();

        const cancelResult = await adapter.query(
          `UPDATE subtitle_batches SET status = 'failed' WHERE translation_queue_id = ? AND status IN ('pending', 'processing')`,
          [translationQueueId]
        );
        console.log(`   ✓ Canceled all pending/processing batches for translation ${translationQueueId}`);
        if (job?.log) await job.log(`[ACTION] Canceled all remaining batches for this translation`);

        const queueInfo = await adapter.query(
          `SELECT series_imdbid, series_seasonno, series_episodeno, langcode, password_hash FROM translation_queue WHERE id = ?`,
          [translationQueueId]
        );

        if (queueInfo.length > 0) {
          const { series_imdbid, series_seasonno, series_episodeno, langcode, password_hash } = queueInfo[0];
          console.log(`   Found translation: ${series_imdbid} S${series_seasonno}E${series_episodeno} -> ${langcode}`);

          const { createOrUpdateMessageSub } = require('../subtitles');
          const providerPath = password_hash || `translated-${langcode}`;

          await createOrUpdateMessageSub(
            "An error occurred while generating your subtitle. We will try again.",
            series_imdbid,
            series_seasonno,
            series_episodeno,
            langcode,
            providerPath
          );
          console.log(`   ✓ Created error message subtitle`);
          if (job?.log) await job.log(`[ACTION] Created error message subtitle file`);

          await connection.updateTranslationStatus(
            series_imdbid,
            series_seasonno,
            series_episodeno,
            langcode,
            'failed'
          );

          console.log(`   ✅ Translation ${translationQueueId} marked as FAILED successfully`);
          if (job?.log) await job.log(`[COMPLETE] Translation marked as FAILED in database`);
        } else {
          console.error(`   ❌ Queue info not found for translation ${translationQueueId}`);
          if (job?.log) await job.log(`[ERROR] Queue info not found for translation ${translationQueueId}`);
        }
      } else {
        console.error(`   ❌ Could not get translation queue ID for batch ${job.data.batchId}`);
        if (job?.log) await job.log(`[ERROR] Could not get translation queue ID`);
      }
    } else if (job.data.batchId) {
      console.log(`   ⚠️  Batch ${job.data.batchId} failed (attempt ${job.attemptsMade}/3) - will retry`);
      if (job?.log) await job.log(`[RETRY] Batch failed (attempt ${job.attemptsMade}/3) - will retry`);
      await connection.updateBatchStatus(job.data.batchId, 'failed');
    }
  } catch (error) {
    console.error(`   ❌ Error handling batch failure:`, error);
    if (job?.log) await job.log(`[ERROR] Exception while handling failure: ${error.message}`);
  }
});

worker.on("error", (err) => {
  console.error("Batch worker error:", err);
});

module.exports = batchQueue;
