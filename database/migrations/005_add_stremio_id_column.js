const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding stremio_id column to translation_queue for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const checkColumn = await adapter.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'translation_queue'
        AND COLUMN_NAME = 'stremio_id'
      `);

      if (checkColumn.length === 0) {
        await adapter.query(`
          ALTER TABLE translation_queue
          ADD COLUMN stremio_id VARCHAR(500) NULL AFTER series_imdbid
        `);
      } else {
        console.log('Column stremio_id already exists, skipping...');
      }
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      console.log('Column stremio_id already exists, skipping...');
    }

    try {
      await adapter.query(`
        CREATE INDEX idx_translation_queue_stremio_id
        ON translation_queue(stremio_id, langcode, password_hash)
      `);
    } catch (error) {
      if (!error.message.includes('Duplicate key name')) {
        throw error;
      }
      console.log('Index idx_translation_queue_stremio_id already exists, skipping...');
    }
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        ALTER TABLE translation_queue
        ADD COLUMN stremio_id TEXT NULL
      `);
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
      console.log('Column stremio_id already exists, skipping...');
    }

    await adapter.query(`
      CREATE INDEX IF NOT EXISTS idx_translation_queue_stremio_id
      ON translation_queue(stremio_id, langcode, password_hash)
    `);
  }

  console.log('✓ stremio_id column added successfully');
}

module.exports = up;
