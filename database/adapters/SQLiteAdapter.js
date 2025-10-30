const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const BaseAdapter = require("./BaseAdapter");

class SQLiteAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.connection = null;
    this.dbPath =
      config.database || path.join(__dirname, "../../data/database.db");
  }

  async connect() {
    try {
      this.connection = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error("Error connecting to SQLite:", err);
          throw err;
        } else {
          console.log("Connected to SQLite!");
        }
      });

      // Create tables if they don't exist
      await this._createTables();

      return true;
    } catch (error) {
      console.error("SQLite connection failed:", error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) {
      this.connection.close((err) => {
        if (err) {
          console.error("SQLite disconnection error:", err);
        } else {
          console.log("SQLite connection disconnected.");
        }
      });
      this.connection = null;
    }
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        this.connection.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      } else {
        this.connection.run(sql, params, function (err) {
          if (err) {
            reject(err);
          } else {
            resolve({ changes: this.changes, lastID: this.lastID });
          }
        });
      }
    });
  }

  async _createTables() {
    const createMigrationsTable = `
            CREATE TABLE IF NOT EXISTS migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

    await this.query(createMigrationsTable);
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
    series_name = null
  ) {
    try {
      if (season && episode) {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,series_seasonno,series_episodeno,subcount,langcode,password_hash,apikey_encrypted,base_url_encrypted,model_name_encrypted,series_name) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [imdbid, season, episode, count, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, series_name]
        );
      } else {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,subcount,langcode,password_hash,apikey_encrypted,base_url_encrypted,model_name_encrypted,series_name) VALUES (?,?,?,?,?,?,?,?)",
          [imdbid, count, langcode, password_hash, apikey_encrypted, base_url_encrypted, model_name_encrypted, series_name]
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

  async checkForTranslation(imdbid, season = null, episode = null, langcode) {
    try {
      const result = await this.query(
        "SELECT status FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
        [imdbid, season, episode, langcode]
      );

      if (result.length > 0) {
        return result[0].status;
      }
      return null;
    } catch (error) {
      console.error("Translation check error:", error.message);
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
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        rows = await this.query(
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? AND subtitle_langcode = ?",
          [imdbid, langcode]
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
}

module.exports = SQLiteAdapter;
