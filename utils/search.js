const axios = require("axios");

const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io";

async function searchContent(query) {
  if (!query || query.trim().length === 0) {
    return { results: [] };
  }

  try {
    const results = [];

    const movieResponse = await axios.get(
      `${CINEMETA_BASE_URL}/catalog/movie/top/search=${encodeURIComponent(query)}.json`,
      { timeout: 5000 }
    );

    if (movieResponse.data && movieResponse.data.metas) {
      results.push(...movieResponse.data.metas.map(meta => ({
        ...meta,
        contentType: 'movie'
      })));
    }

    const seriesResponse = await axios.get(
      `${CINEMETA_BASE_URL}/catalog/series/top/search=${encodeURIComponent(query)}.json`,
      { timeout: 5000 }
    );

    if (seriesResponse.data && seriesResponse.data.metas) {
      results.push(...seriesResponse.data.metas.map(meta => ({
        ...meta,
        contentType: 'series'
      })));
    }

    return { results };
  } catch (error) {
    console.error("Search error:", error.message);
    return { results: [], error: error.message };
  }
}

async function getEpisodes(imdbId) {
  try {
    const response = await axios.get(
      `${CINEMETA_BASE_URL}/meta/series/${imdbId}.json`,
      { timeout: 5000 }
    );

    if (!response.data || !response.data.meta) {
      return { episodes: [], name: '', poster: '' };
    }

    const meta = response.data.meta;
    const episodes = [];

    if (meta.videos) {
      for (const video of meta.videos) {
        episodes.push({
          id: video.id,
          season: video.season,
          episode: video.episode,
          title: video.title || `Episode ${video.episode}`,
          released: video.released || null
        });
      }
    }

    return {
      episodes,
      name: meta.name || '',
      poster: meta.poster || '',
      year: meta.year || null
    };
  } catch (error) {
    console.error("Get episodes error:", error.message);
    return { episodes: [], error: error.message };
  }
}

module.exports = {
  searchContent,
  getEpisodes
};
