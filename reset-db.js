const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.SQLITE_PATH || './data/database.db';

console.log(`Resetting database at: ${dbPath}`);

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('✓ Database deleted successfully!');
} else {
  console.log('⚠ Database file not found, nothing to delete.');
}

const journalPath = `${dbPath}-journal`;
if (fs.existsSync(journalPath)) {
  fs.unlinkSync(journalPath);
  console.log('✓ Journal file deleted.');
}

console.log('\n✓ Database reset complete! The database will be recreated on next server start.');
