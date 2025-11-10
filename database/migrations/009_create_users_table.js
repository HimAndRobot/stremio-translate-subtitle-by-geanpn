const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Creating users table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_users_username (username),
        INDEX idx_users_hash (password_hash)
      )
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
    await adapter.query(`CREATE INDEX IF NOT EXISTS idx_users_hash ON users(password_hash)`);
  }

  console.log('✓ users table created successfully');
}

module.exports = up;
