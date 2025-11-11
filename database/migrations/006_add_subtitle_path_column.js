const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding subtitle_path column to translation_queue for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const checkColumn = await adapter.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'translation_queue'
        AND COLUMN_NAME = 'subtitle_path'
      `);

      if (checkColumn.length === 0) {
        await adapter.query(`
          ALTER TABLE translation_queue
          ADD COLUMN subtitle_path VARCHAR(1000) NULL AFTER stremio_id
        `);
      } else {
        console.log('Column subtitle_path already exists, skipping...');
      }
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      console.log('Column subtitle_path already exists, skipping...');
    }

    // Note: No index on subtitle_path due to VARCHAR(1000) size limits in MySQL
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        ALTER TABLE translation_queue
        ADD COLUMN subtitle_path TEXT NULL
      `);
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
      console.log('Column subtitle_path already exists, skipping...');
    }

    // Note: No index on subtitle_path for consistency with MySQL
  }

  console.log('✓ subtitle_path column added successfully');
}

module.exports = up;
