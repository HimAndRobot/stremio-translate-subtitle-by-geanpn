/**
 * Required dependencies
 */
const opensubtitles = require("./opensubtitles");
const connection = require("./connection");
const fs = require("fs").promises;
const { translateText } = require("./translateProvider");
const { createOrUpdateMessageSub } = require("./subtitles");
const { encryptCredential } = require("./utils/crypto");
const { getMetadata } = require("./utils/metadata");
const crypto = require("crypto");

class SubtitleProcessor {
  constructor() {
    this.subcounts = [];
    this.timecodes = [];
    this.texts = [];
    this.translatedSubtitle = [];
    this.count = 0;
    this.totalTokens = 0;
  }

  async processSubtitles(
    filepath,
    imdbid,
    season = null,
    episode = null,
    oldisocode,
    provider,
    apikey,
    base_url,
    model_name
  ) {
    try {
      this.totalTokens = 0;

      const originalSubtitleFilePath = filepath[0];
      const originalSubtitleContent = await fs.readFile(
        originalSubtitleFilePath,
        { encoding: "utf-8" }
      );
      const lines = originalSubtitleContent.split("\n");

      const batchSize = provider === "ChatGPT API" ? 50 : 60;
      let subtitleBatch = [];
      let currentBlock = {
        iscount: true,
        istimecode: false,
        istext: false,
        textcount: 0,
      };

      // Process subtitle file line by line
      for (const line of lines) {
        if (line.trim() === "") {
          currentBlock = {
            iscount: true,
            istimecode: false,
            istext: false,
            textcount: 0,
          };

          if (this.texts.length > 0) {
            subtitleBatch.push(this.texts[this.texts.length - 1]);
          }

          // Translate when batch size is reached
          if (subtitleBatch.length === batchSize) {
            try {
              const tokens = await this.translateBatch(
                subtitleBatch,
                oldisocode,
                provider,
                apikey,
                base_url,
                model_name
              );
              this.totalTokens += tokens;
              subtitleBatch = [];
            } catch (error) {
              console.error("Batch translation error: ", error);
              throw error;
            }
          }
          continue;
        }

        if (currentBlock.iscount) {
          this.subcounts.push(line);
          currentBlock = {
            iscount: false,
            istimecode: true,
            istext: false,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.istimecode) {
          this.timecodes.push(line);
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
            this.texts.push(line);
          } else {
            this.texts[this.texts.length - 1] += "\n" + line;
          }
          currentBlock.textcount++;
        }
      }

      // Process remaining batch
      if (subtitleBatch.length > 0) {
        try {
          subtitleBatch.push(this.texts[this.texts.length - 1]);
          const tokens = await this.translateBatch(
            subtitleBatch,
            oldisocode,
            provider,
            apikey,
            base_url,
            model_name
          );
          this.totalTokens += tokens;
        } catch (error) {
          console.log("Subtitle batch error: ", error);
          throw error;
        }
      }

      // Save translated subtitles
      try {
        await this.saveTranslatedSubs(
          imdbid,
          season,
          episode,
          oldisocode,
          provider
        );
        console.log(`Subtitles saved successfully. Total tokens used: ${this.totalTokens}`);
        return this.totalTokens;
      } catch (error) {
        console.error("Error saving translated subtitles:", error);
        throw error;
      }
    } catch (error) {
      console.error("Error:", error.message);
      throw error;
    }
  }

  async translateBatch(
    subtitleBatch,
    oldisocode,
    provider,
    apikey,
    base_url,
    model_name
  ) {
    try {
      const result = await translateText(
        subtitleBatch,
        oldisocode,
        provider,
        apikey,
        base_url,
        model_name
      );

      const translations = result.translatedText;
      const tokenUsage = result.tokenUsage || 0;

      translations.forEach((translatedText) => {
        this.translatedSubtitle.push(translatedText);
      });

      console.log(`Batch translation completed. Tokens used: ${tokenUsage}`);
      return tokenUsage;
    } catch (error) {
      console.error("Batch translation error:", error);
      throw error;
    }
  }

