const connection = require('../../connection');

async function runMigration() {
  try {
    console.log('Starting migration: add credentials columns to translation_queue...');

    const adapter = await connection.getAdapter();
    const dbType = adapter.constructor.name;

    console.log(`Database type: ${dbType}`);

    if (dbType === 'MySQLAdapter') {
      const columns = await adapter.query(
        "SHOW COLUMNS FROM translation_queue LIKE 'password_hash'"
      );

      if (columns.length === 0) {
        console.log('Adding credentials columns to MySQL...');
        await adapter.query(`
          ALTER TABLE translation_queue
          ADD COLUMN password_hash VARCHAR(255) NULL,
          ADD COLUMN apikey_encrypted TEXT NULL,
          ADD COLUMN base_url_encrypted TEXT NULL,
          ADD COLUMN model_name_encrypted TEXT NULL
        `);
        console.log('✓ Credentials columns added');
      } else {
        console.log('✓ Credentials columns already exist');
      }
    } else if (dbType === 'SQLiteAdapter') {
      const columns = await adapter.query(
        "PRAGMA table_info(translation_queue)"
      );

      const hasPasswordHash = Array.isArray(columns) && columns.some(col => col.name === 'password_hash');

      if (!hasPasswordHash) {
        console.log('Migrating SQLite table with credentials columns...');
        await adapter.query("BEGIN TRANSACTION");

        await adapter.query(`
          CREATE TABLE IF NOT EXISTS translation_queue_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_imdbid TEXT NOT NULL,
            series_seasonno INTEGER,
            series_episodeno INTEGER,
            subcount INTEGER NOT NULL,
            langcode TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'processing',
            password_hash TEXT NULL,
            apikey_encrypted TEXT NULL,
            base_url_encrypted TEXT NULL,
            model_name_encrypted TEXT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✓ New table created');

        await adapter.query(`
          INSERT INTO translation_queue_new
          (id, series_imdbid, series_seasonno, series_episodeno, subcount, langcode, status, created_at)
          SELECT id, series_imdbid, series_seasonno, series_episodeno, subcount, langcode, status, created_at
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
        console.log('✓ Credentials columns already exist');
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
