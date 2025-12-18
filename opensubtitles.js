const axios = require("axios");
const connection = require("./connection");
const fs = require("fs").promises;

const opensubtitlesbaseurl = "https://opensubtitles-v3.strem.io/subtitles/";

const isoCodeMapping = require("./langs/iso_code_mapping.json");

const downloadSubtitles = async (
  subtitles,
  imdbid,
  season = null,
  episode = null,
  oldisocode
) => {
  let uniqueTempFolder = null;
  if (season && episode) {
    await fs.mkdir(`subtitles/${oldisocode}/${imdbid}/season${season}`, {
      recursive: true,
    });
    uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}/season${season}`;
  } else {
    await fs.mkdir(`subtitles/${oldisocode}/${imdbid}`, { recursive: true });
    uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}`;
  }

  let filepaths = [];

  for (let i = 0; i < subtitles.length; i++) {
    const url = subtitles[i].url;
    try {
      console.log(url);
      const response = await axios.get(url, { responseType: "arraybuffer" });

      let filePath = null;
      if (episode) {
        filePath = `${uniqueTempFolder}/${imdbid}-subtitle_${episode}-${
          i + 1
        }.srt`;
      } else {
        filePath = `${uniqueTempFolder}/${imdbid}-subtitle-${i + 1}.srt`;
      }
      console.log(filePath);
      await fs.writeFile(filePath, response.data);
      console.log(`Subtitle downloaded and saved: ${filePath}`);
      filepaths.push(filePath);
    } catch (error) {
      console.error(`Subtitle download error: ${error.message}`);
      throw error;
    }
  }
  return filepaths;
};

const processSubtitlesResponse = (responseData, newisocode) => {
  if (responseData.subtitles.length === 0) {
    return null;
  }

  const subtitles = responseData.subtitles;

  const findSubtitle = (langCode) => {
    return subtitles.find((subtitle) => {
      const mappedLang = isoCodeMapping[subtitle.lang] || subtitle.lang;
      return mappedLang === langCode;
    });
  };

  const targetLangSubtitle = findSubtitle(newisocode);
  if (targetLangSubtitle !== undefined && targetLangSubtitle !== null) {
    return [{ url: targetLangSubtitle.url, lang: targetLangSubtitle.lang }];
  }

  const englishSubtitle = findSubtitle('en');
  if (englishSubtitle) {
    return [{ url: englishSubtitle.url, lang: englishSubtitle.lang }];
  }

  const firstAvailableSubtitle = subtitles[0];
  return [{ url: firstAvailableSubtitle.url, lang: firstAvailableSubtitle.lang }];
};

const getsubtitles = async (
  type,
  imdbid,
  season = null,
  episode = null,
  newisocode
) => {
  let url = opensubtitlesbaseurl;

  if (type === "series") {
    url = url.concat(type, "/", imdbid, ":", season, ":", episode, ".json");
  } else {
    url = url.concat(type, "/", imdbid, ".json");
  }

  try {
    const response = await axios.get(url);
    return processSubtitlesResponse(response.data, newisocode);
  } catch (error) {
    if (error.response && error.response.status === 520) {
      console.log("Got 520, retrying after 2 seconds...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retryResponse = await axios.get(url);
      return processSubtitlesResponse(retryResponse.data, newisocode);
    }

    console.error("Subtitle URL error:", error);
    throw error;
  }
};

const getAllSubtitles = async (
  type,
  imdbid,
  season = null,
  episode = null
) => {
  let url = opensubtitlesbaseurl;

  if (type === "series") {
    url = url.concat(type, "/", imdbid, ":", season, ":", episode, ".json");
  } else {
    url = url.concat(type, "/", imdbid, ".json");
  }

  try {
    const response = await axios.get(url);

    if (response.data.subtitles.length === 0) {
      return [];
    }

    return response.data.subtitles.map(subtitle => ({
      url: subtitle.url,
      lang: subtitle.lang,
      mappedLang: isoCodeMapping[subtitle.lang] || subtitle.lang
    }));

  } catch (error) {
    console.error("Get all subtitles error:", error);
    throw error;
  }
};

module.exports = { getsubtitles, getAllSubtitles, downloadSubtitles };
