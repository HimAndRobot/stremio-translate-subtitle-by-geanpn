const connection = require('../../connection');

async function runMigration() {
  try {
    console.log('Starting migration: add status column to translation_queue...');

    const adapter = await connection.getAdapter();
    const dbType = adapter.constructor.name;

    console.log(`Database type: ${dbType}`);

    if (dbType === 'MySQLAdapter') {
      const columns = await adapter.query(
        "SHOW COLUMNS FROM translation_queue LIKE 'status'"
      );

      if (columns.length === 0) {
        console.log('Adding status column to MySQL...');
        await adapter.query(
          "ALTER TABLE translation_queue ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'completed'"
        );
        console.log('✓ Status column added');

        console.log('Creating index on status column...');
        await adapter.query(
          "CREATE INDEX idx_translation_queue_status ON translation_queue (status)"
        );
        console.log('✓ Index created');

        console.log('Marking existing entries as completed...');
        await adapter.query(
          "UPDATE translation_queue SET status = 'completed'"
        );
        console.log('✓ Existing entries marked as completed');
      } else {
        console.log('✓ Status column already exists');
      }
    } else if (dbType === 'SQLiteAdapter') {
      const columns = await adapter.query(
        "PRAGMA table_info(translation_queue)"
      );

      const hasStatus = Array.isArray(columns) && columns.some(col => col.name === 'status');

      if (!hasStatus) {
        console.log('Migrating SQLite table with status column...');
        await adapter.query("BEGIN TRANSACTION");

        await adapter.query(`
          CREATE TABLE IF NOT EXISTS translation_queue_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_imdbid TEXT NOT NULL,
            series_seasonno INTEGER,
            series_episodeno INTEGER,
            subcount INTEGER NOT NULL,
            langcode TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✓ New table created');

        await adapter.query(`
          INSERT INTO translation_queue_new (id, series_imdbid, series_seasonno, series_episodeno, subcount, langcode, created_at, status)
          SELECT id, series_imdbid, series_seasonno, series_episodeno, subcount, langcode, created_at, 'completed'
          FROM translation_queue
        `);
        console.log('✓ Data copied');

        await adapter.query("DROP TABLE translation_queue");
        console.log('✓ Old table dropped');

        await adapter.query("ALTER TABLE translation_queue_new RENAME TO translation_queue");
        console.log('✓ Table renamed');

        await adapter.query("COMMIT");
        console.log('✓ Transaction committed');
      } else {
        console.log('✓ Status column already exists');
      }
    }

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
