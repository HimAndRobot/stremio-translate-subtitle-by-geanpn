const axios = require("axios");

const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io";

/**
 * Cinemeta documents are cached in-process. A one hour episode is split into
 * ~14 batch jobs that all run in parallel, and every one of them wants the
 * same context block, so without this we would refetch the same document a
 * dozen times per episode. Failures are cached too (as null) so a missing or
 * unreachable entry does not produce 14 retries.
 */
const metaCache = new Map();
const META_CACHE_LIMIT = 200;

function cacheGet(key) {
  return metaCache.get(key);
}

function cacheSet(key, value) {
  if (metaCache.size >= META_CACHE_LIMIT) {
    // Cheap eviction: drop the oldest insertion. Map preserves insertion order.
    const oldest = metaCache.keys().next();
    if (!oldest.done) {
      metaCache.delete(oldest.value);
    }
  }
  metaCache.set(key, value);
  return value;
}

/**
 * Fetch the raw Cinemeta meta object. No API key required - this is the same
 * metadata addon the Stremio client itself uses.
 */
async function fetchMeta(imdbid, type) {
  const key = `${type}:${imdbid}`;
  if (metaCache.has(key)) {
    return cacheGet(key);
  }

  try {
    const url = `${CINEMETA_BASE_URL}/meta/${type}/${imdbid}.json`;
    const response = await axios.get(url, { timeout: 5000 });

    if (response.data && response.data.meta && response.data.meta.name) {
      return cacheSet(key, response.data.meta);
    }

    return cacheSet(key, null);
  } catch (error) {
    console.error(`Failed to fetch Cinemeta meta for ${imdbid} (${type}):`, error.message);
    return cacheSet(key, null);
  }
}

/**
 * Fetch series/movie metadata from Stremio Cinemeta API
 * @param {string} imdbid - IMDB ID (e.g., "tt1234567")
 * @param {string} type - Content type ("series" or "movie")
 * @returns {Promise<Object>} - Metadata object with name, year, poster
 */
async function getMetadata(imdbid, type = "series") {
  let meta = await fetchMeta(imdbid, type);

  // Se falhar com type=series, tenta com type=movie
  if (!meta && type === "series") {
    meta = await fetchMeta(imdbid, "movie");
  }

  if (!meta) {
    return {
      name: imdbid, // Fallback para o IMDB ID
      year: null,
      poster: null,
      type: type,
      genres: [],
      description: null,
      runtime: null,
    };
  }

  return {
    name: meta.name,
    year: meta.year || null,
    poster: meta.poster || null,
    type: meta.type || type,
    // Kept for prompt context. Cinemeta already returns these in the same
    // response, so reading them costs no extra request.
    genres: meta.genres || [],
    description: meta.description || null,
    runtime: meta.runtime || null,
  };
}

function trim(text, limit) {
  if (!text) return null;
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Build a short, human-readable context block describing what is being
 * translated, for use as part of the translator system prompt.
 *
 * Subtitle cues arrive as isolated fragments with no indication of subject
 * matter, which makes domain terminology and homographs guesswork - "washplant"
 * in a gold mining show becomes "Waschpflanze" rather than "Waschanlage"
 * without it. Genre and premise are usually enough to resolve that.
 *
 * @returns {Promise<string|null>} context block, or null if nothing useful
 */
async function getEpisodeContext(imdbid, type = "series", season = null, episode = null) {
  if (!imdbid) return null;

  const meta = (await fetchMeta(imdbid, type)) || (type === "series" ? await fetchMeta(imdbid, "movie") : null);
  if (!meta) return null;

  const lines = [];
  const kind = (meta.type || type) === "series" ? "series" : "film";

  let heading = `The subtitles below are from the ${kind} "${meta.name}"`;
  if (meta.year) heading += ` (${meta.year})`;
  if (meta.genres && meta.genres.length) heading += `, genre: ${meta.genres.join(", ")}`;
  lines.push(`${heading}.`);

  const description = trim(meta.description, 400);
  if (description) lines.push(`Premise: ${description}`);

  if (season != null && episode != null && Array.isArray(meta.videos)) {
    const match = meta.videos.find(
      (v) => Number(v.season) === Number(season) && Number(v.episode) === Number(episode)
    );

    if (match) {
      const label = `Episode S${season}E${episode}${match.name ? ` "${match.name}"` : ""}`;
      const overview = trim(match.overview || match.description, 400);
      lines.push(overview ? `${label}: ${overview}` : `${label}.`);
    }
  }

  return lines.length ? lines.join("\n") : null;
}

module.exports = {
  getMetadata,
  getEpisodeContext,
};
