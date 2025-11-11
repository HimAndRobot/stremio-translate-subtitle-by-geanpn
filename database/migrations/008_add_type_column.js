const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding type column to translation_queue for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const checkColumn = await adapter.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'translation_queue'
        AND COLUMN_NAME = 'type'
      `);

      if (checkColumn.length === 0) {
        await adapter.query(`
          ALTER TABLE translation_queue
          ADD COLUMN type VARCHAR(20) DEFAULT NULL AFTER series_imdbid
        `);
      } else {
        console.log('Column type already exists, skipping...');
      }
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      console.log('Column type already exists, skipping...');
    }
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        ALTER TABLE translation_queue
        ADD COLUMN type TEXT DEFAULT NULL
      `);
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
      console.log('Column type already exists, skipping...');
    }
  }

  console.log('✓ type column added successfully');
}

module.exports = up;
