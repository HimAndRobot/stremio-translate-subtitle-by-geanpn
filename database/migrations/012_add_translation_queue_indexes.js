const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding performance indexes to translation_queue table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const existingIndexes = await adapter.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'translation_queue'
        AND INDEX_NAME = 'idx_password_imdbid'
      `);

      if (existingIndexes.length === 0) {
        await adapter.query(`
          CREATE INDEX idx_password_imdbid ON translation_queue(password_hash, series_imdbid)
        `);
        console.log('✓ Index idx_password_imdbid created');
      } else {
        console.log('Index idx_password_imdbid already exists, skipping...');
      }

      const existingCreatedIndex = await adapter.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'translation_queue'
        AND INDEX_NAME = 'idx_password_created'
      `);

      if (existingCreatedIndex.length === 0) {
        await adapter.query(`
          CREATE INDEX idx_password_created ON translation_queue(password_hash, created_at)
        `);
        console.log('✓ Index idx_password_created created');
      } else {
        console.log('Index idx_password_created already exists, skipping...');
      }

    } catch (error) {
      console.error('Error creating indexes:', error.message);
      throw error;
    }
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        CREATE INDEX IF NOT EXISTS idx_password_imdbid ON translation_queue(password_hash, series_imdbid)
      `);
      console.log('✓ Index idx_password_imdbid created');

      await adapter.query(`
        CREATE INDEX IF NOT EXISTS idx_password_created ON translation_queue(password_hash, created_at)
      `);
      console.log('✓ Index idx_password_created created');

    } catch (error) {
      console.error('Error creating indexes:', error.message);
      throw error;
    }
  }

  console.log('✓ Translation queue indexes added successfully');
}

module.exports = up;
