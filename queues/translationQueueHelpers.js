const dbConnection = require("../connection");
const opensubtitles = require("../opensubtitles");
const { getMetadata } = require("../utils/metadata");
const fs = require("fs").promises;

async function resolveImdbFromStremioId(stremioId, extra, job) {
  let imdbid = null;
  let season = null;
  let episode = null;
  let type = null;

  await job.log(`[RESOLVE] Resolving IMDb ID from stremioId: ${stremioId}`);

  if (stremioId.startsWith("kkh-")) {
    await job.log('[RESOLVE] KissKH format detected');
    const integrations = require("../integrations");
    const resolved = await integrations.kisskh.resolveKissKHId(stremioId);
    if (resolved) {
      imdbid = resolved.imdbid;
      season = resolved.season;
      episode = resolved.episode;
      type = "series";
      await job.log(`[RESOLVE] KissKH resolved to ${imdbid} S${season}E${episode}`);
    } else {
      throw new Error('Failed to resolve KissKH ID');
    }
  } else if (stremioId.startsWith("dcool-")) {
    await job.log('[RESOLVE] DCool format detected');
    imdbid = "tt5994346";
    const match = stremioId.match(/dcool-(.+)::(.+)-episode-(\d+)/);
    if (match) {
      const [, , title, ep] = match;
      type = "series";
      season = 1;
      episode = Number(ep);
      await job.log(`[RESOLVE] DCool resolved to ${imdbid} S${season}E${episode}`);
    } else {
      throw new Error('Invalid DCool format');
    }
  } else if (stremioId !== null && stremioId.startsWith("tt")) {
    await job.log('[RESOLVE] IMDb format detected');
    const parts = stremioId.split(":");
    imdbid = parts[0];

    const match = stremioId.match(/tt(\d+):(\d+):(\d+)/);
    if (match) {
      const [, , s, e] = match;
      type = "series";
      season = Number(s);
      episode = Number(e);
      await job.log(`[RESOLVE] IMDb resolved to ${imdbid} S${season}E${episode}`);
    } else {
      type = "movie";
      season = 1;
      episode = 1;
      await job.log(`[RESOLVE] IMDb resolved to ${imdbid} (movie)`);
    }
  }

  if (!imdbid && extra && extra.filename) {
    await job.log(`[RESOLVE] Trying Cinemeta fallback with filename: ${extra.filename}`);
    try {
      const { searchContent } = require("../utils/search");
      const searchResults = await searchContent(extra.filename);

      if (searchResults.results && searchResults.results.length > 0) {
        imdbid = searchResults.results[0].id;
        type = searchResults.results[0].type;
        await job.log(`[RESOLVE] Cinemeta found: ${imdbid} (${searchResults.results[0].name})`);

        if (type === "movie") {
          season = 1;
          episode = 1;
        }
      }
    } catch (error) {
      await job.log(`[RESOLVE] Cinemeta fallback failed: ${error.message}`);
    }
  }

  if (!imdbid) {
    throw new Error('Could not resolve IMDb ID from stremioId');
  }

  return { imdbid, season, episode, type };
}

async function fetchSubtitlesFromOpenSubtitles(imdbid, season, episode, type, oldisocode, job) {
  await job.log('[OPENSUBTITLES] Consulting OpenSubtitles...');

  if (!type) {
    type = (season && episode && season !== 1 && episode !== 1) ? "series" : "movie";
  }

  const fetchedSubs = await opensubtitles.getsubtitles(
    type,
    imdbid,
    season,
    episode,
    oldisocode
  );

  if (!fetchedSubs || fetchedSubs.length === 0) {
    throw new Error('No subtitles found on OpenSubtitles');
  }

  await job.log(`[OPENSUBTITLES] Found ${fetchedSubs.length} subtitle(s)`);

  const isoCodeMapping = require("../langs/iso_code_mapping.json");
  const foundSubtitle = fetchedSubs[0];
  const mappedFoundSubtitleLang = isoCodeMapping[foundSubtitle.lang] || foundSubtitle.lang;

  if (mappedFoundSubtitleLang === oldisocode) {
    await job.log('[OPENSUBTITLES] Subtitle already in target language, saving directly');
    await dbConnection.addsubtitle(
      imdbid,
      type,
      season,
      episode,
      foundSubtitle.url.replace(`${process.env.BASE_URL}/`, ""),
      oldisocode
    );
    return { skipped: true, subtitles: null };
  }

  return { skipped: false, subtitles: fetchedSubs };
}

async function updateDatabaseWithResolvedData(stremioId, imdbid, season, episode, type, oldisocode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, job) {
  let series_name = null;
  let poster = null;

  try {
    if (!type) {
      type = (season && episode) ? "series" : "movie";
    }
    const metadata = await getMetadata(imdbid, type);
    series_name = metadata.name;
    poster = metadata.poster;
  } catch (metaError) {
    console.error("Failed to fetch metadata:", metaError.message);
    series_name = imdbid;
  }

  const adapter = await dbConnection.getAdapter();
  await adapter.query(
    `UPDATE translation_queue
     SET series_imdbid = ?, series_seasonno = ?, series_episodeno = ?,
         series_name = ?, poster = ?, apikey_encrypted = ?,
         base_url_encrypted = ?, model_name_encrypted = ?
     WHERE stremio_id = ? AND langcode = ? AND (password_hash = ? OR (password_hash IS NULL AND ? IS NULL))`,
    [imdbid, season, episode, series_name, poster, apikey_encrypted,
     base_url_encrypted, model_name_encrypted, stremioId, oldisocode, password_hash, password_hash]
  );

  await job.log(`[UPDATE] Updated translation_queue with resolved IMDb data`);
}

async function parseSRTFile(filePath, job) {
  await job.log('[STEP 2/4] Parsing SRT file...');

  const originalSubtitleContent = await fs.readFile(filePath, { encoding: "utf-8" });
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

  return { subcounts, timecodes, texts, originalContent: originalSubtitleContent };
}

async function getTranslationQueueId(imdbid, season, episode, oldisocode) {
  const adapter = await dbConnection.getAdapter();
  const queueResult = await adapter.query(
    `SELECT id FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?`,
    [imdbid, season, episode, oldisocode]
  );

  if (queueResult.length === 0) {
    throw new Error('Translation queue entry not found');
  }

  return queueResult[0].id;
}

module.exports = {
  resolveImdbFromStremioId,
  fetchSubtitlesFromOpenSubtitles,
  updateDatabaseWithResolvedData,
  parseSRTFile,
  getTranslationQueueId
};
