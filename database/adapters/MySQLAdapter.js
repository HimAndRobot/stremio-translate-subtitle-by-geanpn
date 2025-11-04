const mysql = require("mysql2");
const util = require("util");
const BaseAdapter = require("./BaseAdapter");

class MySQLAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.connection = null;
    this.query = null;
    this.reconnectInterval = null;
  }

  async connect() {
    try {
      this.connection = mysql.createConnection({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
      });

      await new Promise((resolve, reject) => {
        this.connection.connect((err) => {
          if (err) {
            console.error("Error connecting to MySQL:", err);
            reject(err);
          } else {
            console.log("Connected to MySQL!");
            resolve();
          }
        });
      });

      this.query = util.promisify(this.connection.query).bind(this.connection);

      // Set up auto-reconnection
      this._setupReconnection();

      return true;
    } catch (error) {
      console.error("MySQL connection failed:", error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    if (this.connection) {
      this.connection.end();
      this.connection = null;
    }
  }

  _setupReconnection() {
    this.reconnectInterval = setInterval(() => {
      if (this.connection.state === "disconnected") {
        this.connection.connect((err) => {
          if (err) {
            console.error("MySQL reconnection error:", err);
          } else {
            console.log("Reconnected to MySQL!");
          }
        });
      }
    }, 60000);
  }

  async addToTranslationQueue(
    imdbid,
    season = null,
    episode = null,
    count,
    langcode,
    password_hash = null,
    apikey_encrypted = null,
    base_url_encrypted = null,
    model_name_encrypted = null,
    series_name = null,
    poster = null,
    stremioId = null,
    subtitle_path = null,
    type = null
  ) {
    try {
      if (season && episode) {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,stremio_id,type,series_seasonno,series_episodeno,subcount,langcode,password_hash,apikey_encrypted,base_url_encrypted,model_name_encrypted,series_name,poster,subtitle_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [imdbid, stremioId, type, season, episode, count, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, series_name, poster, subtitle_path]
        );
      } else {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,stremio_id,type,subcount,langcode,password_hash,apikey_encrypted,base_url_encrypted,model_name_encrypted,series_name,poster,subtitle_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [imdbid, stremioId, type, count, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, series_name, poster, subtitle_path]
        );
      }
    } catch (error) {
      console.error("Error adding to translation queue:", error.message);
      throw error;
    }
  }

  async deletetranslationQueue(
    imdbid,
    season = null,
    episode = null,
    langcode
  ) {
    try {
      if (season && episode) {
        await this.query(
          "DELETE FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        await this.query(
          "DELETE FROM translation_queue WHERE series_imdbid = ? AND langcode = ?",
          [imdbid, langcode]
        );
      }
    } catch (error) {
      console.error("Error deleting from translation queue:", error.message);
      throw error;
    }
  }

  async updateTranslationStatus(
    imdbid,
    season = null,
    episode = null,
    langcode,
    status
  ) {
    try {
      if (season && episode) {
        await this.query(
          "UPDATE translation_queue SET status = ? WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
          [status, imdbid, season, episode, langcode]
        );
      } else {
        await this.query(
          "UPDATE translation_queue SET status = ? WHERE series_imdbid = ? AND langcode = ?",
          [status, imdbid, langcode]
        );
      }
    } catch (error) {
      console.error("Error updating translation status:", error.message);
      throw error;
    }
  }

  async updateTranslationCredentials(
    imdbid,
    season = null,
    episode = null,
    langcode,
    password_hash,
    apikey_encrypted,
    base_url_encrypted,
    model_name_encrypted
  ) {
    try {
      if (season && episode) {
        await this.query(
          "UPDATE translation_queue SET password_hash = ?, apikey_encrypted = ?, base_url_encrypted = ?, model_name_encrypted = ? WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
          [password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, imdbid, season, episode, langcode]
        );
      } else {
        await this.query(
          "UPDATE translation_queue SET password_hash = ?, apikey_encrypted = ?, base_url_encrypted = ?, model_name_encrypted = ? WHERE series_imdbid = ? AND langcode = ?",
          [password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, imdbid, langcode]
        );
      }
    } catch (error) {
      console.error("Error updating translation credentials:", error.message);
      throw error;
    }
  }

  async checkForTranslation(imdbid, season = null, episode = null, password_hash = null) {
    try {
      let query, params;

      if (password_hash) {
        query = "SELECT status, subtitle_path FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND password_hash = ? LIMIT 1";
        params = [imdbid, season, episode, password_hash];
      } else {
        query = "SELECT status, subtitle_path FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND (password_hash IS NULL OR password_hash = '') LIMIT 1";
        params = [imdbid, season, episode];
      }

      console.log(`[DEBUG checkForTranslation] Searching for: IMDB=${imdbid}, S${season}E${episode}, Password=${password_hash ? password_hash.substring(0, 8) + '...' : 'NULL'}`);

      const result = await this.query(query, params);

      if (result.length > 0) {
        console.log(`[DEBUG checkForTranslation] FOUND: Status=${result[0].status}, Path=${result[0].subtitle_path}`);
        return {
          status: result[0].status,
          subtitle_path: result[0].subtitle_path
        };
      }

      console.log(`[DEBUG checkForTranslation] NOT FOUND`);
      return null;
    } catch (error) {
      console.error("Translation check error:", error.message);
      return null;
    }
  }

  async checkForTranslationByStremioId(stremioId, langcode, password_hash = null) {
    try {
      let query, params;

      if (password_hash) {
        query = "SELECT status, subtitle_path FROM translation_queue WHERE stremio_id = ? AND langcode = ? AND password_hash = ?";
        params = [stremioId, langcode, password_hash];
      } else {
        query = "SELECT status, subtitle_path FROM translation_queue WHERE stremio_id = ? AND langcode = ? AND (password_hash IS NULL OR password_hash = '')";
        params = [stremioId, langcode];
      }

      console.log(`[DEBUG checkForTranslationByStremioId] Searching for: StremioID=${stremioId}, Lang=${langcode}, Password=${password_hash ? password_hash.substring(0, 8) + '...' : 'NULL'}`);

      const result = await this.query(query, params);

      if (result.length > 0) {
        console.log(`[DEBUG checkForTranslationByStremioId] FOUND: Status=${result[0].status}, Path=${result[0].subtitle_path}`);
        return {
          status: result[0].status,
          subtitle_path: result[0].subtitle_path
        };
      }

      console.log(`[DEBUG checkForTranslationByStremioId] NOT FOUND`);
      return null;
    } catch (error) {
      console.error("Translation check by stremio_id error:", error.message);
      return null;
    }
  }

  async updateTokenUsage(imdbid, season = null, episode = null, langcode, tokens) {
    try {
      if (season && episode) {
        await this.query(
          "UPDATE translation_queue SET token_usage_total = token_usage_total + ? WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
          [tokens, imdbid, season, episode, langcode]
        );
      } else {
        await this.query(
          "UPDATE translation_queue SET token_usage_total = token_usage_total + ? WHERE series_imdbid = ? AND langcode = ?",
          [tokens, imdbid, langcode]
        );
      }
    } catch (error) {
      console.error("Error updating token usage:", error.message);
      throw error;
    }
  }

  async checkseries(imdbid) {
    try {
      const result = await this.query(
        "SELECT COUNT(*) AS count FROM series WHERE series_imdbid = ?",
        [imdbid]
      );
      const count = result[0].count;

      return count > 0;
    } catch (error) {
      console.error("Series check error:", error);
      return false;
    }
  }

  async addseries(imdbid, type) {
    try {
      let seriestype = type === "series" ? 0 : 1;
      await this.query(
        "INSERT INTO series(series_imdbid,series_type) VALUES (?,?)",
        [imdbid, seriestype]
      );
    } catch (error) {
      console.error("Series add error:", error);
    }
  }

  async getSubCount(imdbid, season, episode, langcode) {
    try {
      let result;
      if (season && episode) {
        result = await this.query(
          "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        result = await this.query(
          "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_langcode = ?",
          [imdbid, langcode]
        );
      }
      return result[0].count;
    } catch (error) {
      console.error("Subtitle count error:", error.message);
      return 0;
    }
  }

  async addsubtitle(
    imdbid,
    type,
    season = null,
    episode = null,
    path,
    langcode
  ) {
    try {
      let seriestype = type === "series" ? 0 : 1;
      await this.query(
        "INSERT INTO subtitle(series_imdbid,subtitle_type,subtitle_seasonno,subtitle_episodeno,subtitle_langcode,subtitle_path) VALUES (?,?,?,?,?,?)",
        [imdbid, seriestype, season, episode, langcode, path]
      );
    } catch (error) {
      console.error("Subtitle add error:", error);
    }
  }

  async getsubtitles(imdbid, season = null, episode = null, langcode) {
    try {
      let rows;
      if (episode && season) {
        rows = await this.query(
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? LIMIT 1",
          [imdbid, season, episode]
        );
      } else {
        rows = await this.query(
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? LIMIT 1",
          [imdbid]
        );
      }
      const paths = rows.map((row) => row.subtitle_path);
      return paths;
    } catch (error) {
      console.error("Subtitle retrieval error:", error.message);
      return [];
    }
  }

  async checksubtitle(
    imdbid,
    season = null,
    episode = null,
    subtitlepath,
    langcode
  ) {
    try {
      const result = await this.query(
        "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_path = ? AND subtitle_langcode = ?",
        [imdbid, season, episode, subtitlepath, langcode]
      );
      const count = result[0].count;

      return count > 0;
    } catch (error) {
      console.error("Subtitle check error:", error);
      return false;
    }
  }

  async createSubtitleBatches(translationQueueId, batches) {
    try {
      for (const batch of batches) {
        await this.query(
          "INSERT INTO subtitle_batches (translation_queue_id, batch_number, subtitle_entries, status) VALUES (?, ?, ?, 'pending')",
          [translationQueueId, batch.batch_number, JSON.stringify(batch.subtitle_entries)]
        );
      }
    } catch (error) {
      console.error("Error creating subtitle batches:", error.message);
      throw error;
    }
  }

  async getSubtitleBatch(batchId) {
    try {
      const result = await this.query(
        "SELECT * FROM subtitle_batches WHERE id = ?",
        [batchId]
      );
      if (result.length > 0) {
        const batch = result[0];
        if (typeof batch.subtitle_entries === 'string') {
          batch.subtitle_entries = JSON.parse(batch.subtitle_entries);
        }
        if (batch.translated_entries && typeof batch.translated_entries === 'string') {
          batch.translated_entries = JSON.parse(batch.translated_entries);
        }
        return batch;
      }
      return null;
    } catch (error) {
      console.error("Error getting subtitle batch:", error.message);
      throw error;
    }
  }

  async updateBatchTranslation(batchId, translatedEntries, tokenUsage) {
    try {
      await this.query(
        "UPDATE subtitle_batches SET translated_entries = ?, token_usage = ?, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [JSON.stringify(translatedEntries), tokenUsage, batchId]
      );
    } catch (error) {
      console.error("Error updating batch translation:", error.message);
      throw error;
    }
  }

  async updateBatchStatus(batchId, status) {
    try {
      await this.query(
        "UPDATE subtitle_batches SET status = ? WHERE id = ?",
        [status, batchId]
      );
    } catch (error) {
      console.error("Error updating batch status:", error.message);
      throw error;
    }
  }

  async getBatchesForTranslation(translationQueueId) {
    try {
      const result = await this.query(
        "SELECT * FROM subtitle_batches WHERE translation_queue_id = ? ORDER BY batch_number ASC",
        [translationQueueId]
      );
      return result.map(batch => {
        if (typeof batch.subtitle_entries === 'string') {
          batch.subtitle_entries = JSON.parse(batch.subtitle_entries);
        }
        if (batch.translated_entries && typeof batch.translated_entries === 'string') {
          batch.translated_entries = JSON.parse(batch.translated_entries);
        }
        return batch;
      });
    } catch (error) {
      console.error("Error getting batches for translation:", error.message);
      throw error;
    }
  }

  async areAllBatchesComplete(translationQueueId) {
    try {
      const result = await this.query(
        "SELECT COUNT(*) as count FROM subtitle_batches WHERE translation_queue_id = ? AND status != 'completed'",
        [translationQueueId]
      );
      return result[0].count === 0;
    } catch (error) {
      console.error("Error checking batches completion:", error.message);
      throw error;
    }
  }

  async getTranslationQueueIdFromBatch(batchId) {
    try {
      const result = await this.query(
        "SELECT translation_queue_id FROM subtitle_batches WHERE id = ?",
        [batchId]
      );
      return result.length > 0 ? result[0].translation_queue_id : null;
    } catch (error) {
      console.error("Error getting translation queue ID from batch:", error.message);
      throw error;
    }
  }
}

module.exports = MySQLAdapter;
