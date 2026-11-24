import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  BackupEncryptionMode,
  BackupRecord,
  BackupVerificationResult,
  BackupVerificationStatus,
} from '../../shared/types/domain.ts';
import { closeSqliteSafely, openSqliteConnection } from '../database/connection.ts';
import { runMigrations } from '../database/migrator.ts';
import { writeAuditLog } from '../database/services/auditService.ts';
import {
  checkDatabaseHealth,
  collectReferencedVaultAttachments,
  type DatabaseHealthReport,
  type VaultAttachmentRef,
} from '../database/services/healthService.ts';
import {
  decryptBuffer,
  deriveBackupKeyFromPassphrase,
  encryptBuffer,
  getVaultKeyFingerprint,
  parseVaultRecoveryKey,
  resolveConfinedPath,
} from '../security/crypto.ts';
import { AuthError } from '../security/rbac.ts';

const ARCHIVE_MAGIC = Buffer.from('AGLBKP1\0', 'ascii');
const PACK_MAGIC = Buffer.from('PACK', 'ascii');
const BACKUP_FORMAT_NAME = 'AGENCY_BACKUP_V1';

interface BackupOuterHeader {
  formatVersion: 1;
  backupFormat: string;
  backupType: 'MANUAL' | 'AUTO' | 'PRE_RESTORE';
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  encryptionMode: BackupEncryptionMode;
  saltHex: string;
  recoveryKeyFingerprint: string | null;
  dbSha256: string;
  attachmentCount: number;
  totalUnencryptedBytes: number;
  payloadSha256: string;
}

interface BackupAttachmentManifestEntry {
  relativePath: string;
  plainSha256: string;
  sizeBytes: number;
}

interface BackupInnerManifest {
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  dbSha256: string;
  attachments: BackupAttachmentManifestEntry[];
  referencedAttachments: VaultAttachmentRef[];
}

interface RawBackupRecordRow {
  id: number;
  backup_type: 'AUTO' | 'MANUAL' | 'PRE_RESTORE';
  destination_path: string;
  file_name: string;
  file_size_bytes: number;
  checksum_sha256: string;
  status: 'SUCCESS' | 'FAILED';
  error_message: string | null;
  app_version: string;
  schema_version: string;
  includes_vault: number;
  attachment_count: number;
  backup_format: string;
  is_encrypted: number;
  encryption_mode: BackupEncryptionMode;
  recovery_key_fingerprint: string | null;
  verified_at: string | null;
  verification_status: BackupVerificationStatus;
  verification_summary_json: string | null;
  triggered_by_user_id: number | null;
  triggered_by_username: string | null;
  notes: string | null;
  created_at: string;
}

function mapBackupRow(row: RawBackupRecordRow): BackupRecord {
  return {
    id: row.id,
    backupType: row.backup_type,
    destinationPath: row.destination_path,
    fileName: row.file_name || path.basename(row.destination_path),
    fileSizeBytes: row.file_size_bytes,
    checksumSha256: row.checksum_sha256,
    status: row.status,
    errorMessage: row.error_message,
    appVersion: row.app_version ?? '1.0.0',
    schemaVersion: row.schema_version ?? '009',
    includesVault: row.includes_vault === 1,
    attachmentCount: row.attachment_count ?? 0,
    backupFormat: row.backup_format ?? BACKUP_FORMAT_NAME,
    isEncrypted: row.is_encrypted === 1,
    encryptionMode: row.encryption_mode ?? 'VAULT_RECOVERY_KEY',
    recoveryKeyFingerprint: row.recovery_key_fingerprint,
    verifiedAt: row.verified_at,
    verificationStatus: row.verification_status ?? 'PENDING',
    verificationSummaryJson: row.verification_summary_json,
    triggeredByUserId: row.triggered_by_user_id,
    triggeredByUsername: row.triggered_by_username,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getSchemaVersion(db: Database.Database): string {
  try {
    const row = db
      .prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
      .get();
    return row?.version ?? '000';
  } catch {
    return '000';
  }
}

function formatBackupTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

function walkVaultFiles(vaultRootDir: string): string[] {
  if (!fs.existsSync(vaultRootDir)) return [];
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.vault.key')) continue;
      if (entry.name.endsWith('.tmp')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(vaultRootDir, fullPath).split(path.sep).join('/');
        results.push(rel);
      }
    }
  };
  walk(vaultRootDir);
  return results.sort();
}

