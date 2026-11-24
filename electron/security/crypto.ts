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

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface LocalVaultKeyResult {
  key: Buffer;
  protectionMode: 'dpapi_safestorage' | 'local_file_0600';
}

/**
 * Computes a short non-secret SHA-256 fingerprint of a 32-byte vault key for audit & recovery matching.
 */
export function getVaultKeyFingerprint(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16).toUpperCase();
}

/**
 * Encodes a 32-byte key into a human-transcribable recovery code for offline emergency printout.
 */
export function formatVaultRecoveryKey(key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Vault key must be 32 bytes');
  }
  const hex = key.toString('hex').toUpperCase();
  const groups = hex.match(/.{1,8}/g) ?? [];
  return `AGL-RK1-${groups.join('-')}`;
}

export function parseVaultRecoveryKey(recoveryCode: string): Buffer {
  const cleaned = String(recoveryCode || '')
    .trim()
    .toUpperCase()
    .replace(/^AGL-RK1-/, '')
    .replace(/[^0-9A-F]/g, '');
  if (cleaned.length !== 64) {
    throw new Error('Clé de récupération invalide (64 caractères hexadécimaux attendus)');
  }
  return Buffer.from(cleaned, 'hex');
}

/**
 * Derives a 256-bit AES key from an Admin backup passphrase + random salt via scrypt.
 */
export function deriveBackupKeyFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
}

/**
 * Loads or generates a dedicated local 256-bit vault key inside a confined non-public directory.
 * When Electron's OS-backed `safeStorage` (Windows DPAPI) is available, wraps the key in `.vault.key.dpapi`
 * and removes any legacy plaintext `.vault.key` file after successful verification.
 */
export function loadOrCreateVaultKey(
  vaultRootDir: string,
  safeStorage?: SafeStorageAdapter | null
): LocalVaultKeyResult {
  fs.mkdirSync(vaultRootDir, { recursive: true });
  const dpapiFile = resolveConfinedPath(vaultRootDir, '.vault.key.dpapi');
  const legacyFile = resolveConfinedPath(vaultRootDir, '.vault.key');
  const canUseDpapi = Boolean(safeStorage && safeStorage.isEncryptionAvailable());

  // 1. Existing DPAPI-protected vault key
  if (fs.existsSync(dpapiFile)) {
    if (!canUseDpapi || !safeStorage) {
      throw new Error(
        'Le coffre utilise une clé protégée par Windows DPAPI (safeStorage), inaccessible dans ce contexte.'
      );
    }
    const encryptedBlob = fs.readFileSync(dpapiFile);
    const hex = safeStorage.decryptString(encryptedBlob).trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) {
      return { key: buf, protectionMode: 'dpapi_safestorage' };
    }
    throw new Error('Clé de coffre DPAPI corrompue');
  }

  // 2. Existing raw local key (upgrade to DPAPI seamlessly when running inside Electron desktop)
  if (fs.existsSync(legacyFile)) {
    const hex = fs.readFileSync(legacyFile, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) {
      if (canUseDpapi && safeStorage) {
        try {
          const wrapped = safeStorage.encryptString(buf.toString('hex'));
          fs.writeFileSync(dpapiFile, wrapped, { mode: 0o600 });
          const check = Buffer.from(safeStorage.decryptString(fs.readFileSync(dpapiFile)).trim(), 'hex');
          if (check.length === 32 && crypto.timingSafeEqual(check, buf)) {
            fs.unlinkSync(legacyFile);
            return { key: buf, protectionMode: 'dpapi_safestorage' };
          }
        } catch {
          // Fall back cleanly if DPAPI wrapping fails on host
        }
      }
      return { key: buf, protectionMode: 'local_file_0600' };
    }
  }

  // 3. Brand new installation -> generate fresh 256-bit key
  const newKey = crypto.randomBytes(32);
  if (canUseDpapi && safeStorage) {
    try {
      const wrapped = safeStorage.encryptString(newKey.toString('hex'));
      fs.writeFileSync(dpapiFile, wrapped, { mode: 0o600 });
      return { key: newKey, protectionMode: 'dpapi_safestorage' };
    } catch {
      // Fallback below
    }
  }

  fs.writeFileSync(legacyFile, newKey.toString('hex'), { mode: 0o600 });
  return { key: newKey, protectionMode: 'local_file_0600' };
}

export function getOrCreateLocalVaultKey(vaultRootDir: string, safeStorage?: SafeStorageAdapter | null): Buffer {
  return loadOrCreateVaultKey(vaultRootDir, safeStorage).key;
}

