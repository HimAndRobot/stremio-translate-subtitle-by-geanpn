const axios = require("axios");

/**
 * Fetch series/movie metadata from Stremio Cinemeta API
 * @param {string} imdbid - IMDB ID (e.g., "tt1234567")
 * @param {string} type - Content type ("series" or "movie")
 * @returns {Promise<Object>} - Metadata object with name, year, poster
 */
async function getMetadata(imdbid, type = "series") {
  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbid}.json`;
    const response = await axios.get(url, { timeout: 5000 });

    if (response.data && response.data.meta && response.data.meta.name) {
      return {
        name: response.data.meta.name,
        year: response.data.meta.year || null,
        poster: response.data.meta.poster || null,
        type: response.data.meta.type || type,
      };
    }

    throw new Error(`No metadata found for ${imdbid} as ${type}`);
  } catch (error) {
    console.error(`Failed to fetch metadata for ${imdbid}:`, error.message);

    // Se falhar com type=series, tenta com type=movie
    if (type === "series") {
      try {
        return await getMetadata(imdbid, "movie");
      } catch (retryError) {
        console.error(`Failed to fetch metadata as movie for ${imdbid}:`, retryError.message);
      }
    }

    return {
      name: imdbid, // Fallback para o IMDB ID
      year: null,
      poster: null,
      type: type,
    };
  }
}

module.exports = {
  getMetadata,
};
