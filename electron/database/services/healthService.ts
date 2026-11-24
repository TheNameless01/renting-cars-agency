import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { resolveConfinedPath } from '../../security/crypto.ts';
import { listMigrationFiles } from '../migrator.ts';

export type HealthSeverityStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface HealthCheckItem {
  key: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  messageFr: string;
  messageAr: string;
  details?: string | null;
}

export interface DatabaseHealthReport {
  overallStatus: HealthSeverityStatus;
  checkedAt: string;
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  schemaVersion: string;
  journalMode: string;
  synchronousMode: string;
  foreignKeysEnabled: boolean;
  integrityCheckOk: boolean;
  foreignKeyViolationsCount: number;
  migrationChecksumsOk: boolean;
  missingTables: string[];
  vaultAccessible: boolean;
  vaultProtectionMode: 'dpapi_safestorage' | 'local_file_0600';
  vaultFileCount: number;
  missingReferencedAttachments: number;
  freeDiskBytes: number | null;
  recordCounts: {
    users: number;
    vehicles: number;
    customers: number;
    contracts: number;
    payments: number;
    generatedDocuments: number;
    backups: number;
  };
  checks: HealthCheckItem[];
}

const REQUIRED_CORE_TABLES = [
  'schema_migrations',
  'roles',
  'permissions',
  'users',
  'vehicles',
  'vehicle_documents',
  'customers',
  'customer_documents',
  'reservations',
  'rental_contracts',
  'contract_payments',
  'deposits',
  'deposit_movements',
  'cash_register_sessions',
  'expenses',
  'vehicle_inspections',
  'maintenance_records',
  'inventory_parts',
  'generated_documents',
  'notifications',
  'audit_logs',
  'application_settings',
  'backup_records',
] as const;

export interface VaultAttachmentRef {
  sourceTable: string;
  recordId: number;
  relativePath: string;
}

/**
 * Collects every vault attachment path currently referenced by SQLite rows.
 * Used by both Health Verification and Backup/Restore Integrity Verification.
 */
export function collectReferencedVaultAttachments(db: Database.Database): VaultAttachmentRef[] {
  const refs: VaultAttachmentRef[] = [];

  const pushRows = (sql: string, sourceTable: string) => {
    try {
      const rows = db.prepare<[], { id: number; rel_path: string | null }>(sql).all();
      for (const r of rows) {
        if (r.rel_path && r.rel_path.trim()) {
          refs.push({ sourceTable, recordId: Number(r.id), relativePath: r.rel_path.trim() });
        }
      }
    } catch {
      // Optional table/column may not exist in older backup snapshots
    }
  };

  pushRows('SELECT id, encrypted_file_path AS rel_path FROM customer_documents', 'customer_documents');
  pushRows('SELECT id, file_path AS rel_path FROM generated_documents', 'generated_documents');
  pushRows('SELECT id, file_path AS rel_path FROM inspection_photos', 'inspection_photos');
  pushRows('SELECT id, invoice_file_path AS rel_path FROM maintenance_records WHERE invoice_file_path IS NOT NULL', 'maintenance_records');
  pushRows('SELECT id, receipt_file_path AS rel_path FROM expenses WHERE receipt_file_path IS NOT NULL', 'expenses');
  pushRows('SELECT id, supporting_doc_path AS rel_path FROM deposits WHERE supporting_doc_path IS NOT NULL', 'deposits');
  pushRows('SELECT id, file_path AS rel_path FROM vehicle_documents WHERE file_path IS NOT NULL', 'vehicle_documents');

  try {
    const logoRow = db
      .prepare<[], { setting_value: string }>(
        "SELECT setting_value FROM application_settings WHERE setting_key = 'agency.logo_vault_path'"
      )
      .get();
    if (logoRow?.setting_value && logoRow.setting_value.trim()) {
      refs.push({
        sourceTable: 'application_settings',
        recordId: 0,
        relativePath: logoRow.setting_value.trim(),
      });
    }
  } catch {
    // ignore
  }

  return refs;
}

/**
 * Runs a strictly read-only, non-destructive diagnostic suite on SQLite, schema migrations,
 * vault attachments, financial consistency invariants, and available disk space.
 */