function checkAvailableDiskSpace(targetDir: string, requiredBytesEstimate: number): void {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const statFs = fs.statfsSync(targetDir);
    const freeBytes = Number(statFs.bavail) * Number(statFs.bsize);
    const safetyMin = Math.max(requiredBytesEstimate * 2, 20 * 1024 * 1024);
    if (freeBytes < safetyMin) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Espace disque insuffisant (${Math.round(freeBytes / (1024 * 1024))} Mo disponibles)`
      );
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Ignore platforms where statfsSync is unsupported
  }
}

function packBackupPayload(
  dbBytes: Buffer,
  manifest: BackupInnerManifest,
  attachmentPayloads: Array<{ relativePath: string; plainBytes: Buffer }>
): Buffer {
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  const chunks: Buffer[] = [PACK_MAGIC];

  const writeChunk = (buf: Buffer) => {
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(buf.length, 0);
    chunks.push(lenBuf, buf);
  };

  writeChunk(dbBytes);
  writeChunk(manifestBuf);

  const countBuf = Buffer.allocUnsafe(4);
  countBuf.writeUInt32BE(attachmentPayloads.length, 0);
  chunks.push(countBuf);

  for (const item of attachmentPayloads) {
    writeChunk(Buffer.from(item.relativePath, 'utf8'));
    writeChunk(item.plainBytes);
  }

  return Buffer.concat(chunks);
}

function unpackBackupPayload(packBuf: Buffer): {
  dbBytes: Buffer;
  manifest: BackupInnerManifest;
  attachments: Array<{ relativePath: string; plainBytes: Buffer }>;
} {
  if (packBuf.length < 16 || !packBuf.subarray(0, 4).equals(PACK_MAGIC)) {
    throw new AuthError('VALIDATION_ERROR', 'Contenu de sauvegarde corrompu ou format interne invalide');
  }
  let offset = 4;

  const readChunk = (): Buffer => {
    if (offset + 4 > packBuf.length) {
      throw new AuthError('VALIDATION_ERROR', 'Archive de sauvegarde tronquée');
    }
    const len = packBuf.readUInt32BE(offset);
    offset += 4;
    if (offset + len > packBuf.length) {
      throw new AuthError('VALIDATION_ERROR', 'Bloc de sauvegarde corrompu ou tronqué');
    }
    const slice = packBuf.subarray(offset, offset + len);
    offset += len;
    return slice;
  };

  const dbBytes = readChunk();
  const manifestBuf = readChunk();
  const manifest = JSON.parse(manifestBuf.toString('utf8')) as BackupInnerManifest;

  if (offset + 4 > packBuf.length) {
    throw new AuthError('VALIDATION_ERROR', 'Compteur de pièces jointes manquant dans la sauvegarde');
  }
  const attCount = packBuf.readUInt32BE(offset);
  offset += 4;

  const attachments: Array<{ relativePath: string; plainBytes: Buffer }> = [];
  for (let i = 0; i < attCount; i++) {
    const relativePath = readChunk().toString('utf8');
    const plainBytes = readChunk();
    attachments.push({ relativePath, plainBytes });
  }

  return { dbBytes, manifest, attachments };
}

function encodeArchive(header: BackupOuterHeader, encryptedPayload: Buffer): Buffer {
  const headerBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([ARCHIVE_MAGIC, lenBuf, headerBuf, encryptedPayload]);
}

function decodeArchiveEnvelope(archiveBytes: Buffer): {
  header: BackupOuterHeader;
  encryptedPayload: Buffer;
} {
  if (archiveBytes.length < 16 || !archiveBytes.subarray(0, 8).equals(ARCHIVE_MAGIC)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Fichier de sauvegarde invalide (signature .agbkp absente ou corrompue)'
    );
  }
  const headerLen = archiveBytes.readUInt32BE(8);
  const headerStart = 12;
  const headerEnd = headerStart + headerLen;
  if (headerLen <= 0 || headerEnd > archiveBytes.length) {
    throw new AuthError('VALIDATION_ERROR', 'En-tête de sauvegarde corrompu');
  }
  const header = JSON.parse(archiveBytes.subarray(headerStart, headerEnd).toString('utf8')) as BackupOuterHeader;
  const encryptedPayload = archiveBytes.subarray(headerEnd);
  return { header, encryptedPayload };
}

function resolveDecryptionKeyForHeader(
  header: BackupOuterHeader,
  secrets: {
    passphrase?: string;
    recoveryKey?: string;
    vaultKey?: Buffer;
  }
): Buffer {
  if (header.encryptionMode === 'PASSPHRASE') {
    if (!secrets.passphrase || !secrets.passphrase.trim()) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Cette sauvegarde est protégée par phrase secrète. Veuillez saisir la phrase secrète.'
      );
    }
    const salt = Buffer.from(header.saltHex, 'hex');
    return deriveBackupKeyFromPassphrase(secrets.passphrase, salt);
  }

  if (secrets.recoveryKey && secrets.recoveryKey.trim()) {
    return parseVaultRecoveryKey(secrets.recoveryKey);
  }
  if (secrets.vaultKey && secrets.vaultKey.length === 32) {
    return secrets.vaultKey;
  }
  throw new AuthError(
    'VALIDATION_ERROR',
    'Clé de récupération du coffre requise pour déchiffrer cette sauvegarde'
  );
}

/**
 * Synchronous pre-migration safety snapshot using SQLite `VACUUM INTO` + encrypted vault copy.
 * Triggered automatically before pending SQL migrations run on an existing database.
 */
export function createPreMigrationSnapshot(
  db: Database.Database,
  options: {
    dbPath: string;
    vaultRootDir: string;
    backupDir: string;
    pendingFiles: string[];
  }
): string {
  const snapshotDir = path.join(
    options.backupDir,
    'pre_migration',
    `PRE_MIGRATION_${formatBackupTimestamp()}`
  );
  fs.mkdirSync(snapshotDir, { recursive: true });
  const dbDest = path.join(snapshotDir, 'agency_pre_migration.sqlite');
  const escapedPath = dbDest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);

  const vaultCopyDir = path.join(snapshotDir, 'vault');
  if (fs.existsSync(options.vaultRootDir)) {
    fs.cpSync(options.vaultRootDir, vaultCopyDir, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.vault.key'),
    });
  }

  fs.writeFileSync(
    path.join(snapshotDir, 'migration_info.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sourceDbPath: options.dbPath,
        pendingMigrations: options.pendingFiles,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  return snapshotDir;
}

export function listBackups(db: Database.Database, limit = 100): BackupRecord[] {
  const rows = db
    .prepare<[number], RawBackupRecordRow>(
      `SELECT * FROM backup_records ORDER BY id DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 500));
  return rows.map(mapBackupRow);
}

