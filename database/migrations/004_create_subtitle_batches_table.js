const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Creating subtitle_batches table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS subtitle_batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        translation_queue_id INT NOT NULL,
        batch_number INT NOT NULL,
        subtitle_entries JSON NOT NULL,
        translated_entries JSON NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        token_usage INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        INDEX idx_translation_queue_id (translation_queue_id),
        INDEX idx_status (status),
        UNIQUE KEY unique_batch (translation_queue_id, batch_number),
        FOREIGN KEY (translation_queue_id) REFERENCES translation_queue(id) ON DELETE CASCADE
      )
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS subtitle_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        translation_queue_id INTEGER NOT NULL,
        batch_number INTEGER NOT NULL,
        subtitle_entries TEXT NOT NULL,
        translated_entries TEXT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        token_usage INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        UNIQUE(translation_queue_id, batch_number),
        FOREIGN KEY (translation_queue_id) REFERENCES translation_queue(id) ON DELETE CASCADE
      )
    `);

    await adapter.query(`CREATE INDEX IF NOT EXISTS idx_subtitle_batches_translation_queue ON subtitle_batches(translation_queue_id)`);
    await adapter.query(`CREATE INDEX IF NOT EXISTS idx_subtitle_batches_status ON subtitle_batches(status)`);
  }

  console.log('✓ subtitle_batches table created successfully');
}

module.exports = up;
