const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Allowing NULL for series_imdbid in translation_queue for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      ALTER TABLE translation_queue
      MODIFY COLUMN series_imdbid VARCHAR(255) NULL
    `);
  }
  // SQLite doesn't have strict NULL constraints, so no changes needed

  console.log('✓ series_imdbid can now accept NULL values');
}

module.exports = up;
