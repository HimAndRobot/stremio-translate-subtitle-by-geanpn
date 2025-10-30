const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 10;
const ALGORITHM = 'aes-256-cbc';

async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function encryptCredential(text, encryptionKey) {
  if (!text) return null;
  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('Encryption key must be exactly 32 characters');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(encryptionKey), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return iv.toString('hex') + ':' + encrypted;
}

function decryptCredential(encryptedText, encryptionKey) {
  if (!encryptedText) return null;
  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('Encryption key must be exactly 32 characters');
  }

  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(encryptionKey), iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  hashPassword,
  verifyPassword,
  encryptCredential,
  decryptCredential,
};
