const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Creating subtitle table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS subtitle (
        id INT AUTO_INCREMENT PRIMARY KEY,
        series_imdbid VARCHAR(255) NOT NULL,
        subtitle_type INT NOT NULL,
        subtitle_seasonno INT NULL,
        subtitle_episodeno INT NULL,
        subtitle_langcode VARCHAR(10) NOT NULL,
        subtitle_path TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_subtitle_imdbid (series_imdbid),
        INDEX idx_subtitle_season_episode (subtitle_seasonno, subtitle_episodeno),
        INDEX idx_subtitle_langcode (subtitle_langcode)
      )
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS subtitle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_imdbid TEXT NOT NULL,
        subtitle_type INTEGER NOT NULL,
        subtitle_seasonno INTEGER,
        subtitle_episodeno INTEGER,
        subtitle_langcode TEXT NOT NULL,
        subtitle_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_subtitle_imdbid ON subtitle(series_imdbid)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_subtitle_season_episode ON subtitle(subtitle_seasonno, subtitle_episodeno)
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_subtitle_langcode ON subtitle(subtitle_langcode)
    `);
  }

  console.log('✓ Subtitle table created successfully');
}

module.exports = up;
