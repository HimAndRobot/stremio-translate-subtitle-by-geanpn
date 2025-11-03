const fs = require("fs").promises;

async function createOrUpdateMessageSub(
  placeholderText,
  subtitlePath
) {
  try {
    const fullPath = `subtitles/${subtitlePath}`;
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

    const placeholderSub = [
      "1",
      "00:00:01,000 --> 00:10:50,000",
      placeholderText,
      "",
    ].join("\n");

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(fullPath, placeholderSub);
  } catch (error) {
    console.error("Error creating or updating placeholder subtitle:", error);
    throw error;
  }
}

module.exports = { createOrUpdateMessageSub };
