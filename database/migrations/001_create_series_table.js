const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Creating series table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS series (
        id INT AUTO_INCREMENT PRIMARY KEY,
        series_imdbid VARCHAR(255) NOT NULL,
        series_type INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_series_imdbid (series_imdbid)
      )
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_imdbid TEXT NOT NULL,
        series_type INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_series_imdbid ON series(series_imdbid)
    `);
  }

  console.log('✓ Series table created successfully');
}

module.exports = up;
