const connection = require('../../connection');

async function up() {
  const adapter = await connection.getAdapter();
  const dbType = adapter.constructor.name;

  console.log(`Adding password_bcrypt column to users table for ${dbType}...`);

  if (dbType === 'MySQLAdapter') {
    try {
      const checkColumn = await adapter.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'password_bcrypt'
      `);

      if (checkColumn.length === 0) {
        await adapter.query(`
          ALTER TABLE users
          ADD COLUMN password_bcrypt VARCHAR(255) NULL AFTER password_hash
        `);
      } else {
        console.log('Column password_bcrypt already exists, skipping...');
      }
    } catch (error) {
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      console.log('Column password_bcrypt already exists, skipping...');
    }
  } else if (dbType === 'SQLiteAdapter') {
    try {
      await adapter.query(`
        ALTER TABLE users
        ADD COLUMN password_bcrypt TEXT NULL
      `);
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
      console.log('Column password_bcrypt already exists, skipping...');
    }
  }

  console.log('✓ password_bcrypt column added successfully');
}

module.exports = up;
