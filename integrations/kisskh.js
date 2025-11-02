const axios = require("axios");
const { searchContent } = require("../utils/search");

// Using Cloudflare Worker to bypass datacenter IP blocking
const KISSKH_API = "https://kisskh-proxy.kisskhstremiotranslate.workers.dev/api";

/**
 * Resolve KissKH ID to IMDB ID
 * @param {string} id - Format: "kkh-3163::65119"
 * @returns {Promise<{imdbid: string, season: number, episode: number}|null>}
 */
async function resolveKissKHId(id) {
  try {
    console.log(`[KissKH] Resolving ID: ${id}`);

    // Extract seriesId and episodeId
    const match = id.match(/kkh-(\d+)::(\d+)/);
    if (!match) {
      console.log(`[KissKH] Invalid format: ${id}`);
      return null;
    }

    const kkhSeriesId = match[1];
    const kkhEpisodeId = match[2];

    console.log(`[KissKH] Series ID: ${kkhSeriesId}, Episode ID: ${kkhEpisodeId}`);

    // Fetch via Cloudflare Worker (bypass datacenter IP blocking)
    console.log(`[KissKH] Fetching from Worker: ${KISSKH_API}/${kkhSeriesId}`);
    const response = await axios.get(`${KISSKH_API}/${kkhSeriesId}`, {
      timeout: 10000,
    });

    if (!response.data || !response.data.title) {
      console.log(`[KissKH] No data returned from API`);
      return null;
    }

    const seriesData = {
      title: response.data.title,
      episodes: response.data.episodes || [],
    };

    console.log(`[KissKH] Series title: "${seriesData.title}"`);

    // Remove season number from title for better search results
    // "Single's Inferno Season 4" → "Single's Inferno"
    const searchTitle = seriesData.title.replace(/\s+Season\s+\d+/i, '').trim();

    console.log(`[KissKH] Searching Cinemeta for: "${searchTitle}"`);
    const searchResults = await searchContent(searchTitle);

    if (!searchResults.results || searchResults.results.length === 0) {
      console.log(`[KissKH] No results found in Cinemeta for: "${seriesData.title}"`);
      return null;
    }

    // Try to find best match (exact or close title match)
    const normalizedTitle = seriesData.title.toLowerCase().replace(/[^\w\s]/g, '');
    let bestMatch = searchResults.results[0];

    for (const result of searchResults.results) {
      const resultTitle = (result.name || '').toLowerCase().replace(/[^\w\s]/g, '');
      if (resultTitle === normalizedTitle || resultTitle.includes(normalizedTitle.split(' ')[0])) {
        bestMatch = result;
        break;
      }
    }

    const imdbid = bestMatch.id;
    console.log(`[KissKH] Found IMDB ID: ${imdbid} (${bestMatch.name})`);

    // Map episode
    const episode = seriesData.episodes.find((ep) => ep.id == kkhEpisodeId);
    const episodeNumber = episode ? episode.number : 1;

    console.log(`[KissKH] Episode mapping: KKH #${kkhEpisodeId} → Episode ${episodeNumber}`);

    return {
      imdbid: imdbid,
      season: 1,
      episode: episodeNumber,
    };
  } catch (error) {
    console.error(`[KissKH] Error resolving ID:`, error.message);
    return null;
  }
}

module.exports = {
  resolveKissKHId,
};
