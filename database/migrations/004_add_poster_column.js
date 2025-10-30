const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding poster column to translation_queue for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    await adapter.query(`
      ALTER TABLE translation_queue
      ADD COLUMN poster TEXT NULL AFTER series_name
    `);
  } else if (dbType === 'SQLiteAdapter') {
    await adapter.query(`
      ALTER TABLE translation_queue
      ADD COLUMN poster TEXT NULL
    `);
  }

  console.log('✓ Poster column added successfully');
}

module.exports = up;
