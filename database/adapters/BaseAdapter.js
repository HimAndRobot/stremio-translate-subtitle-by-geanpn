class BaseAdapter {
  constructor(config) {
    this.config = config;
    this.connection = null;
  }

  async connect() {
    throw new Error("connect() must be implemented by child class");
  }

  async disconnect() {
    throw new Error("disconnect() must be implemented by child class");
  }

  async query(sql, params = []) {
    throw new Error("query() must be implemented by child class");
  }

  // Domain-specific methods
  async addToTranslationQueue(
    imdbid,
    season = null,
    episode = null,
    count,
    langcode
  ) {
    throw new Error(
      "addToTranslationQueue() must be implemented by child class"
    );
  }

  async deletetranslationQueue(
    imdbid,
    season = null,
    episode = null,
    langcode
  ) {
    throw new Error(
      "deletetranslationQueue() must be implemented by child class"
    );
  }

  async checkForTranslation(imdbid, season = null, episode = null, langcode) {
    throw new Error("checkForTranslation() must be implemented by child class");
  }

  async checkForTranslationByStremioId(stremioId, password_hash = null) {
    throw new Error("checkForTranslationByStremioId() must be implemented by child class");
  }

  async checkseries(imdbid) {
    throw new Error("checkseries() must be implemented by child class");
  }

  async addseries(imdbid, type) {
    throw new Error("addseries() must be implemented by child class");
  }

  async getSubCount(imdbid, season, episode, langcode) {
    throw new Error("getSubCount() must be implemented by child class");
  }

  async addsubtitle(
    imdbid,
    type,
    season = null,
    episode = null,
    path,
    langcode
  ) {
    throw new Error("addsubtitle() must be implemented by child class");
  }

  async getsubtitles(imdbid, season = null, episode = null, langcode) {
    throw new Error("getsubtitles() must be implemented by child class");
  }

  async checksubtitle(
    imdbid,
    season = null,
    episode = null,
    subtitlepath,
    langcode
  ) {
    throw new Error("checksubtitle() must be implemented by child class");
  }
}

module.exports = BaseAdapter;
