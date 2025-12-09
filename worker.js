require("dotenv").config();
const { createWorker, setupWorkerEvents } = require("./queues/batchQueue");

console.log("Worker process started");

const worker = createWorker();
setupWorkerEvents(worker);

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: forcing worker exit");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: forcing worker exit");
  process.exit(0);
});
