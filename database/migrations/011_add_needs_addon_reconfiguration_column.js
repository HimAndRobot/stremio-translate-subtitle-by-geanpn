const connection = require('../../connection');

/**
 * Adds needs_addon_reconfiguration column to users table
 * This flag indicates if user needs to reconfigure their Stremio addon after migration
 * Set to true after migration, set to false when user reinstalls addon
 */
async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding needs_addon_reconfiguration column to users table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const checkColumn = await adapter.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'needs_addon_reconfiguration'
      `);

      if (checkColumn.length === 0) {
        await adapter.query(`
          ALTER TABLE users
          ADD COLUMN needs_addon_reconfiguration BOOLEAN DEFAULT FALSE AFTER password_bcrypt
        `);
      } else {
        console.log('Column needs_addon_reconfiguration already exists, skipping...');
      }
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      console.log('Column needs_addon_reconfiguration already exists, skipping...');
    }
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        ALTER TABLE users
        ADD COLUMN needs_addon_reconfiguration INTEGER DEFAULT 0
      `);
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
      console.log('Column needs_addon_reconfiguration already exists, skipping...');
    }
  }

  console.log('✓ needs_addon_reconfiguration column added successfully');
}

module.exports = up;
