const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Creating translation_queue table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS translation_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        series_imdbid VARCHAR(255) NOT NULL,
        series_seasonno INT NULL,
        series_episodeno INT NULL,
        subcount INT NOT NULL,
        langcode VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'processing',
        password_hash VARCHAR(255) NULL,
        apikey_encrypted TEXT NULL,
        base_url_encrypted TEXT NULL,
        model_name_encrypted TEXT NULL,
        series_name VARCHAR(500) NULL,
        retry_attempts INT DEFAULT 0,
        token_usage_total INT DEFAULT 0,
        last_retry_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_translation_queue_imdbid (series_imdbid),
        INDEX idx_translation_queue_season_episode (series_seasonno, series_episodeno),
        INDEX idx_translation_queue_langcode (langcode),
        INDEX idx_translation_queue_status (status),
        INDEX idx_translation_queue_password (password_hash)
      )
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS translation_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_imdbid TEXT NOT NULL,
        series_seasonno INTEGER,
        series_episodeno INTEGER,
        subcount INTEGER NOT NULL,
        langcode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        password_hash TEXT NULL,
        apikey_encrypted TEXT NULL,
        base_url_encrypted TEXT NULL,
        model_name_encrypted TEXT NULL,
        series_name TEXT NULL,
        retry_attempts INTEGER DEFAULT 0,
        token_usage_total INTEGER DEFAULT 0,
        last_retry_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_imdbid ON translation_queue(series_imdbid)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_season_episode ON translation_queue(series_seasonno, series_episodeno)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_langcode ON translation_queue(langcode)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_status ON translation_queue(status)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_password ON translation_queue(password_hash)
    `);
  }

  console.log('✓ Translation queue table created successfully');
}

module.exports = up;
