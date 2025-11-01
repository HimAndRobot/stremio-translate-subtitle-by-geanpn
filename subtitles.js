const fs = require("fs").promises;

async function createOrUpdateMessageSub(
  placeholderText,
  imdbid,
  season = null,
  episode = null,
  oldisocode,
  provider
) {
  try {
    // Create placeholder subtitle before download
    let newSubtitleFilePath = null;

    if (season && episode) {
      newSubtitleFilePath = `subtitles/${provider}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
    } else {
      newSubtitleFilePath = `subtitles/${provider}/${imdbid}/${imdbid}-translated-1.srt`;
    }

    // Create basic structure for placeholder subtitle
    const placeholderSub = [
      "1",
      "00:00:01,000 --> 00:10:50,000",
      placeholderText,
      "",
    ].join("\n");

    // Ensure directory exists
    const dir = newSubtitleFilePath.substring(
      0,
      newSubtitleFilePath.lastIndexOf("/")
    );
    await fs.mkdir(dir, { recursive: true });

    // Create or update the file
    await fs.writeFile(newSubtitleFilePath, placeholderSub);
  } catch (error) {
    console.error("Error creating or updating placeholder subtitle:", error);
    throw error;
  }
}

module.exports = { createOrUpdateMessageSub };
