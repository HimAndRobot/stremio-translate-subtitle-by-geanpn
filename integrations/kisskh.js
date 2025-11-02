const axios = require("axios");
const { searchContent } = require("../utils/search");

const KISSKH_API = "https://kisskh.co/api/DramaList/Drama";

// Cache em memória para evitar chamadas repetidas
const cache = new Map();

/**
 * Resolve KissKH ID para IMDB ID
 * @param {string} id - Formato: "kkh-3163::65119"
 * @returns {Promise<{imdbid: string, season: number, episode: number}|null>}
 */
async function resolveKissKHId(id) {
  try {
    console.log(`[KissKH] Resolving ID: ${id}`);

    // Extrair seriesId e episodeId
    const match = id.match(/kkh-(\d+)::(\d+)/);
    if (!match) {
      console.log(`[KissKH] Invalid format: ${id}`);
      return null;
    }

    const kkhSeriesId = match[1];
    const kkhEpisodeId = match[2];

    console.log(`[KissKH] Series ID: ${kkhSeriesId}, Episode ID: ${kkhEpisodeId}`);

    // Verificar cache
    const cacheKey = `series-${kkhSeriesId}`;
    let seriesData = cache.get(cacheKey);

    if (!seriesData) {
      // Buscar na API KissKH
      console.log(`[KissKH] Fetching from API: ${KISSKH_API}/${kkhSeriesId}`);
      const response = await axios.get(`${KISSKH_API}/${kkhSeriesId}?isq=false`, {
        timeout: 10000,
      });

      if (!response.data || !response.data.title) {
        console.log(`[KissKH] No data returned from API`);
        return null;
      }

      seriesData = {
        title: response.data.title,
        episodes: response.data.episodes || [],
      };

      // Salvar no cache
      cache.set(cacheKey, seriesData);
      console.log(`[KissKH] Cached series: "${seriesData.title}"`);
    } else {
      console.log(`[KissKH] Using cached data for series: "${seriesData.title}"`);
    }

    // Buscar IMDB ID usando Cinemeta
    console.log(`[KissKH] Searching Cinemeta for: "${seriesData.title}"`);
    const searchResults = await searchContent(seriesData.title);

    if (!searchResults.results || searchResults.results.length === 0) {
      console.log(`[KissKH] No results found in Cinemeta for: "${seriesData.title}"`);
      return null;
    }

    const firstResult = searchResults.results[0];
    const imdbid = firstResult.id;

    console.log(`[KissKH] Found IMDB ID: ${imdbid} (${firstResult.name})`);

    // Mapear episódio
    const episode = seriesData.episodes.find((ep) => ep.id == kkhEpisodeId);
    const episodeNumber = episode ? episode.number : 1;

    console.log(`[KissKH] Episode mapping: KKH #${kkhEpisodeId} → Episode ${episodeNumber}`);

    // K-dramas normalmente são season 1
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