  async saveTranslatedSubs(
    imdbid,
    season = null,
    episode = null,
    oldisocode,
    provider
  ) {
    try {
      // Define directory path based on content type and provider
      const dirPath =
        season !== null && episode !== null
          ? `subtitles/${provider}/${oldisocode}/${imdbid}/season${season}`
          : `subtitles/${provider}/${oldisocode}/${imdbid}`;

      // Create directory if it doesn't exist
      await fs.mkdir(dirPath, { recursive: true });

      // Create file path and determine content type
      const type = season && episode ? "series" : "movie";
      const newSubtitleFilePath =
        season && episode
          ? `${dirPath}/${imdbid}-translated-${episode}-1.srt`
          : `${dirPath}/${imdbid}-translated-1.srt`;

      // Build subtitle content
      const output = [];
      for (let i = 0; i < this.subcounts.length; i++) {
        output.push(
          this.subcounts[i],
          this.timecodes[i],
          this.translatedSubtitle[i],
          ""
        );
      }

      // Save file and update database
      await fs.writeFile(newSubtitleFilePath, output.join("\n"), { flag: "w" });

      if (!(await connection.checkseries(imdbid))) {
        await connection.addseries(imdbid, type);
      }

      console.log(
        `Subtitle translation and saving completed: ${newSubtitleFilePath}`
      );
    } catch (error) {
      console.error("Error saving translated subtitles:", error);
      throw error;
    }
  }
}

/**
 * Starts the subtitle translation process
 * @param {Object[]} subtitles - Array of subtitle objects to translate
 * @param {string} imdbid - IMDB ID of the media
 * @param {string|null} season - Season number (optional)
 * @param {string|null} episode - Episode number (optional)
 * @param {string} oldisocode - ISO code of the original language
 * @returns {Promise<boolean>} - Returns true on success, false otherwise
 */
async function startTranslation(
  subtitles,
  imdbid,
  season = null,
  episode = null,
  oldisocode,
  provider,
  apikey,
  base_url,
  model_name,
  password = null,
  saveCredentials = true
) {
  let filepaths = [];
  let success = false;

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
          console.log('Credentials encrypted and will be saved');
        } else {
          console.log('Password saved, credentials NOT saved (Save Access Only mode)');
        }
      }
    }

    const existingStatus = await connection.checkForTranslation(
      imdbid,
      season,
      episode,
      oldisocode
    );

    let series_name = null;
    let poster = null;
    if (!existingStatus) {
      try {
        const type = season && episode ? "series" : "movie";
        const metadata = await getMetadata(imdbid, type);
        series_name = metadata.name;
        poster = metadata.poster;
        console.log(`Fetched metadata: ${series_name}`);
      } catch (metaError) {
        console.error("Failed to fetch series metadata:", metaError.message);
        series_name = imdbid;
      }

      await connection.addToTranslationQueue(
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
      await connection.updateTranslationCredentials(
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

    const processor = new SubtitleProcessor();
    filepaths = await opensubtitles.downloadSubtitles(
      subtitles,
      imdbid,
      season,
      episode,
      oldisocode
    );

    if (filepaths && filepaths.length > 0) {
      const totalTokens = await processor.processSubtitles(
        filepaths,
        imdbid,
        season,
        episode,
        oldisocode,
        provider,
        apikey,
        base_url,
        model_name
      );

      if (totalTokens > 0) {
        try {
          await connection.updateTokenUsage(
            imdbid,
            season,
            episode,
            oldisocode,
            totalTokens
          );
          console.log(`Token usage updated: ${totalTokens} tokens`);
        } catch (tokenError) {
          console.error("Failed to update token usage:", tokenError);
        }
      }

      console.log("Translation process completed successfully");
      success = true;
      return true;
    }

    console.error("No subtitle files to process");
    success = false;
    return false;
  } catch (error) {
    console.error("General catch error:", error);
    success = false;

    try {
      await createOrUpdateMessageSub(
        "An error occurred while generating your subtitle. We will try again.",
        imdbid,
        season,
        episode,
        oldisocode,
        provider
      );
    } catch (subError) {
      console.error("Error creating error subtitle:", subError);
    }

    return false;
  } finally {
    for (const fp of filepaths) {
      try {
        await fs.unlink(fp);
        console.log(`Cleaned up downloaded file: ${fp}`);
      } catch (unlinkError) {
        console.error(`Error cleaning up file ${fp}:`, unlinkError);
      }
    }

    try {
      const finalStatus = success ? 'completed' : 'failed';
      await connection.updateTranslationStatus(
        imdbid,
        season,
        episode,
        oldisocode,
        finalStatus
      );
      console.log(`Updated translation queue status to: ${finalStatus}`);
    } catch (dbUpdateError) {
      console.error("Error updating translation queue status:", dbUpdateError);
    }
  }
}

module.exports = { startTranslation };
