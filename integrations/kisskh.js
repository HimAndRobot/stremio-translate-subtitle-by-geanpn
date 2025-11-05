const axios = require("axios");
const { searchContent } = require("../utils/search");

// Using Cloudflare Worker to bypass datacenter IP blocking
const KISSKH_API = "https://kisskh-proxy.kisskhstremiotranslate.workers.dev/api";

/**
 * Resolve KissKH ID to IMDB ID
 * @param {string} id - Format: "kkh-3163::65119"
 * @returns {Promise<{imdbid: string, season: number, episode: number}|null>}
 */
async function resolveKissKHId(id, password_hash = null) {
  try {
    console.log(`[KissKH] Resolving ID: ${id}`);

    const match = id.match(/kkh-(\d+)::(\d+)/);
    if (!match) {
      console.log(`[KissKH] Invalid format: ${id}`);
      return null;
    }

    const kkhSeriesId = match[1];
    const kkhEpisodeId = match[2];

    console.log(`[KissKH] Series ID: ${kkhSeriesId}, Episode ID: ${kkhEpisodeId}`);

    const seriesPrefix = `kkh-${kkhSeriesId}::`;
    console.log(`[KissKH] Checking database cache for: ${seriesPrefix}%`);

    const connection = require("../connection");
    const adapter = await connection.getAdapter();
    const existingSeries = await adapter.query(
      `SELECT series_imdbid, series_name FROM translation_queue WHERE stremio_id LIKE ? AND series_imdbid != 'unknown' AND password_hash ${password_hash ? '= ?' : 'IS NULL'} LIMIT 1`,
      password_hash ? [`${seriesPrefix}%`, password_hash] : [`${seriesPrefix}%`]
    );

    if (existingSeries.length > 0) {
      console.log(`[KissKH] Found cached series: ${existingSeries[0].series_imdbid} (${existingSeries[0].series_name})`);

      const response = await axios.get(`${KISSKH_API}/${kkhSeriesId}`, { timeout: 10000 });
      const episodeData = response.data.episodes?.find(ep => ep.id == kkhEpisodeId);
      const episodeNumber = episodeData ? episodeData.number : 1;

      return {
        imdbid: existingSeries[0].series_imdbid,
        season: 1,
        episode: episodeNumber,
        similarity: 1.0,
      };
    }

    console.log(`[KissKH] No cache found, fetching from Worker: ${KISSKH_API}/${kkhSeriesId}`);
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

    const searchTitle = seriesData.title.replace(/\s+Season\s+\d+/i, '').trim();

    console.log(`[KissKH] Searching Cinemeta for: "${searchTitle}"`);
    const searchResults = await searchContent(searchTitle);

    if (!searchResults.results || searchResults.results.length === 0) {
      console.log(`[KissKH] No results found in Cinemeta for: "${seriesData.title}"`);
      return null;
    }

    function levenshteinDistance(str1, str2) {
      const len1 = str1.length;
      const len2 = str2.length;
      const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

      for (let i = 0; i <= len1; i++) matrix[i][0] = i;
      for (let j = 0; j <= len2; j++) matrix[0][j] = j;

      for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
          const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost
          );
        }
      }

      return matrix[len1][len2];
    }

    function calculateSimilarity(search, target) {
      const s1 = search.toLowerCase().trim();
      const s2 = target.toLowerCase().trim();

      if (s1 === s2) return 1.0;

      const distance = levenshteinDistance(s1, s2);
      const maxLen = Math.max(s1.length, s2.length);
      const exactScore = 1 - (distance / maxLen);

      if (s2.includes(s1)) return Math.max(exactScore, 0.95);
      if (s1.includes(s2)) return Math.max(exactScore, 0.90);

      const searchWords = s1.split(/\s+/).filter(w => w.length > 2);
      const targetWords = s2.split(/\s+/).filter(w => w.length > 2);

      let matchedWords = 0;
      searchWords.forEach(sw => {
        if (targetWords.some(tw => tw === sw || tw.includes(sw) || sw.includes(tw))) {
          matchedWords++;
        }
      });

      const partialScore = searchWords.length > 0 ? matchedWords / searchWords.length : 0;
      return (exactScore * 0.7) + (partialScore * 0.3);
    }

    let bestMatch = searchResults.results[0];
    let bestScore = calculateSimilarity(seriesData.title, bestMatch.name || '');

    console.log(`[KissKH] Comparing "${seriesData.title}" against ${searchResults.results.length} results:`);

    for (const result of searchResults.results) {
      const score = calculateSimilarity(seriesData.title, result.name || '');
      console.log(`  - "${result.name}": ${(score * 100).toFixed(1)}%`);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    const imdbid = bestMatch.id;
    console.log(`[KissKH] Best match: ${imdbid} (${bestMatch.name}) with ${(bestScore * 100).toFixed(1)}% similarity`);

    // Map episode
    const episode = seriesData.episodes.find((ep) => ep.id == kkhEpisodeId);
    const episodeNumber = episode ? episode.number : 1;

    console.log(`[KissKH] Episode mapping: KKH #${kkhEpisodeId} → Episode ${episodeNumber}`);

    return {
      imdbid: imdbid,
      season: 1,
      episode: episodeNumber,
      similarity: bestScore,
    };
  } catch (error) {
    console.error(`[KissKH] Error resolving ID:`, error.message);
    return null;
  }
}

module.exports = {
  resolveKissKHId,
};
