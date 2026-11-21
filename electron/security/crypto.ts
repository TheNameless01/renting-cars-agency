import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const derivedBuf = crypto.scryptSync(plainPassword, salt, expectedBuf.length, SCRYPT_PARAMS);
  return expectedBuf.length === derivedBuf.length && crypto.timingSafeEqual(expectedBuf, derivedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Resolves a file path strictly inside baseDir, blocking path traversal attacks.
 */
export function resolveConfinedPath(baseDir: string, relativeOrTargetPath: string): string {
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, relativeOrTargetPath);
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('SECURITY_PATH_TRAVERSAL_BLOCKED');
  }
  return resolved;
}

/**
 * Encrypts sensitive customer document bytes using AES-256-GCM.
 */
export function encryptBuffer(plainBytes: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes for AES-256-GCM');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptBuffer(encryptedPayload: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('Decryption key must be 32 bytes for AES-256-GCM');
  }
  if (encryptedPayload.length < 28) {
    throw new Error('Corrupted encrypted payload');
  }
  const iv = encryptedPayload.subarray(0, 12);
  const authTag = encryptedPayload.subarray(12, 28);
  const ciphertext = encryptedPayload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Loads or generates a dedicated local 256-bit vault key inside a confined non-public directory.
 */
export function getOrCreateLocalVaultKey(vaultRootDir: string): Buffer {
  fs.mkdirSync(vaultRootDir, { recursive: true });
  const keyFile = resolveConfinedPath(vaultRootDir, '.vault.key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) return buf;
  }
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, newKey.toString('hex'), { mode: 0o600 });
  return newKey;
}