export function checkDatabaseHealth(
  db: Database.Database,
  options: {
    dbPath: string;
    migrationsDir?: string;
    vaultRootDir: string;
    vaultProtectionMode?: 'dpapi_safestorage' | 'local_file_0600';
    deepIntegrity?: boolean;
  }
): DatabaseHealthReport {
  const checks: HealthCheckItem[] = [];
  const checkedAt = new Date().toISOString();

  const dbSizeBytes = fs.existsSync(options.dbPath) ? fs.statSync(options.dbPath).size : 0;
  const walPath = `${options.dbPath}-wal`;
  const walSizeBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

  const journalMode = String(db.pragma('journal_mode', { simple: true }) ?? 'unknown');
  const syncNum = Number(db.pragma('synchronous', { simple: true }) ?? 0);
  const synchronousMode = syncNum === 2 ? 'FULL' : syncNum === 1 ? 'NORMAL' : syncNum === 3 ? 'EXTRA' : String(syncNum);
  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;

  checks.push({
    key: 'sqlite_pragmas',
    status: foreignKeysEnabled && journalMode.toLowerCase() === 'wal' ? 'OK' : 'WARNING',
    messageFr: `Mode ${journalMode.toUpperCase()} / Synchronous ${synchronousMode} / Clés étrangères ${foreignKeysEnabled ? 'actives' : 'inactives'}`,
    messageAr: `الوضع ${journalMode.toUpperCase()} / التزامن ${synchronousMode} / المفاتيح الأجنبية ${foreignKeysEnabled ? 'مفعلة' : 'معطلة'}`,
  });

  // 1. SQLite integrity_check / quick_check
  const pragmaName = options.deepIntegrity !== false ? 'integrity_check' : 'quick_check';
  const integrityRows = db.pragma(pragmaName) as Array<Record<string, string>>;
  const integrityValues = integrityRows.map((r) => String(Object.values(r)[0] ?? ''));
  const integrityCheckOk = integrityValues.length === 1 && integrityValues[0].toLowerCase() === 'ok';
  checks.push({
    key: 'sqlite_integrity',
    status: integrityCheckOk ? 'OK' : 'ERROR',
    messageFr: integrityCheckOk
      ? 'Intégrité structurelle SQLite vérifiée (OK)'
      : 'Anomalie détectée lors du contrôle d’intégrité SQLite',
    messageAr: integrityCheckOk
      ? 'سلامة بنية قاعدة البيانات SQLite مؤكدة (OK)'
      : 'تم اكتشاف خلل أثناء فحص سلامة قاعدة البيانات SQLite',
    details: integrityCheckOk ? null : integrityValues.slice(0, 5).join('; '),
  });

  // 2. Foreign key check
  const fkViolations = db.pragma('foreign_key_check') as Array<unknown>;
  const foreignKeyViolationsCount = fkViolations.length;
  checks.push({
    key: 'foreign_keys',
    status: foreignKeyViolationsCount === 0 ? 'OK' : 'ERROR',
    messageFr:
      foreignKeyViolationsCount === 0
        ? 'Cohérence référentielle (0 violation de clé étrangère)'
        : `${foreignKeyViolationsCount} violation(s) de clé étrangère détectée(s)`,
    messageAr:
      foreignKeyViolationsCount === 0
        ? 'التناسق المرجعي سليم (0 مخالفة للمفاتيح الأجنبية)'
        : `تم رصد ${foreignKeyViolationsCount} مخالفة للمفاتيح الأجنبية`,
  });

  // 3. Required core tables
  const existingTables = new Set(
    db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
  );
  const missingTables = REQUIRED_CORE_TABLES.filter((t) => !existingTables.has(t));
  checks.push({
    key: 'core_tables',
    status: missingTables.length === 0 ? 'OK' : 'ERROR',
    messageFr:
      missingTables.length === 0
        ? `Toutes les ${REQUIRED_CORE_TABLES.length} tables principales sont présentes`
        : `Tables manquantes: ${missingTables.join(', ')}`,
    messageAr:
      missingTables.length === 0
        ? `جميع الجداول الأساسية (${REQUIRED_CORE_TABLES.length}) متوفرة`
        : `جداول مفقودة: ${missingTables.join(', ')}`,
  });

  // 4. Schema version & migration checksum verification
  const latestMig = db
    .prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
    .get();
  const schemaVersion = latestMig?.version ?? '000';

  let migrationChecksumsOk = true;
  let migrationDetail: string | null = null;
  if (options.migrationsDir && fs.existsSync(options.migrationsDir)) {
    const dbMigs = new Map(
      db
        .prepare<[], { version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')
        .all()
        .map((r) => [r.version, r.checksum])
    );
    for (const file of listMigrationFiles(options.migrationsDir)) {
      const version = file.split('_')[0] || file;
      const diskChecksum = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(options.migrationsDir, file), 'utf8'))
        .digest('hex');
      const recorded = dbMigs.get(version);
      if (!recorded) {
        migrationChecksumsOk = false;
        migrationDetail = `Migration non appliquée: ${file}`;
        break;
      }
      if (recorded !== diskChecksum) {
        migrationChecksumsOk = false;
        migrationDetail = `Empreinte modifiée pour ${file}`;
        break;
      }
    }
  }
  checks.push({
    key: 'migrations',
    status: migrationChecksumsOk ? 'OK' : 'WARNING',
    messageFr: migrationChecksumsOk
      ? `Schéma à jour (v${schemaVersion}, empreintes vérifiées)`
      : `Alerte migration schéma (v${schemaVersion})`,
    messageAr: migrationChecksumsOk
      ? `مخطط القاعدة محدث (الإصدار ${schemaVersion}، البصمات مطابقة)`
      : `تنبيه في ترحيل مخطط القاعدة (${schemaVersion})`,
    details: migrationDetail,
  });

  // 5. Vault accessibility & attachment check
  let vaultAccessible = false;
  let vaultFileCount = 0;
  try {
    vaultAccessible = fs.existsSync(options.vaultRootDir) && fs.statSync(options.vaultRootDir).isDirectory();
    if (vaultAccessible) {
      const walkCount = (dir: string): number => {
        let count = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.vault.key')) continue;
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) count += walkCount(p);
          else if (entry.isFile()) count += 1;
        }
        return count;
      };
      vaultFileCount = walkCount(options.vaultRootDir);
    }
  } catch {
    vaultAccessible = false;
  }

  const refs = collectReferencedVaultAttachments(db);
  let missingReferencedAttachments = 0;
  for (const ref of refs) {
    try {
      const full = resolveConfinedPath(options.vaultRootDir, ref.relativePath);
      if (!fs.existsSync(full)) {
        missingReferencedAttachments += 1;
      }
    } catch {
      missingReferencedAttachments += 1;
    }
  }

  checks.push({
    key: 'vault_storage',
    status: !vaultAccessible ? 'ERROR' : missingReferencedAttachments > 0 ? 'WARNING' : 'OK',
    messageFr: !vaultAccessible
      ? 'Dossier du coffre documentaire chiffré inaccessible'
      : missingReferencedAttachments === 0
        ? `Coffre chiffré accessible (${vaultFileCount} fichiers, toutes pièces liées présentes)`
        : `${missingReferencedAttachments} pièce(s) chiffrée(s) référencée(s) introuvable(s) dans le coffre`,
    messageAr: !vaultAccessible
      ? 'مجلد الخزنة المشفرة غير متاح'
      : missingReferencedAttachments === 0
        ? `الخزنة المشفرة سليمة (${vaultFileCount} ملفات، جميع المرفقات متوفرة)`
        : `${missingReferencedAttachments} ملف(ات) مرفقة مفقودة من الخزنة`,
  });

  // 6. Financial invariants check
  const invalidDeposits = db
    .prepare<[], { cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM deposits WHERE deducted_amount_minor + refunded_amount_minor > amount_minor'
    )
    .get();
  const financialAnomalyCount = Number(invalidDeposits?.cnt ?? 0);
  checks.push({
    key: 'financial_invariants',
    status: financialAnomalyCount === 0 ? 'OK' : 'WARNING',
    messageFr:
      financialAnomalyCount === 0
        ? 'Cohérence financière vérifiée (cautions & paiements conformes)'
        : `${financialAnomalyCount} anomalie(s) comptable(s) détectée(s) sur les cautions`,
    messageAr:
      financialAnomalyCount === 0
        ? 'التناسق المالي سليم (الكفالات والمدفوعات متطابقة)'
        : `تم رصد ${financialAnomalyCount} خلل محاسبي في الكفالات`,
  });

  // 7. Disk space check
  let freeDiskBytes: number | null = null;
  try {
    const statFs = fs.statfsSync(path.dirname(options.dbPath));
    freeDiskBytes = Number(statFs.bavail) * Number(statFs.bsize);
    const lowDisk = freeDiskBytes < 100 * 1024 * 1024;
    checks.push({
      key: 'disk_space',
      status: lowDisk ? 'WARNING' : 'OK',
      messageFr: `Espace disque disponible : ${(freeDiskBytes / (1024 * 1024)).toFixed(0)} Mo`,
      messageAr: `المساحة الحرة على القرص: ${(freeDiskBytes / (1024 * 1024)).toFixed(0)} ميغابايت`,
    });
  } catch {
    // statfsSync unavailable on some platforms
  }

  const count = (tbl: string): number => {
    try {
      const r = db.prepare<[], { cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${tbl}`).get();
      return Number(r?.cnt ?? 0);
    } catch {
      return 0;
    }
  };

  const hasError = checks.some((c) => c.status === 'ERROR');
  const hasWarn = checks.some((c) => c.status === 'WARNING');

  return {
    overallStatus: hasError ? 'CRITICAL' : hasWarn ? 'WARNING' : 'HEALTHY',
    checkedAt,
    dbPath: options.dbPath,
    dbSizeBytes,
    walSizeBytes,
    schemaVersion,
    journalMode,
    synchronousMode,
    foreignKeysEnabled,
    integrityCheckOk,
    foreignKeyViolationsCount,
    migrationChecksumsOk,
    missingTables,
    vaultAccessible,
    vaultProtectionMode: options.vaultProtectionMode ?? 'local_file_0600',
    vaultFileCount,
    missingReferencedAttachments,
    freeDiskBytes,
    recordCounts: {
      users: count('users'),
      vehicles: count('vehicles'),
      customers: count('customers'),
      contracts: count('rental_contracts'),
      payments: count('contract_payments'),
      generatedDocuments: count('generated_documents'),
      backups: count('backup_records'),
    },
    checks,
  };
}
