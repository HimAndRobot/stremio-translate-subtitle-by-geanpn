const fs = require('fs').promises;
const path = require('path');
const connection = require('../connection');

async function runAllMigrations() {
  console.log('🚀 Starting migration system...\n');

  let adapter = null;

  try {
    adapter = await connection.getAdapter();

    await adapter.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = await fs.readdir(migrationsDir);

    const migrationFiles = files
      .filter(file => file.endsWith('.js'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('No migration files found.');
      return;
    }

    console.log(`Found ${migrationFiles.length} migration file(s)\n`);

    const executedMigrations = await adapter.query(
      'SELECT name FROM migrations ORDER BY executed_at'
    );

    const executedNames = executedMigrations.map(row => row.name);

    console.log(`Already executed: ${executedNames.length} migration(s)`);
    if (executedNames.length > 0) {
      executedNames.forEach(name => {
        console.log(`  ✓ ${name}`);
      });
    }
    console.log('');

    const pendingMigrations = migrationFiles.filter(
      file => !executedNames.includes(file)
    );

    if (pendingMigrations.length === 0) {
      console.log('✅ All migrations are up to date!');
      return;
    }

    console.log(`Pending: ${pendingMigrations.length} migration(s) to run\n`);

    for (const file of pendingMigrations) {
      const migrationPath = path.join(migrationsDir, file);
      console.log(`📦 Running migration: ${file}`);
      console.log('─'.repeat(50));

      try {
        delete require.cache[require.resolve(migrationPath)];

        const migration = require(migrationPath);

        if (typeof migration === 'function') {
          await migration();
        } else if (typeof migration.up === 'function') {
          await migration.up();
        }

        await adapter.query(
          'INSERT INTO migrations (name) VALUES (?)',
          [file]
        );

        console.log(`✅ Migration ${file} completed and recorded\n`);
      } catch (error) {
        console.error(`❌ Migration ${file} failed:`, error.message);
        console.error('Stopping migration process to prevent data corruption.\n');
        process.exit(1);
      }
    }

    console.log('='.repeat(50));
    console.log('✅ All migrations completed successfully!');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Failed to run migrations:', error);
    process.exit(1);
  } finally {
    if (adapter) {
      await connection.closeConnection();
    }
  }
}

runAllMigrations();