export function getBackupRecordById(db: Database.Database, backupId: number): BackupRecord {
  const row = db
    .prepare<[number], RawBackupRecordRow>('SELECT * FROM backup_records WHERE id = ?')
    .get(backupId);
  if (!row) {
    throw new AuthError('NOT_FOUND', 'Sauvegarde introuvable');
  }
  return mapBackupRow(row);
}

export async function createBackup(
  db: Database.Database,
  options: {
    backupDir: string;
    vaultRootDir: string;
    vaultKey: Buffer;
    appVersion?: string;
    backupType?: 'MANUAL' | 'AUTO' | 'PRE_RESTORE';
    encryptionMode?: BackupEncryptionMode;
    passphrase?: string;
    destinationPath?: string | null;
    notes?: string | null;
    actor?: { id: number | null; username: string };
  }
): Promise<{ backup: BackupRecord; verification: BackupVerificationResult }> {
  const backupType = options.backupType ?? 'MANUAL';
  const encryptionMode: BackupEncryptionMode =
    options.encryptionMode === 'PASSPHRASE' ? 'PASSPHRASE' : 'VAULT_RECOVERY_KEY';

  if (encryptionMode === 'PASSPHRASE' && (!options.passphrase || options.passphrase.length < 8)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'La phrase secrète de sauvegarde doit contenir au moins 8 caractères'
    );
  }

  const appVersion = options.appVersion ?? '1.0.0';
  const schemaVersion = getSchemaVersion(db);
  const createdAt = new Date().toISOString();
  const stamp = formatBackupTimestamp();
  const suffix = backupType === 'AUTO' ? 'AUTO' : backupType === 'PRE_RESTORE' ? 'PRERESTORE' : 'MANUAL';
  const defaultFileName = `AGL-BACKUP-${stamp}-${suffix}.agbkp`;

  const subDir =
    backupType === 'AUTO'
      ? path.join(options.backupDir, 'auto')
      : backupType === 'PRE_RESTORE'
        ? path.join(options.backupDir, 'pre_restore')
        : path.join(options.backupDir, 'manual');

  const finalTargetPath = options.destinationPath
    ? path.resolve(options.destinationPath)
    : path.join(subDir, defaultFileName);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-backup-stage-'));
  const stagedDbPath = path.join(stageDir, 'staged.sqlite');

  try {
    fs.mkdirSync(path.dirname(finalTargetPath), { recursive: true });
    checkAvailableDiskSpace(path.dirname(finalTargetPath), 20 * 1024 * 1024);

    // 1. Consistent SQLite Online Backup (captures committed WAL transactions cleanly)
    await db.backup(stagedDbPath);
    const dbBytes = fs.readFileSync(stagedDbPath);
    if (dbBytes.length === 0) {
      throw new Error('La sauvegarde SQLite générée est vide');
    }
    const dbSha256 = sha256Hex(dbBytes);

    // Inspect staged snapshot for referenced vault attachments
    const stagedDb = openSqliteConnection(stagedDbPath);
    let referencedAttachments: VaultAttachmentRef[] = [];
    try {
      referencedAttachments = collectReferencedVaultAttachments(stagedDb);
    } finally {
      closeSqliteSafely(stagedDb);
    }

    // 2. Collect and decrypt all vault attachments so bundle is self-contained and portable across PCs
    const vaultRelPaths = walkVaultFiles(options.vaultRootDir);
    const attachmentPayloads: Array<{ relativePath: string; plainBytes: Buffer }> = [];
    const attachmentManifest: BackupAttachmentManifestEntry[] = [];
    let totalAttachmentBytes = 0;

    for (const relPath of vaultRelPaths) {
      const fullPath = resolveConfinedPath(options.vaultRootDir, relPath);
      const encBytes = fs.readFileSync(fullPath);
      const plainBytes = decryptBuffer(encBytes, options.vaultKey);
      totalAttachmentBytes += plainBytes.length;
      attachmentPayloads.push({ relativePath: relPath, plainBytes });
      attachmentManifest.push({
        relativePath: relPath,
        plainSha256: sha256Hex(plainBytes),
        sizeBytes: plainBytes.length,
      });
    }

    // Ensure every DB-referenced attachment is accounted for in normal backups;
    // PRE_RESTORE snapshots must succeed even when live vault files were lost prior to recovery.
    if (backupType !== 'PRE_RESTORE') {
      const bundledSet = new Set(attachmentManifest.map((a) => a.relativePath));
      for (const ref of referencedAttachments) {
        const normalized = ref.relativePath.replace(/\\/g, '/');
        if (!bundledSet.has(normalized)) {
          throw new Error(
            `Pièce chiffrée manquante dans le coffre (${ref.sourceTable}#${ref.recordId}: ${normalized})`
          );
        }
      }
    }

    const manifest: BackupInnerManifest = {
      createdAt,
      appVersion,
      schemaVersion,
      dbSha256,
      attachments: attachmentManifest,
      referencedAttachments,
    };

    // 3. Pack + Encrypt + Write atomically via temp file + rename
    const packBuffer = packBackupPayload(dbBytes, manifest, attachmentPayloads);
    const salt = crypto.randomBytes(32);
    const wrappingKey =
      encryptionMode === 'PASSPHRASE'
        ? deriveBackupKeyFromPassphrase(options.passphrase!, salt)
        : options.vaultKey;
    const keyFingerprint =
      encryptionMode === 'VAULT_RECOVERY_KEY' ? getVaultKeyFingerprint(options.vaultKey) : null;

    const encryptedPayload = encryptBuffer(packBuffer, wrappingKey);
    const header: BackupOuterHeader = {
      formatVersion: 1,
      backupFormat: BACKUP_FORMAT_NAME,
      backupType,
      createdAt,
      appVersion,
      schemaVersion,
      encryptionMode,
      saltHex: salt.toString('hex'),
      recoveryKeyFingerprint: keyFingerprint,
      dbSha256,
      attachmentCount: attachmentManifest.length,
      totalUnencryptedBytes: dbBytes.length + totalAttachmentBytes,
      payloadSha256: sha256Hex(packBuffer),
    };

    const archiveBytes = encodeArchive(header, encryptedPayload);
    const archiveSha256 = sha256Hex(archiveBytes);
    const tempOutPath = `${finalTargetPath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempOutPath, archiveBytes, { mode: 0o600 });
    fs.renameSync(tempOutPath, finalTargetPath);

    // 4. Verify immediately after creation
    const verification = verifyBackupArchive({
      filePath: finalTargetPath,
      passphrase: options.passphrase,
      vaultKey: options.vaultKey,
    });
    if (!verification.valid) {
      throw new Error(verification.errorMessage || 'Échec de vérification post-sauvegarde');
    }

    const insertRes = db
      .prepare(
        `INSERT INTO backup_records (
          backup_type, destination_path, file_name, file_size_bytes, checksum_sha256,
          status, error_message, app_version, schema_version, includes_vault, attachment_count,
          backup_format, is_encrypted, encryption_mode, recovery_key_fingerprint,
          verified_at, verification_status, verification_summary_json,
          triggered_by_user_id, triggered_by_username, notes
        ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?, 1, ?, ?, 1, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)`
      )
      .run(
        backupType,
        finalTargetPath,
        path.basename(finalTargetPath),
        archiveBytes.length,
        archiveSha256,
        appVersion,
        schemaVersion,
        attachmentManifest.length,
        BACKUP_FORMAT_NAME,
        encryptionMode,
        keyFingerprint,
        new Date().toISOString(),
        JSON.stringify(verification.recordCounts),
        options.actor?.id ?? null,
        options.actor?.username ?? 'system',
        options.notes ?? null
      );

    const record = getBackupRecordById(db, Number(insertRes.lastInsertRowid));
    writeAuditLog(db, {
      userId: options.actor?.id ?? null,
      usernameSnapshot: options.actor?.username ?? 'system',
      operation: 'BACKUP_CREATED',
      entityType: 'backup_records',
      entityId: record.id,
      newValue: {
        backupType,
        fileName: record.fileName,
        fileSizeBytes: record.fileSizeBytes,
        checksumSha256: record.checksumSha256,
        encryptionMode,
        attachmentCount: record.attachmentCount,
      },
    });

    return { backup: record, verification };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Erreur inconnue de sauvegarde';
    try {
      db.prepare(
        `INSERT INTO backup_records (
          backup_type, destination_path, file_name, file_size_bytes, checksum_sha256,
          status, error_message, app_version, schema_version, includes_vault, attachment_count,
          backup_format, is_encrypted, encryption_mode, verification_status,
          triggered_by_user_id, triggered_by_username, notes
        ) VALUES (?, ?, ?, 0, 'FAILED', 'FAILED', ?, ?, ?, 1, 0, ?, 1, ?, 'FAILED', ?, ?, ?)`
      ).run(
        backupType,
        finalTargetPath,
        path.basename(finalTargetPath),
        errMsg,
        appVersion,
        schemaVersion,
        BACKUP_FORMAT_NAME,
        encryptionMode,
        options.actor?.id ?? null,
        options.actor?.username ?? 'system',
        options.notes ?? null
      );
      writeAuditLog(db, {
        userId: options.actor?.id ?? null,
        usernameSnapshot: options.actor?.username ?? 'system',
        operation: 'BACKUP_FAILED',
        entityType: 'backup_records',
        entityId: null,
        newValue: { backupType, error: errMsg },
      });
    } catch {
      // Never mask original backup error
    }
    throw err;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

export function verifyBackupArchive(input: {
  filePath: string;
  passphrase?: string;
  recoveryKey?: string;
  vaultKey?: Buffer;
  db?: Database.Database;
  backupRecordId?: number;
  actor?: { id: number | null; username: string };
}): BackupVerificationResult {
  if (!fs.existsSync(input.filePath)) {
    throw new AuthError('NOT_FOUND', 'Fichier de sauvegarde introuvable sur le disque');
  }

  const archiveBytes = fs.readFileSync(input.filePath);
  const archiveChecksumSha256 = sha256Hex(archiveBytes);
  const { header, encryptedPayload } = decodeArchiveEnvelope(archiveBytes);

  let packBuffer: Buffer;
  try {
    const key = resolveDecryptionKeyForHeader(header, {
      passphrase: input.passphrase,
      recoveryKey: input.recoveryKey,
      vaultKey: input.vaultKey,
    });
    packBuffer = decryptBuffer(encryptedPayload, key);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(
      'VALIDATION_ERROR',
      'Impossible de déchiffrer la sauvegarde : clé de récupération ou phrase secrète incorrecte, ou fichier altéré'
    );
  }

  if (sha256Hex(packBuffer) !== header.payloadSha256) {
    throw new AuthError('VALIDATION_ERROR', 'Empreinte SHA-256 du contenu de sauvegarde invalide');
  }

  const { dbBytes, manifest, attachments } = unpackBackupPayload(packBuffer);
  if (sha256Hex(dbBytes) !== header.dbSha256 || sha256Hex(dbBytes) !== manifest.dbSha256) {
    throw new AuthError('VALIDATION_ERROR', 'Empreinte SHA-256 de la base SQLite incohérente');
  }

  // Verify every attachment's checksum & map
  const manifestMap = new Map(manifest.attachments.map((a) => [a.relativePath, a]));
  const unpackedMap = new Map<string, Buffer>();
  let verifiedAttachmentCount = 0;

  for (const item of attachments) {
    // Reject path traversal inside archives
    resolveConfinedPath('/virtual-vault', item.relativePath);
    const meta = manifestMap.get(item.relativePath);
    if (!meta || sha256Hex(item.plainBytes) !== meta.plainSha256) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Pièce chiffrée corrompue dans la sauvegarde : ${item.relativePath}`
      );
    }
    unpackedMap.set(item.relativePath, item.plainBytes);
    verifiedAttachmentCount += 1;
  }

  // Deep SQLite structural & foreign-key inspection on a temp file
  const tempVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-verify-'));
  const tempDbPath = path.join(tempVerifyDir, 'verify.sqlite');
  let integrityCheckOk = false;
  let foreignKeyViolations = 0;
  let missingTables: string[] = [];
  let missingAttachmentCount = 0;
  let recordCounts = {
    users: 0,
    vehicles: 0,
    customers: 0,
    contracts: 0,
    payments: 0,
    generatedDocuments: 0,
  };

  try {
    fs.writeFileSync(tempDbPath, dbBytes, { mode: 0o600 });
    const verifyDb = openSqliteConnection(tempDbPath);
    try {
      const integRows = verifyDb.pragma('integrity_check') as Array<Record<string, string>>;
      const vals = integRows.map((r) => String(Object.values(r)[0] ?? '').toLowerCase());
      integrityCheckOk = vals.length === 1 && vals[0] === 'ok';

      const fkRows = verifyDb.pragma('foreign_key_check') as unknown[];
      foreignKeyViolations = fkRows.length;

      const tables = new Set(
        verifyDb
          .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((t) => t.name)
      );
      const criticalTables = [
        'users',
        'vehicles',
        'customers',
        'rental_contracts',
        'contract_payments',
        'deposits',
        'audit_logs',
        'application_settings',
      ];
      missingTables = criticalTables.filter((t) => !tables.has(t));

      const refs = collectReferencedVaultAttachments(verifyDb);
      for (const ref of refs) {
        if (!unpackedMap.has(ref.relativePath.replace(/\\/g, '/'))) {
          missingAttachmentCount += 1;
        }
      }

      const safeCount = (tbl: string) => {
        try {
          const r = verifyDb.prepare<[], { cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${tbl}`).get();
          return Number(r?.cnt ?? 0);
        } catch {
          return 0;
        }
      };

      recordCounts = {
        users: safeCount('users'),
        vehicles: safeCount('vehicles'),
        customers: safeCount('customers'),
        contracts: safeCount('rental_contracts'),
        payments: safeCount('contract_payments'),
        generatedDocuments: safeCount('generated_documents'),
      };
    } finally {
      closeSqliteSafely(verifyDb);
    }
  } finally {
    fs.rmSync(tempVerifyDir, { recursive: true, force: true });
  }

  const valid =
    integrityCheckOk &&
    foreignKeyViolations === 0 &&
    missingTables.length === 0 &&
    (header.backupType === 'PRE_RESTORE' || missingAttachmentCount === 0);

  const result: BackupVerificationResult = {
    valid,
    filePath: input.filePath,
    fileName: path.basename(input.filePath),
    fileSizeBytes: archiveBytes.length,
    archiveChecksumSha256,
    backupType: header.backupType,
    createdAt: header.createdAt,
    appVersion: header.appVersion,
    schemaVersion: header.schemaVersion,
    encryptionMode: header.encryptionMode,
    recoveryKeyFingerprint: header.recoveryKeyFingerprint,
    integrityCheckOk,
    foreignKeyViolations,
    missingTables,
    attachmentCount: manifest.attachments.length,
    verifiedAttachmentCount,
    missingAttachmentCount,
    recordCounts,
    errorMessage: valid
      ? null
      : `Anomalie détectée (intégrité=${integrityCheckOk}, FK=${foreignKeyViolations}, tables manquantes=${missingTables.length}, pièces manquantes=${missingAttachmentCount})`,
  };

  if (input.db && input.backupRecordId) {
    input.db
      .prepare(
        `UPDATE backup_records
         SET verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             verification_status = ?,
             verification_summary_json = ?
         WHERE id = ?`
      )
      .run(valid ? 'VERIFIED' : 'FAILED', JSON.stringify(recordCounts), input.backupRecordId);

    if (input.actor) {
      writeAuditLog(input.db, {
        userId: input.actor.id,
        usernameSnapshot: input.actor.username,
        operation: valid ? 'BACKUP_VERIFIED' : 'BACKUP_VERIFY_FAILED',
        entityType: 'backup_records',
        entityId: input.backupRecordId,
        newValue: {
          valid,
          integrityCheckOk,
          foreignKeyViolations,
          verifiedAttachmentCount,
          missingAttachmentCount,
        },
      });
    }
  }

  return result;
}

/**
 * Atomic disaster-recovery restore:
 * 1. Verifies backup archive completely BEFORE modifying live DB or vault.
 * 2. Captures mandatory PRE_RESTORE safety backup of the current state.
 * 3. Extracts verified SQLite DB + upgrades schema if archive is older + re-encrypts vault attachments with active vaultKey.
 * 4. Performs atomic swap with automatic rollback if swap/reopen/health fails.
 */
export async function restoreFromBackup(
  context: {
    getDb: () => Database.Database;
    setDb: (nextDb: Database.Database) => void;
    dbPath: string;
    migrationsDir: string;
    vaultRootDir: string;
    vaultKey: Buffer;
    vaultProtectionMode: 'dpapi_safestorage' | 'local_file_0600';
    backupDir: string;
    appVersion: string;
  },
  input: {
    backupRecordId?: number;
    filePath?: string;
    base64Archive?: string;
    fileName?: string;
    passphrase?: string;
    recoveryKey?: string;
    actor: { id: number; username: string };
  }
): Promise<{
  restoredFrom: string;
  verification: BackupVerificationResult;
  preRestoreBackup: BackupRecord;
  healthReport: DatabaseHealthReport;
}> {
  const liveDb = context.getDb();
  let targetFilePath = input.filePath ? path.resolve(input.filePath) : '';
  let tempImportedPath: string | null = null;

  try {
    if (input.backupRecordId) {
      const rec = getBackupRecordById(liveDb, input.backupRecordId);
      targetFilePath = rec.destinationPath;
    } else if (input.base64Archive) {
      const buf = Buffer.from(input.base64Archive, 'base64');
      tempImportedPath = path.join(
        os.tmpdir(),
        `agl-restore-upload-${crypto.randomUUID()}.agbkp`
      );
      fs.writeFileSync(tempImportedPath, buf, { mode: 0o600 });
      targetFilePath = tempImportedPath;
    }

    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      throw new AuthError('NOT_FOUND', 'Fichier de sauvegarde introuvable pour la restauration');
    }

    // 1. Full archive verification BEFORE touching any production data
    const verification = verifyBackupArchive({
      filePath: targetFilePath,
      passphrase: input.passphrase,
      recoveryKey: input.recoveryKey,
      vaultKey: context.vaultKey,
    });
    if (!verification.valid) {
      throw new AuthError(
        'VALIDATION_ERROR',
        verification.errorMessage || 'Sauvegarde corrompue — restauration annulée'
      );
    }

    checkAvailableDiskSpace(path.dirname(context.dbPath), verification.fileSizeBytes * 3);

    // 2. Mandatory PRE_RESTORE safety backup of the current live database + vault
    const preRestore = await createBackup(liveDb, {
      backupDir: context.backupDir,
      vaultRootDir: context.vaultRootDir,
      vaultKey: context.vaultKey,
      appVersion: context.appVersion,
      backupType: 'PRE_RESTORE',
      encryptionMode: 'VAULT_RECOVERY_KEY',
      notes: `Instantané automatique avant restauration de ${verification.fileName}`,
      actor: input.actor,
    });

    // 3. Unpack verified archive into staging directory & apply any forward schema migrations
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-restore-stage-'));
    const stagedDbPath = path.join(stageRoot, 'agency_restored.sqlite');
    const stagedVaultDir = path.join(stageRoot, 'vault');
    fs.mkdirSync(stagedVaultDir, { recursive: true });

    try {
      const archiveBytes = fs.readFileSync(targetFilePath);
      const { header, encryptedPayload } = decodeArchiveEnvelope(archiveBytes);
      const decryptKey = resolveDecryptionKeyForHeader(header, {
        passphrase: input.passphrase,
        recoveryKey: input.recoveryKey,
        vaultKey: context.vaultKey,
      });
      const packBuffer = decryptBuffer(encryptedPayload, decryptKey);
      const { dbBytes, attachments } = unpackBackupPayload(packBuffer);

      fs.writeFileSync(stagedDbPath, dbBytes, { mode: 0o600 });

      // Apply forward migrations if backup came from an older schema version
      const stagedDb = openSqliteConnection(stagedDbPath);
      try {
        runMigrations(stagedDb, context.migrationsDir);
      } finally {
        closeSqliteSafely(stagedDb);
      }

      // Re-encrypt all attachments under the current machine's vaultKey
      for (const att of attachments) {
        const destFile = resolveConfinedPath(stagedVaultDir, att.relativePath);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        const reEncrypted = encryptBuffer(att.plainBytes, context.vaultKey);
        fs.writeFileSync(destFile, reEncrypted, { mode: 0o600 });
      }

      // 4. Atomic swap with full rollback on error
      const rollbackDir = path.join(
        os.tmpdir(),
        `agl-rollback-${crypto.randomUUID()}`
      );
      fs.mkdirSync(rollbackDir, { recursive: true });
      const rollbackDbPath = path.join(rollbackDir, 'old.sqlite');
      const rollbackVaultDir = path.join(rollbackDir, 'old_vault');
      fs.mkdirSync(rollbackVaultDir, { recursive: true });

      closeSqliteSafely(liveDb);

      const moveVaultContentsExcludingKey = (srcDir: string, dstDir: string) => {
        if (!fs.existsSync(srcDir)) return;
        fs.mkdirSync(dstDir, { recursive: true });
        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          if (entry.name.startsWith('.vault.key')) continue;
          const srcPath = path.join(srcDir, entry.name);
          const dstPath = path.join(dstDir, entry.name);
          fs.cpSync(srcPath, dstPath, { recursive: true });
          fs.rmSync(srcPath, { recursive: true, force: true });
        }
      };

      try {
        // Backup existing DB + WAL/SHM to rollback dir
        if (fs.existsSync(context.dbPath)) {
          fs.copyFileSync(context.dbPath, rollbackDbPath);
          fs.rmSync(context.dbPath, { force: true });
        }
        for (const suffix of ['-wal', '-shm']) {
          const sidecar = `${context.dbPath}${suffix}`;
          if (fs.existsSync(sidecar)) {
            fs.copyFileSync(sidecar, `${rollbackDbPath}${suffix}`);
            fs.rmSync(sidecar, { force: true });
          }
        }
        moveVaultContentsExcludingKey(context.vaultRootDir, rollbackVaultDir);

        // Move staged DB + staged vault into live paths
        fs.copyFileSync(stagedDbPath, context.dbPath);
        fs.cpSync(stagedVaultDir, context.vaultRootDir, { recursive: true });

        // Reopen and validate live DB health
        const restoredDb = openSqliteConnection(context.dbPath);
        const healthReport = checkDatabaseHealth(restoredDb, {
          dbPath: context.dbPath,
          migrationsDir: context.migrationsDir,
          vaultRootDir: context.vaultRootDir,
          vaultProtectionMode: context.vaultProtectionMode,
          deepIntegrity: true,
        });

        if (healthReport.overallStatus === 'CRITICAL') {
          closeSqliteSafely(restoredDb);
          throw new Error('La base restaurée a échoué au contrôle critique de santé');
        }

        // Record restore audit log inside newly restored DB safely
        const actorInRestoredDb = restoredDb
          .prepare<[string], { id: number }>('SELECT id FROM users WHERE username = ?')
          .get(input.actor.username);

        writeAuditLog(restoredDb, {
          userId: actorInRestoredDb?.id ?? null,
          usernameSnapshot: input.actor.username,
          operation: 'BACKUP_RESTORED',
          entityType: 'backup_records',
          entityId: input.backupRecordId ?? null,
          newValue: {
            restoredFile: verification.fileName,
            archiveChecksumSha256: verification.archiveChecksumSha256,
            schemaVersion: verification.schemaVersion,
            preRestoreBackupPath: preRestore.backup.destinationPath,
          },
        });

        context.setDb(restoredDb);
        fs.rmSync(rollbackDir, { recursive: true, force: true });

        return {
          restoredFrom: verification.fileName,
          verification,
          preRestoreBackup: preRestore.backup,
          healthReport,
        };
      } catch (swapErr) {
        // Automatic rollback to pre-restore files
        try {
          if (fs.existsSync(rollbackDbPath)) {
            fs.copyFileSync(rollbackDbPath, context.dbPath);
          }
          for (const suffix of ['-wal', '-shm']) {
            const rbSide = `${rollbackDbPath}${suffix}`;
            const liveSide = `${context.dbPath}${suffix}`;
            if (fs.existsSync(rbSide)) fs.copyFileSync(rbSide, liveSide);
            else if (fs.existsSync(liveSide)) fs.rmSync(liveSide, { force: true });
          }
          moveVaultContentsExcludingKey(context.vaultRootDir, path.join(rollbackDir, 'failed_vault'));
          if (fs.existsSync(rollbackVaultDir)) {
            fs.cpSync(rollbackVaultDir, context.vaultRootDir, { recursive: true });
          }
          const reopenedOldDb = openSqliteConnection(context.dbPath);
          context.setDb(reopenedOldDb);
        } catch {
          // Best-effort rollback
        } finally {
          fs.rmSync(rollbackDir, { recursive: true, force: true });
        }
        throw swapErr;
      }
    } finally {
      fs.rmSync(stageRoot, { recursive: true, force: true });
    }
  } finally {
    if (tempImportedPath && fs.existsSync(tempImportedPath)) {
      fs.rmSync(tempImportedPath, { force: true });
    }
  }
}

export function exportBackupFile(
  db: Database.Database,
  input: {
    backupRecordId: number;
    destinationPath?: string;
    actor: { id: number; username: string };
  }
): { fileName: string; exportedToPath?: string; base64Archive?: string; checksumSha256: string } {
  const record = getBackupRecordById(db, input.backupRecordId);
  if (!fs.existsSync(record.destinationPath)) {
    throw new AuthError('NOT_FOUND', 'Fichier de sauvegarde introuvable sur le disque');
  }

  const archiveBytes = fs.readFileSync(record.destinationPath);
  const checksumSha256 = sha256Hex(archiveBytes);
  const fileName = record.fileName || path.basename(record.destinationPath);

  if (input.destinationPath) {
    const target = path.resolve(input.destinationPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, archiveBytes, { mode: 0o600 });
    fs.renameSync(tmp, target);

    writeAuditLog(db, {
      userId: input.actor.id,
      usernameSnapshot: input.actor.username,
      operation: 'BACKUP_EXPORTED',
      entityType: 'backup_records',
      entityId: record.id,
      newValue: { exportedToPath: target, checksumSha256 },
    });

    return { fileName, exportedToPath: target, checksumSha256 };
  }

  writeAuditLog(db, {
    userId: input.actor.id,
    usernameSnapshot: input.actor.username,
    operation: 'BACKUP_EXPORTED',
    entityType: 'backup_records',
    entityId: record.id,
    newValue: { mode: 'browser_download', fileName, checksumSha256 },
  });

  return {
    fileName,
    base64Archive: archiveBytes.toString('base64'),
    checksumSha256,
  };
}

export function importBackupExternal(
  db: Database.Database,
  options: {
    backupDir: string;
    vaultKey: Buffer;
    sourcePath?: string;
    fileName?: string;
    base64Archive?: string;
    passphrase?: string;
    recoveryKey?: string;
    actor: { id: number; username: string };
  }
): { backup: BackupRecord; verification: BackupVerificationResult } {
  const importDir = path.join(options.backupDir, 'imported');
  fs.mkdirSync(importDir, { recursive: true });

  const cleanBaseName = path
    .basename(options.fileName || options.sourcePath || `imported-${formatBackupTimestamp()}.agbkp`)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const ensuredName = cleanBaseName.endsWith('.agbkp') ? cleanBaseName : `${cleanBaseName}.agbkp`;
  const destPath = path.join(importDir, `${Date.now()}_${ensuredName}`);

  if (options.sourcePath) {
    if (!fs.existsSync(options.sourcePath)) {
      throw new AuthError('NOT_FOUND', 'Fichier source introuvable');
    }
    fs.copyFileSync(options.sourcePath, destPath);
  } else if (options.base64Archive) {
    const buf = Buffer.from(options.base64Archive, 'base64');
    fs.writeFileSync(destPath, buf, { mode: 0o600 });
  } else {
    throw new AuthError('VALIDATION_ERROR', 'Source de sauvegarde requise');
  }

  try {
    const verification = verifyBackupArchive({
      filePath: destPath,
      passphrase: options.passphrase,
      recoveryKey: options.recoveryKey,
      vaultKey: options.vaultKey,
    });
    if (!verification.valid) {
      throw new AuthError(
        'VALIDATION_ERROR',
        verification.errorMessage || 'Sauvegarde importée invalide'
      );
    }

    const insertRes = db
      .prepare(
        `INSERT INTO backup_records (
          backup_type, destination_path, file_name, file_size_bytes, checksum_sha256,
          status, error_message, app_version, schema_version, includes_vault, attachment_count,
          backup_format, is_encrypted, encryption_mode, recovery_key_fingerprint,
          verified_at, verification_status, verification_summary_json,
          triggered_by_user_id, triggered_by_username, notes
        ) VALUES ('MANUAL', ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?, 1, ?, ?, 1, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)`
      )
      .run(
        destPath,
        path.basename(destPath),
        verification.fileSizeBytes,
        verification.archiveChecksumSha256,
        verification.appVersion,
        verification.schemaVersion,
        verification.attachmentCount,
        BACKUP_FORMAT_NAME,
        verification.encryptionMode,
        verification.recoveryKeyFingerprint,
        new Date().toISOString(),
        JSON.stringify(verification.recordCounts),
        options.actor.id,
        options.actor.username,
        `Importée depuis support externe (${cleanBaseName})`
      );

    const record = getBackupRecordById(db, Number(insertRes.lastInsertRowid));
    writeAuditLog(db, {
      userId: options.actor.id,
      usernameSnapshot: options.actor.username,
      operation: 'BACKUP_IMPORTED',
      entityType: 'backup_records',
      entityId: record.id,
      newValue: {
        fileName: record.fileName,
        checksumSha256: record.checksumSha256,
      },
    });

    return { backup: record, verification };
  } catch (err) {
    fs.rmSync(destPath, { force: true });
    throw err;
  }
}

/**
 * Retention pruning for automatic scheduled backups:
 * Keeps at least `retentionCount` newest valid AUTO backups (minimum 1).
 * Never deletes MANUAL or PRE_RESTORE snapshots.
 */
export function pruneExpiredBackups(
  db: Database.Database,
  retentionCount: number
): { removedIds: number[] } {
  const safeKeep = Math.max(1, Math.min(365, Math.floor(retentionCount)));
  const rows = db
    .prepare<[], { id: number; destination_path: string }>(
      `SELECT id, destination_path
       FROM backup_records
       WHERE backup_type = 'AUTO' AND status = 'SUCCESS'
       ORDER BY id DESC`
    )
    .all();

  if (rows.length <= safeKeep) {
    return { removedIds: [] };
  }

  const toPrune = rows.slice(safeKeep);
  const removedIds: number[] = [];

  for (const row of toPrune) {
    try {
      if (fs.existsSync(row.destination_path)) {
        fs.rmSync(row.destination_path, { force: true });
      }
      db.prepare('DELETE FROM backup_records WHERE id = ?').run(row.id);
      removedIds.push(row.id);
    } catch {
      // Skip non-removable files safely
    }
  }

  return { removedIds };
}
