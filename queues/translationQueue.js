const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const processfiles = require("../processfiles");

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
    } = job.data;

    await job.log(`[START] Processing translation for ${imdbid}`);
    await job.log(`[INFO] Provider: ${provider}, Target Language: ${oldisocode}`);
    await job.log(`[INFO] Season: ${season}, Episode: ${episode}`);
    await job.log(`[INFO] Subtitles found: ${subs?.length || 0}`);

    console.log(`Processing job ${job.id} for ${imdbid}`);

    await job.updateProgress(10);
    await job.log('[STEP 1/3] Downloading subtitles from OpenSubtitles...');

    const result = await processfiles.startTranslation(
      subs,
      imdbid,
      season,
      episode,
      oldisocode,
      provider,
      apikey,
      base_url,
      model_name,
      password
    );

    await job.updateProgress(100);
    await job.log(`[COMPLETE] Translation finished successfully!`);
    await job.log(`[RESULT] ${result ? 'Subtitle file created' : 'Translation failed'}`);

    return result;
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
    jobId: `${jobData.imdbid}-${jobData.season}-${jobData.episode}-${jobData.oldisocode}`,
  });
};

module.exports = translationQueue;
