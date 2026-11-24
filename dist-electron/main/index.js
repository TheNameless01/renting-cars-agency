var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main/index.ts
var import_node_fs15 = __toESM(require("node:fs"), 1);
var import_node_path18 = __toESM(require("node:path"), 1);
var import_electron = require("electron");

// electron/main/appKernel.ts
var import_node_path16 = __toESM(require("node:path"), 1);

// electron/backups/backupService.ts
var import_node_crypto4 = __toESM(require("node:crypto"), 1);
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);

// electron/database/connection.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
function resolveDatabasePath(options) {
  if (options.scope === "browser_preview_temp") {
    const tempDir = import_node_path.default.join(import_node_os.default.tmpdir(), "algeria_car_rental_erp_preview");
    import_node_fs.default.mkdirSync(tempDir, { recursive: true });
    return import_node_path.default.join(tempDir, "preview_isolated.sqlite");
  }
  if (!options.productionDbPath) {
    throw new Error("productionDbPath is required for desktop_production database scope");
  }
  const resolved = import_node_path.default.resolve(options.productionDbPath);
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(resolved), { recursive: true });
  return resolved;
}
function openSqliteConnection(dbFilePath) {
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(dbFilePath), { recursive: true });
  const existed = import_node_fs.default.existsSync(dbFilePath) && import_node_fs.default.statSync(dbFilePath).size > 0;
  const db = new import_better_sqlite3.default(dbFilePath);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.pragma("wal_autocheckpoint = 1000");
    db.pragma("temp_store = MEMORY");
    db.pragma("busy_timeout = 5000");
    const fkEnabled = db.pragma("foreign_keys", { simple: true });
    if (fkEnabled !== 1) {
      throw new Error("Failed to enforce SQLite PRAGMA foreign_keys = ON");
    }
    if (existed) {
      const quick = db.pragma("quick_check(1)", { simple: true });
      if (String(quick).toLowerCase() !== "ok") {
        throw new Error(`SQLite database corruption detected on open: ${String(quick)}`);
      }
    }
    return db;
  } catch (err) {
    try {
      if (db.open) db.close();
    } catch {
    }
    throw err;
  }
}
function closeSqliteSafely(db) {
  if (!db || !db.open) return;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
  }
  db.close();
}

// electron/database/migrator.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
function listMigrationFiles(migrationsDir) {
  return import_node_fs2.default.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
}
function runMigrations(db, migrationsDir, options) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const files = listMigrationFiles(migrationsDir);
  const appliedStmt = db.prepare(
    "SELECT version, checksum FROM schema_migrations"
  );
  const existingRows = appliedStmt.all();
  const existing = new Map(existingRows.map((row) => [row.version, row.checksum]));
  const pending = [];
  const alreadyApplied = [];
  for (const file of files) {
    const version = file.split("_")[0] || file;
    const fullPath = import_node_path2.default.join(migrationsDir, file);
    const sql = import_node_fs2.default.readFileSync(fullPath, "utf8");
    const checksum = import_node_crypto.default.createHash("sha256").update(sql).digest("hex");
    const prevChecksum = existing.get(version);
    if (prevChecksum) {
      if (prevChecksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${file}: database has ${prevChecksum}, disk has ${checksum}`
        );
      }
      alreadyApplied.push(file);
    } else {
      pending.push({ file, version, sql, checksum });
    }
  }
  if (pending.length > 0 && existingRows.length > 0 && options?.onBeforeApply) {
    options.onBeforeApply(pending.map((p) => p.file));
  }
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)"
  );
  const applied = [];
  for (const item of pending) {
    const applyTx = db.transaction(() => {
      db.exec(item.sql);
      insertMigration.run(item.version, item.file, item.checksum);
    });
    applyTx();
    applied.push(item.file);
  }
  const latestRow = db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
  return {
    applied,
    alreadyApplied,
    latestVersion: latestRow?.version ?? "000"
  };
}

// electron/database/services/auditService.ts
function writeAuditLog(db, input) {
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, username_snapshot, operation, entity_type, entity_id,
      previous_value_json, new_value_json, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId,
    input.usernameSnapshot,
    input.operation,
    input.entityType,
    input.entityId != null ? String(input.entityId) : null,
    input.previousValue !== void 0 ? JSON.stringify(input.previousValue) : null,
    input.newValue !== void 0 ? JSON.stringify(input.newValue) : null,
    input.reason ?? null
  );
}
function listAuditLogs(db, options) {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const clauses = [];
  const params = [];
  if (options?.entityType) {
    clauses.push("entity_type = ?");
    params.push(options.entityType);
  }
  if (options?.operation) {
    clauses.push("operation = ?");
    params.push(options.operation);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const rows = db.prepare(
    `SELECT id, user_id, username_snapshot, operation, entity_type, entity_id,
              previous_value_json, new_value_json, reason, created_at
       FROM audit_logs
       ${where}
       ORDER BY id DESC
       LIMIT ?`
  ).all(...params);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    usernameSnapshot: r.username_snapshot,
    operation: r.operation,
    entityType: r.entity_type,
    entityId: r.entity_id,
    previousValueJson: r.previous_value_json,
    newValueJson: r.new_value_json,
    reason: r.reason,
    createdAt: r.created_at
  }));
}

// electron/database/services/healthService.ts
var import_node_crypto3 = __toESM(require("node:crypto"), 1);
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);

// electron/security/crypto.ts
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var SCRYPT_KEYLEN = 64;
var SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
function hashPassword(plainPassword) {
  const salt = import_node_crypto2.default.randomBytes(16).toString("hex");
  const derived = import_node_crypto2.default.scryptSync(plainPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(plainPassword, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, expectedHex] = parts;
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const derivedBuf = import_node_crypto2.default.scryptSync(plainPassword, salt, expectedBuf.length, SCRYPT_PARAMS);
  return expectedBuf.length === derivedBuf.length && import_node_crypto2.default.timingSafeEqual(expectedBuf, derivedBuf);
}
function generateSessionToken() {
  return import_node_crypto2.default.randomBytes(32).toString("hex");
}
function resolveConfinedPath(baseDir, relativeOrTargetPath) {
  const normalizedBase = import_node_path3.default.resolve(baseDir);
  const resolved = import_node_path3.default.resolve(normalizedBase, relativeOrTargetPath);
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + import_node_path3.default.sep)) {
    throw new Error("SECURITY_PATH_TRAVERSAL_BLOCKED");
  }
  return resolved;
}
function encryptBuffer(plainBytes, key) {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes for AES-256-GCM");
  }
  const iv = import_node_crypto2.default.randomBytes(12);
  const cipher = import_node_crypto2.default.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}
function decryptBuffer(encryptedPayload, key) {
  if (key.length !== 32) {
    throw new Error("Decryption key must be 32 bytes for AES-256-GCM");
  }
  if (encryptedPayload.length < 28) {
    throw new Error("Corrupted encrypted payload");
  }
  const iv = encryptedPayload.subarray(0, 12);
  const authTag = encryptedPayload.subarray(12, 28);
  const ciphertext = encryptedPayload.subarray(28);
  const decipher = import_node_crypto2.default.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function getVaultKeyFingerprint(key) {
  return import_node_crypto2.default.createHash("sha256").update(key).digest("hex").slice(0, 16).toUpperCase();
}
function formatVaultRecoveryKey(key) {
  if (key.length !== 32) {
    throw new Error("Vault key must be 32 bytes");
  }
  const hex = key.toString("hex").toUpperCase();
  const groups = hex.match(/.{1,8}/g) ?? [];
  return `AGL-RK1-${groups.join("-")}`;
}
function parseVaultRecoveryKey(recoveryCode) {
  const cleaned = String(recoveryCode || "").trim().toUpperCase().replace(/^AGL-RK1-/, "").replace(/[^0-9A-F]/g, "");
  if (cleaned.length !== 64) {
    throw new Error("Cl\xE9 de r\xE9cup\xE9ration invalide (64 caract\xE8res hexad\xE9cimaux attendus)");
  }
  return Buffer.from(cleaned, "hex");
}
function deriveBackupKeyFromPassphrase(passphrase, salt) {
  return import_node_crypto2.default.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
}
function loadOrCreateVaultKey(vaultRootDir, safeStorage2) {
  import_node_fs3.default.mkdirSync(vaultRootDir, { recursive: true });
  const dpapiFile = resolveConfinedPath(vaultRootDir, ".vault.key.dpapi");
  const legacyFile = resolveConfinedPath(vaultRootDir, ".vault.key");
  const canUseDpapi = Boolean(safeStorage2 && safeStorage2.isEncryptionAvailable());
  if (import_node_fs3.default.existsSync(dpapiFile)) {
    if (!canUseDpapi || !safeStorage2) {
      throw new Error(
        "Le coffre utilise une cl\xE9 prot\xE9g\xE9e par Windows DPAPI (safeStorage), inaccessible dans ce contexte."
      );
    }
    const encryptedBlob = import_node_fs3.default.readFileSync(dpapiFile);
    const hex = safeStorage2.decryptString(encryptedBlob).trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === 32) {
      return { key: buf, protectionMode: "dpapi_safestorage" };
    }
    throw new Error("Cl\xE9 de coffre DPAPI corrompue");
  }
  if (import_node_fs3.default.existsSync(legacyFile)) {
    const hex = import_node_fs3.default.readFileSync(legacyFile, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === 32) {
      if (canUseDpapi && safeStorage2) {
        try {
          const wrapped = safeStorage2.encryptString(buf.toString("hex"));
          import_node_fs3.default.writeFileSync(dpapiFile, wrapped, { mode: 384 });
          const check = Buffer.from(safeStorage2.decryptString(import_node_fs3.default.readFileSync(dpapiFile)).trim(), "hex");
          if (check.length === 32 && import_node_crypto2.default.timingSafeEqual(check, buf)) {
            import_node_fs3.default.unlinkSync(legacyFile);
            return { key: buf, protectionMode: "dpapi_safestorage" };
          }
        } catch {
        }
      }
      return { key: buf, protectionMode: "local_file_0600" };
    }
  }
  const newKey = import_node_crypto2.default.randomBytes(32);
  if (canUseDpapi && safeStorage2) {
    try {
      const wrapped = safeStorage2.encryptString(newKey.toString("hex"));
      import_node_fs3.default.writeFileSync(dpapiFile, wrapped, { mode: 384 });
      return { key: newKey, protectionMode: "dpapi_safestorage" };
    } catch {
    }
  }
  import_node_fs3.default.writeFileSync(legacyFile, newKey.toString("hex"), { mode: 384 });
  return { key: newKey, protectionMode: "local_file_0600" };
}

// electron/database/services/healthService.ts
var REQUIRED_CORE_TABLES = [
  "schema_migrations",
  "roles",
  "permissions",
  "users",
  "vehicles",
  "vehicle_documents",
  "customers",
  "customer_documents",
  "reservations",
  "rental_contracts",
  "contract_payments",
  "deposits",
  "deposit_movements",
  "cash_register_sessions",
  "expenses",
  "vehicle_inspections",
  "maintenance_records",
  "inventory_parts",
  "generated_documents",
  "notifications",
  "audit_logs",
  "application_settings",
  "backup_records"
];
function collectReferencedVaultAttachments(db) {
  const refs = [];
  const pushRows = (sql, sourceTable) => {
    try {
      const rows = db.prepare(sql).all();
      for (const r of rows) {
        if (r.rel_path && r.rel_path.trim()) {
          refs.push({ sourceTable, recordId: Number(r.id), relativePath: r.rel_path.trim() });
        }
      }
    } catch {
    }
  };
  pushRows("SELECT id, encrypted_file_path AS rel_path FROM customer_documents", "customer_documents");
  pushRows("SELECT id, file_path AS rel_path FROM generated_documents", "generated_documents");
  pushRows("SELECT id, file_path AS rel_path FROM inspection_photos", "inspection_photos");
  pushRows("SELECT id, invoice_file_path AS rel_path FROM maintenance_records WHERE invoice_file_path IS NOT NULL", "maintenance_records");
  pushRows("SELECT id, receipt_file_path AS rel_path FROM expenses WHERE receipt_file_path IS NOT NULL", "expenses");
  pushRows("SELECT id, supporting_doc_path AS rel_path FROM deposits WHERE supporting_doc_path IS NOT NULL", "deposits");
  pushRows("SELECT id, file_path AS rel_path FROM vehicle_documents WHERE file_path IS NOT NULL", "vehicle_documents");
  try {
    const logoRow = db.prepare(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'agency.logo_vault_path'"
    ).get();
    if (logoRow?.setting_value && logoRow.setting_value.trim()) {
      refs.push({
        sourceTable: "application_settings",
        recordId: 0,
        relativePath: logoRow.setting_value.trim()
      });
    }
  } catch {
  }
  return refs;
}
function checkDatabaseHealth(db, options) {
  const checks = [];
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  const dbSizeBytes = import_node_fs4.default.existsSync(options.dbPath) ? import_node_fs4.default.statSync(options.dbPath).size : 0;
  const walPath = `${options.dbPath}-wal`;
  const walSizeBytes = import_node_fs4.default.existsSync(walPath) ? import_node_fs4.default.statSync(walPath).size : 0;
  const journalMode = String(db.pragma("journal_mode", { simple: true }) ?? "unknown");
  const syncNum = Number(db.pragma("synchronous", { simple: true }) ?? 0);
  const synchronousMode = syncNum === 2 ? "FULL" : syncNum === 1 ? "NORMAL" : syncNum === 3 ? "EXTRA" : String(syncNum);
  const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true })) === 1;
  checks.push({
    key: "sqlite_pragmas",
    status: foreignKeysEnabled && journalMode.toLowerCase() === "wal" ? "OK" : "WARNING",
    messageFr: `Mode ${journalMode.toUpperCase()} / Synchronous ${synchronousMode} / Cl\xE9s \xE9trang\xE8res ${foreignKeysEnabled ? "actives" : "inactives"}`,
    messageAr: `\u0627\u0644\u0648\u0636\u0639 ${journalMode.toUpperCase()} / \u0627\u0644\u062A\u0632\u0627\u0645\u0646 ${synchronousMode} / \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0623\u062C\u0646\u0628\u064A\u0629 ${foreignKeysEnabled ? "\u0645\u0641\u0639\u0644\u0629" : "\u0645\u0639\u0637\u0644\u0629"}`
  });
  const pragmaName = options.deepIntegrity !== false ? "integrity_check" : "quick_check";
  const integrityRows = db.pragma(pragmaName);
  const integrityValues = integrityRows.map((r) => String(Object.values(r)[0] ?? ""));
  const integrityCheckOk = integrityValues.length === 1 && integrityValues[0].toLowerCase() === "ok";
  checks.push({
    key: "sqlite_integrity",
    status: integrityCheckOk ? "OK" : "ERROR",
    messageFr: integrityCheckOk ? "Int\xE9grit\xE9 structurelle SQLite v\xE9rifi\xE9e (OK)" : "Anomalie d\xE9tect\xE9e lors du contr\xF4le d\u2019int\xE9grit\xE9 SQLite",
    messageAr: integrityCheckOk ? "\u0633\u0644\u0627\u0645\u0629 \u0628\u0646\u064A\u0629 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A SQLite \u0645\u0624\u0643\u062F\u0629 (OK)" : "\u062A\u0645 \u0627\u0643\u062A\u0634\u0627\u0641 \u062E\u0644\u0644 \u0623\u062B\u0646\u0627\u0621 \u0641\u062D\u0635 \u0633\u0644\u0627\u0645\u0629 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A SQLite",
    details: integrityCheckOk ? null : integrityValues.slice(0, 5).join("; ")
  });
  const fkViolations = db.pragma("foreign_key_check");
  const foreignKeyViolationsCount = fkViolations.length;
  checks.push({
    key: "foreign_keys",
    status: foreignKeyViolationsCount === 0 ? "OK" : "ERROR",
    messageFr: foreignKeyViolationsCount === 0 ? "Coh\xE9rence r\xE9f\xE9rentielle (0 violation de cl\xE9 \xE9trang\xE8re)" : `${foreignKeyViolationsCount} violation(s) de cl\xE9 \xE9trang\xE8re d\xE9tect\xE9e(s)`,
    messageAr: foreignKeyViolationsCount === 0 ? "\u0627\u0644\u062A\u0646\u0627\u0633\u0642 \u0627\u0644\u0645\u0631\u062C\u0639\u064A \u0633\u0644\u064A\u0645 (0 \u0645\u062E\u0627\u0644\u0641\u0629 \u0644\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0623\u062C\u0646\u0628\u064A\u0629)" : `\u062A\u0645 \u0631\u0635\u062F ${foreignKeyViolationsCount} \u0645\u062E\u0627\u0644\u0641\u0629 \u0644\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0623\u062C\u0646\u0628\u064A\u0629`
  });
  const existingTables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );
  const missingTables = REQUIRED_CORE_TABLES.filter((t) => !existingTables.has(t));
  checks.push({
    key: "core_tables",
    status: missingTables.length === 0 ? "OK" : "ERROR",
    messageFr: missingTables.length === 0 ? `Toutes les ${REQUIRED_CORE_TABLES.length} tables principales sont pr\xE9sentes` : `Tables manquantes: ${missingTables.join(", ")}`,
    messageAr: missingTables.length === 0 ? `\u062C\u0645\u064A\u0639 \u0627\u0644\u062C\u062F\u0627\u0648\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 (${REQUIRED_CORE_TABLES.length}) \u0645\u062A\u0648\u0641\u0631\u0629` : `\u062C\u062F\u0627\u0648\u0644 \u0645\u0641\u0642\u0648\u062F\u0629: ${missingTables.join(", ")}`
  });
  const latestMig = db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
  const schemaVersion = latestMig?.version ?? "000";
  let migrationChecksumsOk = true;
  let migrationDetail = null;
  if (options.migrationsDir && import_node_fs4.default.existsSync(options.migrationsDir)) {
    const dbMigs = new Map(
      db.prepare("SELECT version, checksum FROM schema_migrations").all().map((r) => [r.version, r.checksum])
    );
    for (const file of listMigrationFiles(options.migrationsDir)) {
      const version = file.split("_")[0] || file;
      const diskChecksum = import_node_crypto3.default.createHash("sha256").update(import_node_fs4.default.readFileSync(import_node_path4.default.join(options.migrationsDir, file), "utf8")).digest("hex");
      const recorded = dbMigs.get(version);
      if (!recorded) {
        migrationChecksumsOk = false;
        migrationDetail = `Migration non appliqu\xE9e: ${file}`;
        break;
      }
      if (recorded !== diskChecksum) {
        migrationChecksumsOk = false;
        migrationDetail = `Empreinte modifi\xE9e pour ${file}`;
        break;
      }
    }
  }
  checks.push({
    key: "migrations",
    status: migrationChecksumsOk ? "OK" : "WARNING",
    messageFr: migrationChecksumsOk ? `Sch\xE9ma \xE0 jour (v${schemaVersion}, empreintes v\xE9rifi\xE9es)` : `Alerte migration sch\xE9ma (v${schemaVersion})`,
    messageAr: migrationChecksumsOk ? `\u0645\u062E\u0637\u0637 \u0627\u0644\u0642\u0627\u0639\u062F\u0629 \u0645\u062D\u062F\u062B (\u0627\u0644\u0625\u0635\u062F\u0627\u0631 ${schemaVersion}\u060C \u0627\u0644\u0628\u0635\u0645\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629)` : `\u062A\u0646\u0628\u064A\u0647 \u0641\u064A \u062A\u0631\u062D\u064A\u0644 \u0645\u062E\u0637\u0637 \u0627\u0644\u0642\u0627\u0639\u062F\u0629 (${schemaVersion})`,
    details: migrationDetail
  });
  let vaultAccessible = false;
  let vaultFileCount = 0;
  try {
    vaultAccessible = import_node_fs4.default.existsSync(options.vaultRootDir) && import_node_fs4.default.statSync(options.vaultRootDir).isDirectory();
    if (vaultAccessible) {
      const walkCount = (dir) => {
        let count2 = 0;
        for (const entry of import_node_fs4.default.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".vault.key")) continue;
          const p = import_node_path4.default.join(dir, entry.name);
          if (entry.isDirectory()) count2 += walkCount(p);
          else if (entry.isFile()) count2 += 1;
        }
        return count2;
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
      if (!import_node_fs4.default.existsSync(full)) {
        missingReferencedAttachments += 1;
      }
    } catch {
      missingReferencedAttachments += 1;
    }
  }
  checks.push({
    key: "vault_storage",
    status: !vaultAccessible ? "ERROR" : missingReferencedAttachments > 0 ? "WARNING" : "OK",
    messageFr: !vaultAccessible ? "Dossier du coffre documentaire chiffr\xE9 inaccessible" : missingReferencedAttachments === 0 ? `Coffre chiffr\xE9 accessible (${vaultFileCount} fichiers, toutes pi\xE8ces li\xE9es pr\xE9sentes)` : `${missingReferencedAttachments} pi\xE8ce(s) chiffr\xE9e(s) r\xE9f\xE9renc\xE9e(s) introuvable(s) dans le coffre`,
    messageAr: !vaultAccessible ? "\u0645\u062C\u0644\u062F \u0627\u0644\u062E\u0632\u0646\u0629 \u0627\u0644\u0645\u0634\u0641\u0631\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D" : missingReferencedAttachments === 0 ? `\u0627\u0644\u062E\u0632\u0646\u0629 \u0627\u0644\u0645\u0634\u0641\u0631\u0629 \u0633\u0644\u064A\u0645\u0629 (${vaultFileCount} \u0645\u0644\u0641\u0627\u062A\u060C \u062C\u0645\u064A\u0639 \u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062A \u0645\u062A\u0648\u0641\u0631\u0629)` : `${missingReferencedAttachments} \u0645\u0644\u0641(\u0627\u062A) \u0645\u0631\u0641\u0642\u0629 \u0645\u0641\u0642\u0648\u062F\u0629 \u0645\u0646 \u0627\u0644\u062E\u0632\u0646\u0629`
  });
  const invalidDeposits = db.prepare(
    "SELECT COUNT(*) AS cnt FROM deposits WHERE deducted_amount_minor + refunded_amount_minor > amount_minor"
  ).get();
  const financialAnomalyCount = Number(invalidDeposits?.cnt ?? 0);
  checks.push({
    key: "financial_invariants",
    status: financialAnomalyCount === 0 ? "OK" : "WARNING",
    messageFr: financialAnomalyCount === 0 ? "Coh\xE9rence financi\xE8re v\xE9rifi\xE9e (cautions & paiements conformes)" : `${financialAnomalyCount} anomalie(s) comptable(s) d\xE9tect\xE9e(s) sur les cautions`,
    messageAr: financialAnomalyCount === 0 ? "\u0627\u0644\u062A\u0646\u0627\u0633\u0642 \u0627\u0644\u0645\u0627\u0644\u064A \u0633\u0644\u064A\u0645 (\u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A \u0648\u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0627\u062A \u0645\u062A\u0637\u0627\u0628\u0642\u0629)" : `\u062A\u0645 \u0631\u0635\u062F ${financialAnomalyCount} \u062E\u0644\u0644 \u0645\u062D\u0627\u0633\u0628\u064A \u0641\u064A \u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A`
  });
  let freeDiskBytes = null;
  try {
    const statFs = import_node_fs4.default.statfsSync(import_node_path4.default.dirname(options.dbPath));
    freeDiskBytes = Number(statFs.bavail) * Number(statFs.bsize);
    const lowDisk = freeDiskBytes < 100 * 1024 * 1024;
    checks.push({
      key: "disk_space",
      status: lowDisk ? "WARNING" : "OK",
      messageFr: `Espace disque disponible : ${(freeDiskBytes / (1024 * 1024)).toFixed(0)} Mo`,
      messageAr: `\u0627\u0644\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u062D\u0631\u0629 \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635: ${(freeDiskBytes / (1024 * 1024)).toFixed(0)} \u0645\u064A\u063A\u0627\u0628\u0627\u064A\u062A`
    });
  } catch {
  }
  const count = (tbl) => {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS cnt FROM ${tbl}`).get();
      return Number(r?.cnt ?? 0);
    } catch {
      return 0;
    }
  };
  const hasError = checks.some((c) => c.status === "ERROR");
  const hasWarn = checks.some((c) => c.status === "WARNING");
  return {
    overallStatus: hasError ? "CRITICAL" : hasWarn ? "WARNING" : "HEALTHY",
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
    vaultProtectionMode: options.vaultProtectionMode ?? "local_file_0600",
    vaultFileCount,
    missingReferencedAttachments,
    freeDiskBytes,
    recordCounts: {
      users: count("users"),
      vehicles: count("vehicles"),
      customers: count("customers"),
      contracts: count("rental_contracts"),
      payments: count("contract_payments"),
      generatedDocuments: count("generated_documents"),
      backups: count("backup_records")
    },
    checks
  };
}

// electron/security/rbac.ts
var AuthError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.httpStatus = code === "UNAUTHORIZED" ? 401 : code === "LOCKED" ? 423 : code === "FORBIDDEN" ? 403 : code === "CONFLICT" ? 409 : code === "NOT_FOUND" ? 404 : 400;
  }
};
function getConfiguredAutoLockMinutes(db) {
  try {
    const row = db.prepare(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'app.auto_lock_minutes'"
    ).get();
    if (!row) return 15;
    const parsed = Number(row.setting_value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15;
  } catch {
    return 15;
  }
}
function resolveEffectivePermissions(db, userId, roleId) {
  const rolePerms = db.prepare(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
  ).all(roleId);
  const effective = new Set(rolePerms.map((r) => r.code));
  const overrides = db.prepare(
    `SELECT p.code, up.granted
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ?`
  ).all(userId);
  for (const ov of overrides) {
    if (ov.granted === 1) {
      effective.add(ov.code);
    } else {
      effective.delete(ov.code);
    }
  }
  return Array.from(effective).sort();
}
function requireAuthenticatedSession(db, sessionStore, token, allowLocked = false) {
  const session2 = sessionStore.get(token);
  if (!session2) {
    throw new AuthError("UNAUTHORIZED", "Session invalide ou expir\xE9e");
  }
  const userRow = db.prepare("SELECT is_active FROM users WHERE id = ?").get(session2.userId);
  if (!userRow || userRow.is_active !== 1) {
    sessionStore.revoke(session2.token);
    throw new AuthError("UNAUTHORIZED", "Compte utilisateur d\xE9sactiv\xE9");
  }
  if (!allowLocked) {
    const idleMinutes = getConfiguredAutoLockMinutes(db);
    const idleCheck = sessionStore.checkIdleAndAutoLock(session2.token, idleMinutes);
    if (idleCheck.lockedNow) {
      try {
        writeAuditLog(db, {
          userId: session2.userId,
          usernameSnapshot: session2.username,
          operation: "SESSION_AUTO_LOCKED",
          entityType: "users",
          entityId: session2.userId,
          newValue: { idleMinutes }
        });
      } catch {
      }
      throw new AuthError("LOCKED", "Session verrouill\xE9e automatiquement suite \xE0 une inactivit\xE9 prolong\xE9e");
    }
    if (session2.isLocked) {
      throw new AuthError("LOCKED", "Session verrouill\xE9e \u2014 d\xE9verrouillage requis");
    }
    sessionStore.touch(session2.token);
  }
  return session2;
}
function requirePermission(db, session2, requiredPermission) {
  const row = db.prepare(
    `SELECT u.role_id, r.code AS role_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.is_active = 1`
  ).get(session2.userId);
  if (!row) {
    throw new AuthError("UNAUTHORIZED", "Utilisateur introuvable ou inactif");
  }
  const livePermissions = resolveEffectivePermissions(db, session2.userId, row.role_id);
  if (!livePermissions.includes(requiredPermission)) {
    throw new AuthError("FORBIDDEN", `Permission requise: ${requiredPermission}`);
  }
}

// electron/backups/backupService.ts
var ARCHIVE_MAGIC = Buffer.from("AGLBKP1\0", "ascii");
var PACK_MAGIC = Buffer.from("PACK", "ascii");
var BACKUP_FORMAT_NAME = "AGENCY_BACKUP_V1";
function mapBackupRow(row) {
  return {
    id: row.id,
    backupType: row.backup_type,
    destinationPath: row.destination_path,
    fileName: row.file_name || import_node_path5.default.basename(row.destination_path),
    fileSizeBytes: row.file_size_bytes,
    checksumSha256: row.checksum_sha256,
    status: row.status,
    errorMessage: row.error_message,
    appVersion: row.app_version ?? "1.0.0",
    schemaVersion: row.schema_version ?? "009",
    includesVault: row.includes_vault === 1,
    attachmentCount: row.attachment_count ?? 0,
    backupFormat: row.backup_format ?? BACKUP_FORMAT_NAME,
    isEncrypted: row.is_encrypted === 1,
    encryptionMode: row.encryption_mode ?? "VAULT_RECOVERY_KEY",
    recoveryKeyFingerprint: row.recovery_key_fingerprint,
    verifiedAt: row.verified_at,
    verificationStatus: row.verification_status ?? "PENDING",
    verificationSummaryJson: row.verification_summary_json,
    triggeredByUserId: row.triggered_by_user_id,
    triggeredByUsername: row.triggered_by_username,
    notes: row.notes,
    createdAt: row.created_at
  };
}
function sha256Hex(buf) {
  return import_node_crypto4.default.createHash("sha256").update(buf).digest("hex");
}
function getSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
    return row?.version ?? "000";
  } catch {
    return "000";
  }
}
function formatBackupTimestamp(date = /* @__PURE__ */ new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
function walkVaultFiles(vaultRootDir) {
  if (!import_node_fs5.default.existsSync(vaultRootDir)) return [];
  const results = [];
  const walk = (dir) => {
    for (const entry of import_node_fs5.default.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".vault.key")) continue;
      if (entry.name.endsWith(".tmp")) continue;
      const fullPath = import_node_path5.default.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = import_node_path5.default.relative(vaultRootDir, fullPath).split(import_node_path5.default.sep).join("/");
        results.push(rel);
      }
    }
  };
  walk(vaultRootDir);
  return results.sort();
}
function checkAvailableDiskSpace(targetDir, requiredBytesEstimate) {
  try {
    import_node_fs5.default.mkdirSync(targetDir, { recursive: true });
    const statFs = import_node_fs5.default.statfsSync(targetDir);
    const freeBytes = Number(statFs.bavail) * Number(statFs.bsize);
    const safetyMin = Math.max(requiredBytesEstimate * 2, 20 * 1024 * 1024);
    if (freeBytes < safetyMin) {
      throw new AuthError(
        "VALIDATION_ERROR",
        `Espace disque insuffisant (${Math.round(freeBytes / (1024 * 1024))} Mo disponibles)`
      );
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }
}
function packBackupPayload(dbBytes, manifest, attachmentPayloads) {
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  const chunks = [PACK_MAGIC];
  const writeChunk = (buf) => {
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
    writeChunk(Buffer.from(item.relativePath, "utf8"));
    writeChunk(item.plainBytes);
  }
  return Buffer.concat(chunks);
}
function unpackBackupPayload(packBuf) {
  if (packBuf.length < 16 || !packBuf.subarray(0, 4).equals(PACK_MAGIC)) {
    throw new AuthError("VALIDATION_ERROR", "Contenu de sauvegarde corrompu ou format interne invalide");
  }
  let offset = 4;
  const readChunk = () => {
    if (offset + 4 > packBuf.length) {
      throw new AuthError("VALIDATION_ERROR", "Archive de sauvegarde tronqu\xE9e");
    }
    const len = packBuf.readUInt32BE(offset);
    offset += 4;
    if (offset + len > packBuf.length) {
      throw new AuthError("VALIDATION_ERROR", "Bloc de sauvegarde corrompu ou tronqu\xE9");
    }
    const slice = packBuf.subarray(offset, offset + len);
    offset += len;
    return slice;
  };
  const dbBytes = readChunk();
  const manifestBuf = readChunk();
  const manifest = JSON.parse(manifestBuf.toString("utf8"));
  if (offset + 4 > packBuf.length) {
    throw new AuthError("VALIDATION_ERROR", "Compteur de pi\xE8ces jointes manquant dans la sauvegarde");
  }
  const attCount = packBuf.readUInt32BE(offset);
  offset += 4;
  const attachments = [];
  for (let i = 0; i < attCount; i++) {
    const relativePath = readChunk().toString("utf8");
    const plainBytes = readChunk();
    attachments.push({ relativePath, plainBytes });
  }
  return { dbBytes, manifest, attachments };
}
function encodeArchive(header, encryptedPayload) {
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([ARCHIVE_MAGIC, lenBuf, headerBuf, encryptedPayload]);
}
function decodeArchiveEnvelope(archiveBytes) {
  if (archiveBytes.length < 16 || !archiveBytes.subarray(0, 8).equals(ARCHIVE_MAGIC)) {
    throw new AuthError(
      "VALIDATION_ERROR",
      "Fichier de sauvegarde invalide (signature .agbkp absente ou corrompue)"
    );
  }
  const headerLen = archiveBytes.readUInt32BE(8);
  const headerStart = 12;
  const headerEnd = headerStart + headerLen;
  if (headerLen <= 0 || headerEnd > archiveBytes.length) {
    throw new AuthError("VALIDATION_ERROR", "En-t\xEAte de sauvegarde corrompu");
  }
  const header = JSON.parse(archiveBytes.subarray(headerStart, headerEnd).toString("utf8"));
  const encryptedPayload = archiveBytes.subarray(headerEnd);
  return { header, encryptedPayload };
}
function resolveDecryptionKeyForHeader(header, secrets) {
  if (header.encryptionMode === "PASSPHRASE") {
    if (!secrets.passphrase || !secrets.passphrase.trim()) {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Cette sauvegarde est prot\xE9g\xE9e par phrase secr\xE8te. Veuillez saisir la phrase secr\xE8te."
      );
    }
    const salt = Buffer.from(header.saltHex, "hex");
    return deriveBackupKeyFromPassphrase(secrets.passphrase, salt);
  }
  if (secrets.recoveryKey && secrets.recoveryKey.trim()) {
    return parseVaultRecoveryKey(secrets.recoveryKey);
  }
  if (secrets.vaultKey && secrets.vaultKey.length === 32) {
    return secrets.vaultKey;
  }
  throw new AuthError(
    "VALIDATION_ERROR",
    "Cl\xE9 de r\xE9cup\xE9ration du coffre requise pour d\xE9chiffrer cette sauvegarde"
  );
}
function createPreMigrationSnapshot(db, options) {
  const snapshotDir = import_node_path5.default.join(
    options.backupDir,
    "pre_migration",
    `PRE_MIGRATION_${formatBackupTimestamp()}`
  );
  import_node_fs5.default.mkdirSync(snapshotDir, { recursive: true });
  const dbDest = import_node_path5.default.join(snapshotDir, "agency_pre_migration.sqlite");
  const escapedPath = dbDest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
  const vaultCopyDir = import_node_path5.default.join(snapshotDir, "vault");
  if (import_node_fs5.default.existsSync(options.vaultRootDir)) {
    import_node_fs5.default.cpSync(options.vaultRootDir, vaultCopyDir, {
      recursive: true,
      filter: (src) => !import_node_path5.default.basename(src).startsWith(".vault.key")
    });
  }
  import_node_fs5.default.writeFileSync(
    import_node_path5.default.join(snapshotDir, "migration_info.json"),
    JSON.stringify(
      {
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        sourceDbPath: options.dbPath,
        pendingMigrations: options.pendingFiles
      },
      null,
      2
    ),
    { mode: 384 }
  );
  return snapshotDir;
}
function listBackups(db, limit = 100) {
  const rows = db.prepare(
    `SELECT * FROM backup_records ORDER BY id DESC LIMIT ?`
  ).all(Math.min(Math.max(limit, 1), 500));
  return rows.map(mapBackupRow);
}
function getBackupRecordById(db, backupId) {
  const row = db.prepare("SELECT * FROM backup_records WHERE id = ?").get(backupId);
  if (!row) {
    throw new AuthError("NOT_FOUND", "Sauvegarde introuvable");
  }
  return mapBackupRow(row);
}
async function createBackup(db, options) {
  const backupType = options.backupType ?? "MANUAL";
  const encryptionMode = options.encryptionMode === "PASSPHRASE" ? "PASSPHRASE" : "VAULT_RECOVERY_KEY";
  if (encryptionMode === "PASSPHRASE" && (!options.passphrase || options.passphrase.length < 8)) {
    throw new AuthError(
      "VALIDATION_ERROR",
      "La phrase secr\xE8te de sauvegarde doit contenir au moins 8 caract\xE8res"
    );
  }
  const appVersion = options.appVersion ?? "1.0.0";
  const schemaVersion = getSchemaVersion(db);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const stamp = formatBackupTimestamp();
  const suffix = backupType === "AUTO" ? "AUTO" : backupType === "PRE_RESTORE" ? "PRERESTORE" : "MANUAL";
  const defaultFileName = `AGL-BACKUP-${stamp}-${suffix}.agbkp`;
  const subDir = backupType === "AUTO" ? import_node_path5.default.join(options.backupDir, "auto") : backupType === "PRE_RESTORE" ? import_node_path5.default.join(options.backupDir, "pre_restore") : import_node_path5.default.join(options.backupDir, "manual");
  const finalTargetPath = options.destinationPath ? import_node_path5.default.resolve(options.destinationPath) : import_node_path5.default.join(subDir, defaultFileName);
  const stageDir = import_node_fs5.default.mkdtempSync(import_node_path5.default.join(import_node_os2.default.tmpdir(), "agl-backup-stage-"));
  const stagedDbPath = import_node_path5.default.join(stageDir, "staged.sqlite");
  try {
    import_node_fs5.default.mkdirSync(import_node_path5.default.dirname(finalTargetPath), { recursive: true });
    checkAvailableDiskSpace(import_node_path5.default.dirname(finalTargetPath), 20 * 1024 * 1024);
    await db.backup(stagedDbPath);
    const dbBytes = import_node_fs5.default.readFileSync(stagedDbPath);
    if (dbBytes.length === 0) {
      throw new Error("La sauvegarde SQLite g\xE9n\xE9r\xE9e est vide");
    }
    const dbSha256 = sha256Hex(dbBytes);
    const stagedDb = openSqliteConnection(stagedDbPath);
    let referencedAttachments = [];
    try {
      referencedAttachments = collectReferencedVaultAttachments(stagedDb);
    } finally {
      closeSqliteSafely(stagedDb);
    }
    const vaultRelPaths = walkVaultFiles(options.vaultRootDir);
    const attachmentPayloads = [];
    const attachmentManifest = [];
    let totalAttachmentBytes = 0;
    for (const relPath of vaultRelPaths) {
      const fullPath = resolveConfinedPath(options.vaultRootDir, relPath);
      const encBytes = import_node_fs5.default.readFileSync(fullPath);
      const plainBytes = decryptBuffer(encBytes, options.vaultKey);
      totalAttachmentBytes += plainBytes.length;
      attachmentPayloads.push({ relativePath: relPath, plainBytes });
      attachmentManifest.push({
        relativePath: relPath,
        plainSha256: sha256Hex(plainBytes),
        sizeBytes: plainBytes.length
      });
    }
    if (backupType !== "PRE_RESTORE") {
      const bundledSet = new Set(attachmentManifest.map((a) => a.relativePath));
      for (const ref of referencedAttachments) {
        const normalized = ref.relativePath.replace(/\\/g, "/");
        if (!bundledSet.has(normalized)) {
          throw new Error(
            `Pi\xE8ce chiffr\xE9e manquante dans le coffre (${ref.sourceTable}#${ref.recordId}: ${normalized})`
          );
        }
      }
    }
    const manifest = {
      createdAt,
      appVersion,
      schemaVersion,
      dbSha256,
      attachments: attachmentManifest,
      referencedAttachments
    };
    const packBuffer = packBackupPayload(dbBytes, manifest, attachmentPayloads);
    const salt = import_node_crypto4.default.randomBytes(32);
    const wrappingKey = encryptionMode === "PASSPHRASE" ? deriveBackupKeyFromPassphrase(options.passphrase, salt) : options.vaultKey;
    const keyFingerprint = encryptionMode === "VAULT_RECOVERY_KEY" ? getVaultKeyFingerprint(options.vaultKey) : null;
    const encryptedPayload = encryptBuffer(packBuffer, wrappingKey);
    const header = {
      formatVersion: 1,
      backupFormat: BACKUP_FORMAT_NAME,
      backupType,
      createdAt,
      appVersion,
      schemaVersion,
      encryptionMode,
      saltHex: salt.toString("hex"),
      recoveryKeyFingerprint: keyFingerprint,
      dbSha256,
      attachmentCount: attachmentManifest.length,
      totalUnencryptedBytes: dbBytes.length + totalAttachmentBytes,
      payloadSha256: sha256Hex(packBuffer)
    };
    const archiveBytes = encodeArchive(header, encryptedPayload);
    const archiveSha256 = sha256Hex(archiveBytes);
    const tempOutPath = `${finalTargetPath}.${import_node_crypto4.default.randomUUID()}.tmp`;
    import_node_fs5.default.writeFileSync(tempOutPath, archiveBytes, { mode: 384 });
    import_node_fs5.default.renameSync(tempOutPath, finalTargetPath);
    const verification = verifyBackupArchive({
      filePath: finalTargetPath,
      passphrase: options.passphrase,
      vaultKey: options.vaultKey
    });
    if (!verification.valid) {
      throw new Error(verification.errorMessage || "\xC9chec de v\xE9rification post-sauvegarde");
    }
    const insertRes = db.prepare(
      `INSERT INTO backup_records (
          backup_type, destination_path, file_name, file_size_bytes, checksum_sha256,
          status, error_message, app_version, schema_version, includes_vault, attachment_count,
          backup_format, is_encrypted, encryption_mode, recovery_key_fingerprint,
          verified_at, verification_status, verification_summary_json,
          triggered_by_user_id, triggered_by_username, notes
        ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?, 1, ?, ?, 1, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)`
    ).run(
      backupType,
      finalTargetPath,
      import_node_path5.default.basename(finalTargetPath),
      archiveBytes.length,
      archiveSha256,
      appVersion,
      schemaVersion,
      attachmentManifest.length,
      BACKUP_FORMAT_NAME,
      encryptionMode,
      keyFingerprint,
      (/* @__PURE__ */ new Date()).toISOString(),
      JSON.stringify(verification.recordCounts),
      options.actor?.id ?? null,
      options.actor?.username ?? "system",
      options.notes ?? null
    );
    const record = getBackupRecordById(db, Number(insertRes.lastInsertRowid));
    writeAuditLog(db, {
      userId: options.actor?.id ?? null,
      usernameSnapshot: options.actor?.username ?? "system",
      operation: "BACKUP_CREATED",
      entityType: "backup_records",
      entityId: record.id,
      newValue: {
        backupType,
        fileName: record.fileName,
        fileSizeBytes: record.fileSizeBytes,
        checksumSha256: record.checksumSha256,
        encryptionMode,
        attachmentCount: record.attachmentCount
      }
    });
    return { backup: record, verification };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erreur inconnue de sauvegarde";
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
        import_node_path5.default.basename(finalTargetPath),
        errMsg,
        appVersion,
        schemaVersion,
        BACKUP_FORMAT_NAME,
        encryptionMode,
        options.actor?.id ?? null,
        options.actor?.username ?? "system",
        options.notes ?? null
      );
      writeAuditLog(db, {
        userId: options.actor?.id ?? null,
        usernameSnapshot: options.actor?.username ?? "system",
        operation: "BACKUP_FAILED",
        entityType: "backup_records",
        entityId: null,
        newValue: { backupType, error: errMsg }
      });
    } catch {
    }
    throw err;
  } finally {
    import_node_fs5.default.rmSync(stageDir, { recursive: true, force: true });
  }
}
function verifyBackupArchive(input) {
  if (!import_node_fs5.default.existsSync(input.filePath)) {
    throw new AuthError("NOT_FOUND", "Fichier de sauvegarde introuvable sur le disque");
  }
  const archiveBytes = import_node_fs5.default.readFileSync(input.filePath);
  const archiveChecksumSha256 = sha256Hex(archiveBytes);
  const { header, encryptedPayload } = decodeArchiveEnvelope(archiveBytes);
  let packBuffer;
  try {
    const key = resolveDecryptionKeyForHeader(header, {
      passphrase: input.passphrase,
      recoveryKey: input.recoveryKey,
      vaultKey: input.vaultKey
    });
    packBuffer = decryptBuffer(encryptedPayload, key);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(
      "VALIDATION_ERROR",
      "Impossible de d\xE9chiffrer la sauvegarde : cl\xE9 de r\xE9cup\xE9ration ou phrase secr\xE8te incorrecte, ou fichier alt\xE9r\xE9"
    );
  }
  if (sha256Hex(packBuffer) !== header.payloadSha256) {
    throw new AuthError("VALIDATION_ERROR", "Empreinte SHA-256 du contenu de sauvegarde invalide");
  }
  const { dbBytes, manifest, attachments } = unpackBackupPayload(packBuffer);
  if (sha256Hex(dbBytes) !== header.dbSha256 || sha256Hex(dbBytes) !== manifest.dbSha256) {
    throw new AuthError("VALIDATION_ERROR", "Empreinte SHA-256 de la base SQLite incoh\xE9rente");
  }
  const manifestMap = new Map(manifest.attachments.map((a) => [a.relativePath, a]));
  const unpackedMap = /* @__PURE__ */ new Map();
  let verifiedAttachmentCount = 0;
  for (const item of attachments) {
    resolveConfinedPath("/virtual-vault", item.relativePath);
    const meta = manifestMap.get(item.relativePath);
    if (!meta || sha256Hex(item.plainBytes) !== meta.plainSha256) {
      throw new AuthError(
        "VALIDATION_ERROR",
        `Pi\xE8ce chiffr\xE9e corrompue dans la sauvegarde : ${item.relativePath}`
      );
    }
    unpackedMap.set(item.relativePath, item.plainBytes);
    verifiedAttachmentCount += 1;
  }
  const tempVerifyDir = import_node_fs5.default.mkdtempSync(import_node_path5.default.join(import_node_os2.default.tmpdir(), "agl-verify-"));
  const tempDbPath = import_node_path5.default.join(tempVerifyDir, "verify.sqlite");
  let integrityCheckOk = false;
  let foreignKeyViolations = 0;
  let missingTables = [];
  let missingAttachmentCount = 0;
  let recordCounts = {
    users: 0,
    vehicles: 0,
    customers: 0,
    contracts: 0,
    payments: 0,
    generatedDocuments: 0
  };
  try {
    import_node_fs5.default.writeFileSync(tempDbPath, dbBytes, { mode: 384 });
    const verifyDb = openSqliteConnection(tempDbPath);
    try {
      const integRows = verifyDb.pragma("integrity_check");
      const vals = integRows.map((r) => String(Object.values(r)[0] ?? "").toLowerCase());
      integrityCheckOk = vals.length === 1 && vals[0] === "ok";
      const fkRows = verifyDb.pragma("foreign_key_check");
      foreignKeyViolations = fkRows.length;
      const tables = new Set(
        verifyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name)
      );
      const criticalTables = [
        "users",
        "vehicles",
        "customers",
        "rental_contracts",
        "contract_payments",
        "deposits",
        "audit_logs",
        "application_settings"
      ];
      missingTables = criticalTables.filter((t) => !tables.has(t));
      const refs = collectReferencedVaultAttachments(verifyDb);
      for (const ref of refs) {
        if (!unpackedMap.has(ref.relativePath.replace(/\\/g, "/"))) {
          missingAttachmentCount += 1;
        }
      }
      const safeCount = (tbl) => {
        try {
          const r = verifyDb.prepare(`SELECT COUNT(*) AS cnt FROM ${tbl}`).get();
          return Number(r?.cnt ?? 0);
        } catch {
          return 0;
        }
      };
      recordCounts = {
        users: safeCount("users"),
        vehicles: safeCount("vehicles"),
        customers: safeCount("customers"),
        contracts: safeCount("rental_contracts"),
        payments: safeCount("contract_payments"),
        generatedDocuments: safeCount("generated_documents")
      };
    } finally {
      closeSqliteSafely(verifyDb);
    }
  } finally {
    import_node_fs5.default.rmSync(tempVerifyDir, { recursive: true, force: true });
  }
  const valid = integrityCheckOk && foreignKeyViolations === 0 && missingTables.length === 0 && (header.backupType === "PRE_RESTORE" || missingAttachmentCount === 0);
  const result = {
    valid,
    filePath: input.filePath,
    fileName: import_node_path5.default.basename(input.filePath),
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
    errorMessage: valid ? null : `Anomalie d\xE9tect\xE9e (int\xE9grit\xE9=${integrityCheckOk}, FK=${foreignKeyViolations}, tables manquantes=${missingTables.length}, pi\xE8ces manquantes=${missingAttachmentCount})`
  };
  if (input.db && input.backupRecordId) {
    input.db.prepare(
      `UPDATE backup_records
         SET verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             verification_status = ?,
             verification_summary_json = ?
         WHERE id = ?`
    ).run(valid ? "VERIFIED" : "FAILED", JSON.stringify(recordCounts), input.backupRecordId);
    if (input.actor) {
      writeAuditLog(input.db, {
        userId: input.actor.id,
        usernameSnapshot: input.actor.username,
        operation: valid ? "BACKUP_VERIFIED" : "BACKUP_VERIFY_FAILED",
        entityType: "backup_records",
        entityId: input.backupRecordId,
        newValue: {
          valid,
          integrityCheckOk,
          foreignKeyViolations,
          verifiedAttachmentCount,
          missingAttachmentCount
        }
      });
    }
  }
  return result;
}
async function restoreFromBackup(context, input) {
  const liveDb = context.getDb();
  let targetFilePath = input.filePath ? import_node_path5.default.resolve(input.filePath) : "";
  let tempImportedPath = null;
  try {
    if (input.backupRecordId) {
      const rec = getBackupRecordById(liveDb, input.backupRecordId);
      targetFilePath = rec.destinationPath;
    } else if (input.base64Archive) {
      const buf = Buffer.from(input.base64Archive, "base64");
      tempImportedPath = import_node_path5.default.join(
        import_node_os2.default.tmpdir(),
        `agl-restore-upload-${import_node_crypto4.default.randomUUID()}.agbkp`
      );
      import_node_fs5.default.writeFileSync(tempImportedPath, buf, { mode: 384 });
      targetFilePath = tempImportedPath;
    }
    if (!targetFilePath || !import_node_fs5.default.existsSync(targetFilePath)) {
      throw new AuthError("NOT_FOUND", "Fichier de sauvegarde introuvable pour la restauration");
    }
    const verification = verifyBackupArchive({
      filePath: targetFilePath,
      passphrase: input.passphrase,
      recoveryKey: input.recoveryKey,
      vaultKey: context.vaultKey
    });
    if (!verification.valid) {
      throw new AuthError(
        "VALIDATION_ERROR",
        verification.errorMessage || "Sauvegarde corrompue \u2014 restauration annul\xE9e"
      );
    }
    checkAvailableDiskSpace(import_node_path5.default.dirname(context.dbPath), verification.fileSizeBytes * 3);
    const preRestore = await createBackup(liveDb, {
      backupDir: context.backupDir,
      vaultRootDir: context.vaultRootDir,
      vaultKey: context.vaultKey,
      appVersion: context.appVersion,
      backupType: "PRE_RESTORE",
      encryptionMode: "VAULT_RECOVERY_KEY",
      notes: `Instantan\xE9 automatique avant restauration de ${verification.fileName}`,
      actor: input.actor
    });
    const stageRoot = import_node_fs5.default.mkdtempSync(import_node_path5.default.join(import_node_os2.default.tmpdir(), "agl-restore-stage-"));
    const stagedDbPath = import_node_path5.default.join(stageRoot, "agency_restored.sqlite");
    const stagedVaultDir = import_node_path5.default.join(stageRoot, "vault");
    import_node_fs5.default.mkdirSync(stagedVaultDir, { recursive: true });
    try {
      const archiveBytes = import_node_fs5.default.readFileSync(targetFilePath);
      const { header, encryptedPayload } = decodeArchiveEnvelope(archiveBytes);
      const decryptKey = resolveDecryptionKeyForHeader(header, {
        passphrase: input.passphrase,
        recoveryKey: input.recoveryKey,
        vaultKey: context.vaultKey
      });
      const packBuffer = decryptBuffer(encryptedPayload, decryptKey);
      const { dbBytes, attachments } = unpackBackupPayload(packBuffer);
      import_node_fs5.default.writeFileSync(stagedDbPath, dbBytes, { mode: 384 });
      const stagedDb = openSqliteConnection(stagedDbPath);
      try {
        runMigrations(stagedDb, context.migrationsDir);
      } finally {
        closeSqliteSafely(stagedDb);
      }
      for (const att of attachments) {
        const destFile = resolveConfinedPath(stagedVaultDir, att.relativePath);
        import_node_fs5.default.mkdirSync(import_node_path5.default.dirname(destFile), { recursive: true });
        const reEncrypted = encryptBuffer(att.plainBytes, context.vaultKey);
        import_node_fs5.default.writeFileSync(destFile, reEncrypted, { mode: 384 });
      }
      const rollbackDir = import_node_path5.default.join(
        import_node_os2.default.tmpdir(),
        `agl-rollback-${import_node_crypto4.default.randomUUID()}`
      );
      import_node_fs5.default.mkdirSync(rollbackDir, { recursive: true });
      const rollbackDbPath = import_node_path5.default.join(rollbackDir, "old.sqlite");
      const rollbackVaultDir = import_node_path5.default.join(rollbackDir, "old_vault");
      import_node_fs5.default.mkdirSync(rollbackVaultDir, { recursive: true });
      closeSqliteSafely(liveDb);
      const moveVaultContentsExcludingKey = (srcDir, dstDir) => {
        if (!import_node_fs5.default.existsSync(srcDir)) return;
        import_node_fs5.default.mkdirSync(dstDir, { recursive: true });
        for (const entry of import_node_fs5.default.readdirSync(srcDir, { withFileTypes: true })) {
          if (entry.name.startsWith(".vault.key")) continue;
          const srcPath = import_node_path5.default.join(srcDir, entry.name);
          const dstPath = import_node_path5.default.join(dstDir, entry.name);
          import_node_fs5.default.cpSync(srcPath, dstPath, { recursive: true });
          import_node_fs5.default.rmSync(srcPath, { recursive: true, force: true });
        }
      };
      try {
        if (import_node_fs5.default.existsSync(context.dbPath)) {
          import_node_fs5.default.copyFileSync(context.dbPath, rollbackDbPath);
          import_node_fs5.default.rmSync(context.dbPath, { force: true });
        }
        for (const suffix of ["-wal", "-shm"]) {
          const sidecar = `${context.dbPath}${suffix}`;
          if (import_node_fs5.default.existsSync(sidecar)) {
            import_node_fs5.default.copyFileSync(sidecar, `${rollbackDbPath}${suffix}`);
            import_node_fs5.default.rmSync(sidecar, { force: true });
          }
        }
        moveVaultContentsExcludingKey(context.vaultRootDir, rollbackVaultDir);
        import_node_fs5.default.copyFileSync(stagedDbPath, context.dbPath);
        import_node_fs5.default.cpSync(stagedVaultDir, context.vaultRootDir, { recursive: true });
        const restoredDb = openSqliteConnection(context.dbPath);
        const healthReport = checkDatabaseHealth(restoredDb, {
          dbPath: context.dbPath,
          migrationsDir: context.migrationsDir,
          vaultRootDir: context.vaultRootDir,
          vaultProtectionMode: context.vaultProtectionMode,
          deepIntegrity: true
        });
        if (healthReport.overallStatus === "CRITICAL") {
          closeSqliteSafely(restoredDb);
          throw new Error("La base restaur\xE9e a \xE9chou\xE9 au contr\xF4le critique de sant\xE9");
        }
        const actorInRestoredDb = restoredDb.prepare("SELECT id FROM users WHERE username = ?").get(input.actor.username);
        writeAuditLog(restoredDb, {
          userId: actorInRestoredDb?.id ?? null,
          usernameSnapshot: input.actor.username,
          operation: "BACKUP_RESTORED",
          entityType: "backup_records",
          entityId: input.backupRecordId ?? null,
          newValue: {
            restoredFile: verification.fileName,
            archiveChecksumSha256: verification.archiveChecksumSha256,
            schemaVersion: verification.schemaVersion,
            preRestoreBackupPath: preRestore.backup.destinationPath
          }
        });
        context.setDb(restoredDb);
        import_node_fs5.default.rmSync(rollbackDir, { recursive: true, force: true });
        return {
          restoredFrom: verification.fileName,
          verification,
          preRestoreBackup: preRestore.backup,
          healthReport
        };
      } catch (swapErr) {
        try {
          if (import_node_fs5.default.existsSync(rollbackDbPath)) {
            import_node_fs5.default.copyFileSync(rollbackDbPath, context.dbPath);
          }
          for (const suffix of ["-wal", "-shm"]) {
            const rbSide = `${rollbackDbPath}${suffix}`;
            const liveSide = `${context.dbPath}${suffix}`;
            if (import_node_fs5.default.existsSync(rbSide)) import_node_fs5.default.copyFileSync(rbSide, liveSide);
            else if (import_node_fs5.default.existsSync(liveSide)) import_node_fs5.default.rmSync(liveSide, { force: true });
          }
          moveVaultContentsExcludingKey(context.vaultRootDir, import_node_path5.default.join(rollbackDir, "failed_vault"));
          if (import_node_fs5.default.existsSync(rollbackVaultDir)) {
            import_node_fs5.default.cpSync(rollbackVaultDir, context.vaultRootDir, { recursive: true });
          }
          const reopenedOldDb = openSqliteConnection(context.dbPath);
          context.setDb(reopenedOldDb);
        } catch {
        } finally {
          import_node_fs5.default.rmSync(rollbackDir, { recursive: true, force: true });
        }
        throw swapErr;
      }
    } finally {
      import_node_fs5.default.rmSync(stageRoot, { recursive: true, force: true });
    }
  } finally {
    if (tempImportedPath && import_node_fs5.default.existsSync(tempImportedPath)) {
      import_node_fs5.default.rmSync(tempImportedPath, { force: true });
    }
  }
}
function exportBackupFile(db, input) {
  const record = getBackupRecordById(db, input.backupRecordId);
  if (!import_node_fs5.default.existsSync(record.destinationPath)) {
    throw new AuthError("NOT_FOUND", "Fichier de sauvegarde introuvable sur le disque");
  }
  const archiveBytes = import_node_fs5.default.readFileSync(record.destinationPath);
  const checksumSha256 = sha256Hex(archiveBytes);
  const fileName = record.fileName || import_node_path5.default.basename(record.destinationPath);
  if (input.destinationPath) {
    const target = import_node_path5.default.resolve(input.destinationPath);
    import_node_fs5.default.mkdirSync(import_node_path5.default.dirname(target), { recursive: true });
    const tmp = `${target}.${import_node_crypto4.default.randomUUID()}.tmp`;
    import_node_fs5.default.writeFileSync(tmp, archiveBytes, { mode: 384 });
    import_node_fs5.default.renameSync(tmp, target);
    writeAuditLog(db, {
      userId: input.actor.id,
      usernameSnapshot: input.actor.username,
      operation: "BACKUP_EXPORTED",
      entityType: "backup_records",
      entityId: record.id,
      newValue: { exportedToPath: target, checksumSha256 }
    });
    return { fileName, exportedToPath: target, checksumSha256 };
  }
  writeAuditLog(db, {
    userId: input.actor.id,
    usernameSnapshot: input.actor.username,
    operation: "BACKUP_EXPORTED",
    entityType: "backup_records",
    entityId: record.id,
    newValue: { mode: "browser_download", fileName, checksumSha256 }
  });
  return {
    fileName,
    base64Archive: archiveBytes.toString("base64"),
    checksumSha256
  };
}
function importBackupExternal(db, options) {
  const importDir = import_node_path5.default.join(options.backupDir, "imported");
  import_node_fs5.default.mkdirSync(importDir, { recursive: true });
  const cleanBaseName = import_node_path5.default.basename(options.fileName || options.sourcePath || `imported-${formatBackupTimestamp()}.agbkp`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const ensuredName = cleanBaseName.endsWith(".agbkp") ? cleanBaseName : `${cleanBaseName}.agbkp`;
  const destPath = import_node_path5.default.join(importDir, `${Date.now()}_${ensuredName}`);
  if (options.sourcePath) {
    if (!import_node_fs5.default.existsSync(options.sourcePath)) {
      throw new AuthError("NOT_FOUND", "Fichier source introuvable");
    }
    import_node_fs5.default.copyFileSync(options.sourcePath, destPath);
  } else if (options.base64Archive) {
    const buf = Buffer.from(options.base64Archive, "base64");
    import_node_fs5.default.writeFileSync(destPath, buf, { mode: 384 });
  } else {
    throw new AuthError("VALIDATION_ERROR", "Source de sauvegarde requise");
  }
  try {
    const verification = verifyBackupArchive({
      filePath: destPath,
      passphrase: options.passphrase,
      recoveryKey: options.recoveryKey,
      vaultKey: options.vaultKey
    });
    if (!verification.valid) {
      throw new AuthError(
        "VALIDATION_ERROR",
        verification.errorMessage || "Sauvegarde import\xE9e invalide"
      );
    }
    const insertRes = db.prepare(
      `INSERT INTO backup_records (
          backup_type, destination_path, file_name, file_size_bytes, checksum_sha256,
          status, error_message, app_version, schema_version, includes_vault, attachment_count,
          backup_format, is_encrypted, encryption_mode, recovery_key_fingerprint,
          verified_at, verification_status, verification_summary_json,
          triggered_by_user_id, triggered_by_username, notes
        ) VALUES ('MANUAL', ?, ?, ?, ?, 'SUCCESS', NULL, ?, ?, 1, ?, ?, 1, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)`
    ).run(
      destPath,
      import_node_path5.default.basename(destPath),
      verification.fileSizeBytes,
      verification.archiveChecksumSha256,
      verification.appVersion,
      verification.schemaVersion,
      verification.attachmentCount,
      BACKUP_FORMAT_NAME,
      verification.encryptionMode,
      verification.recoveryKeyFingerprint,
      (/* @__PURE__ */ new Date()).toISOString(),
      JSON.stringify(verification.recordCounts),
      options.actor.id,
      options.actor.username,
      `Import\xE9e depuis support externe (${cleanBaseName})`
    );
    const record = getBackupRecordById(db, Number(insertRes.lastInsertRowid));
    writeAuditLog(db, {
      userId: options.actor.id,
      usernameSnapshot: options.actor.username,
      operation: "BACKUP_IMPORTED",
      entityType: "backup_records",
      entityId: record.id,
      newValue: {
        fileName: record.fileName,
        checksumSha256: record.checksumSha256
      }
    });
    return { backup: record, verification };
  } catch (err) {
    import_node_fs5.default.rmSync(destPath, { force: true });
    throw err;
  }
}
function pruneExpiredBackups(db, retentionCount) {
  const safeKeep = Math.max(1, Math.min(365, Math.floor(retentionCount)));
  const rows = db.prepare(
    `SELECT id, destination_path
       FROM backup_records
       WHERE backup_type = 'AUTO' AND status = 'SUCCESS'
       ORDER BY id DESC`
  ).all();
  if (rows.length <= safeKeep) {
    return { removedIds: [] };
  }
  const toPrune = rows.slice(safeKeep);
  const removedIds = [];
  for (const row of toPrune) {
    try {
      if (import_node_fs5.default.existsSync(row.destination_path)) {
        import_node_fs5.default.rmSync(row.destination_path, { force: true });
      }
      db.prepare("DELETE FROM backup_records WHERE id = ?").run(row.id);
      removedIds.push(row.id);
    } catch {
    }
  }
  return { removedIds };
}

// electron/backups/backupScheduler.ts
function readAppSetting(db, key, fallback) {
  try {
    const row = db.prepare(
      "SELECT setting_value FROM application_settings WHERE setting_key = ?"
    ).get(key);
    return row?.setting_value ?? fallback;
  } catch {
    return fallback;
  }
}
function parseDailyMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 22 * 60;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}
async function runScheduledBackupIfDue(options) {
  const db = options.getDb();
  if (!db.open) {
    return { executed: false, reason: "db_closed" };
  }
  const enabled = readAppSetting(db, "app.auto_backup_enabled", "true") === "true";
  if (!enabled) {
    return { executed: false, reason: "disabled" };
  }
  const now = options.now ?? /* @__PURE__ */ new Date();
  const targetMinutes = parseDailyMinutes(readAppSetting(db, "app.auto_backup_time", "22:00"));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (currentMinutes < targetMinutes) {
    return { executed: false, reason: "before_scheduled_time" };
  }
  const todayPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const alreadyRanToday = db.prepare(
    `SELECT COUNT(*) AS cnt
       FROM backup_records
       WHERE backup_type = 'AUTO'
         AND status = 'SUCCESS'
         AND substr(created_at, 1, 10) = ?`
  ).get(todayPrefix);
  if ((alreadyRanToday?.cnt ?? 0) > 0) {
    return { executed: false, reason: "already_completed_today" };
  }
  await createBackup(db, {
    backupDir: options.backupDir,
    vaultRootDir: options.vaultRootDir,
    vaultKey: options.vaultKey,
    appVersion: options.appVersion,
    backupType: "AUTO",
    encryptionMode: "VAULT_RECOVERY_KEY",
    notes: `Sauvegarde automatique planifi\xE9e (${todayPrefix})`,
    actor: { id: null, username: "scheduler" }
  });
  const retention = Number(readAppSetting(db, "app.backup_retention_count", "14")) || 14;
  const pruned = pruneExpiredBackups(db, retention);
  return {
    executed: true,
    reason: "created",
    prunedCount: pruned.removedIds.length
  };
}
function startBackupScheduler(options) {
  let running = false;
  const triggerCheck = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledBackupIfDue(options);
    } catch {
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void triggerCheck();
  }, options.intervalMs ?? 6e4);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    triggerCheck
  };
}

// electron/security/sessionStore.ts
var DEFAULT_TTL_MS = 12 * 60 * 60 * 1e3;
var SessionStore = class {
  constructor(runtimeMode) {
    this.sessions = /* @__PURE__ */ new Map();
    this.runtimeMode = runtimeMode;
  }
  create(user, permissions) {
    const token = generateSessionToken();
    const now = Date.now();
    const record = {
      token,
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode,
      user,
      permissions,
      isLocked: false,
      runtimeMode: this.runtimeMode,
      createdAtMs: now,
      lastActivityMs: now,
      expiresAt: new Date(now + DEFAULT_TTL_MS).toISOString()
    };
    this.sessions.set(token, record);
    return record;
  }
  get(token) {
    if (!token) return null;
    const record = this.sessions.get(token);
    if (!record) return null;
    if (Date.now() > Date.parse(record.expiresAt)) {
      this.sessions.delete(token);
      return null;
    }
    return record;
  }
  touch(token) {
    const record = this.sessions.get(token);
    if (record && !record.isLocked) {
      record.lastActivityMs = Date.now();
    }
  }
  lock(token) {
    const record = this.sessions.get(token);
    if (!record) return false;
    record.isLocked = true;
    return true;
  }
  checkIdleAndAutoLock(token, idleMinutes) {
    const record = this.get(token);
    if (!record) {
      return { lockedNow: false, record: null };
    }
    if (!record.isLocked && idleMinutes > 0 && Date.now() - record.lastActivityMs > idleMinutes * 6e4) {
      record.isLocked = true;
      return { lockedNow: true, record };
    }
    return { lockedNow: false, record };
  }
  unlock(token, updatedUser, updatedPermissions) {
    const record = this.sessions.get(token);
    if (!record) return false;
    record.isLocked = false;
    record.lastActivityMs = Date.now();
    if (updatedUser) record.user = updatedUser;
    if (updatedPermissions) record.permissions = updatedPermissions;
    return true;
  }
  updateUserSnapshot(userId, user, permissions) {
    for (const session2 of this.sessions.values()) {
      if (session2.userId === userId) {
        session2.user = user;
        session2.roleCode = user.roleCode;
        session2.permissions = permissions;
        if (!user.isActive) {
          this.sessions.delete(session2.token);
        }
      }
    }
  }
  revoke(token) {
    return this.sessions.delete(token);
  }
  revokeAllForUser(userId) {
    for (const [token, record] of this.sessions.entries()) {
      if (record.userId === userId) {
        this.sessions.delete(token);
      }
    }
  }
};

// electron/main/ipcRouter.ts
var import_node_fs14 = __toESM(require("node:fs"), 1);
var import_node_os4 = __toESM(require("node:os"), 1);
var import_node_path15 = __toESM(require("node:path"), 1);
var import_zod2 = require("zod");

// shared/schemas/index.ts
var import_zod = require("zod");

// shared/constants/algeria.ts
var ALGERIA_WILAYAS = [
  { code: "01", nameFr: "Adrar", nameAr: "\u0623\u062F\u0631\u0627\u0631" },
  { code: "02", nameFr: "Chlef", nameAr: "\u0627\u0644\u0634\u0644\u0641" },
  { code: "03", nameFr: "Laghouat", nameAr: "\u0627\u0644\u0623\u063A\u0648\u0627\u0637" },
  { code: "04", nameFr: "Oum El Bouaghi", nameAr: "\u0623\u0645 \u0627\u0644\u0628\u0648\u0627\u0642\u064A" },
  { code: "05", nameFr: "Batna", nameAr: "\u0628\u0627\u062A\u0646\u0629" },
  { code: "06", nameFr: "B\xE9ja\xEFa", nameAr: "\u0628\u062C\u0627\u064A\u0629" },
  { code: "07", nameFr: "Biskra", nameAr: "\u0628\u0633\u0643\u0631\u0629" },
  { code: "08", nameFr: "B\xE9char", nameAr: "\u0628\u0634\u0627\u0631" },
  { code: "09", nameFr: "Blida", nameAr: "\u0627\u0644\u0628\u0644\u064A\u062F\u0629" },
  { code: "10", nameFr: "Bouira", nameAr: "\u0627\u0644\u0628\u0648\u064A\u0631\u0629" },
  { code: "11", nameFr: "Tamanrasset", nameAr: "\u062A\u0645\u0646\u0631\u0627\u0633\u062A" },
  { code: "12", nameFr: "T\xE9bessa", nameAr: "\u062A\u0628\u0633\u0629" },
  { code: "13", nameFr: "Tlemcen", nameAr: "\u062A\u0644\u0645\u0633\u0627\u0646" },
  { code: "14", nameFr: "Tiaret", nameAr: "\u062A\u064A\u0627\u0631\u062A" },
  { code: "15", nameFr: "Tizi Ouzou", nameAr: "\u062A\u064A\u0632\u064A \u0648\u0632\u0648" },
  { code: "16", nameFr: "Alger", nameAr: "\u0627\u0644\u062C\u0632\u0627\u0626\u0631 \u0627\u0644\u0639\u0627\u0635\u0645\u0629" },
  { code: "17", nameFr: "Djelfa", nameAr: "\u0627\u0644\u062C\u0644\u0641\u0629" },
  { code: "18", nameFr: "Jijel", nameAr: "\u062C\u064A\u062C\u0644" },
  { code: "19", nameFr: "S\xE9tif", nameAr: "\u0633\u0637\u064A\u0641" },
  { code: "20", nameFr: "Sa\xEFda", nameAr: "\u0633\u0639\u064A\u062F\u0629" },
  { code: "21", nameFr: "Skikda", nameAr: "\u0633\u0643\u064A\u0643\u062F\u0629" },
  { code: "22", nameFr: "Sidi Bel Abb\xE8s", nameAr: "\u0633\u064A\u062F\u064A \u0628\u0644\u0639\u0628\u0627\u0633" },
  { code: "23", nameFr: "Annaba", nameAr: "\u0639\u0646\u0627\u0628\u0629" },
  { code: "24", nameFr: "Guelma", nameAr: "\u0642\u0627\u0644\u0645\u0629" },
  { code: "25", nameFr: "Constantine", nameAr: "\u0642\u0633\u0646\u0637\u064A\u0646\u0629" },
  { code: "26", nameFr: "M\xE9d\xE9a", nameAr: "\u0627\u0644\u0645\u062F\u064A\u0629" },
  { code: "27", nameFr: "Mostaganem", nameAr: "\u0645\u0633\u062A\u063A\u0627\u0646\u0645" },
  { code: "28", nameFr: "M'Sila", nameAr: "\u0627\u0644\u0645\u0633\u064A\u0644\u0629" },
  { code: "29", nameFr: "Mascara", nameAr: "\u0645\u0639\u0633\u0643\u0631" },
  { code: "30", nameFr: "Ouargla", nameAr: "\u0648\u0631\u0642\u0644\u0629" },
  { code: "31", nameFr: "Oran", nameAr: "\u0648\u0647\u0631\u0627\u0646" },
  { code: "32", nameFr: "El Bayadh", nameAr: "\u0627\u0644\u0628\u064A\u0636" },
  { code: "33", nameFr: "Illizi", nameAr: "\u0625\u0644\u064A\u0632\u064A" },
  { code: "34", nameFr: "Bordj Bou Arr\xE9ridj", nameAr: "\u0628\u0631\u062C \u0628\u0648\u0639\u0631\u064A\u0631\u064A\u062C" },
  { code: "35", nameFr: "Boumerd\xE8s", nameAr: "\u0628\u0648\u0645\u0631\u062F\u0627\u0633" },
  { code: "36", nameFr: "El Tarf", nameAr: "\u0627\u0644\u0637\u0627\u0631\u0641" },
  { code: "37", nameFr: "Tindouf", nameAr: "\u062A\u0646\u062F\u0648\u0641" },
  { code: "38", nameFr: "Tissemsilt", nameAr: "\u062A\u064A\u0633\u0645\u0633\u064A\u0644\u062A" },
  { code: "39", nameFr: "El Oued", nameAr: "\u0627\u0644\u0648\u0627\u062F\u064A" },
  { code: "40", nameFr: "Khenchela", nameAr: "\u062E\u0646\u0634\u0644\u0629" },
  { code: "41", nameFr: "Souk Ahras", nameAr: "\u0633\u0648\u0642 \u0623\u0647\u0631\u0627\u0633" },
  { code: "42", nameFr: "Tipaza", nameAr: "\u062A\u064A\u0628\u0627\u0632\u0629" },
  { code: "43", nameFr: "Mila", nameAr: "\u0645\u064A\u0644\u0629" },
  { code: "44", nameFr: "A\xEFn Defla", nameAr: "\u0639\u064A\u0646 \u0627\u0644\u062F\u0641\u0644\u0649" },
  { code: "45", nameFr: "Na\xE2ma", nameAr: "\u0627\u0644\u0646\u0639\u0627\u0645\u0629" },
  { code: "46", nameFr: "A\xEFn T\xE9mouchent", nameAr: "\u0639\u064A\u0646 \u062A\u0645\u0648\u0634\u0646\u062A" },
  { code: "47", nameFr: "Gharda\xEFa", nameAr: "\u063A\u0631\u062F\u0627\u064A\u0629" },
  { code: "48", nameFr: "Relizane", nameAr: "\u063A\u0644\u064A\u0632\u0627\u0646" },
  { code: "49", nameFr: "Timimoun", nameAr: "\u062A\u064A\u0645\u064A\u0645\u0648\u0646" },
  { code: "50", nameFr: "Bordj Badji Mokhtar", nameAr: "\u0628\u0631\u062C \u0628\u0627\u062C\u064A \u0645\u062E\u062A\u0627\u0631" },
  { code: "51", nameFr: "Ouled Djellal", nameAr: "\u0623\u0648\u0644\u0627\u062F \u062C\u0644\u0627\u0644" },
  { code: "52", nameFr: "B\xE9ni Abb\xE8s", nameAr: "\u0628\u0646\u064A \u0639\u0628\u0627\u0633" },
  { code: "53", nameFr: "In Salah", nameAr: "\u0639\u064A\u0646 \u0635\u0627\u0644\u062D" },
  { code: "54", nameFr: "In Guezzam", nameAr: "\u0639\u064A\u0646 \u0642\u0632\u0627\u0645" },
  { code: "55", nameFr: "Touggourt", nameAr: "\u062A\u0642\u0631\u062A" },
  { code: "56", nameFr: "Djanet", nameAr: "\u062C\u0627\u0646\u062A" },
  { code: "57", nameFr: "El M'Ghair", nameAr: "\u0627\u0644\u0645\u063A\u064A\u0631" },
  { code: "58", nameFr: "El Meniaa", nameAr: "\u0627\u0644\u0645\u0646\u064A\u0639\u0629" },
  { code: "59", nameFr: "Aflou", nameAr: "\u0623\u0641\u0644\u0648" },
  { code: "60", nameFr: "Barika", nameAr: "\u0628\u0631\u064A\u0643\u0629" },
  { code: "61", nameFr: "El Kantara", nameAr: "\u0627\u0644\u0642\u0646\u0637\u0631\u0629" },
  { code: "62", nameFr: "Bir El Ater", nameAr: "\u0628\u0626\u0631 \u0627\u0644\u0639\u0627\u062A\u0631" },
  { code: "63", nameFr: "El Aricha", nameAr: "\u0627\u0644\u0639\u0631\u064A\u0634\u0629" },
  { code: "64", nameFr: "Ksar Chellala", nameAr: "\u0642\u0635\u0631 \u0627\u0644\u0634\u0644\u0627\u0644\u0629" },
  { code: "65", nameFr: "A\xEFn Ouessara", nameAr: "\u0639\u064A\u0646 \u0648\u0633\u0627\u0631\u0629" },
  { code: "66", nameFr: "Messaad", nameAr: "\u0645\u0633\u0639\u062F" },
  { code: "67", nameFr: "Ksar El Boukhari", nameAr: "\u0642\u0635\u0631 \u0627\u0644\u0628\u062E\u0627\u0631\u064A" },
  { code: "68", nameFr: "Bou Sa\xE2da", nameAr: "\u0628\u0648\u0633\u0639\u0627\u062F\u0629" },
  { code: "69", nameFr: "El Abiodh Sidi Cheikh", nameAr: "\u0627\u0644\u0623\u0628\u064A\u0636 \u0633\u064A\u062F\u064A \u0627\u0644\u0634\u064A\u062E" }
];
var ALGERIA_WILAYA_CODES = new Set(ALGERIA_WILAYAS.map((w) => w.code));
var DEFAULT_TIMEZONE = "Africa/Algiers";
var STANDARD_ALGERIAN_MATRICULE_REGEX = /^\d{5,6}[-\s]\d{3}[-\s](0[1-9]|[1-6]\d)$/;

// shared/schemas/index.ts
var LoginSchema = import_zod.z.object({
  username: import_zod.z.string().trim().min(2).max(64),
  password: import_zod.z.string().min(4).max(128)
});
var BootstrapAdminSchema = import_zod.z.object({
  username: import_zod.z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: import_zod.z.string().trim().min(2).max(120),
  password: import_zod.z.string().min(8).max(128)
});
var UnlockSessionSchema = import_zod.z.object({
  password: import_zod.z.string().min(1).max(128)
});
var ChangePasswordSchema = import_zod.z.object({
  currentPassword: import_zod.z.string().min(1).max(128),
  newPassword: import_zod.z.string().min(8).max(128)
});
var CreateUserSchema = import_zod.z.object({
  username: import_zod.z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: import_zod.z.string().trim().min(2).max(120),
  password: import_zod.z.string().min(8).max(128),
  roleCode: import_zod.z.enum(["ADMIN", "AGENT"])
});
var UpdateUserSchema = import_zod.z.object({
  userId: import_zod.z.number().int().positive(),
  fullName: import_zod.z.string().trim().min(2).max(120).optional(),
  roleCode: import_zod.z.enum(["ADMIN", "AGENT"]).optional(),
  isActive: import_zod.z.boolean().optional(),
  unlockAccount: import_zod.z.boolean().optional(),
  resetPassword: import_zod.z.string().min(8).max(128).optional(),
  permissionOverrides: import_zod.z.array(
    import_zod.z.object({
      code: import_zod.z.string().min(3),
      granted: import_zod.z.boolean().nullable()
    })
  ).optional()
});
var UpdateSettingsBatchSchema = import_zod.z.object({
  updates: import_zod.z.array(
    import_zod.z.object({
      key: import_zod.z.string().trim().min(2).max(120),
      group: import_zod.z.enum(["agency", "business", "documents", "app"]),
      value: import_zod.z.string().max(4e3)
    })
  ).min(1)
});
var UpsertWilayaSchema = import_zod.z.object({
  code: import_zod.z.string().trim().min(2).max(6).regex(/^[A-Za-z0-9_-]+$/),
  nameFr: import_zod.z.string().trim().min(2).max(100),
  nameAr: import_zod.z.string().trim().min(2).max(100),
  isNewlyCreated2026: import_zod.z.boolean(),
  parentWilayaCode: import_zod.z.string().trim().max(6).nullable().optional(),
  decreeReference: import_zod.z.string().trim().max(120).nullable().optional(),
  effectiveYear: import_zod.z.number().int().min(1962).max(2100),
  isActive: import_zod.z.boolean(),
  notes: import_zod.z.string().max(500).nullable().optional()
});
var CreateVehicleSchema = import_zod.z.object({
  internalCode: import_zod.z.string().trim().min(1).max(32),
  matricule: import_zod.z.string().trim().min(5).max(32).refine(
    (val) => STANDARD_ALGERIAN_MATRICULE_REGEX.test(val) || val.length >= 5,
    "Matricule invalide"
  ),
  vin: import_zod.z.string().trim().max(32).nullable().optional(),
  brand: import_zod.z.string().trim().min(1).max(64),
  model: import_zod.z.string().trim().min(1).max(64),
  year: import_zod.z.number().int().min(1980).max(2035),
  color: import_zod.z.string().trim().min(1).max(40),
  category: import_zod.z.string().trim().min(1).max(64),
  fuelType: import_zod.z.enum(["ESSENCE", "DIESEL", "GPL", "OTHER"]),
  transmission: import_zod.z.enum(["MANUAL", "AUTOMATIC"]),
  seats: import_zod.z.number().int().min(2).max(9),
  currentOdometerKm: import_zod.z.number().int().min(0),
  acquisitionDate: import_zod.z.string().nullable().optional(),
  acquisitionCostMinor: import_zod.z.number().int().min(0).nullable().optional(),
  defaultDailyRateMinor: import_zod.z.number().int().min(0),
  defaultWeeklyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  defaultMonthlyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  notes: import_zod.z.string().max(2e3).nullable().optional()
});
var CreateCustomerSchema = import_zod.z.object({
  customerType: import_zod.z.enum(["INDIVIDUAL", "COMPANY"]),
  fullName: import_zod.z.string().trim().min(2).max(160),
  dateOfBirth: import_zod.z.string().nullable().optional(),
  phone: import_zod.z.string().trim().min(6).max(32),
  secondaryPhone: import_zod.z.string().trim().max(32).nullable().optional(),
  address: import_zod.z.string().trim().max(255).nullable().optional(),
  wilayaCode: import_zod.z.string().refine((c) => !c || ALGERIA_WILAYA_CODES.has(c), "Code wilaya invalide (01-69)").nullable().optional(),
  commune: import_zod.z.string().trim().max(100).nullable().optional(),
  cniNumber: import_zod.z.string().trim().max(64).nullable().optional(),
  passportNumber: import_zod.z.string().trim().max(64).nullable().optional(),
  drivingLicenceNumber: import_zod.z.string().trim().max(64).nullable().optional(),
  drivingLicenceIssueDate: import_zod.z.string().nullable().optional(),
  drivingLicenceExpirationDate: import_zod.z.string().nullable().optional(),
  internalNotes: import_zod.z.string().max(2e3).nullable().optional(),
  company: import_zod.z.object({
    companyName: import_zod.z.string().trim().min(2).max(180),
    legalRepresentative: import_zod.z.string().trim().min(2).max(160),
    rcNumber: import_zod.z.string().trim().max(64).nullable().optional(),
    nifNumber: import_zod.z.string().trim().max(64).nullable().optional(),
    nisNumber: import_zod.z.string().trim().max(64).nullable().optional(),
    artNumber: import_zod.z.string().trim().max(64).nullable().optional(),
    bonDeCommandeNumber: import_zod.z.string().trim().max(64).nullable().optional()
  }).nullable().optional()
});
var CreateRiskRecordSchema = import_zod.z.object({
  customerId: import_zod.z.number().int().positive(),
  riskLevel: import_zod.z.enum(["LOW", "MEDIUM", "HIGH", "BLACKLISTED"]),
  reason: import_zod.z.enum([
    "UNPAID_DEBT",
    "TRAFFIC_FINE",
    "RADAR_FINE",
    "VEHICLE_DAMAGE",
    "LATE_RETURN",
    "CONTRACT_VIOLATION",
    "OTHER"
  ]),
  description: import_zod.z.string().trim().min(5).max(2e3),
  incidentDate: import_zod.z.string().min(8)
});
var CreateContractSchema = import_zod.z.object({
  reservationId: import_zod.z.number().int().positive().nullable().optional(),
  customerId: import_zod.z.number().int().positive(),
  vehicleId: import_zod.z.number().int().positive(),
  startDate: import_zod.z.string().min(10),
  expectedReturnDate: import_zod.z.string().min(10),
  departureOdometerKm: import_zod.z.number().int().min(0),
  mileageMode: import_zod.z.enum(["UNLIMITED", "DAILY_ALLOWANCE", "CUSTOM_TOTAL"]),
  dailyMileageAllowanceKm: import_zod.z.number().int().min(0).nullable().optional(),
  includedTotalKm: import_zod.z.number().int().min(0).nullable().optional(),
  extraKmRateMinor: import_zod.z.number().int().min(0),
  currency: import_zod.z.enum(["DZD", "EUR"]).default("DZD"),
  baseRentalTotalMinor: import_zod.z.number().int().min(0),
  discountMinor: import_zod.z.number().int().min(0).default(0),
  depositAmountMinor: import_zod.z.number().int().min(0),
  depositCurrency: import_zod.z.enum(["DZD", "EUR"]).default("DZD"),
  initialPaymentMinor: import_zod.z.number().int().min(0).default(0),
  initialPaymentMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  initialPaymentReference: import_zod.z.string().max(128).nullable().optional(),
  blacklistOverrideReason: import_zod.z.string().max(500).nullable().optional(),
  notes: import_zod.z.string().max(2e3).nullable().optional()
});
var ExtendContractSchema = import_zod.z.object({
  contractId: import_zod.z.number().int().positive(),
  newReturnDate: import_zod.z.string().min(10),
  additionalAmountMinor: import_zod.z.number().int().min(0),
  additionalKmAllowance: import_zod.z.number().int().min(0).default(0),
  notes: import_zod.z.string().max(1e3).nullable().optional()
});
var RecordPaymentSchema = import_zod.z.object({
  contractId: import_zod.z.number().int().positive(),
  direction: import_zod.z.enum(["INFLOW", "REFUND"]),
  method: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]),
  paymentReference: import_zod.z.string().trim().max(128).nullable().optional(),
  amountMinor: import_zod.z.number().int().positive(),
  currency: import_zod.z.enum(["DZD", "EUR"]).default("DZD"),
  paymentDate: import_zod.z.string().min(8),
  description: import_zod.z.string().trim().max(500).nullable().optional()
});
var ReversePaymentSchema = import_zod.z.object({
  paymentId: import_zod.z.number().int().positive(),
  reason: import_zod.z.string().trim().min(3).max(500)
});
var SettleDepositSchema = import_zod.z.object({
  depositId: import_zod.z.number().int().positive(),
  deductedAmountMinor: import_zod.z.number().int().min(0),
  refundedAmountMinor: import_zod.z.number().int().min(0),
  chargeCategory: import_zod.z.enum(["DAMAGE", "TRAFFIC_FINE", "LATE_FEE", "EXTRA_KM", "CLEANING", "FUEL", "OTHER"]).nullable().optional(),
  deductionReason: import_zod.z.string().trim().max(500).nullable().optional(),
  refundMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  trafficFineId: import_zod.z.number().int().positive().nullable().optional(),
  supportingDoc: import_zod.z.object({
    originalFileName: import_zod.z.string().trim().min(1).max(200),
    mimeType: import_zod.z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    base64Data: import_zod.z.string().min(4).max(8e6)
  }).nullable().optional()
});
var CreateTrafficFineSchema = import_zod.z.object({
  contractId: import_zod.z.number().int().positive().nullable().optional(),
  vehicleId: import_zod.z.number().int().positive(),
  customerId: import_zod.z.number().int().positive(),
  fineType: import_zod.z.enum(["TRAFFIC", "RADAR", "PARKING", "OTHER"]),
  referenceNumber: import_zod.z.string().trim().max(100).nullable().optional(),
  incurredDate: import_zod.z.string().min(8),
  amountMinor: import_zod.z.number().int().positive(),
  notes: import_zod.z.string().trim().max(500).nullable().optional()
});
var OpenCashSessionSchema = import_zod.z.object({
  sessionDate: import_zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  openingBalanceMinor: import_zod.z.number().int().min(0),
  openingNotes: import_zod.z.string().trim().max(500).nullable().optional()
});
var CloseCashSessionSchema = import_zod.z.object({
  sessionId: import_zod.z.number().int().positive(),
  actualClosingMinor: import_zod.z.number().int().min(0),
  discrepancyNotes: import_zod.z.string().trim().max(500).nullable().optional()
});
var RecordCashAdjustmentSchema = import_zod.z.object({
  sessionId: import_zod.z.number().int().positive(),
  amountDeltaMinor: import_zod.z.number().int().refine((n) => n !== 0, "Le montant ne peut pas \xEAtre z\xE9ro"),
  reason: import_zod.z.string().trim().min(3).max(500)
});
var CreateCustomerAdjustmentSchema = import_zod.z.object({
  customerId: import_zod.z.number().int().positive(),
  contractId: import_zod.z.number().int().positive().nullable().optional(),
  adjustmentType: import_zod.z.enum(["CREDIT_NOTE", "DEBIT_CHARGE", "WRITE_OFF"]),
  amountMinor: import_zod.z.number().int().positive(),
  currency: import_zod.z.enum(["DZD", "EUR"]).default("DZD"),
  adjustmentDate: import_zod.z.string().min(8),
  reason: import_zod.z.string().trim().min(3).max(500),
  notes: import_zod.z.string().trim().max(1e3).nullable().optional()
});
var CreateSupplierSchema = import_zod.z.object({
  id: import_zod.z.number().int().positive().optional(),
  name: import_zod.z.string().trim().min(2).max(160),
  phone: import_zod.z.string().trim().max(40).nullable().optional(),
  email: import_zod.z.string().trim().max(120).nullable().optional(),
  address: import_zod.z.string().trim().max(255).nullable().optional(),
  wilayaCode: import_zod.z.string().trim().max(10).nullable().optional(),
  specialty: import_zod.z.string().trim().max(120).nullable().optional(),
  nifNumber: import_zod.z.string().trim().max(64).nullable().optional(),
  notes: import_zod.z.string().trim().max(500).nullable().optional(),
  isArchived: import_zod.z.boolean().optional()
});
var UpsertSupplierSchema = CreateSupplierSchema;
var CreateExpenseSchema = import_zod.z.object({
  category: import_zod.z.enum([
    "MAINTENANCE",
    "REPAIRS",
    "SPARE_PARTS",
    "INSURANCE",
    "VIGNETTE",
    "TECHNICAL_INSPECTION",
    "CLEANING",
    "ADMINISTRATIVE",
    "OTHER"
  ]),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  supplierId: import_zod.z.number().int().positive().nullable().optional(),
  maintenanceRecordId: import_zod.z.number().int().positive().nullable().optional(),
  amountMinor: import_zod.z.number().int().positive(),
  currency: import_zod.z.enum(["DZD", "EUR"]).default("DZD"),
  expenseDate: import_zod.z.string().min(8),
  paymentMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  paymentReference: import_zod.z.string().trim().max(128).nullable().optional(),
  description: import_zod.z.string().trim().min(2).max(500),
  receiptDoc: import_zod.z.object({
    originalFileName: import_zod.z.string().trim().min(1).max(200),
    mimeType: import_zod.z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    base64Data: import_zod.z.string().min(4).max(8e6)
  }).nullable().optional()
});
var ReverseExpenseSchema = import_zod.z.object({
  expenseId: import_zod.z.number().int().positive(),
  reason: import_zod.z.string().trim().min(3).max(500)
});
var InventoryMovementSchema = import_zod.z.object({
  partId: import_zod.z.number().int().positive(),
  movementType: import_zod.z.enum(["PURCHASE", "ENTRY", "WITHDRAWAL", "MAINTENANCE_USE", "ADJUSTMENT"]),
  quantityDelta: import_zod.z.number().int().refine((n) => n !== 0, "La quantit\xE9 ne peut pas \xEAtre z\xE9ro"),
  unitCostMinor: import_zod.z.number().int().min(0).default(0),
  maintenanceRecordId: import_zod.z.number().int().positive().nullable().optional(),
  notes: import_zod.z.string().max(500).nullable().optional(),
  overrideReason: import_zod.z.string().max(500).nullable().optional()
});
var UpdateVehicleSchema = CreateVehicleSchema.partial().extend({
  id: import_zod.z.number().int().positive(),
  status: import_zod.z.enum(["AVAILABLE", "RENTED", "RESERVED", "MAINTENANCE"]).optional()
});
var UpsertVehicleDocSchema = import_zod.z.object({
  id: import_zod.z.number().int().positive().optional(),
  vehicleId: import_zod.z.number().int().positive(),
  docType: import_zod.z.enum(["CARTE_GRISE", "ASSURANCE", "VIGNETTE", "CONTROLE_TECHNIQUE"]),
  documentNumber: import_zod.z.string().trim().max(100).nullable().optional(),
  issueDate: import_zod.z.string().nullable().optional(),
  expirationDate: import_zod.z.string().min(8),
  reminderDays: import_zod.z.number().int().min(0).max(365).default(30),
  notes: import_zod.z.string().max(500).nullable().optional()
});
var CreateBlockedPeriodSchema = import_zod.z.object({
  vehicleId: import_zod.z.number().int().positive(),
  blockType: import_zod.z.enum(["MAINTENANCE", "ADMIN_HOLD", "OTHER"]),
  startDate: import_zod.z.string().min(10),
  endDate: import_zod.z.string().min(10),
  reason: import_zod.z.string().trim().min(3).max(500)
});
var UpdateCustomerSchema = CreateCustomerSchema.partial().extend({
  id: import_zod.z.number().int().positive()
});
var ResolveRiskRecordSchema = import_zod.z.object({
  riskRecordId: import_zod.z.number().int().positive(),
  resolutionNotes: import_zod.z.string().trim().min(3).max(1e3),
  nextCustomerRiskStatus: import_zod.z.enum(["LOW", "MEDIUM", "HIGH", "BLACKLISTED"]).optional()
});
var UploadCustomerDocSchema = import_zod.z.object({
  customerId: import_zod.z.number().int().positive(),
  docCategory: import_zod.z.enum(["CNI", "PASSPORT", "DRIVING_LICENCE", "COMPANY_RC", "COMPANY_NIF", "BON_COMMANDE", "OTHER"]),
  originalFileName: import_zod.z.string().trim().min(1).max(200),
  mimeType: import_zod.z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  base64Data: import_zod.z.string().min(4).max(8e6),
  documentNumber: import_zod.z.string().trim().max(100).nullable().optional(),
  issueDate: import_zod.z.string().nullable().optional(),
  expirationDate: import_zod.z.string().nullable().optional(),
  reminderDays: import_zod.z.number().int().min(0).max(365).default(30).optional(),
  notes: import_zod.z.string().trim().max(1e3).nullable().optional(),
  replaceDocId: import_zod.z.number().int().positive().nullable().optional()
});
var UpdateCustomerDocMetaSchema = import_zod.z.object({
  docId: import_zod.z.number().int().positive(),
  documentNumber: import_zod.z.string().trim().max(100).nullable().optional(),
  issueDate: import_zod.z.string().nullable().optional(),
  expirationDate: import_zod.z.string().nullable().optional(),
  reminderDays: import_zod.z.number().int().min(0).max(365).optional(),
  notes: import_zod.z.string().trim().max(1e3).nullable().optional()
});
var ArchiveCustomerDocSchema = import_zod.z.object({
  docId: import_zod.z.number().int().positive(),
  reason: import_zod.z.string().trim().max(500).nullable().optional()
});
var CreateReservationSchema = import_zod.z.object({
  customerId: import_zod.z.number().int().positive(),
  vehicleId: import_zod.z.number().int().positive(),
  startDate: import_zod.z.string().min(10),
  expectedReturnDate: import_zod.z.string().min(10),
  estimatedTotalMinor: import_zod.z.number().int().min(0).default(0),
  status: import_zod.z.enum(["PENDING", "CONFIRMED"]).default("CONFIRMED"),
  notes: import_zod.z.string().max(1e3).nullable().optional()
});
var UpdateReservationStatusSchema = import_zod.z.object({
  reservationId: import_zod.z.number().int().positive(),
  status: import_zod.z.enum(["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW"]),
  notes: import_zod.z.string().max(1e3).nullable().optional()
});
var CalculatePriceSchema = import_zod.z.object({
  vehicleId: import_zod.z.number().int().positive(),
  customerId: import_zod.z.number().int().positive().nullable().optional(),
  startDate: import_zod.z.string().min(10),
  endDate: import_zod.z.string().min(10),
  pricingTier: import_zod.z.enum(["AUTO", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).default("AUTO"),
  customDailyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  customTotalMinor: import_zod.z.number().int().min(0).nullable().optional(),
  discountType: import_zod.z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
  discountValue: import_zod.z.number().min(0).default(0)
});
var CreateSeasonalRateSchema = import_zod.z.object({
  name: import_zod.z.string().trim().min(2).max(120),
  vehicleCategory: import_zod.z.string().trim().max(64).nullable().optional(),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  startDate: import_zod.z.string().min(8),
  endDate: import_zod.z.string().min(8),
  dailyRateMinor: import_zod.z.number().int().min(0),
  weeklyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  monthlyRateMinor: import_zod.z.number().int().min(0).nullable().optional()
});
var UpsertCustomerCustomRateSchema = import_zod.z.object({
  customerId: import_zod.z.number().int().positive(),
  vehicleCategory: import_zod.z.string().trim().max(64).nullable().optional(),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  dailyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  weeklyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  monthlyRateMinor: import_zod.z.number().int().min(0).nullable().optional(),
  defaultDiscountPercent: import_zod.z.number().min(0).max(100).default(0),
  notes: import_zod.z.string().max(500).nullable().optional()
});
var CreateContractPhase2Schema = CreateContractSchema.extend({
  initialStatus: import_zod.z.enum(["DRAFT", "CONFIRMED", "ACTIVE"]).default("CONFIRMED"),
  pricingTier: import_zod.z.enum(["AUTO", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).default("AUTO"),
  discountType: import_zod.z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
  discountValue: import_zod.z.number().min(0).default(0),
  pricingBreakdownLabel: import_zod.z.string().max(240).optional(),
  discountAuthorizationReason: import_zod.z.string().max(500).nullable().optional()
});
var CompleteContractSchema = import_zod.z.object({
  contractId: import_zod.z.number().int().positive(),
  actualReturnDate: import_zod.z.string().min(10),
  returnOdometerKm: import_zod.z.number().int().min(0),
  odometerCorrectionReason: import_zod.z.string().max(500).nullable().optional(),
  lateFeeMinor: import_zod.z.number().int().min(0).default(0),
  damageChargeMinor: import_zod.z.number().int().min(0).default(0),
  otherChargesMinor: import_zod.z.number().int().min(0).default(0),
  notes: import_zod.z.string().max(1e3).nullable().optional()
});
var InspectionItemInputSchema = import_zod.z.object({
  itemKey: import_zod.z.string().trim().min(1).max(80),
  category: import_zod.z.string().trim().min(1).max(40).default("GENERAL"),
  labelFr: import_zod.z.string().trim().min(1).max(200),
  labelAr: import_zod.z.string().trim().min(1).max(200),
  condition: import_zod.z.enum(["GOOD", "DAMAGED", "MISSING"]),
  notes: import_zod.z.string().trim().max(500).nullable().optional(),
  sortOrder: import_zod.z.number().int().min(0).default(0)
});
var InspectionDamageInputSchema = import_zod.z.object({
  zoneCode: import_zod.z.string().trim().min(1).max(60),
  diagramX: import_zod.z.number().min(0).max(100).nullable().optional(),
  diagramY: import_zod.z.number().min(0).max(100).nullable().optional(),
  damageType: import_zod.z.enum(["SCRATCH", "DENT", "CRACK", "BROKEN", "MISSING_ACCESSORY", "OTHER"]),
  severity: import_zod.z.enum(["MINOR", "MODERATE", "MAJOR", "CRITICAL"]),
  description: import_zod.z.string().trim().min(2).max(1e3),
  isPreExisting: import_zod.z.boolean().optional(),
  isNewlyDiscovered: import_zod.z.boolean().optional(),
  estimatedRepairCostMinor: import_zod.z.number().int().min(0).nullable().optional()
});
var CreateInspectionSchema = import_zod.z.object({
  contractId: import_zod.z.number().int().positive(),
  stage: import_zod.z.enum(["DEPARTURE", "RETURN"]),
  odometerKm: import_zod.z.number().int().min(0),
  fuelLevelPercent: import_zod.z.number().int().min(0).max(100),
  exteriorNotes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  interiorNotes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  agencySignatureData: import_zod.z.string().max(5e5).nullable().optional(),
  customerSignatureData: import_zod.z.string().max(5e5).nullable().optional(),
  customerAcknowledged: import_zod.z.boolean().default(false),
  customerAcknowledgmentNotes: import_zod.z.string().trim().max(1e3).nullable().optional(),
  inspectedAt: import_zod.z.string().min(10).optional(),
  finalizeNow: import_zod.z.boolean().default(false),
  items: import_zod.z.array(InspectionItemInputSchema).min(1).optional(),
  damages: import_zod.z.array(InspectionDamageInputSchema).optional()
});
var UpdateInspectionDraftSchema = import_zod.z.object({
  inspectionId: import_zod.z.number().int().positive(),
  odometerKm: import_zod.z.number().int().min(0).optional(),
  fuelLevelPercent: import_zod.z.number().int().min(0).max(100).optional(),
  exteriorNotes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  interiorNotes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  agencySignatureData: import_zod.z.string().max(5e5).nullable().optional(),
  customerSignatureData: import_zod.z.string().max(5e5).nullable().optional(),
  customerAcknowledged: import_zod.z.boolean().optional(),
  customerAcknowledgmentNotes: import_zod.z.string().trim().max(1e3).nullable().optional(),
  inspectedAt: import_zod.z.string().min(10).optional(),
  items: import_zod.z.array(InspectionItemInputSchema).min(1).optional()
});
var UploadInspectionPhotoSchema = import_zod.z.object({
  inspectionId: import_zod.z.number().int().positive(),
  damageId: import_zod.z.number().int().positive().nullable().optional(),
  originalFileName: import_zod.z.string().trim().min(1).max(200),
  mimeType: import_zod.z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64Data: import_zod.z.string().min(4).max(8e6),
  caption: import_zod.z.string().trim().max(300).nullable().optional()
});
var AddVehicleDamageSchema = InspectionDamageInputSchema.extend({
  vehicleId: import_zod.z.number().int().positive(),
  contractId: import_zod.z.number().int().positive().nullable().optional(),
  inspectionId: import_zod.z.number().int().positive().nullable().optional()
});
var UpdateDamageStatusSchema = import_zod.z.object({
  damageId: import_zod.z.number().int().positive(),
  newStatus: import_zod.z.enum(["REPORTED", "UNDER_REVIEW", "CONFIRMED", "UNDER_REPAIR", "REPAIRED", "REJECTED"]),
  notes: import_zod.z.string().trim().min(2).max(1e3),
  estimatedRepairCostMinor: import_zod.z.number().int().min(0).nullable().optional(),
  repairReference: import_zod.z.string().trim().max(120).nullable().optional(),
  linkedExpenseId: import_zod.z.number().int().positive().nullable().optional()
});
var UpsertMaintenanceTypeSchema = import_zod.z.object({
  id: import_zod.z.number().int().positive().optional(),
  code: import_zod.z.string().trim().min(2).max(50),
  nameFr: import_zod.z.string().trim().min(2).max(150),
  nameAr: import_zod.z.string().trim().min(2).max(150),
  defaultKmInterval: import_zod.z.number().int().positive().nullable().optional(),
  defaultDayInterval: import_zod.z.number().int().positive().nullable().optional(),
  kmWarningThreshold: import_zod.z.number().int().min(0).default(1e3),
  dayWarningThreshold: import_zod.z.number().int().min(0).default(14),
  isActive: import_zod.z.boolean().default(true)
});
var UpsertVehicleMaintenanceScheduleSchema = import_zod.z.object({
  vehicleId: import_zod.z.number().int().positive(),
  maintenanceTypeId: import_zod.z.number().int().positive(),
  kmInterval: import_zod.z.number().int().positive().nullable().optional(),
  dayInterval: import_zod.z.number().int().positive().nullable().optional(),
  kmWarningThreshold: import_zod.z.number().int().min(0).default(1e3),
  dayWarningThreshold: import_zod.z.number().int().min(0).default(14),
  isActive: import_zod.z.boolean().default(true),
  notes: import_zod.z.string().trim().max(500).nullable().optional()
});
var MaintenanceDocUploadSchema = import_zod.z.object({
  originalFileName: import_zod.z.string().trim().min(1).max(200),
  mimeType: import_zod.z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  base64Data: import_zod.z.string().min(4).max(12e6)
});
var MaintenancePartUsageSchema = import_zod.z.object({
  partId: import_zod.z.number().int().positive(),
  quantityUsed: import_zod.z.number().int().positive(),
  unitCostMinor: import_zod.z.number().int().min(0).optional()
});
var CreateMaintenanceRecordSchema = import_zod.z.object({
  vehicleId: import_zod.z.number().int().positive(),
  maintenanceTypeId: import_zod.z.number().int().positive(),
  supplierId: import_zod.z.number().int().positive().nullable().optional(),
  status: import_zod.z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED"]).default("COMPLETED"),
  isEmergency: import_zod.z.boolean().default(false),
  workDescription: import_zod.z.string().trim().min(3).max(2e3),
  performedDate: import_zod.z.string().min(10).max(30),
  scheduledStartDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  scheduledEndDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  odometerKm: import_zod.z.number().int().min(0),
  nextDueDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  nextDueOdometerKm: import_zod.z.number().int().min(0).nullable().optional(),
  laborCostMinor: import_zod.z.number().int().min(0).default(0),
  partsCostMinor: import_zod.z.number().int().min(0).default(0),
  partsUsed: import_zod.z.array(MaintenancePartUsageSchema).optional(),
  technicianName: import_zod.z.string().trim().max(120).nullable().optional(),
  notes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  blockVehicle: import_zod.z.boolean().default(false),
  recordInFinance: import_zod.z.boolean().default(false),
  financeCategory: import_zod.z.enum(["MAINTENANCE", "REPAIRS"]).default("MAINTENANCE"),
  financeExpenseScope: import_zod.z.enum(["TOTAL", "LABOR_ONLY"]).default("TOTAL"),
  paymentMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  paymentReference: import_zod.z.string().trim().max(120).nullable().optional(),
  invoiceDoc: MaintenanceDocUploadSchema.nullable().optional()
});
var UpdateMaintenanceRecordSchema = import_zod.z.object({
  recordId: import_zod.z.number().int().positive(),
  status: import_zod.z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  supplierId: import_zod.z.number().int().positive().nullable().optional(),
  workDescription: import_zod.z.string().trim().min(3).max(2e3).optional(),
  performedDate: import_zod.z.string().min(10).max(30).optional(),
  scheduledStartDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  scheduledEndDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  odometerKm: import_zod.z.number().int().min(0).optional(),
  nextDueDate: import_zod.z.string().min(10).max(30).nullable().optional(),
  nextDueOdometerKm: import_zod.z.number().int().min(0).nullable().optional(),
  laborCostMinor: import_zod.z.number().int().min(0).optional(),
  partsCostMinor: import_zod.z.number().int().min(0).optional(),
  partsUsed: import_zod.z.array(MaintenancePartUsageSchema).optional(),
  technicianName: import_zod.z.string().trim().max(120).nullable().optional(),
  notes: import_zod.z.string().trim().max(2e3).nullable().optional(),
  blockVehicle: import_zod.z.boolean().optional(),
  recordInFinance: import_zod.z.boolean().optional(),
  financeCategory: import_zod.z.enum(["MAINTENANCE", "REPAIRS"]).optional(),
  financeExpenseScope: import_zod.z.enum(["TOTAL", "LABOR_ONLY"]).optional(),
  paymentMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).optional(),
  paymentReference: import_zod.z.string().trim().max(120).nullable().optional(),
  invoiceDoc: MaintenanceDocUploadSchema.nullable().optional()
});
var UpsertInventoryPartSchema = import_zod.z.object({
  id: import_zod.z.number().int().positive().optional(),
  partCode: import_zod.z.string().trim().min(2).max(60),
  partName: import_zod.z.string().trim().min(2).max(160),
  category: import_zod.z.string().trim().min(2).max(80),
  description: import_zod.z.string().trim().max(1e3).nullable().optional(),
  unitLabel: import_zod.z.string().trim().min(1).max(30).default("PIECE"),
  compatibleModels: import_zod.z.string().trim().max(300).nullable().optional(),
  minimumStock: import_zod.z.number().int().min(0).default(1),
  unitPurchasePriceMinor: import_zod.z.number().int().min(0).default(0),
  supplierId: import_zod.z.number().int().positive().nullable().optional(),
  storageLocation: import_zod.z.string().trim().max(120).nullable().optional(),
  initialStock: import_zod.z.number().int().min(0).optional(),
  isArchived: import_zod.z.boolean().optional()
});
var RecordInventoryMovementSchema = import_zod.z.object({
  partId: import_zod.z.number().int().positive(),
  movementType: import_zod.z.enum(["PURCHASE", "ENTRY", "WITHDRAWAL", "RETURN"]),
  quantity: import_zod.z.number().int().positive(),
  unitCostMinor: import_zod.z.number().int().min(0).optional(),
  supplierId: import_zod.z.number().int().positive().nullable().optional(),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  maintenanceRecordId: import_zod.z.number().int().positive().nullable().optional(),
  referenceCode: import_zod.z.string().trim().max(100).nullable().optional(),
  movementDate: import_zod.z.string().min(8).max(30).optional(),
  notes: import_zod.z.string().trim().max(500).nullable().optional(),
  recordInFinance: import_zod.z.boolean().default(false),
  paymentMethod: import_zod.z.enum(["CASH", "CCP", "BARIDIMOB", "BANK_TRANSFER", "OTHER"]).default("CASH"),
  paymentReference: import_zod.z.string().trim().max(120).nullable().optional()
});
var AdjustInventoryStockSchema = import_zod.z.object({
  partId: import_zod.z.number().int().positive(),
  quantityDelta: import_zod.z.number().int().refine((n) => n !== 0, "La quantit\xE9 d\u2019ajustement ne peut pas \xEAtre z\xE9ro"),
  overrideReason: import_zod.z.string().trim().min(3).max(500),
  notes: import_zod.z.string().trim().max(500).nullable().optional(),
  movementDate: import_zod.z.string().min(8).max(30).optional()
});
var DocumentKindEnum = import_zod.z.enum([
  "RENTAL_CONTRACT",
  "CONTRACT_AMENDMENT",
  "DEPARTURE_INSPECTION",
  "RETURN_INSPECTION",
  "DAMAGE_REPORT",
  "PAYMENT_RECEIPT",
  "DEPOSIT_RECEIPT",
  "DEPOSIT_SETTLEMENT",
  "INVOICE",
  "EXPENSE_RECEIPT",
  "MAINTENANCE_REPORT",
  "VEHICLE_HISTORY",
  "CUSTOMER_STATEMENT",
  "CASH_REGISTER_CLOSING",
  "FINANCIAL_SUMMARY",
  "CUSTOM_REPORT"
]);
var DocumentFormatEnum = import_zod.z.enum([
  "A4_PDF",
  "A4_LANDSCAPE_PDF",
  "THERMAL_80MM",
  "THERMAL_58MM"
]);
var ReportFilterSchema = import_zod.z.object({
  category: import_zod.z.enum(["FINANCIAL", "FLEET", "OPERATIONAL", "CUSTOM"]),
  reportCode: import_zod.z.string().trim().max(64).optional(),
  dateFrom: import_zod.z.string().max(32).optional(),
  dateTo: import_zod.z.string().max(32).optional(),
  customerId: import_zod.z.number().int().positive().nullable().optional(),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  documentKind: DocumentKindEnum.nullable().optional(),
  transactionType: import_zod.z.string().trim().max(64).nullable().optional(),
  userId: import_zod.z.number().int().positive().nullable().optional(),
  status: import_zod.z.string().trim().max(64).nullable().optional(),
  expenseCategory: import_zod.z.string().trim().max(64).nullable().optional(),
  includeSections: import_zod.z.array(import_zod.z.string().trim().max(64)).optional(),
  language: import_zod.z.enum(["fr", "ar"]).optional()
});
var GenerateDocumentSchema = import_zod.z.object({
  documentKind: DocumentKindEnum,
  format: DocumentFormatEnum.optional(),
  language: import_zod.z.enum(["fr", "ar"]).default("fr"),
  numeralSystem: import_zod.z.enum(["latin", "arabic"]).default("latin"),
  contractId: import_zod.z.number().int().positive().nullable().optional(),
  extensionId: import_zod.z.number().int().positive().nullable().optional(),
  paymentId: import_zod.z.number().int().positive().nullable().optional(),
  depositId: import_zod.z.number().int().positive().nullable().optional(),
  inspectionId: import_zod.z.number().int().positive().nullable().optional(),
  invoiceId: import_zod.z.number().int().positive().nullable().optional(),
  customerId: import_zod.z.number().int().positive().nullable().optional(),
  vehicleId: import_zod.z.number().int().positive().nullable().optional(),
  maintenanceRecordId: import_zod.z.number().int().positive().nullable().optional(),
  expenseId: import_zod.z.number().int().positive().nullable().optional(),
  cashSessionId: import_zod.z.number().int().positive().nullable().optional(),
  dateFrom: import_zod.z.string().max(32).nullable().optional(),
  dateTo: import_zod.z.string().max(32).nullable().optional(),
  reportFilter: ReportFilterSchema.nullable().optional(),
  notes: import_zod.z.string().trim().max(1e3).nullable().optional(),
  taxRatePercent: import_zod.z.number().min(0).max(100).optional()
});
var ListDocumentsSchema = import_zod.z.object({
  search: import_zod.z.string().trim().max(120).optional(),
  documentKind: DocumentKindEnum.optional(),
  format: DocumentFormatEnum.optional(),
  customerId: import_zod.z.number().int().positive().optional(),
  vehicleId: import_zod.z.number().int().positive().optional(),
  contractId: import_zod.z.number().int().positive().optional(),
  dateFrom: import_zod.z.string().max(32).optional(),
  dateTo: import_zod.z.string().max(32).optional(),
  isCopy: import_zod.z.boolean().optional(),
  limit: import_zod.z.number().int().min(1).max(500).optional()
});
var ReprintDocumentSchema = import_zod.z.object({
  sourceDocumentId: import_zod.z.number().int().positive(),
  format: DocumentFormatEnum.optional(),
  language: import_zod.z.enum(["fr", "ar"]).optional()
});
var PrintDocumentSchema = import_zod.z.object({
  documentId: import_zod.z.number().int().positive(),
  printerName: import_zod.z.string().trim().max(255).nullable().optional(),
  silent: import_zod.z.boolean().default(false),
  copies: import_zod.z.number().int().min(1).max(10).default(1)
});
var UploadAgencyLogoSchema = import_zod.z.object({
  originalFileName: import_zod.z.string().trim().min(1).max(200),
  mimeType: import_zod.z.enum(["image/png", "image/jpeg"]),
  base64Data: import_zod.z.string().min(4).max(4e6)
});
var UpdateDocumentTemplatesSchema = import_zod.z.object({
  defaultLanguage: import_zod.z.enum(["fr", "ar"]).optional(),
  defaultFormat: DocumentFormatEnum.optional(),
  thermalWidth: import_zod.z.enum(["80MM", "58MM"]).optional(),
  defaultPrinterA4: import_zod.z.string().max(255).optional(),
  defaultPrinterThermal: import_zod.z.string().max(255).optional(),
  showLogo: import_zod.z.boolean().optional(),
  showFiscalIds: import_zod.z.boolean().optional(),
  showSignatureBoxes: import_zod.z.boolean().optional(),
  invoiceFiscallyCompliant: import_zod.z.boolean().optional(),
  invoiceTaxRatePercent: import_zod.z.number().min(0).max(100).optional(),
  footerFr: import_zod.z.string().max(600).optional(),
  footerAr: import_zod.z.string().max(600).optional(),
  signatureAgencyFr: import_zod.z.string().max(200).optional(),
  signatureAgencyAr: import_zod.z.string().max(200).optional(),
  signatureCustomerFr: import_zod.z.string().max(200).optional(),
  signatureCustomerAr: import_zod.z.string().max(200).optional(),
  contractTermsFr: import_zod.z.string().max(3e3).optional(),
  contractTermsAr: import_zod.z.string().max(3e3).optional(),
  invoiceDisclaimerFr: import_zod.z.string().max(600).optional(),
  invoiceDisclaimerAr: import_zod.z.string().max(600).optional(),
  prefixes: import_zod.z.record(DocumentKindEnum, import_zod.z.string().trim().min(1).max(16)).optional()
});
var ExportReportSchema = import_zod.z.object({
  filter: ReportFilterSchema,
  exportFormat: import_zod.z.enum(["CSV", "XLSX", "PDF"]),
  pdfFormat: import_zod.z.enum(["A4_PDF", "A4_LANDSCAPE_PDF"]).optional(),
  language: import_zod.z.enum(["fr", "ar"]).default("fr"),
  numeralSystem: import_zod.z.enum(["latin", "arabic"]).default("latin")
});
var CreateBackupSchema = import_zod.z.object({
  backupType: import_zod.z.enum(["MANUAL", "AUTO"]).default("MANUAL"),
  encryptionMode: import_zod.z.enum(["VAULT_RECOVERY_KEY", "PASSPHRASE"]).default("VAULT_RECOVERY_KEY"),
  passphrase: import_zod.z.string().min(8).max(128).optional(),
  destinationPath: import_zod.z.string().trim().max(500).nullable().optional(),
  notes: import_zod.z.string().trim().max(500).nullable().optional()
});
var VerifyBackupSchema = import_zod.z.object({
  backupRecordId: import_zod.z.number().int().positive().optional(),
  filePath: import_zod.z.string().trim().max(500).optional(),
  base64Archive: import_zod.z.string().max(15e7).optional(),
  passphrase: import_zod.z.string().min(1).max(128).optional(),
  recoveryKey: import_zod.z.string().trim().min(10).max(200).optional()
});
var RestoreBackupSchema = import_zod.z.object({
  backupRecordId: import_zod.z.number().int().positive().optional(),
  filePath: import_zod.z.string().trim().max(500).optional(),
  base64Archive: import_zod.z.string().max(15e7).optional(),
  fileName: import_zod.z.string().trim().max(200).optional(),
  passphrase: import_zod.z.string().min(1).max(128).optional(),
  recoveryKey: import_zod.z.string().trim().min(10).max(200).optional(),
  adminPassword: import_zod.z.string().min(1).max(128)
});
var ExportBackupSchema = import_zod.z.object({
  backupRecordId: import_zod.z.number().int().positive(),
  destinationPath: import_zod.z.string().trim().min(3).max(500).optional()
});
var ImportBackupSchema = import_zod.z.object({
  sourcePath: import_zod.z.string().trim().max(500).optional(),
  fileName: import_zod.z.string().trim().max(200).optional(),
  base64Archive: import_zod.z.string().max(15e7).optional(),
  passphrase: import_zod.z.string().min(1).max(128).optional(),
  recoveryKey: import_zod.z.string().trim().min(10).max(200).optional()
});
var ShowRecoveryKeySchema = import_zod.z.object({
  adminPassword: import_zod.z.string().min(1).max(128)
});

// electron/database/services/alertService.ts
function addDaysToIsoDate(dateStr, days) {
  const base = /* @__PURE__ */ new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
function diffCalendarDays(fromDateStr, toDateStr) {
  const a = Date.parse(`${fromDateStr.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toDateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}
function docTypeLabelFr(docType) {
  switch (docType) {
    case "CARTE_GRISE":
      return "Carte grise";
    case "ASSURANCE":
      return "Assurance";
    case "VIGNETTE":
      return "Vignette";
    case "CONTROLE_TECHNIQUE":
      return "Contr\xF4le technique";
  }
}
function docTypeLabelAr(docType) {
  switch (docType) {
    case "CARTE_GRISE":
      return "\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0631\u0645\u0627\u062F\u064A\u0629";
    case "ASSURANCE":
      return "\u0627\u0644\u062A\u0623\u0645\u064A\u0646";
    case "VIGNETTE":
      return "\u0642\u0633\u064A\u0645\u0629 \u0627\u0644\u0633\u064A\u0627\u0631\u0627\u062A";
    case "CONTROLE_TECHNIQUE":
      return "\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u062A\u0642\u0646\u064A\u0629";
  }
}
function mapNotification(r) {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity,
    titleFr: r.title_fr,
    titleAr: r.title_ar,
    messageFr: r.message_fr,
    messageAr: r.message_ar,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    isRead: r.is_read === 1,
    isResolved: r.is_resolved === 1,
    dueDate: r.due_date ?? null,
    createdAt: r.created_at
  };
}
function upsertNotification(db, params) {
  const existing = db.prepare(
    "SELECT id, severity, is_resolved FROM notifications WHERE dedupe_key = ?"
  ).get(params.dedupeKey);
  if (existing) {
    const escalated = existing.severity !== "CRITICAL" && params.severity === "CRITICAL";
    db.prepare(
      `UPDATE notifications
       SET category = ?,
           severity = ?,
           title_fr = ?,
           title_ar = ?,
           message_fr = ?,
           message_ar = ?,
           entity_type = ?,
           entity_id = ?,
           due_date = ?,
           is_resolved = 0,
           is_read = CASE WHEN ? = 1 OR is_resolved = 1 THEN 0 ELSE is_read END
       WHERE id = ?`
    ).run(
      params.category,
      params.severity,
      params.titleFr,
      params.titleAr,
      params.messageFr,
      params.messageAr,
      params.entityType,
      params.entityId,
      params.dueDate,
      escalated ? 1 : 0,
      existing.id
    );
    return;
  }
  db.prepare(
    `INSERT INTO notifications (
      category, severity, title_fr, title_ar, message_fr, message_ar,
      entity_type, entity_id, dedupe_key, is_read, is_resolved, due_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(
    params.category,
    params.severity,
    params.titleFr,
    params.titleAr,
    params.messageFr,
    params.messageAr,
    params.entityType,
    params.entityId,
    params.dedupeKey,
    params.dueDate
  );
}
function getVehicleMaintenanceDueSummary(db, vehicleId, referenceDate) {
  const vehicle = db.prepare(
    "SELECT id, current_odometer_km, acquisition_date FROM vehicles WHERE id = ?"
  ).get(vehicleId);
  if (!vehicle) {
    throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
  }
  const today = (referenceDate || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10);
  const currentKm = Number(vehicle.current_odometer_km ?? 0);
  const types = db.prepare("SELECT * FROM maintenance_types WHERE is_active = 1 ORDER BY id ASC").all();
  const schedules = db.prepare("SELECT * FROM vehicle_maintenance_schedules WHERE vehicle_id = ?").all(vehicleId);
  const scheduleByType = /* @__PURE__ */ new Map();
  for (const s of schedules) scheduleByType.set(Number(s.maintenance_type_id), s);
  const lastCompletedStmt = db.prepare(
    `SELECT id, performed_date, odometer_km, next_due_date, next_due_odometer_km
     FROM maintenance_records
     WHERE vehicle_id = ? AND maintenance_type_id = ? AND status = 'COMPLETED'
     ORDER BY performed_date DESC, id DESC
     LIMIT 1`
  );
  const activePlannedStmt = db.prepare(
    `SELECT id, status, COALESCE(scheduled_start_date, performed_date) AS planned_date
     FROM maintenance_records
     WHERE vehicle_id = ? AND maintenance_type_id = ? AND status IN ('SCHEDULED', 'IN_PROGRESS')
     ORDER BY COALESCE(scheduled_start_date, performed_date) ASC, id DESC
     LIMIT 1`
  );
  const items = [];
  for (const mt of types) {
    const sched = scheduleByType.get(Number(mt.id)) ?? null;
    const isScheduleActive = sched ? sched.is_active === 1 : true;
    const kmInterval = sched ? sched.km_interval : mt.default_km_interval;
    const dayInterval = sched ? sched.day_interval : mt.default_day_interval;
    const kmWarningThreshold = Number(
      sched ? sched.km_warning_threshold : mt.km_warning_threshold ?? 1e3
    );
    const dayWarningThreshold = Number(
      sched ? sched.day_warning_threshold : mt.day_warning_threshold ?? 14
    );
    const lastCompleted = lastCompletedStmt.get(vehicleId, mt.id);
    const activePlanned = activePlannedStmt.get(vehicleId, mt.id);
    let nextDueOdometerKm = null;
    let nextDueDate = null;
    if (lastCompleted) {
      nextDueOdometerKm = lastCompleted.next_due_odometer_km != null ? Number(lastCompleted.next_due_odometer_km) : kmInterval != null ? Number(lastCompleted.odometer_km) + Number(kmInterval) : null;
      nextDueDate = lastCompleted.next_due_date ?? (dayInterval != null ? addDaysToIsoDate(lastCompleted.performed_date, Number(dayInterval)) : null);
    } else if (isScheduleActive) {
      if (kmInterval != null) {
        nextDueOdometerKm = Number(kmInterval);
      }
      if (dayInterval != null && vehicle.acquisition_date) {
        nextDueDate = addDaysToIsoDate(vehicle.acquisition_date, Number(dayInterval));
      }
    }
    const remainingKm = nextDueOdometerKm != null ? nextDueOdometerKm - currentKm : null;
    const remainingDays = nextDueDate != null ? diffCalendarDays(today, nextDueDate) : null;
    let alertState = "OK";
    if (isScheduleActive) {
      if (remainingKm != null && remainingKm < 0 || remainingDays != null && remainingDays < 0) {
        alertState = "OVERDUE";
      } else if (remainingKm != null && remainingKm <= 0 || remainingDays != null && remainingDays <= 0) {
        alertState = "DUE";
      } else if (remainingKm != null && remainingKm <= kmWarningThreshold || remainingDays != null && remainingDays <= dayWarningThreshold) {
        alertState = "APPROACHING";
      }
    }
    items.push({
      maintenanceTypeId: Number(mt.id),
      code: mt.code,
      nameFr: mt.name_fr,
      nameAr: mt.name_ar,
      scheduleId: sched ? Number(sched.id) : null,
      hasCustomSchedule: Boolean(sched),
      isScheduleActive,
      kmInterval: kmInterval != null ? Number(kmInterval) : null,
      dayInterval: dayInterval != null ? Number(dayInterval) : null,
      kmWarningThreshold,
      dayWarningThreshold,
      currentOdometerKm: currentKm,
      lastRecordId: lastCompleted ? Number(lastCompleted.id) : null,
      lastPerformedDate: lastCompleted ? String(lastCompleted.performed_date) : null,
      lastOdometerKm: lastCompleted ? Number(lastCompleted.odometer_km) : null,
      nextDueDate,
      nextDueOdometerKm,
      remainingKm,
      remainingDays,
      alertState,
      activePlannedRecordId: activePlanned ? Number(activePlanned.id) : null,
      activePlannedStatus: activePlanned ? String(activePlanned.status) : null,
      activePlannedDate: activePlanned ? String(activePlanned.planned_date) : null,
      scheduleNotes: sched?.notes ?? null
    });
  }
  return items;
}
var SYNC_MANAGED_CATEGORIES = [
  "MAINTENANCE_DUE",
  "MAINTENANCE_OVERDUE",
  "VEHICLE_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "MILEAGE_ANOMALY",
  "LOW_STOCK"
];
function syncOperationalAlerts(db, referenceDate) {
  const today = (referenceDate || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10);
  const activeKeys = /* @__PURE__ */ new Set();
  const vehicles = db.prepare(
    `SELECT id, brand, model, matricule, current_odometer_km
       FROM vehicles
       WHERE is_archived = 0
       ORDER BY id ASC`
  ).all();
  for (const v of vehicles) {
    const vehicleLabel = `${v.brand} ${v.model} (${v.matricule})`;
    const dueItems = getVehicleMaintenanceDueSummary(db, v.id, today);
    for (const item of dueItems) {
      if (!item.isScheduleActive || item.alertState === "OK") continue;
      const dedupeKey = `maint_due:v${v.id}:t${item.maintenanceTypeId}`;
      activeKeys.add(dedupeKey);
      const isCritical = item.alertState === "OVERDUE" || item.alertState === "DUE";
      const category = isCritical ? "MAINTENANCE_OVERDUE" : "MAINTENANCE_DUE";
      const severity = isCritical ? "CRITICAL" : "WARNING";
      const partsFr = [];
      const partsAr = [];
      if (item.remainingKm != null) {
        partsFr.push(
          item.remainingKm < 0 ? `d\xE9pass\xE9e de ${Math.abs(item.remainingKm).toLocaleString()} km` : item.remainingKm === 0 ? "\xE9ch\xE9ance atteinte (0 km restant)" : `${item.remainingKm.toLocaleString()} km restants`
        );
        partsAr.push(
          item.remainingKm < 0 ? `\u062A\u062C\u0627\u0648\u0632\u062A \u0628\u0640 ${Math.abs(item.remainingKm).toLocaleString()} \u0643\u0645` : item.remainingKm === 0 ? "\u0628\u0644\u063A\u062A \u0627\u0644\u0623\u062C\u0644 (0 \u0643\u0645 \u0645\u062A\u0628\u0642\u064A\u0629)" : `\u0645\u062A\u0628\u0642\u064A ${item.remainingKm.toLocaleString()} \u0643\u0645`
        );
      }
      if (item.remainingDays != null) {
        partsFr.push(
          item.remainingDays < 0 ? `retard ${Math.abs(item.remainingDays)} j` : item.remainingDays === 0 ? "\xE9ch\xE9ance aujourd'hui" : `${item.remainingDays} j restants`
        );
        partsAr.push(
          item.remainingDays < 0 ? `\u0645\u062A\u0623\u062E\u0631\u0629 \u0628\u0640 ${Math.abs(item.remainingDays)} \u064A\u0648\u0645` : item.remainingDays === 0 ? "\u062A\u0633\u062A\u062D\u0642 \u0627\u0644\u064A\u0648\u0645" : `\u0645\u062A\u0628\u0642\u064A ${item.remainingDays} \u064A\u0648\u0645`
        );
      }
      const titleFr = item.alertState === "OVERDUE" ? `Maintenance en retard : ${item.nameFr} \xB7 ${v.matricule}` : item.alertState === "DUE" ? `Maintenance due : ${item.nameFr} \xB7 ${v.matricule}` : `Maintenance proche : ${item.nameFr} \xB7 ${v.matricule}`;
      const titleAr = item.alertState === "OVERDUE" ? `\u0635\u064A\u0627\u0646\u0629 \u0645\u062A\u0623\u062E\u0631\u0629: ${item.nameAr} \xB7 ${v.matricule}` : item.alertState === "DUE" ? `\u0635\u064A\u0627\u0646\u0629 \u0645\u0633\u062A\u062D\u0642\u0629: ${item.nameAr} \xB7 ${v.matricule}` : `\u0635\u064A\u0627\u0646\u0629 \u0648\u0634\u064A\u0643\u0629: ${item.nameAr} \xB7 ${v.matricule}`;
      upsertNotification(db, {
        dedupeKey,
        category,
        severity,
        titleFr,
        titleAr,
        messageFr: `${vehicleLabel} \u2014 ${item.nameFr} (${partsFr.join(" \xB7 ")})`,
        messageAr: `${vehicleLabel} \u2014 ${item.nameAr} (${partsAr.join(" \xB7 ")})`,
        entityType: "vehicle",
        entityId: Number(v.id),
        dueDate: item.nextDueDate
      });
    }
    const docs = db.prepare("SELECT * FROM vehicle_documents WHERE vehicle_id = ?").all(v.id);
    for (const d of docs) {
      const remDays = diffCalendarDays(today, d.expiration_date);
      const threshold = Number(d.reminder_days ?? 30);
      if (remDays > threshold) continue;
      const dedupeKey = `veh_doc:v${v.id}:d${d.id}`;
      activeKeys.add(dedupeKey);
      const expired = remDays < 0;
      const severity = expired ? "CRITICAL" : "WARNING";
      const labelFr = docTypeLabelFr(d.doc_type);
      const labelAr = docTypeLabelAr(d.doc_type);
      upsertNotification(db, {
        dedupeKey,
        category: "VEHICLE_DOCUMENT",
        severity,
        titleFr: expired ? `${labelFr} expir\xE9(e) \xB7 ${v.matricule}` : `${labelFr} expire bient\xF4t \xB7 ${v.matricule}`,
        titleAr: expired ? `\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 ${labelAr} \xB7 ${v.matricule}` : `\u062A\u0646\u062A\u0647\u064A \u0635\u0644\u0627\u062D\u064A\u0629 ${labelAr} \u0642\u0631\u064A\u0628\u0627\u064B \xB7 ${v.matricule}`,
        messageFr: expired ? `${vehicleLabel} \u2014 ${labelFr} expir\xE9(e) depuis ${Math.abs(remDays)} jour(s) (${d.expiration_date}).` : `${vehicleLabel} \u2014 ${labelFr} expire dans ${remDays} jour(s) (${d.expiration_date}).`,
        messageAr: expired ? `${vehicleLabel} \u2014 ${labelAr} \u0645\u0646\u062A\u0647\u064A\u0629 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0645\u0646\u0630 ${Math.abs(remDays)} \u064A\u0648\u0645 (${d.expiration_date}).` : `${vehicleLabel} \u2014 ${labelAr} \u062A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644 ${remDays} \u064A\u0648\u0645 (${d.expiration_date}).`,
        entityType: "vehicle",
        entityId: Number(v.id),
        dueDate: d.expiration_date
      });
    }
    const mRecords = db.prepare(
      `SELECT id, performed_date, odometer_km, record_number
         FROM maintenance_records
         WHERE vehicle_id = ? AND status != 'CANCELLED'
         ORDER BY performed_date ASC, id ASC`
    ).all(v.id);
    let maxSeenKm = 0;
    for (const mr of mRecords) {
      const km = Number(mr.odometer_km);
      if (km < maxSeenKm) {
        const dedupeKey = `mileage_anomaly:m${mr.id}`;
        activeKeys.add(dedupeKey);
        upsertNotification(db, {
          dedupeKey,
          category: "MILEAGE_ANOMALY",
          severity: "WARNING",
          titleFr: `Anomalie kilom\xE9trique \xB7 ${v.matricule}`,
          titleAr: `\u062A\u0646\u0627\u0642\u0636 \u0641\u064A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0639\u062F\u0627\u062F \xB7 ${v.matricule}`,
          messageFr: `${vehicleLabel} \u2014 Intervention ${mr.record_number ?? `#${mr.id}`} (${mr.performed_date}) saisie \xE0 ${km.toLocaleString()} km alors qu'un relev\xE9 ant\xE9rieur indiquait ${maxSeenKm.toLocaleString()} km.`,
          messageAr: `${vehicleLabel} \u2014 \u062A\u062F\u062E\u0644 ${mr.record_number ?? `#${mr.id}`} (${mr.performed_date}) \u0645\u0633\u062C\u0644 \u0628\u0640 ${km.toLocaleString()} \u0643\u0645 \u0623\u0642\u0644 \u0645\u0646 \u0642\u0631\u0627\u0621\u0629 \u0633\u0627\u0628\u0642\u0629 (${maxSeenKm.toLocaleString()} \u0643\u0645).`,
          entityType: "vehicle",
          entityId: Number(v.id),
          dueDate: mr.performed_date.slice(0, 10)
        });
      } else {
        maxSeenKm = km;
      }
    }
  }
  const overdueRecords = db.prepare(
    `SELECT mr.id, mr.record_number, mr.vehicle_id, mr.status, mr.work_description,
              COALESCE(mr.scheduled_end_date, mr.scheduled_start_date, mr.performed_date) AS target_date,
              v.brand, v.model, v.matricule
       FROM maintenance_records mr
       JOIN vehicles v ON v.id = mr.vehicle_id
       WHERE v.is_archived = 0
         AND mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND substr(COALESCE(mr.scheduled_end_date, mr.scheduled_start_date, mr.performed_date), 1, 10) < ?`
  ).all(today);
  for (const rec of overdueRecords) {
    const dedupeKey = `maint_record_overdue:r${rec.id}`;
    activeKeys.add(dedupeKey);
    const vehicleLabel = `${rec.brand} ${rec.model} (${rec.matricule})`;
    const ref = rec.record_number || `MNT-${rec.id}`;
    const targetDay = String(rec.target_date).slice(0, 10);
    upsertNotification(db, {
      dedupeKey,
      category: "MAINTENANCE_OVERDUE",
      severity: "CRITICAL",
      titleFr: `Intervention non cl\xF4tur\xE9e (${ref}) \xB7 ${rec.matricule}`,
      titleAr: `\u0639\u0645\u0644\u064A\u0629 \u0635\u064A\u0627\u0646\u0629 \u0645\u062A\u0623\u062E\u0631\u0629 \u0639\u0646 \u0627\u0644\u0645\u0648\u0639\u062F (${ref}) \xB7 ${rec.matricule}`,
      messageFr: `${vehicleLabel} \u2014 ${rec.work_description} pr\xE9vue pour le ${targetDay}.`,
      messageAr: `${vehicleLabel} \u2014 ${rec.work_description} \u0645\u0628\u0631\u0645\u062C\u0629 \u0644\u064A\u0648\u0645 ${targetDay}.`,
      entityType: "maintenance_record",
      entityId: Number(rec.id),
      dueDate: targetDay
    });
  }
  const lowParts = db.prepare(
    `SELECT id, part_code, part_name, quantity_available, minimum_stock, unit_label
       FROM inventory_parts
       WHERE COALESCE(is_archived, 0) = 0 AND quantity_available <= minimum_stock
       ORDER BY id ASC`
  ).all();
  for (const part of lowParts) {
    const qty = Number(part.quantity_available);
    const min = Number(part.minimum_stock);
    const dedupeKey = `stock_low:p${part.id}`;
    activeKeys.add(dedupeKey);
    const outOfStock = qty <= 0;
    upsertNotification(db, {
      dedupeKey,
      category: "LOW_STOCK",
      severity: outOfStock ? "CRITICAL" : "WARNING",
      titleFr: outOfStock ? `Rupture de stock : ${part.part_code} \xB7 ${part.part_name}` : `Stock bas : ${part.part_code} \xB7 ${part.part_name}`,
      titleAr: outOfStock ? `\u0646\u0641\u0627\u062F \u0627\u0644\u0645\u062E\u0632\u0648\u0646: ${part.part_code} \xB7 ${part.part_name}` : `\u0645\u062E\u0632\u0648\u0646 \u0645\u0646\u062E\u0641\u0636: ${part.part_code} \xB7 ${part.part_name}`,
      messageFr: outOfStock ? `Stock \xE9puis\xE9 (0 ${part.unit_label || "PIECE"} disponible, seuil minimum ${min}). R\xE9approvisionnement requis.` : `Quantit\xE9 disponible ${qty} \u2264 seuil minimum ${min} (${part.unit_label || "PIECE"}).`,
      messageAr: outOfStock ? `\u0646\u0641\u062F\u062A \u0627\u0644\u0643\u0645\u064A\u0629 \u0645\u0646 \u0627\u0644\u0645\u062E\u0632\u0648\u0646 (0 ${part.unit_label || "PIECE"}\u060C \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 ${min}). \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0632\u0648\u062F.` : `\u0627\u0644\u0643\u0645\u064A\u0629 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629 ${qty} \u0623\u0642\u0644 \u0623\u0648 \u062A\u0633\u0627\u0648\u064A \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 ${min} (${part.unit_label || "PIECE"}).`,
      entityType: "inventory_part",
      entityId: Number(part.id),
      dueDate: today
    });
  }
  const customerDocs = db.prepare(
    `SELECT cd.id, cd.customer_id, cd.doc_category, cd.original_file_name,
              cd.expiration_date, cd.reminder_days, c.full_name, c.phone
       FROM customer_documents cd
       JOIN customers c ON c.id = cd.customer_id
       WHERE c.is_archived = 0
         AND COALESCE(cd.is_archived, 0) = 0
         AND cd.expiration_date IS NOT NULL
         AND trim(cd.expiration_date) != ''`
  ).all();
  const custDocLabelsFr = {
    CNI: "Carte nationale (CNI)",
    PASSPORT: "Passeport",
    DRIVING_LICENCE: "Permis de conduire",
    COMPANY_RC: "Registre de commerce",
    COMPANY_NIF: "NIF soci\xE9t\xE9",
    BON_COMMANDE: "Bon de commande",
    OTHER: "Document client"
  };
  const custDocLabelsAr = {
    CNI: "\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062A\u0639\u0631\u064A\u0641 \u0627\u0644\u0648\u0637\u0646\u064A\u0629",
    PASSPORT: "\u062C\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631",
    DRIVING_LICENCE: "\u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629",
    COMPANY_RC: "\u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u062A\u062C\u0627\u0631\u064A",
    COMPANY_NIF: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0628\u0627\u0626\u064A NIF",
    BON_COMMANDE: "\u0633\u0646\u062F \u0627\u0644\u0637\u0644\u0628",
    OTHER: "\u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0632\u0628\u0648\u0646"
  };
  for (const cd of customerDocs) {
    const remDays = diffCalendarDays(today, String(cd.expiration_date));
    const threshold = Number(cd.reminder_days ?? 30);
    if (remDays > threshold) continue;
    const dedupeKey = `cust_doc:c${cd.customer_id}:d${cd.id}`;
    activeKeys.add(dedupeKey);
    const expired = remDays < 0;
    const lblFr = custDocLabelsFr[cd.doc_category] ?? cd.doc_category;
    const lblAr = custDocLabelsAr[cd.doc_category] ?? cd.doc_category;
    upsertNotification(db, {
      dedupeKey,
      category: "CUSTOMER_DOCUMENT",
      severity: expired ? "CRITICAL" : "WARNING",
      titleFr: expired ? `${lblFr} expir\xE9(e) \xB7 ${cd.full_name}` : `${lblFr} expire bient\xF4t \xB7 ${cd.full_name}`,
      titleAr: expired ? `\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 ${lblAr} \xB7 ${cd.full_name}` : `\u062A\u0646\u062A\u0647\u064A \u0635\u0644\u0627\u062D\u064A\u0629 ${lblAr} \u0642\u0631\u064A\u0628\u0627\u064B \xB7 ${cd.full_name}`,
      messageFr: expired ? `${cd.full_name} (${cd.phone}) \u2014 ${lblFr} (${cd.original_file_name}) expir\xE9 depuis ${Math.abs(remDays)} jour(s) (${cd.expiration_date}).` : `${cd.full_name} (${cd.phone}) \u2014 ${lblFr} (${cd.original_file_name}) expire dans ${remDays} jour(s) (${cd.expiration_date}).`,
      messageAr: expired ? `${cd.full_name} (${cd.phone}) \u2014 ${lblAr} (${cd.original_file_name}) \u0645\u0646\u062A\u0647\u064A\u0629 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0645\u0646\u0630 ${Math.abs(remDays)} \u064A\u0648\u0645 (${cd.expiration_date}).` : `${cd.full_name} (${cd.phone}) \u2014 ${lblAr} (${cd.original_file_name}) \u062A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644 ${remDays} \u064A\u0648\u0645 (${cd.expiration_date}).`,
      entityType: "customer",
      entityId: Number(cd.customer_id),
      dueDate: String(cd.expiration_date).slice(0, 10)
    });
  }
  const expiringLicences = db.prepare(
    `SELECT id, full_name, phone, driving_licence_number, driving_licence_expiration_date
       FROM customers
       WHERE is_archived = 0
         AND driving_licence_expiration_date IS NOT NULL
         AND trim(driving_licence_expiration_date) != ''`
  ).all();
  for (const cust of expiringLicences) {
    const remDays = diffCalendarDays(today, String(cust.driving_licence_expiration_date));
    if (remDays > 30) continue;
    const dedupeKey = `cust_lic:c${cust.id}`;
    activeKeys.add(dedupeKey);
    const expired = remDays < 0;
    upsertNotification(db, {
      dedupeKey,
      category: "CUSTOMER_DOCUMENT",
      severity: expired ? "CRITICAL" : "WARNING",
      titleFr: expired ? `Permis de conduire expir\xE9 \xB7 ${cust.full_name}` : `Permis de conduire expire bient\xF4t \xB7 ${cust.full_name}`,
      titleAr: expired ? `\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629 \xB7 ${cust.full_name}` : `\u062A\u0646\u062A\u0647\u064A \u0635\u0644\u0627\u062D\u064A\u0629 \u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629 \u0642\u0631\u064A\u0628\u0627\u064B \xB7 ${cust.full_name}`,
      messageFr: expired ? `${cust.full_name} (${cust.phone}) \u2014 Permis ${cust.driving_licence_number ?? ""} expir\xE9 depuis ${Math.abs(remDays)} jour(s) (${cust.driving_licence_expiration_date}).` : `${cust.full_name} (${cust.phone}) \u2014 Permis ${cust.driving_licence_number ?? ""} expire dans ${remDays} jour(s) (${cust.driving_licence_expiration_date}).`,
      messageAr: expired ? `${cust.full_name} (${cust.phone}) \u2014 \u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629 ${cust.driving_licence_number ?? ""} \u0645\u0646\u062A\u0647\u064A\u0629 \u0645\u0646\u0630 ${Math.abs(remDays)} \u064A\u0648\u0645 (${cust.driving_licence_expiration_date}).` : `${cust.full_name} (${cust.phone}) \u2014 \u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629 ${cust.driving_licence_number ?? ""} \u062A\u0646\u062A\u0647\u064A \u062E\u0644\u0627\u0644 ${remDays} \u064A\u0648\u0645 (${cust.driving_licence_expiration_date}).`,
      entityType: "customer",
      entityId: Number(cust.id),
      dueDate: String(cust.driving_licence_expiration_date).slice(0, 10)
    });
  }
  const placeholders = SYNC_MANAGED_CATEGORIES.map(() => "?").join(", ");
  const existingOpen = db.prepare(
    `SELECT id, dedupe_key FROM notifications
       WHERE is_resolved = 0 AND category IN (${placeholders})`
  ).all(...SYNC_MANAGED_CATEGORIES);
  const resolveStmt = db.prepare("UPDATE notifications SET is_resolved = 1 WHERE id = ?");
  for (const row of existingOpen) {
    if (!row.dedupe_key || !activeKeys.has(row.dedupe_key)) {
      resolveStmt.run(row.id);
    }
  }
  return listOperationalAlerts(db, { includeResolved: false });
}
function listOperationalAlerts(db, filters) {
  const clauses = [];
  const params = [];
  if (!filters?.includeResolved) {
    clauses.push("is_resolved = 0");
  }
  if (filters?.category && filters.category !== "ALL") {
    clauses.push("category = ?");
    params.push(filters.category);
  }
  if (filters?.severity && filters.severity !== "ALL") {
    clauses.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters?.vehicleId) {
    clauses.push("entity_type = 'vehicle' AND entity_id = ?");
    params.push(filters.vehicleId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM notifications
       ${where}
       ORDER BY
         is_resolved ASC,
         CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END ASC,
         COALESCE(due_date, created_at) ASC,
         id DESC`
  ).all(...params);
  return rows.map(mapNotification);
}
function markAlertRead(db, alertId) {
  const existing = db.prepare("SELECT * FROM notifications WHERE id = ?").get(alertId);
  if (!existing) throw new AuthError("NOT_FOUND", "Alerte introuvable");
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(alertId);
  return mapNotification(db.prepare("SELECT * FROM notifications WHERE id = ?").get(alertId));
}
function resolveAlert(db, actor, alertId) {
  const existing = db.prepare("SELECT * FROM notifications WHERE id = ?").get(alertId);
  if (!existing) throw new AuthError("NOT_FOUND", "Alerte introuvable");
  db.prepare("UPDATE notifications SET is_resolved = 1, is_read = 1 WHERE id = ?").run(alertId);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "OPERATIONAL_ALERT_RESOLVED",
    entityType: "notifications",
    entityId: alertId,
    newValue: { dedupeKey: existing.dedupe_key, category: existing.category }
  });
  return mapNotification(db.prepare("SELECT * FROM notifications WHERE id = ?").get(alertId));
}

// electron/database/services/authService.ts
function mapRawUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    isActive: row.is_active === 1,
    preferredLanguage: row.preferred_language,
    preferredTheme: row.preferred_theme,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var MAX_FAILED_ATTEMPTS = 5;
var LOCK_DURATION_MS = 15 * 60 * 1e3;
function getAuthStatus(db, runtimeMode) {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM users").get();
  return {
    needsBootstrap: (row?.cnt ?? 0) === 0,
    runtimeMode
  };
}
function bootstrapFirstAdmin(db, sessionStore, runtimeMode, input) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT COUNT(*) AS cnt FROM users").get();
    if ((existing?.cnt ?? 0) > 0) {
      throw new AuthError("CONFLICT", "Le compte administrateur initial existe d\xE9j\xE0");
    }
    const adminRole = db.prepare("SELECT id FROM roles WHERE code = 'ADMIN'").get();
    if (!adminRole) {
      throw new Error("Missing ADMIN role seed");
    }
    const passwordHash = hashPassword(input.password);
    const insertRes = db.prepare(
      `INSERT INTO users (username, full_name, password_hash, role_id, is_active, preferred_language, preferred_theme)
         VALUES (?, ?, ?, ?, 1, 'fr', 'light')`
    ).run(input.username.trim(), input.fullName.trim(), passwordHash, adminRole.id);
    const userId = Number(insertRes.lastInsertRowid);
    const createdRow = db.prepare(
      `SELECT u.*, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
    ).get(userId);
    writeAuditLog(db, {
      userId,
      usernameSnapshot: createdRow.username,
      operation: "BOOTSTRAP_ADMIN",
      entityType: "users",
      entityId: userId,
      newValue: { username: createdRow.username, roleCode: "ADMIN", runtimeMode }
    });
    return createdRow;
  });
  const userRow = tx();
  const user = mapRawUser(userRow);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  const session2 = sessionStore.create(user, permissions);
  return {
    token: session2.token,
    user,
    permissions,
    expiresAt: session2.expiresAt,
    runtimeMode
  };
}
function loginUser(db, sessionStore, runtimeMode, username, password) {
  const row = db.prepare(
    `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.username = ?`
  ).get(username.trim());
  if (!row) {
    throw new AuthError("UNAUTHORIZED", "Identifiants invalides");
  }
  if (row.is_active !== 1) {
    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: "LOGIN_BLOCKED_INACTIVE",
      entityType: "users",
      entityId: row.id
    });
    throw new AuthError("FORBIDDEN", "Ce compte utilisateur est d\xE9sactiv\xE9");
  }
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new AuthError(
      "LOCKED",
      `Compte temporairement bloqu\xE9 suite \xE0 plusieurs tentatives \xE9chou\xE9es jusqu'\xE0 ${row.locked_until}`
    );
  }
  const valid = verifyPassword(password, row.password_hash);
  if (!valid) {
    const nextAttempts = row.failed_login_attempts + 1;
    const lockedUntil = nextAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS).toISOString() : null;
    db.prepare(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextAttempts, lockedUntil, row.id);
    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: "LOGIN_FAILED",
      entityType: "users",
      entityId: row.id,
      newValue: { failedAttempts: nextAttempts, lockedUntil }
    });
    throw new AuthError(
      lockedUntil ? "LOCKED" : "UNAUTHORIZED",
      lockedUntil ? "Trop de tentatives \xE9chou\xE9es. Compte bloqu\xE9 15 minutes." : "Identifiants invalides"
    );
  }
  db.prepare(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL,
         last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(row.id);
  const refreshed = db.prepare(
    `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
  ).get(row.id);
  writeAuditLog(db, {
    userId: refreshed.id,
    usernameSnapshot: refreshed.username,
    operation: "LOGIN_SUCCESS",
    entityType: "users",
    entityId: refreshed.id,
    newValue: { runtimeMode }
  });
  const user = mapRawUser(refreshed);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  const session2 = sessionStore.create(user, permissions);
  return {
    token: session2.token,
    user,
    permissions,
    expiresAt: session2.expiresAt,
    runtimeMode
  };
}
function lockSession(db, sessionStore, token) {
  const session2 = sessionStore.get(token);
  if (!session2) {
    throw new AuthError("UNAUTHORIZED", "Session invalide");
  }
  sessionStore.lock(token);
  writeAuditLog(db, {
    userId: session2.userId,
    usernameSnapshot: session2.username,
    operation: "SESSION_LOCKED",
    entityType: "users",
    entityId: session2.userId
  });
}
function unlockSession(db, sessionStore, token, password) {
  const session2 = sessionStore.get(token);
  if (!session2) {
    throw new AuthError("UNAUTHORIZED", "Session expir\xE9e \u2014 reconnexion requise");
  }
  const row = db.prepare(
    `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.is_active = 1`
  ).get(session2.userId);
  if (!row) {
    sessionStore.revoke(token);
    throw new AuthError("UNAUTHORIZED", "Compte utilisateur inactif ou introuvable");
  }
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    sessionStore.revoke(token);
    throw new AuthError(
      "LOCKED",
      `Compte temporairement bloqu\xE9 suite \xE0 plusieurs tentatives \xE9chou\xE9es jusqu'\xE0 ${row.locked_until}`
    );
  }
  if (!verifyPassword(password, row.password_hash)) {
    const nextAttempts = row.failed_login_attempts + 1;
    const lockedUntil = nextAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS).toISOString() : null;
    db.prepare(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextAttempts, lockedUntil, row.id);
    writeAuditLog(db, {
      userId: row.id,
      usernameSnapshot: row.username,
      operation: "UNLOCK_FAILED",
      entityType: "users",
      entityId: row.id,
      newValue: { failedAttempts: nextAttempts, lockedUntil }
    });
    if (lockedUntil) {
      sessionStore.revoke(token);
      throw new AuthError(
        "LOCKED",
        "Trop de tentatives \xE9chou\xE9es lors du d\xE9verrouillage. Session ferm\xE9e et compte bloqu\xE9 15 minutes."
      );
    }
    throw new AuthError("UNAUTHORIZED", "Mot de passe incorrect pour le d\xE9verrouillage");
  }
  db.prepare(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(row.id);
  const refreshed = db.prepare(
    `SELECT u.*, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
  ).get(row.id);
  const user = mapRawUser(refreshed);
  const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
  sessionStore.unlock(token, user, permissions);
  writeAuditLog(db, {
    userId: user.id,
    usernameSnapshot: user.username,
    operation: "SESSION_UNLOCKED",
    entityType: "users",
    entityId: user.id
  });
  return {
    token: session2.token,
    user,
    permissions,
    expiresAt: session2.expiresAt,
    runtimeMode: session2.runtimeMode
  };
}
function logoutUser(db, sessionStore, token) {
  const session2 = sessionStore.get(token);
  if (session2) {
    writeAuditLog(db, {
      userId: session2.userId,
      usernameSnapshot: session2.username,
      operation: "LOGOUT",
      entityType: "users",
      entityId: session2.userId
    });
    sessionStore.revoke(token);
  }
}
function changeOwnPassword(db, userId, currentPassword, newPassword) {
  const row = db.prepare(
    `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
  ).get(userId);
  if (!row) {
    throw new AuthError("NOT_FOUND", "Utilisateur introuvable");
  }
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new AuthError("UNAUTHORIZED", "Mot de passe actuel incorrect");
  }
  const newHash = hashPassword(newPassword);
  db.prepare(
    `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(newHash, userId);
  writeAuditLog(db, {
    userId: row.id,
    usernameSnapshot: row.username,
    operation: "PASSWORD_CHANGED",
    entityType: "users",
    entityId: row.id
  });
}

// electron/database/services/availabilityService.ts
function checkVehicleAvailability(db, params) {
  const {
    vehicleId,
    startDate,
    endDate,
    excludeContractId,
    excludeReservationId,
    excludeBlockId,
    excludeMaintenanceId,
    allowVehicleInMaintenance
  } = params;
  const conflicts = [];
  if (Date.parse(endDate) <= Date.parse(startDate)) {
    return {
      available: false,
      conflicts: [
        {
          sourceType: "VEHICLE_STATUS",
          sourceId: vehicleId,
          reference: "INVALID_DATES",
          startDate,
          endDate,
          details: "La date de fin doit \xEAtre post\xE9rieure \xE0 la date de d\xE9but"
        }
      ]
    };
  }
  const vehicle = db.prepare(
    "SELECT id, matricule, status, is_archived FROM vehicles WHERE id = ?"
  ).get(vehicleId);
  if (!vehicle || vehicle.is_archived === 1) {
    conflicts.push({
      sourceType: "VEHICLE_STATUS",
      sourceId: vehicleId,
      reference: vehicle?.matricule ?? String(vehicleId),
      startDate,
      endDate,
      details: "V\xE9hicule introuvable ou archiv\xE9"
    });
    return { available: false, conflicts };
  }
  if (vehicle.status === "MAINTENANCE" && !allowVehicleInMaintenance && excludeMaintenanceId == null && excludeBlockId == null) {
    conflicts.push({
      sourceType: "VEHICLE_STATUS",
      sourceId: vehicle.id,
      reference: vehicle.matricule,
      startDate,
      endDate,
      details: "V\xE9hicule actuellement en maintenance"
    });
  }
  const contractConflicts = db.prepare(
    `SELECT id, contract_number, status, start_date, expected_return_date
       FROM rental_contracts
       WHERE vehicle_id = ?
         AND id != ?
         AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED')
         AND start_date < ?
         AND expected_return_date > ?`
  ).all(vehicleId, excludeContractId ?? -1, endDate, startDate);
  for (const c of contractConflicts) {
    conflicts.push({
      sourceType: "CONTRACT",
      sourceId: c.id,
      reference: c.contract_number,
      startDate: c.start_date,
      endDate: c.expected_return_date,
      details: `Contrat ${c.contract_number} (${c.status})`
    });
  }
  const reservationConflicts = db.prepare(
    `SELECT id, reservation_number, status, start_date, expected_return_date
       FROM reservations
       WHERE vehicle_id = ?
         AND id != ?
         AND status IN ('PENDING', 'CONFIRMED')
         AND start_date < ?
         AND expected_return_date > ?`
  ).all(vehicleId, excludeReservationId ?? -1, endDate, startDate);
  for (const r of reservationConflicts) {
    conflicts.push({
      sourceType: "RESERVATION",
      sourceId: r.id,
      reference: r.reservation_number,
      startDate: r.start_date,
      endDate: r.expected_return_date,
      details: `R\xE9servation ${r.reservation_number} (${r.status})`
    });
  }
  const blockConflicts = db.prepare(
    `SELECT id, block_type, start_date, end_date, reason
       FROM vehicle_blocked_periods
       WHERE vehicle_id = ?
         AND id != ?
         AND is_active = 1
         AND start_date < ?
         AND end_date > ?`
  ).all(vehicleId, excludeBlockId ?? -1, endDate, startDate);
  for (const b of blockConflicts) {
    conflicts.push({
      sourceType: "BLOCKED_PERIOD",
      sourceId: b.id,
      reference: b.block_type,
      startDate: b.start_date,
      endDate: b.end_date,
      details: b.reason
    });
  }
  const maintConflicts = db.prepare(
    `SELECT mr.id,
              mr.record_number,
              mr.status,
              mr.work_description,
              COALESCE(mr.scheduled_start_date, mr.performed_date) AS start_at,
              COALESCE(mr.scheduled_end_date, '9999-12-31T23:59:59Z') AS end_at
       FROM maintenance_records mr
       WHERE mr.vehicle_id = ?
         AND mr.id != ?
         AND mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND (
           mr.blocked_period_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM vehicle_blocked_periods vbp
             WHERE vbp.id = mr.blocked_period_id AND vbp.is_active = 1
           )
         )
         AND (
           mr.scheduled_start_date IS NOT NULL
           OR mr.status = 'IN_PROGRESS'
         )
         AND COALESCE(mr.scheduled_start_date, mr.performed_date) < ?
         AND COALESCE(mr.scheduled_end_date, '9999-12-31T23:59:59Z') > ?`
  ).all(vehicleId, excludeMaintenanceId ?? -1, endDate, startDate);
  for (const m of maintConflicts) {
    conflicts.push({
      sourceType: "MAINTENANCE",
      sourceId: m.id,
      reference: m.record_number ?? `MNT-${m.id}`,
      startDate: m.start_at,
      endDate: m.end_at,
      details: `${m.record_number ?? `MNT-${m.id}`}: ${m.work_description}`
    });
  }
  return {
    available: conflicts.length === 0,
    conflicts
  };
}
function recomputeVehicleStatus(db, vehicleId, options) {
  const vehicle = db.prepare("SELECT status FROM vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return "AVAILABLE";
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const activeContract = db.prepare(
    `SELECT id FROM rental_contracts
       WHERE vehicle_id = ? AND status IN ('ACTIVE', 'EXTENDED')
       LIMIT 1`
  ).get(vehicleId);
  let nextStatus = "AVAILABLE";
  if (activeContract) {
    nextStatus = "RENTED";
  } else {
    const activeMaintenanceBlock = db.prepare(
      `SELECT id FROM vehicle_blocked_periods
         WHERE vehicle_id = ? AND is_active = 1 AND block_type = 'MAINTENANCE'
           AND start_date <= ? AND end_date >= ?
         LIMIT 1`
    ).get(vehicleId, nowIso, nowIso);
    const activeMaintenanceRecord = db.prepare(
      `SELECT id FROM maintenance_records
         WHERE vehicle_id = ? AND status = 'IN_PROGRESS'
           AND (scheduled_start_date IS NULL OR scheduled_start_date <= ?)
           AND (scheduled_end_date IS NULL OR scheduled_end_date >= ?)
         LIMIT 1`
    ).get(vehicleId, nowIso, nowIso);
    const preserveManualMaint = !options?.releaseManualMaintenance && vehicle.status === "MAINTENANCE";
    if (activeMaintenanceBlock || activeMaintenanceRecord || preserveManualMaint) {
      nextStatus = "MAINTENANCE";
    } else {
      const confirmedContract = db.prepare(
        `SELECT id FROM rental_contracts
           WHERE vehicle_id = ? AND status = 'CONFIRMED'
           LIMIT 1`
      ).get(vehicleId);
      const activeReservation = db.prepare(
        `SELECT id FROM reservations
           WHERE vehicle_id = ? AND status IN ('PENDING', 'CONFIRMED')
           LIMIT 1`
      ).get(vehicleId);
      if (confirmedContract || activeReservation) {
        nextStatus = "RESERVED";
      }
    }
  }
  db.prepare(
    `UPDATE vehicles SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(nextStatus, vehicleId);
  return nextStatus;
}
function getPlanningCalendar(db, rangeStart, rangeEnd) {
  const vehicles = db.prepare(
    `SELECT id, internal_code, matricule, brand, model, year, category, status, default_daily_rate_minor
       FROM vehicles
       WHERE is_archived = 0
       ORDER BY brand, model, matricule`
  ).all().map((v) => ({
    id: v.id,
    internalCode: v.internal_code,
    matricule: v.matricule,
    brand: v.brand,
    model: v.model,
    year: v.year,
    category: v.category,
    status: v.status,
    defaultDailyRateMinor: v.default_daily_rate_minor
  }));
  const contracts = db.prepare(
    `SELECT rc.id, rc.vehicle_id, rc.customer_id, c.full_name AS customer_name,
              rc.contract_number, rc.status, rc.start_date, rc.expected_return_date, rc.actual_return_date, rc.notes
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE rc.status IN ('DRAFT', 'CONFIRMED', 'ACTIVE', 'EXTENDED', 'COMPLETED')
         AND rc.start_date <= ?
         AND COALESCE(rc.actual_return_date, rc.expected_return_date) >= ?`
  ).all(rangeEnd, rangeStart);
  const reservations = db.prepare(
    `SELECT r.id, r.vehicle_id, r.customer_id, c.full_name AS customer_name,
              r.reservation_number, r.status, r.start_date, r.expected_return_date, r.notes
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('PENDING', 'CONFIRMED')
         AND r.start_date <= ?
         AND r.expected_return_date >= ?`
  ).all(rangeEnd, rangeStart);
  const blocks = db.prepare(
    `SELECT id, vehicle_id, block_type, start_date, end_date, reason
       FROM vehicle_blocked_periods
       WHERE is_active = 1
         AND start_date <= ?
         AND end_date >= ?`
  ).all(rangeEnd, rangeStart);
  const maintenances = db.prepare(
    `SELECT mr.id, mr.vehicle_id, mr.record_number, mr.status,
              COALESCE(mr.scheduled_start_date, mr.performed_date) AS start_date,
              COALESCE(mr.scheduled_end_date, mr.performed_date) AS end_date,
              mr.work_description
       FROM maintenance_records mr
       WHERE mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND (
           mr.blocked_period_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM vehicle_blocked_periods vbp
             WHERE vbp.id = mr.blocked_period_id AND vbp.is_active = 1
           )
         )
         AND COALESCE(mr.scheduled_start_date, mr.performed_date) <= ?
         AND COALESCE(mr.scheduled_end_date, mr.performed_date) >= ?`
  ).all(rangeEnd, rangeStart);
  const events = [
    ...contracts.map((c) => ({
      eventType: "CONTRACT",
      id: c.id,
      vehicleId: c.vehicle_id,
      customerId: c.customer_id,
      customerName: c.customer_name,
      reference: c.contract_number,
      status: c.status,
      startDate: c.start_date,
      endDate: c.expected_return_date,
      actualReturnDate: c.actual_return_date,
      notes: c.notes
    })),
    ...reservations.map((r) => ({
      eventType: "RESERVATION",
      id: r.id,
      vehicleId: r.vehicle_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      reference: r.reservation_number,
      status: r.status,
      startDate: r.start_date,
      endDate: r.expected_return_date,
      actualReturnDate: null,
      notes: r.notes
    })),
    ...blocks.map((b) => ({
      eventType: "BLOCKED_PERIOD",
      id: b.id,
      vehicleId: b.vehicle_id,
      customerId: null,
      customerName: null,
      reference: b.block_type,
      status: b.block_type,
      startDate: b.start_date,
      endDate: b.end_date,
      actualReturnDate: null,
      notes: b.reason
    })),
    ...maintenances.map((m) => ({
      eventType: "MAINTENANCE",
      id: m.id,
      vehicleId: m.vehicle_id,
      customerId: null,
      customerName: null,
      reference: m.record_number || `MNT-${m.id}`,
      status: m.status,
      startDate: m.start_date,
      endDate: m.end_date,
      actualReturnDate: null,
      notes: m.work_description
    }))
  ];
  return { vehicles, events };
}

// electron/database/services/cashRegisterService.ts
function getTodayAlgiersDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(/* @__PURE__ */ new Date());
}
function mapCashSession(row) {
  return {
    id: row.id,
    sessionDate: row.session_date,
    status: row.status,
    openingBalanceMinor: Number(row.opening_balance_minor ?? 0),
    cashReceivedMinor: Number(row.cash_received_minor ?? 0),
    cashRefundedMinor: Number(row.cash_refunded_minor ?? 0),
    cashExpensesMinor: Number(row.cash_expenses_minor ?? 0),
    cashAdjustmentsMinor: Number(row.cash_adjustments_minor ?? 0),
    expectedClosingMinor: Number(row.expected_closing_minor ?? 0),
    actualClosingMinor: row.actual_closing_minor != null ? Number(row.actual_closing_minor) : null,
    discrepancyMinor: row.discrepancy_minor != null ? Number(row.discrepancy_minor) : null,
    openingNotes: row.opening_notes ?? null,
    discrepancyNotes: row.discrepancy_notes ?? null,
    openedByUserId: row.opened_by_user_id,
    closedByUserId: row.closed_by_user_id ?? null,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? null,
    openedByUsername: row.opened_by_username,
    closedByUsername: row.closed_by_username ?? null
  };
}
function mapCashMovement(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    movementType: row.movement_type,
    amountMinor: Number(row.amount_minor ?? 0),
    paymentId: row.payment_id ?? null,
    depositMovementId: row.deposit_movement_id ?? null,
    expenseId: row.expense_id ?? null,
    description: row.description ?? null,
    recordedByUserId: row.recorded_by_user_id,
    createdAt: row.created_at,
    recordedByUsername: row.recorded_by_username,
    referenceCode: row.reference_code ?? null
  };
}
function getCashSessionMovements(db, sessionId) {
  const rows = db.prepare(
    `SELECT m.*,
              u.username AS recorded_by_username,
              COALESCE(cp.receipt_number, e.expense_number, rc.contract_number) AS reference_code
       FROM cash_register_movements m
       JOIN users u ON u.id = m.recorded_by_user_id
       LEFT JOIN contract_payments cp ON cp.id = m.payment_id
       LEFT JOIN expenses e ON e.id = m.expense_id
       LEFT JOIN deposit_movements dm ON dm.id = m.deposit_movement_id
       LEFT JOIN deposits d ON d.id = dm.deposit_id
       LEFT JOIN rental_contracts rc ON rc.id = d.contract_id
       WHERE m.session_id = ?
       ORDER BY m.id DESC`
  ).all(sessionId);
  return rows.map(mapCashMovement);
}
function getCurrentCashSession(db) {
  const openRow = db.prepare(
    `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       WHERE s.status = 'OPEN'
       ORDER BY s.id DESC
       LIMIT 1`
  ).get();
  const lastClosed = db.prepare(
    `SELECT actual_closing_minor, expected_closing_minor, session_date
       FROM cash_register_sessions
       WHERE status = 'CLOSED'
       ORDER BY session_date DESC, id DESC
       LIMIT 1`
  ).get();
  const suggestedOpeningBalanceMinor = lastClosed != null ? Number(lastClosed.actual_closing_minor ?? lastClosed.expected_closing_minor ?? 0) : 0;
  if (!openRow) {
    return {
      session: null,
      movements: [],
      suggestedOpeningBalanceMinor,
      lastClosedDate: lastClosed?.session_date ?? null
    };
  }
  return {
    session: mapCashSession(openRow),
    movements: getCashSessionMovements(db, openRow.id),
    suggestedOpeningBalanceMinor,
    lastClosedDate: lastClosed?.session_date ?? null
  };
}
function listCashSessions(db, limit = 90) {
  const rows = db.prepare(
    `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       ORDER BY s.session_date DESC, s.id DESC
       LIMIT ?`
  ).all(Math.max(1, Math.min(limit, 365)));
  return rows.map(mapCashSession);
}
function getCashSessionDetail(db, sessionId) {
  const row = db.prepare(
    `SELECT s.*, uo.username AS opened_by_username, uc.username AS closed_by_username
       FROM cash_register_sessions s
       JOIN users uo ON uo.id = s.opened_by_user_id
       LEFT JOIN users uc ON uc.id = s.closed_by_user_id
       WHERE s.id = ?`
  ).get(sessionId);
  if (!row) throw new AuthError("NOT_FOUND", "Session de caisse introuvable");
  return {
    session: mapCashSession(row),
    movements: getCashSessionMovements(db, sessionId)
  };
}
function openCashSession(db, actor, input) {
  const tx = db.transaction(() => {
    const existingOpen = db.prepare(
      "SELECT id, session_date FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1"
    ).get();
    if (existingOpen) {
      throw new AuthError(
        "CONFLICT",
        `Une session de caisse est d\xE9j\xE0 ouverte (${existingOpen.session_date}). Cl\xF4turez-la avant d\u2019en ouvrir une nouvelle.`
      );
    }
    const sessionDate = input.sessionDate ?? getTodayAlgiersDate();
    const existingDate = db.prepare(
      "SELECT id, status FROM cash_register_sessions WHERE session_date = ?"
    ).get(sessionDate);
    if (existingDate) {
      throw new AuthError(
        "CONFLICT",
        `Une session de caisse existe d\xE9j\xE0 pour la date ${sessionDate} (${existingDate.status}).`
      );
    }
    const res = db.prepare(
      `INSERT INTO cash_register_sessions (
          session_date, status, opening_balance_minor, cash_received_minor,
          cash_refunded_minor, cash_expenses_minor, cash_adjustments_minor,
          expected_closing_minor, opening_notes, opened_by_user_id
        ) VALUES (?, 'OPEN', ?, 0, 0, 0, 0, ?, ?, ?)`
    ).run(sessionDate, input.openingBalanceMinor, input.openingBalanceMinor, input.openingNotes ?? null, actor.id);
    const sessionId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CASH_SESSION_OPENED",
      entityType: "cash_register_sessions",
      entityId: sessionId,
      newValue: { sessionDate, openingBalanceMinor: input.openingBalanceMinor },
      reason: input.openingNotes ?? null
    });
    return getCashSessionDetail(db, sessionId);
  });
  return tx();
}
function closeCashSession(db, actor, input) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM cash_register_sessions WHERE id = ?").get(input.sessionId);
    if (!row) throw new AuthError("NOT_FOUND", "Session de caisse introuvable");
    if (row.status === "CLOSED") {
      throw new AuthError("CONFLICT", "Cette session de caisse est d\xE9j\xE0 cl\xF4tur\xE9e et verrouill\xE9e");
    }
    const expectedClosing = Number(row.opening_balance_minor) + Number(row.cash_received_minor) - Number(row.cash_refunded_minor) - Number(row.cash_expenses_minor) + Number(row.cash_adjustments_minor ?? 0);
    const discrepancyMinor = input.actualClosingMinor - expectedClosing;
    db.prepare(
      `UPDATE cash_register_sessions
       SET status = 'CLOSED',
           expected_closing_minor = ?,
           actual_closing_minor = ?,
           discrepancy_minor = ?,
           discrepancy_notes = ?,
           closed_by_user_id = ?,
           closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      expectedClosing,
      input.actualClosingMinor,
      discrepancyMinor,
      input.discrepancyNotes ?? null,
      actor.id,
      input.sessionId
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CASH_SESSION_CLOSED",
      entityType: "cash_register_sessions",
      entityId: input.sessionId,
      newValue: {
        expectedClosingMinor: expectedClosing,
        actualClosingMinor: input.actualClosingMinor,
        discrepancyMinor
      },
      reason: input.discrepancyNotes ?? null
    });
    return getCashSessionDetail(db, input.sessionId);
  });
  return tx();
}
function recordCashAdjustment(db, actor, input) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM cash_register_sessions WHERE id = ?").get(input.sessionId);
    if (!row) throw new AuthError("NOT_FOUND", "Session de caisse introuvable");
    if (row.status === "CLOSED") {
      throw new AuthError(
        "CONFLICT",
        "Impossible de modifier une session de caisse cl\xF4tur\xE9e \u2014 les sessions ferm\xE9es sont immuables"
      );
    }
    const nextExpected = Number(row.expected_closing_minor) + input.amountDeltaMinor;
    if (nextExpected < 0) {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Ajustement refus\xE9 : le solde attendu de caisse ne peut pas devenir n\xE9gatif"
      );
    }
    const nextAdjustments = Number(row.cash_adjustments_minor ?? 0) + input.amountDeltaMinor;
    const movRes = db.prepare(
      `INSERT INTO cash_register_movements (
          session_id, movement_type, amount_minor, description, recorded_by_user_id
        ) VALUES (?, 'ADJUSTMENT', ?, ?, ?)`
    ).run(input.sessionId, input.amountDeltaMinor, input.reason.trim(), actor.id);
    db.prepare(
      `UPDATE cash_register_sessions
       SET cash_adjustments_minor = ?, expected_closing_minor = ?
       WHERE id = ?`
    ).run(nextAdjustments, nextExpected, input.sessionId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CASH_ADJUSTMENT_RECORDED",
      entityType: "cash_register_movements",
      entityId: Number(movRes.lastInsertRowid),
      newValue: {
        sessionId: input.sessionId,
        amountDeltaMinor: input.amountDeltaMinor,
        expectedClosingMinor: nextExpected
      },
      reason: input.reason.trim()
    });
    return getCashSessionDetail(db, input.sessionId);
  });
  return tx();
}
function appendCashMovementIfOpenSession(db, params) {
  if (params.paymentMethod !== "CASH" || params.currency !== "DZD" || params.amountMinor <= 0) {
    return null;
  }
  const openSession = db.prepare("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").get();
  if (!openSession) {
    return null;
  }
  let nextReceived = Number(openSession.cash_received_minor);
  let nextRefunded = Number(openSession.cash_refunded_minor);
  let nextExpenses = Number(openSession.cash_expenses_minor);
  const adjustments = Number(openSession.cash_adjustments_minor ?? 0);
  if (params.movementType === "PAYMENT_INFLOW" || params.movementType === "DEPOSIT_INFLOW") {
    nextReceived += params.amountMinor;
  } else if (params.movementType === "PAYMENT_REFUND" || params.movementType === "DEPOSIT_REFUND") {
    nextRefunded += params.amountMinor;
  } else if (params.movementType === "EXPENSE") {
    nextExpenses += params.amountMinor;
  }
  const nextExpected = Number(openSession.opening_balance_minor) + nextReceived - nextRefunded - nextExpenses + adjustments;
  if (nextExpected < 0) {
    throw new AuthError(
      "VALIDATION_ERROR",
      "Solde de caisse insuffisant pour cette sortie en esp\xE8ces (le solde de caisse ne peut pas \xEAtre n\xE9gatif)"
    );
  }
  const movRes = db.prepare(
    `INSERT INTO cash_register_movements (
        session_id, movement_type, amount_minor, payment_id, deposit_movement_id, expense_id, description, recorded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    openSession.id,
    params.movementType,
    params.amountMinor,
    params.paymentId ?? null,
    params.depositMovementId ?? null,
    params.expenseId ?? null,
    params.description,
    params.actorId
  );
  db.prepare(
    `UPDATE cash_register_sessions
     SET cash_received_minor = ?,
         cash_refunded_minor = ?,
         cash_expenses_minor = ?,
         expected_closing_minor = ?
     WHERE id = ?`
  ).run(nextReceived, nextRefunded, nextExpenses, nextExpected, openSession.id);
  return Number(movRes.lastInsertRowid);
}

// electron/database/services/customerService.ts
var import_node_crypto5 = __toESM(require("node:crypto"), 1);
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);

// electron/security/fileValidation.ts
var import_node_path6 = __toESM(require("node:path"), 1);
var MAX_UPLOAD_BYTES_DEFAULT = 8 * 1024 * 1024;
function sanitizeUploadedFileName(rawName, fallback = "document") {
  const base = import_node_path6.default.basename(String(rawName || "").replace(/\\/g, "/")).trim();
  const cleaned = base.replace(/[\u0000-\u001f<>:"/|?*]/g, "_").replace(/\.{2,}/g, ".").slice(0, 180);
  return cleaned || fallback;
}
function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255;
}
function isPng(buf) {
  return buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71 && buf[4] === 13 && buf[5] === 10 && buf[6] === 26 && buf[7] === 10;
}
function isWebp(buf) {
  return buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
}
function isPdf(buf) {
  if (buf.length < 5) return false;
  const headerWindow = buf.subarray(0, Math.min(buf.length, 64)).toString("latin1");
  return headerWindow.includes("%PDF-");
}
function looksDangerousExecutableOrScript(buf) {
  if (buf.length >= 2 && buf[0] === 77 && buf[1] === 90) return true;
  if (buf.length >= 4 && buf[0] === 127 && buf[1] === 69 && buf[2] === 76 && buf[3] === 70) return true;
  if (buf.length >= 4 && buf[0] === 80 && buf[1] === 75 && buf[2] === 3 && buf[3] === 4) return true;
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<script") || head.startsWith("<?xml")) {
    return true;
  }
  return false;
}
function validateAndDecodeUpload(input) {
  const allowed = input.allowedMimes ?? [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
  ];
  if (!allowed.includes(input.mimeType)) {
    throw new AuthError("VALIDATION_ERROR", `Type de fichier non autoris\xE9 (${input.mimeType})`);
  }
  const declaredMime = input.mimeType;
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES_DEFAULT;
  const cleanB64 = String(input.base64Data || "").replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!cleanB64) {
    throw new AuthError("VALIDATION_ERROR", "Le contenu du fichier est vide");
  }
  const bytes = Buffer.from(cleanB64, "base64");
  if (bytes.length === 0) {
    throw new AuthError("VALIDATION_ERROR", "Le fichier d\xE9cod\xE9 est vide");
  }
  if (bytes.length > maxBytes) {
    throw new AuthError(
      "VALIDATION_ERROR",
      `Fichier trop volumineux (${(bytes.length / (1024 * 1024)).toFixed(2)} Mo, maximum ${(maxBytes / (1024 * 1024)).toFixed(1)} Mo)`
    );
  }
  if (looksDangerousExecutableOrScript(bytes)) {
    throw new AuthError(
      "VALIDATION_ERROR",
      "Contenu rejet\xE9 par contr\xF4le de s\xE9curit\xE9 : signature ex\xE9cutable, archive ou script d\xE9tect\xE9e"
    );
  }
  const magicValid = declaredMime === "image/jpeg" && isJpeg(bytes) || declaredMime === "image/png" && isPng(bytes) || declaredMime === "image/webp" && isWebp(bytes) || declaredMime === "application/pdf" && isPdf(bytes);
  if (!magicValid) {
    throw new AuthError(
      "VALIDATION_ERROR",
      `Signature binaire invalide : le contenu r\xE9el du fichier ne correspond pas au type ${declaredMime}`
    );
  }
  return {
    bytes,
    safeFileName: sanitizeUploadedFileName(input.originalFileName),
    mimeType: declaredMime
  };
}

// electron/database/services/customerFinanceService.ts
function generateAdjustmentCode(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM customer_financial_adjustments").get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return `ADJ-${year}-${String(seq).padStart(5, "0")}`;
}
function computeCustomerFinancialMetrics(db, customerId) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const contracts = db.prepare(
    `SELECT rc.id, rc.status, rc.expected_return_date, rc.total_contract_amount_minor,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor,
              COALESCE((SELECT SUM(CASE WHEN cfa.adjustment_type = 'DEBIT_CHARGE' THEN cfa.amount_minor
                                        WHEN cfa.adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -cfa.amount_minor
                                        ELSE 0 END)
                        FROM customer_financial_adjustments cfa WHERE cfa.contract_id = rc.id), 0) AS contract_adj_net_minor
       FROM rental_contracts rc
       WHERE rc.customer_id = ?`
  ).all(customerId);
  const nonCancelled = contracts.filter((c) => c.status !== "CANCELLED");
  const activeContractsCount = contracts.filter(
    (c) => ["CONFIRMED", "ACTIVE", "EXTENDED"].includes(c.status)
  ).length;
  const contractChargesMinor = nonCancelled.reduce(
    (s, c) => s + Number(c.total_contract_amount_minor ?? 0),
    0
  );
  const adjTotals = db.prepare(
    `SELECT
         COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor ELSE 0 END), 0) AS debit_minor,
         COALESCE(SUM(CASE WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN amount_minor ELSE 0 END), 0) AS credit_minor
       FROM customer_financial_adjustments
       WHERE customer_id = ?`
  ).get(customerId);
  const debitAdjustmentsMinor = Number(adjTotals?.debit_minor ?? 0);
  const creditAndWriteOffMinor = Number(adjTotals?.credit_minor ?? 0);
  const totalChargedMinor = Math.max(0, contractChargesMinor + debitAdjustmentsMinor - creditAndWriteOffMinor);
  const paymentSummary = db.prepare(
    `SELECT
         COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE 0 END), 0) AS inflows,
         COALESCE(SUM(CASE WHEN direction = 'REFUND' THEN amount_minor ELSE 0 END), 0) AS refunds
       FROM contract_payments
       WHERE customer_id = ?`
  ).get(customerId);
  const inflowsMinor = Number(paymentSummary?.inflows ?? 0);
  const refundsMinor = Number(paymentSummary?.refunds ?? 0);
  const netPaidMinor = inflowsMinor - refundsMinor;
  const outstandingBalanceMinor = Math.max(0, totalChargedMinor - netPaidMinor);
  const unallocatedAdj = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS net_unalloc
       FROM customer_financial_adjustments
       WHERE customer_id = ? AND contract_id IS NULL`
  ).get(customerId);
  let overdueContractsCount = 0;
  let overdueRawMinor = 0;
  for (const c of nonCancelled) {
    const cAdjustedTotal = Math.max(
      0,
      Number(c.total_contract_amount_minor ?? 0) + Number(c.contract_adj_net_minor ?? 0)
    );
    const cRemaining = Math.max(0, cAdjustedTotal - Number(c.paid_net_minor ?? 0));
    const isOverdue = cRemaining > 0 && (c.status === "COMPLETED" || String(c.expected_return_date) < nowIso);
    if (isOverdue) {
      overdueContractsCount += 1;
      overdueRawMinor += cRemaining;
    }
  }
  const unallocNet = Number(unallocatedAdj?.net_unalloc ?? 0);
  const overdueDebtMinor = Math.min(
    outstandingBalanceMinor,
    Math.max(0, overdueRawMinor + (unallocNet < 0 ? unallocNet : 0))
  );
  const depositSummary = db.prepare(
    `SELECT COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS held_minor
       FROM deposits
       WHERE customer_id = ?`
  ).get(customerId);
  return {
    totalRentals: contracts.length,
    activeContractsCount,
    overdueContractsCount,
    contractChargesMinor,
    debitAdjustmentsMinor,
    creditAndWriteOffMinor,
    totalChargedMinor,
    inflowsMinor,
    refundsMinor,
    netPaidMinor,
    outstandingBalanceMinor,
    overdueDebtMinor,
    heldDepositsMinor: Number(depositSummary?.held_minor ?? 0)
  };
}
function listCustomerFinancialAccounts(db, filters) {
  const clauses = ["c.is_archived = 0"];
  const params = [];
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push("(c.full_name LIKE ? OR c.phone LIKE ? OR COALESCE(cc.company_name, '') LIKE ?)");
    params.push(q, q, q);
  }
  const rows = db.prepare(
    `SELECT c.id, c.customer_type, c.full_name, c.phone, c.risk_status, cc.company_name
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.full_name ASC`
  ).all(...params);
  const accounts = rows.map((r) => {
    const metrics = computeCustomerFinancialMetrics(db, r.id);
    return {
      customerId: r.id,
      customerType: r.customer_type,
      fullName: r.full_name,
      companyName: r.company_name ?? null,
      phone: r.phone,
      riskStatus: r.risk_status,
      ...metrics
    };
  });
  return accounts.filter((a) => !filters?.onlyWithBalance ? true : a.outstandingBalanceMinor > 0).filter((a) => !filters?.onlyOverdue ? true : a.overdueDebtMinor > 0).sort((a, b) => b.overdueDebtMinor - a.overdueDebtMinor || b.outstandingBalanceMinor - a.outstandingBalanceMinor);
}
function getCustomerFinancialLedger(db, customerId) {
  const customer = db.prepare(
    `SELECT c.*, cc.company_name
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       WHERE c.id = ?`
  ).get(customerId);
  if (!customer) throw new AuthError("NOT_FOUND", "Client introuvable");
  const metrics = computeCustomerFinancialMetrics(db, customerId);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const contracts = db.prepare(
    `SELECT rc.*,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor,
              COALESCE((SELECT SUM(CASE WHEN cfa.adjustment_type = 'DEBIT_CHARGE' THEN cfa.amount_minor
                                        WHEN cfa.adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -cfa.amount_minor
                                        ELSE 0 END)
                        FROM customer_financial_adjustments cfa WHERE cfa.contract_id = rc.id), 0) AS adj_net_minor
       FROM rental_contracts rc
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.customer_id = ?
       ORDER BY rc.start_date DESC`
  ).all(customerId).map((c) => {
    const effectiveTotal = Math.max(0, Number(c.total_contract_amount_minor) + Number(c.adj_net_minor ?? 0));
    const paidNetMinor = Number(c.paid_net_minor ?? 0);
    const outstandingMinor = c.status === "CANCELLED" ? 0 : Math.max(0, effectiveTotal - paidNetMinor);
    const isOverdue = c.status !== "CANCELLED" && outstandingMinor > 0 && (c.status === "COMPLETED" || String(c.expected_return_date) < nowIso);
    return {
      id: c.id,
      contractNumber: c.contract_number,
      vehicleLabel: c.vehicle_label,
      status: c.status,
      startDate: c.start_date,
      expectedReturnDate: c.expected_return_date,
      currency: c.currency,
      totalContractAmountMinor: Number(c.total_contract_amount_minor),
      adjustmentNetMinor: Number(c.adj_net_minor ?? 0),
      paidNetMinor,
      outstandingMinor,
      isOverdue
    };
  });
  const payments = db.prepare(
    `SELECT cp.*, rc.contract_number, u.username AS recorded_by_username
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       WHERE cp.customer_id = ?
       ORDER BY cp.payment_date DESC, cp.id DESC`
  ).all(customerId).map((p) => ({
    id: p.id,
    transactionCode: p.transaction_code,
    receiptNumber: p.receipt_number,
    contractId: p.contract_id,
    contractNumber: p.contract_number,
    direction: p.direction,
    method: p.method,
    paymentReference: p.payment_reference ?? null,
    amountMinor: Number(p.amount_minor),
    currency: p.currency,
    paymentDate: p.payment_date,
    description: p.description ?? null,
    recordedByUsername: p.recorded_by_username
  }));
  const adjustments = db.prepare(
    `SELECT cfa.*, rc.contract_number, u.username AS authorized_by_username
       FROM customer_financial_adjustments cfa
       LEFT JOIN rental_contracts rc ON rc.id = cfa.contract_id
       JOIN users u ON u.id = cfa.authorized_by_user_id
       WHERE cfa.customer_id = ?
       ORDER BY cfa.adjustment_date DESC, cfa.id DESC`
  ).all(customerId).map((a) => ({
    id: a.id,
    adjustmentCode: a.adjustment_code,
    customerId: a.customer_id,
    contractId: a.contract_id ?? null,
    contractNumber: a.contract_number ?? null,
    adjustmentType: a.adjustment_type,
    amountMinor: Number(a.amount_minor),
    currency: a.currency,
    adjustmentDate: a.adjustment_date,
    reason: a.reason,
    notes: a.notes ?? null,
    authorizedByUsername: a.authorized_by_username,
    createdAt: a.created_at
  }));
  const deposits = db.prepare(
    `SELECT d.*, rc.contract_number
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       WHERE d.customer_id = ?
       ORDER BY d.id DESC`
  ).all(customerId).map((d) => ({
    id: d.id,
    contractId: d.contract_id,
    contractNumber: d.contract_number,
    amountMinor: Number(d.amount_minor),
    deductedAmountMinor: Number(d.deducted_amount_minor),
    refundedAmountMinor: Number(d.refunded_amount_minor),
    remainingHeldMinor: Math.max(
      0,
      Number(d.amount_minor) - Number(d.deducted_amount_minor) - Number(d.refunded_amount_minor)
    ),
    currency: d.currency,
    status: d.status,
    receivedDate: d.received_date
  }));
  return {
    customer: {
      id: customer.id,
      customerType: customer.customer_type,
      fullName: customer.full_name,
      companyName: customer.company_name ?? null,
      phone: customer.phone,
      riskStatus: customer.risk_status
    },
    metrics,
    contracts,
    payments,
    adjustments,
    deposits
  };
}
function createCustomerAdjustment(db, actor, input) {
  const tx = db.transaction(() => {
    const cust = db.prepare("SELECT id FROM customers WHERE id = ?").get(input.customerId);
    if (!cust) throw new AuthError("NOT_FOUND", "Client introuvable");
    if (input.contractId) {
      const ctr = db.prepare("SELECT id, customer_id, status FROM rental_contracts WHERE id = ?").get(input.contractId);
      if (!ctr) throw new AuthError("NOT_FOUND", "Contrat introuvable");
      if (ctr.customer_id !== input.customerId) {
        throw new AuthError("VALIDATION_ERROR", "Ce contrat appartient \xE0 un autre client");
      }
      if (ctr.status === "CANCELLED") {
        throw new AuthError("CONFLICT", "Impossible d\u2019ajuster un contrat annul\xE9");
      }
    }
    const currentMetrics = computeCustomerFinancialMetrics(db, input.customerId);
    if ((input.adjustmentType === "CREDIT_NOTE" || input.adjustmentType === "WRITE_OFF") && input.amountMinor > currentMetrics.outstandingBalanceMinor) {
      throw new AuthError(
        "VALIDATION_ERROR",
        `L\u2019avoir / annulation de cr\xE9ance (${input.amountMinor / 100}) d\xE9passe le solde d\xFB par le client (${currentMetrics.outstandingBalanceMinor / 100})`
      );
    }
    const code = generateAdjustmentCode(db);
    const res = db.prepare(
      `INSERT INTO customer_financial_adjustments (
          adjustment_code, customer_id, contract_id, adjustment_type, amount_minor,
          currency, adjustment_date, reason, notes, authorized_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code,
      input.customerId,
      input.contractId ?? null,
      input.adjustmentType,
      input.amountMinor,
      input.currency,
      input.adjustmentDate,
      input.reason.trim(),
      input.notes?.trim() || null,
      actor.id
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_FINANCIAL_ADJUSTMENT_CREATED",
      entityType: "customer_financial_adjustments",
      entityId: Number(res.lastInsertRowid),
      newValue: { code, ...input },
      reason: input.reason.trim()
    });
    return getCustomerFinancialLedger(db, input.customerId);
  });
  return tx();
}

// electron/database/services/customerService.ts
function mapCustomer(row) {
  return {
    id: row.id,
    customerType: row.customer_type,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    secondaryPhone: row.secondary_phone,
    address: row.address,
    wilayaCode: row.wilaya_code,
    commune: row.commune,
    cniNumber: row.cni_number,
    passportNumber: row.passport_number,
    drivingLicenceNumber: row.driving_licence_number,
    drivingLicenceIssueDate: row.driving_licence_issue_date,
    drivingLicenceExpirationDate: row.driving_licence_expiration_date,
    riskStatus: row.risk_status,
    internalNotes: row.internal_notes,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function mapCompany(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    companyName: row.company_name,
    legalRepresentative: row.legal_representative,
    rcNumber: row.rc_number,
    nifNumber: row.nif_number,
    nisNumber: row.nis_number,
    artNumber: row.art_number,
    bonDeCommandeNumber: row.bon_de_commande_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function mapRiskRecord(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    riskLevel: row.risk_level,
    reason: row.reason,
    description: row.description,
    incidentDate: row.incident_date,
    evidenceFilePath: row.evidence_file_path,
    reportedByUserId: row.reported_by_user_id,
    isResolved: row.is_resolved === 1,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at
  };
}
function listCustomers(db, filters) {
  const clauses = [];
  const params = [];
  if (!filters?.includeArchived) {
    clauses.push("c.is_archived = 0");
  }
  if (filters?.customerType && filters.customerType !== "ALL") {
    clauses.push("c.customer_type = ?");
    params.push(filters.customerType);
  }
  if (filters?.riskStatus && filters.riskStatus !== "ALL") {
    clauses.push("c.risk_status = ?");
    params.push(filters.riskStatus);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(c.full_name LIKE ? OR c.phone LIKE ? OR COALESCE(c.cni_number, '') LIKE ? OR COALESCE(c.driving_licence_number, '') LIKE ? OR COALESCE(cc.company_name, '') LIKE ? OR COALESCE(cc.nif_number, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT c.*, cc.company_name, cc.rc_number, cc.nif_number,
              (SELECT COUNT(*) FROM rental_contracts rc WHERE rc.customer_id = c.id) AS total_rentals
       FROM customers c
       LEFT JOIN customer_companies cc ON cc.customer_id = c.id
       ${where}
       ORDER BY c.id DESC`
  ).all(...params);
  return rows.map((r) => ({
    ...mapCustomer(r),
    companyName: r.company_name ?? null,
    rcNumber: r.rc_number ?? null,
    nifNumber: r.nif_number ?? null,
    totalRentals: Number(r.total_rentals ?? 0)
  }));
}
function getCustomerProfile(db, customerId) {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  if (!row) throw new AuthError("NOT_FOUND", "Client introuvable");
  const companyRow = db.prepare("SELECT * FROM customer_companies WHERE customer_id = ?").get(customerId);
  const riskRecords = db.prepare(
    "SELECT * FROM customer_risk_records WHERE customer_id = ? ORDER BY incident_date DESC, id DESC"
  ).all(customerId).map(mapRiskRecord);
  const documents = db.prepare("SELECT * FROM customer_documents WHERE customer_id = ? ORDER BY is_archived ASC, id DESC").all(customerId).map(mapCustomerDocument);
  const rentalHistory = db.prepare(
    `SELECT rc.*, v.matricule, v.brand, v.model
       FROM rental_contracts rc
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.customer_id = ?
       ORDER BY rc.start_date DESC`
  ).all(customerId).map((c) => ({
    id: c.id,
    contractNumber: c.contract_number,
    vehicleId: c.vehicle_id,
    vehicleLabel: `${c.brand} ${c.model} (${c.matricule})`,
    status: c.status,
    startDate: c.start_date,
    expectedReturnDate: c.expected_return_date,
    actualReturnDate: c.actual_return_date,
    totalContractAmountMinor: c.total_contract_amount_minor,
    currency: c.currency
  }));
  const finMetrics = computeCustomerFinancialMetrics(db, customerId);
  const customRates = db.prepare("SELECT * FROM customer_custom_rates WHERE customer_id = ? AND is_active = 1").all(customerId).map((cr) => ({
    id: cr.id,
    customerId: cr.customer_id,
    vehicleCategory: cr.vehicle_category,
    vehicleId: cr.vehicle_id,
    dailyRateMinor: cr.daily_rate_minor,
    weeklyRateMinor: cr.weekly_rate_minor,
    monthlyRateMinor: cr.monthly_rate_minor,
    defaultDiscountPercent: cr.default_discount_percent,
    notes: cr.notes
  }));
  return {
    customer: mapCustomer(row),
    company: companyRow ? mapCompany(companyRow) : null,
    riskRecords,
    documents,
    rentalHistory,
    customRates,
    stats: {
      totalRentals: finMetrics.totalRentals,
      totalChargedMinor: finMetrics.totalChargedMinor,
      netPaidMinor: finMetrics.netPaidMinor,
      outstandingBalanceMinor: finMetrics.outstandingBalanceMinor,
      overdueDebtMinor: finMetrics.overdueDebtMinor,
      heldDepositsMinor: finMetrics.heldDepositsMinor
    }
  };
}
function createCustomer(db, actor, input) {
  const tx = db.transaction(() => {
    if (input.wilayaCode) {
      const w = db.prepare("SELECT code FROM wilayas WHERE code = ?").get(input.wilayaCode);
      if (!w) throw new AuthError("VALIDATION_ERROR", `Code wilaya inconnu: ${input.wilayaCode}`);
    }
    const res = db.prepare(
      `INSERT INTO customers (
          customer_type, full_name, date_of_birth, phone, secondary_phone,
          address, wilaya_code, commune, cni_number, passport_number,
          driving_licence_number, driving_licence_issue_date, driving_licence_expiration_date,
          risk_status, internal_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOW', ?)`
    ).run(
      input.customerType,
      input.fullName.trim(),
      input.dateOfBirth || null,
      input.phone.trim(),
      input.secondaryPhone || null,
      input.address || null,
      input.wilayaCode || null,
      input.commune || null,
      input.cniNumber || null,
      input.passportNumber || null,
      input.drivingLicenceNumber || null,
      input.drivingLicenceIssueDate || null,
      input.drivingLicenceExpirationDate || null,
      input.internalNotes || null
    );
    const customerId = Number(res.lastInsertRowid);
    if (input.customerType === "COMPANY" && input.company) {
      db.prepare(
        `INSERT INTO customer_companies (
          customer_id, company_name, legal_representative, rc_number,
          nif_number, nis_number, art_number, bon_de_commande_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        customerId,
        input.company.companyName.trim(),
        input.company.legalRepresentative.trim(),
        input.company.rcNumber || null,
        input.company.nifNumber || null,
        input.company.nisNumber || null,
        input.company.artNumber || null,
        input.company.bonDeCommandeNumber || null
      );
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_CREATED",
      entityType: "customers",
      entityId: customerId,
      newValue: { fullName: input.fullName, customerType: input.customerType, phone: input.phone }
    });
    return getCustomerProfile(db, customerId);
  });
  return tx();
}
function updateCustomer(db, actor, input) {
  const tx = db.transaction(() => {
    const currentRow = db.prepare("SELECT * FROM customers WHERE id = ?").get(input.id);
    if (!currentRow) throw new AuthError("NOT_FOUND", "Client introuvable");
    const prev = mapCustomer(currentRow);
    if (input.wilayaCode) {
      const w = db.prepare("SELECT code FROM wilayas WHERE code = ?").get(input.wilayaCode);
      if (!w) throw new AuthError("VALIDATION_ERROR", `Code wilaya inconnu: ${input.wilayaCode}`);
    }
    const nextType = input.customerType ?? prev.customerType;
    db.prepare(
      `UPDATE customers SET
        customer_type = ?, full_name = ?, date_of_birth = ?, phone = ?, secondary_phone = ?,
        address = ?, wilaya_code = ?, commune = ?, cni_number = ?, passport_number = ?,
        driving_licence_number = ?, driving_licence_issue_date = ?, driving_licence_expiration_date = ?,
        internal_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextType,
      input.fullName?.trim() ?? prev.fullName,
      input.dateOfBirth !== void 0 ? input.dateOfBirth || null : prev.dateOfBirth,
      input.phone?.trim() ?? prev.phone,
      input.secondaryPhone !== void 0 ? input.secondaryPhone || null : prev.secondaryPhone,
      input.address !== void 0 ? input.address || null : prev.address,
      input.wilayaCode !== void 0 ? input.wilayaCode || null : prev.wilayaCode,
      input.commune !== void 0 ? input.commune || null : prev.commune,
      input.cniNumber !== void 0 ? input.cniNumber || null : prev.cniNumber,
      input.passportNumber !== void 0 ? input.passportNumber || null : prev.passportNumber,
      input.drivingLicenceNumber !== void 0 ? input.drivingLicenceNumber || null : prev.drivingLicenceNumber,
      input.drivingLicenceIssueDate !== void 0 ? input.drivingLicenceIssueDate || null : prev.drivingLicenceIssueDate,
      input.drivingLicenceExpirationDate !== void 0 ? input.drivingLicenceExpirationDate || null : prev.drivingLicenceExpirationDate,
      input.internalNotes !== void 0 ? input.internalNotes || null : prev.internalNotes,
      input.id
    );
    if (nextType === "INDIVIDUAL") {
      db.prepare("DELETE FROM customer_companies WHERE customer_id = ?").run(input.id);
    } else if (nextType === "COMPANY" && input.company) {
      db.prepare(
        `INSERT INTO customer_companies (
          customer_id, company_name, legal_representative, rc_number,
          nif_number, nis_number, art_number, bon_de_commande_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET
          company_name = excluded.company_name,
          legal_representative = excluded.legal_representative,
          rc_number = excluded.rc_number,
          nif_number = excluded.nif_number,
          nis_number = excluded.nis_number,
          art_number = excluded.art_number,
          bon_de_commande_number = excluded.bon_de_commande_number,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      ).run(
        input.id,
        input.company.companyName.trim(),
        input.company.legalRepresentative.trim(),
        input.company.rcNumber || null,
        input.company.nifNumber || null,
        input.company.nisNumber || null,
        input.company.artNumber || null,
        input.company.bonDeCommandeNumber || null
      );
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_UPDATED",
      entityType: "customers",
      entityId: input.id,
      previousValue: prev
    });
    return getCustomerProfile(db, input.id);
  });
  return tx();
}
function archiveCustomer(db, actor, customerId) {
  const tx = db.transaction(() => {
    const active = db.prepare(
      "SELECT id FROM rental_contracts WHERE customer_id = ? AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED') LIMIT 1"
    ).get(customerId);
    if (active) {
      throw new AuthError("CONFLICT", "Impossible d\u2019archiver un client ayant un contrat actif");
    }
    db.prepare(
      "UPDATE customers SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(customerId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_ARCHIVED",
      entityType: "customers",
      entityId: customerId
    });
  });
  tx();
}
function addCustomerRiskRecord(db, actor, input) {
  const tx = db.transaction(() => {
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(input.customerId);
    if (!customer) throw new AuthError("NOT_FOUND", "Client introuvable");
    const res = db.prepare(
      `INSERT INTO customer_risk_records (
          customer_id, risk_level, reason, description, incident_date, reported_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.customerId,
      input.riskLevel,
      input.reason,
      input.description.trim(),
      input.incidentDate,
      actor.id
    );
    const severityRank = { LOW: 0, MEDIUM: 1, HIGH: 2, BLACKLISTED: 3 };
    const currentRank = severityRank[customer.risk_status] ?? 0;
    const nextRank = severityRank[input.riskLevel] ?? 0;
    if (nextRank >= currentRank) {
      db.prepare(
        "UPDATE customers SET risk_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(input.riskLevel, input.customerId);
    }
    const recordId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_RISK_ADDED",
      entityType: "customer_risk_records",
      entityId: recordId,
      newValue: input
    });
    return mapRiskRecord(
      db.prepare("SELECT * FROM customer_risk_records WHERE id = ?").get(recordId)
    );
  });
  return tx();
}
function resolveCustomerRiskRecord(db, actor, input) {
  const tx = db.transaction(() => {
    const rec = db.prepare("SELECT * FROM customer_risk_records WHERE id = ?").get(input.riskRecordId);
    if (!rec) throw new AuthError("NOT_FOUND", "Incident introuvable");
    db.prepare(
      `UPDATE customer_risk_records
       SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           resolution_notes = ?
       WHERE id = ?`
    ).run(actor.id, input.resolutionNotes.trim(), input.riskRecordId);
    if (input.nextCustomerRiskStatus) {
      db.prepare(
        "UPDATE customers SET risk_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(input.nextCustomerRiskStatus, rec.customer_id);
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CUSTOMER_RISK_RESOLVED",
      entityType: "customer_risk_records",
      entityId: input.riskRecordId,
      newValue: input
    });
    return mapRiskRecord(
      db.prepare("SELECT * FROM customer_risk_records WHERE id = ?").get(input.riskRecordId)
    );
  });
  return tx();
}
function mapCustomerDocument(d) {
  return {
    id: Number(d.id),
    customerId: Number(d.customer_id),
    docCategory: d.doc_category,
    encryptedFilePath: d.encrypted_file_path,
    originalFileName: d.original_file_name,
    mimeType: d.mime_type,
    documentNumber: d.document_number ?? null,
    issueDate: d.issue_date ?? null,
    expirationDate: d.expiration_date ?? null,
    reminderDays: Number(d.reminder_days ?? 30),
    notes: d.notes ?? null,
    isArchived: Number(d.is_archived ?? 0) === 1,
    replacesDocId: d.replaces_doc_id != null ? Number(d.replaces_doc_id) : null,
    replacedByDocId: d.replaced_by_doc_id != null ? Number(d.replaced_by_doc_id) : null,
    archivedAt: d.archived_at ?? null,
    archivedByUserId: d.archived_by_user_id != null ? Number(d.archived_by_user_id) : null,
    uploadedByUserId: Number(d.uploaded_by_user_id),
    createdAt: d.created_at
  };
}
function uploadCustomerDocument(db, actor, vaultRootDir, vaultKey, input) {
  const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(input.customerId);
  if (!customer) throw new AuthError("NOT_FOUND", "Client introuvable");
  let oldDoc = null;
  if (input.replaceDocId) {
    oldDoc = db.prepare("SELECT * FROM customer_documents WHERE id = ? AND customer_id = ?").get(input.replaceDocId, input.customerId);
    if (!oldDoc) {
      throw new AuthError("NOT_FOUND", "Document \xE0 remplacer introuvable pour ce client");
    }
  }
  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data
  });
  const encryptedBytes = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `cust_${input.customerId}_${import_node_crypto5.default.randomUUID()}.enc`;
  const relativePath = import_node_path7.default.join("customers", opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  import_node_fs6.default.mkdirSync(import_node_path7.default.dirname(fullPath), { recursive: true });
  import_node_fs6.default.writeFileSync(fullPath, encryptedBytes, { mode: 384 });
  const tx = db.transaction(() => {
    const res = db.prepare(
      `INSERT INTO customer_documents (
          customer_id, doc_category, encrypted_file_path, original_file_name, mime_type,
          document_number, issue_date, expiration_date, reminder_days, notes,
          replaces_doc_id, uploaded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.customerId,
      input.docCategory,
      relativePath,
      validated.safeFileName,
      validated.mimeType,
      input.documentNumber ?? null,
      input.issueDate ?? null,
      input.expirationDate ?? null,
      input.reminderDays ?? 30,
      input.notes ?? null,
      oldDoc ? Number(oldDoc.id) : null,
      actor.id
    );
    const docId2 = Number(res.lastInsertRowid);
    if (oldDoc) {
      db.prepare(
        `UPDATE customer_documents
         SET is_archived = 1,
             replaced_by_doc_id = ?,
             archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
             archived_by_user_id = COALESCE(archived_by_user_id, ?)
         WHERE id = ?`
      ).run(docId2, actor.id, oldDoc.id);
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: oldDoc ? "CUSTOMER_DOCUMENT_REPLACED" : "CUSTOMER_DOCUMENT_UPLOADED",
      entityType: "customer_documents",
      entityId: docId2,
      previousValue: oldDoc ? { replacedDocId: oldDoc.id, originalFileName: oldDoc.original_file_name } : void 0,
      newValue: {
        customerId: input.customerId,
        docCategory: input.docCategory,
        documentNumber: input.documentNumber ?? null,
        expirationDate: input.expirationDate ?? null
      }
    });
    return docId2;
  });
  const docId = tx();
  const row = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(docId);
  return mapCustomerDocument(row);
}
function updateCustomerDocumentMeta(db, actor, input) {
  const existing = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(input.docId);
  if (!existing) throw new AuthError("NOT_FOUND", "Document client introuvable");
  db.prepare(
    `UPDATE customer_documents
     SET document_number = ?,
         issue_date = ?,
         expiration_date = ?,
         reminder_days = ?,
         notes = ?
     WHERE id = ?`
  ).run(
    input.documentNumber !== void 0 ? input.documentNumber : existing.document_number,
    input.issueDate !== void 0 ? input.issueDate : existing.issue_date,
    input.expirationDate !== void 0 ? input.expirationDate : existing.expiration_date,
    input.reminderDays !== void 0 ? input.reminderDays : Number(existing.reminder_days ?? 30),
    input.notes !== void 0 ? input.notes : existing.notes,
    input.docId
  );
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "CUSTOMER_DOCUMENT_META_UPDATED",
    entityType: "customer_documents",
    entityId: input.docId,
    previousValue: {
      documentNumber: existing.document_number,
      expirationDate: existing.expiration_date,
      reminderDays: existing.reminder_days
    },
    newValue: {
      documentNumber: input.documentNumber !== void 0 ? input.documentNumber : existing.document_number,
      expirationDate: input.expirationDate !== void 0 ? input.expirationDate : existing.expiration_date,
      reminderDays: input.reminderDays !== void 0 ? input.reminderDays : existing.reminder_days
    }
  });
  const updated = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(input.docId);
  return mapCustomerDocument(updated);
}
function archiveCustomerDocument(db, actor, docId, reason) {
  const existing = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(docId);
  if (!existing) throw new AuthError("NOT_FOUND", "Document client introuvable");
  db.prepare(
    `UPDATE customer_documents
     SET is_archived = 1,
         archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         archived_by_user_id = ?
     WHERE id = ?`
  ).run(actor.id, docId);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "CUSTOMER_DOCUMENT_ARCHIVED",
    entityType: "customer_documents",
    entityId: docId,
    reason: reason ?? null
  });
  const updated = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(docId);
  return mapCustomerDocument(updated);
}
function readCustomerDocument(db, vaultRootDir, vaultKey, docId) {
  const row = db.prepare("SELECT * FROM customer_documents WHERE id = ?").get(docId);
  if (!row) throw new AuthError("NOT_FOUND", "Document client introuvable");
  const fullPath = resolveConfinedPath(vaultRootDir, row.encrypted_file_path);
  if (!import_node_fs6.default.existsSync(fullPath)) {
    throw new AuthError("NOT_FOUND", "Fichier chiffr\xE9 manquant dans le coffre");
  }
  const encryptedBytes = import_node_fs6.default.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);
  return {
    id: row.id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    base64Data: plainBytes.toString("base64")
  };
}
function checkCustomerEligibility(db, customerId, rentalEndDate) {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  if (!customer) throw new AuthError("NOT_FOUND", "Client introuvable");
  const warnings = [];
  const blockers = [];
  if (customer.is_archived === 1) {
    blockers.push("Client archiv\xE9");
  }
  const riskStatus = customer.risk_status;
  const requiresBlacklistOverride = riskStatus === "BLACKLISTED";
  if (requiresBlacklistOverride) {
    warnings.push("Client sur liste noire \u2014 autorisation exceptionnelle administrateur requise");
  } else if (riskStatus === "HIGH" || riskStatus === "MEDIUM") {
    warnings.push(`Client signal\xE9 (${riskStatus}) \u2014 v\xE9rifier les incidents`);
  }
  if (customer.customer_type === "INDIVIDUAL") {
    if (!customer.driving_licence_number) {
      warnings.push("Num\xE9ro de permis de conduire non renseign\xE9");
    }
    if (customer.driving_licence_expiration_date && customer.driving_licence_expiration_date < rentalEndDate.slice(0, 10)) {
      warnings.push("Le permis de conduire expire avant la date de retour pr\xE9vue");
    }
    const minYearsSetting = db.prepare(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'business.min_licence_years'"
    ).get();
    const minYears = Number(minYearsSetting?.setting_value ?? 2);
    if (customer.driving_licence_issue_date && minYears > 0) {
      const issueDate = new Date(customer.driving_licence_issue_date);
      const diffYears = (Date.now() - issueDate.getTime()) / (365.25 * 24 * 60 * 60 * 1e3);
      if (diffYears < minYears) {
        warnings.push(
          `Anciennet\xE9 du permis (${diffYears.toFixed(1)} ans) inf\xE9rieure au seuil configur\xE9 (${minYears} ans)`
        );
      }
    }
  }
  return {
    eligible: blockers.length === 0,
    requiresBlacklistOverride,
    riskStatus,
    warnings,
    blockers
  };
}

// electron/database/services/contractService.ts
function generateContractNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare(
    "SELECT COUNT(*) AS cnt FROM rental_contracts WHERE contract_number LIKE ?"
  ).get(`CTR-${year}-%`);
  const seq = (countRow?.cnt ?? 0) + 1;
  return `CTR-${year}-${String(seq).padStart(4, "0")}`;
}
function generatePaymentCodes(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM contract_payments").get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return {
    transactionCode: `TXN-${year}-${String(seq).padStart(5, "0")}`,
    receiptNumber: `REC-${year}-${String(seq).padStart(5, "0")}`
  };
}
function listContracts(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("rc.status = ?");
    params.push(filters.status);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push("(rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ?)");
    params.push(q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(
    `SELECT rc.*,
              c.full_name AS customer_name, c.phone AS customer_phone, c.risk_status AS customer_risk_status,
              v.matricule, v.brand, v.model,
              (SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0)
               FROM contract_payments cp WHERE cp.contract_id = rc.id) AS paid_net_minor,
              (SELECT amount_minor FROM deposits d WHERE d.contract_id = rc.id) AS deposit_amount_minor,
              (SELECT status FROM deposits d WHERE d.contract_id = rc.id) AS deposit_status
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       ${where}
       ORDER BY rc.id DESC`
  ).all(...params).map((r) => ({
    id: r.id,
    contractNumber: r.contract_number,
    reservationId: r.reservation_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerRiskStatus: r.customer_risk_status,
    vehicleId: r.vehicle_id,
    vehicleLabel: `${r.brand} ${r.model} (${r.matricule})`,
    status: r.status,
    startDate: r.start_date,
    originalEndDate: r.original_end_date,
    expectedReturnDate: r.expected_return_date,
    actualReturnDate: r.actual_return_date,
    departureOdometerKm: r.departure_odometer_km,
    returnOdometerKm: r.return_odometer_km,
    mileageMode: r.mileage_mode,
    includedTotalKm: r.included_total_km,
    currency: r.currency,
    totalContractAmountMinor: r.total_contract_amount_minor,
    paidNetMinor: Number(r.paid_net_minor ?? 0),
    outstandingMinor: Math.max(0, Number(r.total_contract_amount_minor) - Number(r.paid_net_minor ?? 0)),
    depositAmountMinor: Number(r.deposit_amount_minor ?? 0),
    depositStatus: r.deposit_status ?? null,
    createdAt: r.created_at
  }));
}
function getContractDetail(db, contractId) {
  const row = db.prepare(
    `SELECT rc.*,
              c.full_name AS customer_name, c.phone AS customer_phone, c.risk_status AS customer_risk_status,
              c.customer_type,
              v.matricule, v.brand, v.model, v.year, v.current_odometer_km, v.default_daily_rate_minor
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE rc.id = ?`
  ).get(contractId);
  if (!row) throw new AuthError("NOT_FOUND", "Contrat introuvable");
  const pricingItems = db.prepare("SELECT * FROM contract_pricing_items WHERE contract_id = ? ORDER BY id ASC").all(contractId).map((p) => ({
    id: p.id,
    contractId: p.contract_id,
    itemType: p.item_type,
    label: p.label,
    quantity: p.quantity,
    unitPriceMinor: p.unit_price_minor,
    totalMinor: p.total_minor,
    isAuthorizedAdjustment: p.is_authorized_adjustment === 1,
    createdAt: p.created_at
  }));
  const extensions = db.prepare(
    `SELECT re.*, u.username AS created_by_username
       FROM rental_extensions re
       JOIN users u ON u.id = re.created_by_user_id
       WHERE re.contract_id = ?
       ORDER BY re.id ASC`
  ).all(contractId).map((e) => ({
    id: e.id,
    contractId: e.contract_id,
    previousReturnDate: e.previous_return_date,
    newReturnDate: e.new_return_date,
    addedDays: e.added_days,
    additionalAmountMinor: e.additional_amount_minor,
    additionalKmAllowance: e.additional_km_allowance,
    notes: e.notes,
    createdByUsername: e.created_by_username,
    createdAt: e.created_at
  }));
  const payments = db.prepare(
    `SELECT cp.*, rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       WHERE cp.contract_id = ?
       ORDER BY cp.id ASC`
  ).all(contractId).map((p) => ({
    id: p.id,
    transactionCode: p.transaction_code,
    receiptNumber: p.receipt_number,
    direction: p.direction,
    method: p.method,
    paymentReference: p.payment_reference,
    amountMinor: p.amount_minor,
    currency: p.currency,
    paymentDate: p.payment_date,
    description: p.description,
    reversalOfPaymentId: p.reversal_of_payment_id ?? null,
    isReversed: p.reversed_by_payment_id != null,
    createdAt: p.created_at
  }));
  const deposit = db.prepare("SELECT * FROM deposits WHERE contract_id = ?").get(contractId);
  const paidNetMinor = payments.reduce(
    (sum, p) => sum + (p.direction === "INFLOW" ? p.amountMinor : -p.amountMinor),
    0
  );
  return {
    contract: {
      id: row.id,
      contractNumber: row.contract_number,
      reservationId: row.reservation_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerType: row.customer_type,
      customerRiskStatus: row.customer_risk_status,
      vehicleId: row.vehicle_id,
      vehicleLabel: `${row.brand} ${row.model} (${row.matricule})`,
      vehicleYear: row.year,
      vehicleCurrentOdometerKm: row.current_odometer_km,
      vehicleDefaultDailyRateMinor: row.default_daily_rate_minor,
      status: row.status,
      startDate: row.start_date,
      originalEndDate: row.original_end_date,
      expectedReturnDate: row.expected_return_date,
      actualReturnDate: row.actual_return_date,
      departureOdometerKm: row.departure_odometer_km,
      returnOdometerKm: row.return_odometer_km,
      odometerCorrectionReason: row.odometer_correction_reason,
      mileageMode: row.mileage_mode,
      dailyMileageAllowanceKm: row.daily_mileage_allowance_km,
      includedTotalKm: row.included_total_km,
      extraKmRateMinor: row.extra_km_rate_minor,
      currency: row.currency,
      baseRentalTotalMinor: row.base_rental_total_minor,
      discountMinor: row.discount_minor,
      extensionTotalMinor: row.extension_total_minor,
      extraKmChargeMinor: row.extra_km_charge_minor,
      lateFeeMinor: row.late_fee_minor,
      damageChargeMinor: row.damage_charge_minor,
      otherChargesMinor: row.other_charges_minor,
      totalContractAmountMinor: row.total_contract_amount_minor,
      paidNetMinor,
      outstandingMinor: Math.max(0, row.total_contract_amount_minor - paidNetMinor),
      blacklistOverrideReason: row.blacklist_override_reason,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    pricingItems,
    extensions,
    payments,
    deposit: deposit ? {
      id: deposit.id,
      amountMinor: deposit.amount_minor,
      currency: deposit.currency,
      status: deposit.status,
      receivedDate: deposit.received_date,
      returnedDate: deposit.returned_date,
      deductedAmountMinor: deposit.deducted_amount_minor,
      refundedAmountMinor: deposit.refunded_amount_minor,
      remainingHeldMinor: Math.max(
        0,
        Number(deposit.amount_minor) - Number(deposit.deducted_amount_minor ?? 0) - Number(deposit.refunded_amount_minor ?? 0)
      ),
      deductionReason: deposit.deduction_reason,
      hasSupportingDoc: Boolean(deposit.supporting_doc_path),
      supportingDocOriginalName: deposit.supporting_doc_original_name ?? null
    } : null
  };
}
function createContract(db, actor, permissions, input) {
  const tx = db.transaction(() => {
    const startMs = Date.parse(input.startDate);
    const endMs = Date.parse(input.expectedReturnDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      throw new AuthError("VALIDATION_ERROR", "Date de retour pr\xE9vue invalide");
    }
    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.expectedReturnDate,
      excludeReservationId: input.reservationId ?? null
    });
    if (!avail.available) {
      throw new AuthError(
        "CONFLICT",
        `V\xE9hicule indisponible: ${avail.conflicts.map((c) => c.details).join(" ; ")}`
      );
    }
    const eligibility = checkCustomerEligibility(db, input.customerId, input.expectedReturnDate);
    if (!eligibility.eligible) {
      throw new AuthError("VALIDATION_ERROR", eligibility.blockers.join(" ; "));
    }
    if (eligibility.requiresBlacklistOverride) {
      if (!permissions.canOverrideBlacklist) {
        throw new AuthError(
          "FORBIDDEN",
          "Client sur liste noire \u2014 autorisation Administrateur requise (customers:override_blacklist)"
        );
      }
      if (!input.blacklistOverrideReason || !input.blacklistOverrideReason.trim()) {
        throw new AuthError(
          "VALIDATION_ERROR",
          "Motif obligatoire pour autoriser la location \xE0 un client sur liste noire"
        );
      }
    }
    const maxAgentPctRow = db.prepare(
      "SELECT setting_value FROM application_settings WHERE setting_key = 'business.max_agent_discount_percent'"
    ).get();
    const maxAgentPct = Number(maxAgentPctRow?.setting_value ?? 10);
    const effectiveDiscountPct = input.baseRentalTotalMinor > 0 ? input.discountMinor / input.baseRentalTotalMinor * 100 : 0;
    if (effectiveDiscountPct > maxAgentPct && !permissions.canApproveDiscount) {
      throw new AuthError(
        "FORBIDDEN",
        `Remise (${effectiveDiscountPct.toFixed(1)}%) sup\xE9rieure au plafond agent (${maxAgentPct}%) \u2014 approbation Administrateur requise`
      );
    }
    if (input.depositCurrency === "EUR") {
      const eurSetting = db.prepare(
        "SELECT setting_value FROM application_settings WHERE setting_key = 'business.allow_eur_deposits'"
      ).get();
      if (eurSetting?.setting_value !== "true") {
        throw new AuthError("VALIDATION_ERROR", "Les cautions en EUR ne sont pas activ\xE9es dans les param\xE8tres");
      }
    }
    const totalContractAmountMinor = Math.max(0, input.baseRentalTotalMinor - (input.discountMinor ?? 0));
    const days = Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1e3)));
    const includedTotalKm = input.mileageMode === "UNLIMITED" ? null : input.mileageMode === "DAILY_ALLOWANCE" ? (input.dailyMileageAllowanceKm ?? 0) * days : input.includedTotalKm ?? 0;
    const contractNumber = generateContractNumber(db);
    const initialStatus = input.initialStatus ?? "CONFIRMED";
    const insertRes = db.prepare(
      `INSERT INTO rental_contracts (
          contract_number, reservation_id, customer_id, vehicle_id, status,
          start_date, original_end_date, expected_return_date, departure_odometer_km,
          mileage_mode, daily_mileage_allowance_km, included_total_km, extra_km_rate_minor,
          currency, base_rental_total_minor, discount_minor, total_contract_amount_minor,
          blacklist_override_reason, blacklist_override_by_user_id, notes, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      contractNumber,
      input.reservationId ?? null,
      input.customerId,
      input.vehicleId,
      initialStatus,
      input.startDate,
      input.expectedReturnDate,
      input.expectedReturnDate,
      input.departureOdometerKm,
      input.mileageMode,
      input.dailyMileageAllowanceKm ?? null,
      includedTotalKm,
      input.extraKmRateMinor,
      input.currency,
      input.baseRentalTotalMinor,
      input.discountMinor ?? 0,
      totalContractAmountMinor,
      eligibility.requiresBlacklistOverride ? input.blacklistOverrideReason.trim() : null,
      eligibility.requiresBlacklistOverride ? actor.id : null,
      input.notes ?? null,
      actor.id
    );
    const contractId = Number(insertRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO contract_pricing_items (
        contract_id, item_type, label, quantity, unit_price_minor, total_minor,
        is_authorized_adjustment, authorized_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`
    ).run(
      contractId,
      input.pricingTier === "MONTHLY" ? "MONTHLY_RATE" : input.pricingTier === "WEEKLY" ? "WEEKLY_RATE" : input.pricingTier === "CUSTOM" ? "CUSTOM_RATE" : "DAILY_RATE",
      input.pricingBreakdownLabel || `Location ${days} jours`,
      days,
      Math.round(input.baseRentalTotalMinor / days),
      input.baseRentalTotalMinor
    );
    if ((input.discountMinor ?? 0) > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (
          contract_id, item_type, label, quantity, unit_price_minor, total_minor,
          is_authorized_adjustment, authorized_by_user_id
        ) VALUES (?, 'FIXED_DISCOUNT', ?, 1, ?, ?, ?, ?)`
      ).run(
        contractId,
        input.discountAuthorizationReason || "Remise accord\xE9e sur contrat",
        -input.discountMinor,
        -input.discountMinor,
        effectiveDiscountPct > maxAgentPct ? 1 : 0,
        effectiveDiscountPct > maxAgentPct ? actor.id : null
      );
    }
    if (input.reservationId) {
      db.prepare(
        `UPDATE reservations SET status = 'CONVERTED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(input.reservationId);
    }
    if (input.depositAmountMinor > 0) {
      const depCurrency = input.depositCurrency ?? "DZD";
      const depMethod = input.depositPaymentMethod ?? "CASH";
      const depRes = db.prepare(
        `INSERT INTO deposits (
            contract_id, customer_id, amount_minor, currency, status, received_date, received_method, received_by_user_id
          ) VALUES (?, ?, ?, ?, 'HELD', ?, ?, ?)`
      ).run(
        contractId,
        input.customerId,
        input.depositAmountMinor,
        depCurrency,
        (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        depMethod,
        actor.id
      );
      const depMovRes = db.prepare(
        `INSERT INTO deposit_movements (deposit_id, movement_type, amount_minor, payment_method, reason, recorded_by_user_id)
           VALUES (?, 'RECEIVED', ?, ?, 'Caution re\xE7ue au contrat', ?)`
      ).run(Number(depRes.lastInsertRowid), input.depositAmountMinor, depMethod, actor.id);
      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: depCurrency,
        paymentMethod: depMethod,
        movementType: "DEPOSIT_INFLOW",
        amountMinor: input.depositAmountMinor,
        depositMovementId: Number(depMovRes.lastInsertRowid),
        description: `Caution re\xE7ue (${contractNumber})`
      });
    }
    if ((input.initialPaymentMinor ?? 0) > 0) {
      const codes = generatePaymentCodes(db);
      const payRes = db.prepare(
        `INSERT INTO contract_payments (
            transaction_code, receipt_number, contract_id, customer_id, direction, method,
            payment_reference, amount_minor, currency, payment_date, description, recorded_by_user_id
          ) VALUES (?, ?, ?, ?, 'INFLOW', ?, ?, ?, ?, ?, 'Paiement initial contrat', ?)`
      ).run(
        codes.transactionCode,
        codes.receiptNumber,
        contractId,
        input.customerId,
        input.initialPaymentMethod ?? "CASH",
        input.initialPaymentReference ?? null,
        input.initialPaymentMinor,
        input.currency,
        (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        actor.id
      );
      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: input.currency,
        paymentMethod: input.initialPaymentMethod ?? "CASH",
        movementType: "PAYMENT_INFLOW",
        amountMinor: input.initialPaymentMinor,
        paymentId: Number(payRes.lastInsertRowid),
        description: `${codes.receiptNumber} (${contractNumber})`
      });
    }
    recomputeVehicleStatus(db, input.vehicleId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CONTRACT_CREATED",
      entityType: "rental_contracts",
      entityId: contractId,
      newValue: {
        contractNumber,
        vehicleId: input.vehicleId,
        customerId: input.customerId,
        status: initialStatus,
        totalContractAmountMinor,
        depositAmountMinor: input.depositAmountMinor
      },
      reason: eligibility.requiresBlacklistOverride ? input.blacklistOverrideReason : null
    });
    return getContractDetail(db, contractId);
  });
  return tx();
}
function activateContract(db, actor, contractId, departureOdometerKm) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(contractId);
    if (!current) throw new AuthError("NOT_FOUND", "Contrat introuvable");
    if (current.status !== "DRAFT" && current.status !== "CONFIRMED") {
      throw new AuthError("CONFLICT", `Impossible d\u2019activer un contrat au statut ${current.status}`);
    }
    const avail = checkVehicleAvailability(db, {
      vehicleId: current.vehicle_id,
      startDate: current.start_date,
      endDate: current.expected_return_date,
      excludeContractId: contractId
    });
    if (!avail.available) {
      throw new AuthError(
        "CONFLICT",
        `Activation bloqu\xE9e: ${avail.conflicts.map((c) => c.details).join(" ; ")}`
      );
    }
    const odo = departureOdometerKm ?? current.departure_odometer_km;
    db.prepare(
      `UPDATE rental_contracts
       SET status = 'ACTIVE', departure_odometer_km = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(odo, contractId);
    recomputeVehicleStatus(db, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CONTRACT_ACTIVATED",
      entityType: "rental_contracts",
      entityId: contractId,
      previousValue: { status: current.status },
      newValue: { status: "ACTIVE", departureOdometerKm: odo }
    });
    return getContractDetail(db, contractId);
  });
  return tx();
}
function extendContract(db, actor, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(input.contractId);
    if (!current) throw new AuthError("NOT_FOUND", "Contrat introuvable");
    if (current.status !== "ACTIVE" && current.status !== "EXTENDED" && current.status !== "CONFIRMED") {
      throw new AuthError(
        "CONFLICT",
        `Seul un contrat confirm\xE9, actif ou d\xE9j\xE0 prolong\xE9 peut \xEAtre prolong\xE9 (statut actuel: ${current.status})`
      );
    }
    const prevEndMs = Date.parse(current.expected_return_date);
    const nextEndMs = Date.parse(input.newReturnDate);
    if (Number.isNaN(nextEndMs) || nextEndMs <= prevEndMs) {
      throw new AuthError(
        "VALIDATION_ERROR",
        "La nouvelle date de retour doit \xEAtre strictement post\xE9rieure \xE0 la date de retour actuelle"
      );
    }
    const avail = checkVehicleAvailability(db, {
      vehicleId: current.vehicle_id,
      startDate: current.expected_return_date,
      endDate: input.newReturnDate,
      excludeContractId: current.id
    });
    if (!avail.available) {
      throw new AuthError(
        "CONFLICT",
        `Prolongation impossible \u2014 conflit sur la p\xE9riode demand\xE9e: ${avail.conflicts.map((c) => c.details).join(" ; ")}`
      );
    }
    const addedDays = Math.max(1, Math.ceil((nextEndMs - prevEndMs) / (24 * 60 * 60 * 1e3)));
    db.prepare(
      `INSERT INTO rental_extensions (
        contract_id, previous_return_date, new_return_date, added_days,
        additional_amount_minor, additional_km_allowance, notes, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      current.id,
      current.expected_return_date,
      input.newReturnDate,
      addedDays,
      input.additionalAmountMinor,
      input.additionalKmAllowance ?? 0,
      input.notes ?? null,
      actor.id
    );
    db.prepare(
      `INSERT INTO contract_pricing_items (
        contract_id, item_type, label, quantity, unit_price_minor, total_minor
      ) VALUES (?, 'DAILY_RATE', ?, ?, ?, ?)`
    ).run(
      current.id,
      `Prolongation (${addedDays} j jusqu'au ${input.newReturnDate.slice(0, 10)})`,
      addedDays,
      Math.round(input.additionalAmountMinor / addedDays),
      input.additionalAmountMinor
    );
    const nextExtensionTotal = Number(current.extension_total_minor) + input.additionalAmountMinor;
    const nextTotalAmount = Number(current.total_contract_amount_minor) + input.additionalAmountMinor;
    const nextIncludedKm = current.mileage_mode === "UNLIMITED" ? null : Number(current.included_total_km ?? 0) + (input.additionalKmAllowance ?? 0);
    const nextStatus = current.status === "CONFIRMED" ? "CONFIRMED" : "EXTENDED";
    db.prepare(
      `UPDATE rental_contracts
       SET expected_return_date = ?,
           extension_total_minor = ?,
           included_total_km = ?,
           total_contract_amount_minor = ?,
           status = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.newReturnDate,
      nextExtensionTotal,
      nextIncludedKm,
      nextTotalAmount,
      nextStatus,
      current.id
    );
    recomputeVehicleStatus(db, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CONTRACT_EXTENDED",
      entityType: "rental_contracts",
      entityId: current.id,
      previousValue: {
        expectedReturnDate: current.expected_return_date,
        totalContractAmountMinor: current.total_contract_amount_minor
      },
      newValue: {
        newReturnDate: input.newReturnDate,
        addedDays,
        additionalAmountMinor: input.additionalAmountMinor,
        totalContractAmountMinor: nextTotalAmount
      },
      reason: input.notes ?? null
    });
    return getContractDetail(db, current.id);
  });
  return tx();
}
function completeContract(db, actor, hasOdometerOverridePerm, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(input.contractId);
    if (!current) throw new AuthError("NOT_FOUND", "Contrat introuvable");
    if (current.status !== "ACTIVE" && current.status !== "EXTENDED") {
      throw new AuthError("CONFLICT", `Le contrat doit \xEAtre actif pour \xEAtre cl\xF4tur\xE9 (${current.status})`);
    }
    if (input.returnOdometerKm < current.departure_odometer_km) {
      if (!hasOdometerOverridePerm || !input.odometerCorrectionReason?.trim()) {
        throw new AuthError(
          "VALIDATION_ERROR",
          "Le kilom\xE9trage retour ne peut pas \xEAtre inf\xE9rieur au kilom\xE9trage d\xE9part sans correction autoris\xE9e et justifi\xE9e"
        );
      }
    }
    const drivenKm = Math.max(0, input.returnOdometerKm - current.departure_odometer_km);
    let extraKmChargeMinor = 0;
    if (current.mileage_mode !== "UNLIMITED" && current.included_total_km != null) {
      const extraKm = Math.max(0, drivenKm - Number(current.included_total_km));
      extraKmChargeMinor = extraKm * Number(current.extra_km_rate_minor);
    }
    if (extraKmChargeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'EXTRA_KM', 'Kilom\xE9trage suppl\xE9mentaire', 1, ?, ?)`
      ).run(current.id, extraKmChargeMinor, extraKmChargeMinor);
    }
    if (input.lateFeeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'LATE_FEE', 'P\xE9nalit\xE9 de retard', 1, ?, ?)`
      ).run(current.id, input.lateFeeMinor, input.lateFeeMinor);
    }
    if (input.damageChargeMinor > 0) {
      db.prepare(
        `INSERT INTO contract_pricing_items (contract_id, item_type, label, quantity, unit_price_minor, total_minor)
         VALUES (?, 'DAMAGE', 'Frais de dommages', 1, ?, ?)`
      ).run(current.id, input.damageChargeMinor, input.damageChargeMinor);
    }
    const nextTotal = Number(current.base_rental_total_minor) - Number(current.discount_minor) + Number(current.extension_total_minor) + extraKmChargeMinor + input.lateFeeMinor + input.damageChargeMinor + input.otherChargesMinor;
    db.prepare(
      `UPDATE rental_contracts
       SET status = 'COMPLETED',
           actual_return_date = ?,
           return_odometer_km = ?,
           odometer_correction_reason = ?,
           extra_km_charge_minor = ?,
           late_fee_minor = ?,
           damage_charge_minor = ?,
           other_charges_minor = ?,
           total_contract_amount_minor = ?,
           closed_by_user_id = ?,
           notes = COALESCE(?, notes),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.actualReturnDate,
      input.returnOdometerKm,
      input.odometerCorrectionReason ?? null,
      extraKmChargeMinor,
      input.lateFeeMinor,
      input.damageChargeMinor,
      input.otherChargesMinor,
      nextTotal,
      actor.id,
      input.notes ?? null,
      current.id
    );
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.returnOdometerKm, current.vehicle_id);
    recomputeVehicleStatus(db, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CONTRACT_COMPLETED",
      entityType: "rental_contracts",
      entityId: current.id,
      newValue: {
        returnOdometerKm: input.returnOdometerKm,
        extraKmChargeMinor,
        lateFeeMinor: input.lateFeeMinor,
        totalContractAmountMinor: nextTotal
      }
    });
    return getContractDetail(db, current.id);
  });
  return tx();
}
function cancelContract(db, actor, contractId, reason) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(contractId);
    if (!current) throw new AuthError("NOT_FOUND", "Contrat introuvable");
    if (current.status === "COMPLETED" || current.status === "CANCELLED") {
      throw new AuthError("CONFLICT", `Impossible d\u2019annuler un contrat au statut ${current.status}`);
    }
    db.prepare(
      `UPDATE rental_contracts
       SET status = 'CANCELLED',
           notes = COALESCE(notes || ' | Annul\xE9: ' || ?, 'Annul\xE9: ' || ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(reason.trim(), reason.trim(), contractId);
    recomputeVehicleStatus(db, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "CONTRACT_CANCELLED",
      entityType: "rental_contracts",
      entityId: contractId,
      previousValue: { status: current.status },
      newValue: { status: "CANCELLED" },
      reason: reason.trim()
    });
    return getContractDetail(db, contractId);
  });
  return tx();
}

// electron/database/services/documentService.ts
var import_node_crypto10 = __toESM(require("node:crypto"), 1);
var import_node_fs12 = __toESM(require("node:fs"), 1);
var import_node_path13 = __toESM(require("node:path"), 1);

// electron/database/services/settingsService.ts
function getAllSettings(db) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM application_settings ORDER BY setting_key"
  ).all();
  const result = {};
  for (const row of rows) {
    result[row.setting_key] = row.setting_value;
  }
  return result;
}
function updateSettingsBatch(db, actor, updates) {
  const tx = db.transaction(() => {
    const previous = getAllSettings(db);
    const stmt = db.prepare(
      `INSERT INTO application_settings (setting_key, setting_group, setting_value, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_group = excluded.setting_group,
         setting_value = excluded.setting_value,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`
    );
    const changed = {};
    for (const item of updates) {
      stmt.run(item.key, item.group, item.value, actor.id);
      if (previous[item.key] !== item.value) {
        changed[item.key] = { before: previous[item.key], after: item.value };
      }
    }
    if (Object.keys(changed).length > 0) {
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: "SETTINGS_UPDATED",
        entityType: "application_settings",
        entityId: "batch",
        previousValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.before])),
        newValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.after]))
      });
    }
  });
  tx();
  return getAllSettings(db);
}

// electron/documents/arabicText.ts
var import_arabic_persian_reshaper = __toESM(require("arabic-persian-reshaper"), 1);
var import_bidi_js = __toESM(require("bidi-js"), 1);
var bidi = (0, import_bidi_js.default)();
var EASTERN_ARABIC_DIGITS = ["\u0660", "\u0661", "\u0662", "\u0663", "\u0664", "\u0665", "\u0666", "\u0667", "\u0668", "\u0669"];
var ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
var BIDI_CONTROL_STRIP_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
function isolateLtrTokensForRtl(input) {
  const tokenPattern = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Z]{2,8}(?:-[A-Z0-9]{1,8})+|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?|\d{2}\/\d{2}\/\d{4}|\d{3,6}-\d{2,4}-\d{2,4}|\+?\d[\d\s.-]{5,}\d|\d+(?:[\s,]\d{3})*(?:\.\d+)?(?:\s*(?:DA|DZD|EUR|km|KM|%))?|[A-Za-z][A-Za-z0-9\s./_-]*[A-Za-z0-9])/g;
  return input.replace(tokenPattern, (match) => `\u2066${match}\u2069`);
}
function sanitizePdfText(raw) {
  if (raw === null || raw === void 0) return "";
  return String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "  ").replace(/[\u202F\u00A0]/g, " ").replace(/[\u{1F000}-\u{1FFFF}]/gu, "").trimEnd();
}
function applyNumeralPreference(text, numerals) {
  if (numerals !== "arabic") return text;
  return text.replace(/\d/g, (d) => EASTERN_ARABIC_DIGITS[Number(d)] ?? d);
}
function prepareLineForPdf(logicalLine, baseDir) {
  const clean = sanitizePdfText(logicalLine);
  if (!clean) return "";
  const hasArabic = ARABIC_CHAR_REGEX.test(clean);
  if (!hasArabic) {
    return clean;
  }
  const protectedText = baseDir === "rtl" ? isolateLtrTokensForRtl(clean) : clean;
  const shaped = import_arabic_persian_reshaper.default.ArabicShaper.convertArabic(protectedText);
  const levels = bidi.getEmbeddingLevels(shaped, baseDir);
  const reordered = bidi.getReorderedString(shaped, levels);
  return reordered.replace(BIDI_CONTROL_STRIP_REGEX, "");
}
function wrapTextForPdf(text, maxWidth, font, fontSize, baseDir) {
  const clean = sanitizePdfText(text);
  if (!clean) return [""];
  const paragraphs = clean.split("\n");
  const lines = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const visualCandidate = prepareLineForPdf(candidate, baseDir);
      const width = font.widthOfTextAtSize(visualCandidate, fontSize);
      if (width <= maxWidth) {
        current = candidate;
      } else if (!current) {
        let chunk = "";
        for (const ch of word) {
          const nextChunk = chunk + ch;
          if (font.widthOfTextAtSize(prepareLineForPdf(nextChunk, baseDir), fontSize) > maxWidth && chunk) {
            lines.push(prepareLineForPdf(chunk, baseDir));
            chunk = ch;
          } else {
            chunk = nextChunk;
          }
        }
        current = chunk;
      } else {
        lines.push(prepareLineForPdf(current, baseDir));
        current = word;
      }
    }
    if (current) {
      lines.push(prepareLineForPdf(current, baseDir));
    }
  }
  return lines.length > 0 ? lines : [""];
}
function formatMoneyForDoc(minorAmount, currency, lang, numerals = "latin") {
  const sign = minorAmount < 0 ? "-" : "";
  const major = Math.abs(minorAmount) / 100;
  const fixed = major.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const unit = currency === "EUR" ? "EUR" : lang === "ar" ? "\u062F\u062C" : "DA";
  return applyNumeralPreference(`${sign}${grouped}.${decPart} ${unit}`, numerals);
}
function formatDateForDoc(iso, lang, numerals = "latin", withTime = false) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return applyNumeralPreference(iso.slice(0, 16), numerals);
  }
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}
  });
  const formatted = formatter.format(d);
  return applyNumeralPreference(formatted, numerals);
}

// electron/documents/pdfEngine.ts
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var import_pdf_lib = require("pdf-lib");
var import_fontkit = __toESM(require("@pdf-lib/fontkit"), 1);
var import_meta = {};
var cachedFonts = null;
function resolveFontsDir() {
  const candidates = [];
  if (typeof __dirname !== "undefined") {
    candidates.push(import_node_path8.default.resolve(__dirname, "../../electron/assets/fonts"));
    candidates.push(import_node_path8.default.resolve(__dirname, "../assets/fonts"));
  }
  if (import_meta.dirname) {
    candidates.push(import_node_path8.default.resolve(import_meta.dirname, "..", "assets", "fonts"));
  }
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath) {
    candidates.push(import_node_path8.default.resolve(resourcesPath, "app.asar.unpacked", "electron", "assets", "fonts"));
    candidates.push(import_node_path8.default.resolve(resourcesPath, "electron", "assets", "fonts"));
  }
  candidates.push(import_node_path8.default.resolve(process.cwd(), "electron", "assets", "fonts"));
  candidates.push("/usr/share/fonts/truetype/dejavu");
  for (const dir of candidates) {
    if (import_node_fs7.default.existsSync(import_node_path8.default.join(dir, "DejaVuSans.ttf"))) {
      return dir;
    }
  }
  throw new Error("Polices PDF introuvables (DejaVuSans.ttf requis dans electron/assets/fonts).");
}
function loadFontBundle() {
  if (cachedFonts) return cachedFonts;
  const dir = resolveFontsDir();
  cachedFonts = {
    regular: import_node_fs7.default.readFileSync(import_node_path8.default.join(dir, "DejaVuSans.ttf")),
    bold: import_node_fs7.default.readFileSync(import_node_path8.default.join(dir, "DejaVuSans-Bold.ttf")),
    mono: import_node_fs7.default.readFileSync(import_node_path8.default.join(dir, "DejaVuSansMono.ttf"))
  };
  return cachedFonts;
}
async function embedOptionalImage(pdfDoc, dataUrlOrBuffer) {
  if (!dataUrlOrBuffer) return null;
  try {
    let bytes;
    let mime = "";
    if (typeof dataUrlOrBuffer === "string") {
      const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(dataUrlOrBuffer.trim());
      if (!match) return null;
      mime = match[1].toLowerCase();
      bytes = Buffer.from(match[2], "base64");
    } else {
      bytes = dataUrlOrBuffer.bytes;
      mime = dataUrlOrBuffer.mimeType.toLowerCase();
    }
    if (bytes.length === 0) return null;
    if (mime.includes("png")) return await pdfDoc.embedPng(bytes);
    if (mime.includes("jpeg") || mime.includes("jpg")) return await pdfDoc.embedJpg(bytes);
    return null;
  } catch {
    return null;
  }
}
var PALETTE = {
  ink: (0, import_pdf_lib.rgb)(0.08, 0.11, 0.17),
  slate: (0, import_pdf_lib.rgb)(0.32, 0.37, 0.45),
  muted: (0, import_pdf_lib.rgb)(0.47, 0.52, 0.6),
  border: (0, import_pdf_lib.rgb)(0.84, 0.87, 0.91),
  surface: (0, import_pdf_lib.rgb)(0.96, 0.97, 0.985),
  accent: (0, import_pdf_lib.rgb)(0.06, 0.36, 0.56),
  accentSoft: (0, import_pdf_lib.rgb)(0.92, 0.955, 0.985),
  copyRed: (0, import_pdf_lib.rgb)(0.75, 0.16, 0.16),
  copyBg: (0, import_pdf_lib.rgb)(0.995, 0.94, 0.94),
  white: (0, import_pdf_lib.rgb)(1, 1, 1)
};
function drawAlignedLine(page, visualText, x, y, boxWidth, font, size, align, color = PALETTE.ink) {
  if (!visualText) return;
  const textWidth = font.widthOfTextAtSize(visualText, size);
  let drawX = x;
  if (align === "right") {
    drawX = x + Math.max(0, boxWidth - textWidth);
  } else if (align === "center") {
    drawX = x + Math.max(0, (boxWidth - textWidth) / 2);
  }
  page.drawText(visualText, { x: drawX, y, size, font, color });
}
async function renderDocumentToPdf(payload) {
  if (payload.format === "THERMAL_80MM" || payload.format === "THERMAL_58MM") {
    return renderThermalReceiptPdf(payload);
  }
  return renderA4DocumentPdf(payload);
}
async function renderA4DocumentPdf(payload) {
  const isLandscape = payload.format === "A4_LANDSCAPE_PDF";
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const marginX = 34;
  const contentWidth = pageWidth - marginX * 2;
  const topMargin = 32;
  const footerReserve = 42;
  const isRtl = payload.language === "ar";
  const baseDir = isRtl ? "rtl" : "ltr";
  const defaultAlign = isRtl ? "right" : "left";
  const pdfDoc = await import_pdf_lib.PDFDocument.create();
  pdfDoc.registerFontkit(import_fontkit.default);
  const fonts = loadFontBundle();
  const fontReg = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold = await pdfDoc.embedFont(fonts.bold, { subset: true });
  const fontMono = await pdfDoc.embedFont(fonts.mono, { subset: true });
  const logoImage = payload.template.showLogo && payload.logoBytes ? await embedOptionalImage(pdfDoc, payload.logoBytes) : null;
  const pages = [];
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = pageHeight - topMargin;
  const drawAgencyHeader = (targetPage, compact) => {
    let cursorY = pageHeight - topMargin;
    const headerHeight = compact ? 42 : 76;
    targetPage.drawRectangle({
      x: marginX,
      y: cursorY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: PALETTE.surface,
      borderColor: PALETTE.border,
      borderWidth: 0.75
    });
    if (!compact) {
      const logoBoxSize = 48;
      const hasLogo = Boolean(logoImage);
      if (logoImage) {
        const scaled = logoImage.scaleToFit(logoBoxSize, logoBoxSize);
        const lx = isRtl ? marginX + contentWidth - scaled.width - 10 : marginX + 10;
        const ly = cursorY - 14 - scaled.height;
        targetPage.drawImage(logoImage, { x: lx, y: ly, width: scaled.width, height: scaled.height });
      }
      const infoOffset = hasLogo ? logoBoxSize + 18 : 10;
      const infoWidth = contentWidth * 0.56 - infoOffset;
      const infoX = isRtl ? marginX + contentWidth - infoOffset - infoWidth : marginX + infoOffset;
      const agencyName = prepareLineForPdf(
        payload.template.agencyName || (isRtl ? "\u0648\u0643\u0627\u0644\u0629 \u0643\u0631\u0627\u0621 \u0627\u0644\u0633\u064A\u0627\u0631\u0627\u062A" : "Agence de Location"),
        baseDir
      );
      drawAlignedLine(targetPage, agencyName, infoX, cursorY - 18, infoWidth, fontBold, 11.5, defaultAlign, PALETTE.accent);
      const contactParts = [
        payload.template.agencyAddress,
        payload.template.agencyPhone ? `T\xE9l: ${payload.template.agencyPhone}` : "",
        payload.template.agencyEmail
      ].filter(Boolean);
      const contactLine = prepareLineForPdf(contactParts.join(" \xB7 "), baseDir);
      const contactWrapped = wrapTextForPdf(contactLine, infoWidth, fontReg, 7.8, baseDir).slice(0, 2);
      contactWrapped.forEach((line, idx) => {
        drawAlignedLine(targetPage, line, infoX, cursorY - 31 - idx * 10, infoWidth, fontReg, 7.8, defaultAlign, PALETTE.slate);
      });
      if (payload.template.showFiscalIds) {
        const fiscalParts = [
          payload.template.rcNumber ? `RC: ${payload.template.rcNumber}` : "",
          payload.template.nifNumber ? `NIF: ${payload.template.nifNumber}` : "",
          payload.template.nisNumber ? `NIS: ${payload.template.nisNumber}` : "",
          payload.template.artNumber ? `ART: ${payload.template.artNumber}` : ""
        ].filter(Boolean);
        if (fiscalParts.length > 0) {
          const fiscalWrapped = wrapTextForPdf(fiscalParts.join(" \xB7 "), infoWidth, fontReg, 7.2, baseDir).slice(0, 1);
          drawAlignedLine(targetPage, fiscalWrapped[0], infoX, cursorY - 56, infoWidth, fontReg, 7.2, defaultAlign, PALETTE.muted);
        }
      }
      const metaWidth = contentWidth * 0.4;
      const metaX = isRtl ? marginX + 10 : marginX + contentWidth - metaWidth - 10;
      const metaAlign = isRtl ? "left" : "right";
      const docTitleLine = prepareLineForPdf(payload.title, baseDir);
      drawAlignedLine(targetPage, docTitleLine, metaX, cursorY - 19, metaWidth, fontBold, 11, metaAlign, PALETTE.ink);
      const numLine = prepareLineForPdf(
        `${isRtl ? "\u0627\u0644\u0645\u0631\u062C\u0639" : "N\xB0"} : ${applyNumeralPreference(payload.documentNumber, payload.numeralSystem)}`,
        baseDir
      );
      drawAlignedLine(targetPage, numLine, metaX, cursorY - 33, metaWidth, fontBold, 9, metaAlign, PALETTE.accent);
      const dateLine = prepareLineForPdf(
        `${isRtl ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0635\u062F\u0627\u0631" : "\xC9mis le"} : ${payload.issueDateDisplay}`,
        baseDir
      );
      drawAlignedLine(targetPage, dateLine, metaX, cursorY - 45, metaWidth, fontReg, 8, metaAlign, PALETTE.slate);
      const badgeLabel = payload.isCopy ? isRtl ? `\u0646\u0633\u062E\u0629 \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0623\u0635\u0644${payload.sourceDocumentNumber ? ` (${payload.sourceDocumentNumber})` : ""}` : `COPIE CONFORME${payload.sourceDocumentNumber ? ` \xB7 R\xE9f ${payload.sourceDocumentNumber}` : ""}` : isRtl ? "\u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0623\u0635\u0644\u064A\u0629" : "ORIGINAL ARCHIV\xC9";
      drawAlignedLine(
        targetPage,
        prepareLineForPdf(badgeLabel, baseDir),
        metaX,
        cursorY - 59,
        metaWidth,
        fontBold,
        7.8,
        metaAlign,
        payload.isCopy ? PALETTE.copyRed : PALETTE.accent
      );
      cursorY -= headerHeight + 10;
      if (payload.isCopy) {
        const copyBannerHeight = 20;
        targetPage.drawRectangle({
          x: marginX,
          y: cursorY - copyBannerHeight,
          width: contentWidth,
          height: copyBannerHeight,
          color: PALETTE.copyBg,
          borderColor: PALETTE.copyRed,
          borderWidth: 0.75
        });
        const copyBannerText = isRtl ? `\u062A\u0646\u0628\u064A\u0647: \u0647\u0630\u0647 \u0646\u0633\u062E\u0629 \u0645\u0639\u0627\u062F \u0637\u0628\u0627\u0639\u062A\u0647\u0627 (#${payload.copyNumber ?? 1}) \u0645\u0646 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 \u0627\u0644\u0623\u0635\u0644\u064A\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u0641\u064A \u0627\u0644\u0623\u0631\u0634\u064A\u0641.` : `AVIS : Ce document est une COPIE R\xC9\xC9DIT\xC9E (#${payload.copyNumber ?? 1}) issue de l'archive immuable.`;
        drawAlignedLine(
          targetPage,
          prepareLineForPdf(applyNumeralPreference(copyBannerText, payload.numeralSystem), baseDir),
          marginX + 8,
          cursorY - 13.5,
          contentWidth - 16,
          fontBold,
          8,
          "center",
          PALETTE.copyRed
        );
        cursorY -= copyBannerHeight + 8;
      }
      if (payload.subtitle) {
        const subLines = wrapTextForPdf(payload.subtitle, contentWidth - 16, fontReg, 8.5, baseDir);
        for (const sl of subLines) {
          drawAlignedLine(targetPage, sl, marginX + 8, cursorY - 10, contentWidth - 16, fontReg, 8.5, defaultAlign, PALETTE.slate);
          cursorY -= 12;
        }
        cursorY -= 4;
      }
      return cursorY;
    }
    drawAlignedLine(
      targetPage,
      prepareLineForPdf(`${payload.title} \xB7 ${payload.documentNumber}`, baseDir),
      marginX + 10,
      cursorY - 17,
      contentWidth - 20,
      fontBold,
      9.5,
      defaultAlign,
      PALETTE.accent
    );
    drawAlignedLine(
      targetPage,
      prepareLineForPdf(
        `${payload.template.agencyName} \u2014 ${payload.issueDateDisplay}${payload.isCopy ? isRtl ? " (\u0646\u0633\u062E\u0629)" : " (COPIE)" : ""}`,
        baseDir
      ),
      marginX + 10,
      cursorY - 31,
      contentWidth - 20,
      fontReg,
      7.8,
      defaultAlign,
      PALETTE.slate
    );
    return cursorY - headerHeight - 10;
  };
  const ensureSpace = (neededHeight) => {
    if (y - neededHeight < footerReserve) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pages.push(page);
      y = drawAgencyHeader(page, true);
    }
  };
  y = drawAgencyHeader(page, false);
  const drawSectionHeading = (title) => {
    ensureSpace(24);
    const barH = 18;
    page.drawRectangle({
      x: marginX,
      y: y - barH,
      width: contentWidth,
      height: barH,
      color: PALETTE.accentSoft,
      borderColor: PALETTE.border,
      borderWidth: 0.5
    });
    drawAlignedLine(
      page,
      prepareLineForPdf(title, baseDir),
      marginX + 8,
      y - 12.5,
      contentWidth - 16,
      fontBold,
      9,
      defaultAlign,
      PALETTE.accent
    );
    y -= barH + 6;
  };
  for (const section of payload.sections) {
    if (section.type === "kv_grid") {
      if (section.title) drawSectionHeading(section.title);
      const cols = section.columns ?? 2;
      const gap = 10;
      const colW = cols === 2 ? (contentWidth - gap) / 2 : contentWidth;
      const items = section.items;
      for (let i = 0; i < items.length; i += cols) {
        const pair = items.slice(i, i + cols);
        const wrappedCells = pair.map((item) => {
          const lblLines = wrapTextForPdf(item.label, colW - 14, fontBold, 7.5, baseDir);
          const valLines = wrapTextForPdf(item.value || "\u2014", colW - 14, item.emphasize ? fontBold : fontReg, 8.8, baseDir);
          const cellH = lblLines.length * 10 + valLines.length * 11.5 + 10;
          return { item, lblLines, valLines, cellH };
        });
        const rowH = Math.max(...wrappedCells.map((c) => c.cellH), 26);
        ensureSpace(rowH + 4);
        wrappedCells.forEach((cell, idx) => {
          const visualCol = isRtl && cols === 2 ? 1 - idx : idx;
          const boxX = marginX + visualCol * (colW + gap);
          page.drawRectangle({
            x: boxX,
            y: y - rowH,
            width: colW,
            height: rowH,
            color: PALETTE.white,
            borderColor: PALETTE.border,
            borderWidth: 0.5
          });
          let cy = y - 11;
          for (const ll of cell.lblLines) {
            drawAlignedLine(page, ll, boxX + 7, cy, colW - 14, fontBold, 7.5, defaultAlign, PALETTE.muted);
            cy -= 10;
          }
          for (const vl of cell.valLines) {
            drawAlignedLine(
              page,
              vl,
              boxX + 7,
              cy,
              colW - 14,
              cell.item.emphasize ? fontBold : fontReg,
              8.8,
              defaultAlign,
              cell.item.emphasize ? PALETTE.accent : PALETTE.ink
            );
            cy -= 11.5;
          }
        });
        y -= rowH + 5;
      }
      y -= 4;
    } else if (section.type === "table") {
      if (section.title) drawSectionHeading(section.title);
      const totalWeight = section.columns.reduce((acc, c) => acc + c.widthWeight, 0) || 1;
      const orderedCols = isRtl ? [...section.columns].reverse() : section.columns;
      const colWidths = orderedCols.map((c) => c.widthWeight / totalWeight * contentWidth);
      const drawTableHeader = () => {
        const hdrH = 20;
        ensureSpace(hdrH + 16);
        page.drawRectangle({
          x: marginX,
          y: y - hdrH,
          width: contentWidth,
          height: hdrH,
          color: PALETTE.accent
        });
        let cx = marginX;
        orderedCols.forEach((col, idx) => {
          const w = colWidths[idx];
          const align = col.align ?? (isRtl ? "right" : "left");
          const lbl = wrapTextForPdf(col.label, w - 8, fontBold, 7.8, baseDir)[0] ?? "";
          drawAlignedLine(page, lbl, cx + 4, y - 13, w - 8, fontBold, 7.8, align, PALETTE.white);
          cx += w;
        });
        y -= hdrH;
      };
      drawTableHeader();
      if (section.rows.length === 0) {
        const emptyH = 22;
        ensureSpace(emptyH);
        page.drawRectangle({
          x: marginX,
          y: y - emptyH,
          width: contentWidth,
          height: emptyH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.5
        });
        drawAlignedLine(
          page,
          prepareLineForPdf(section.emptyText || (isRtl ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0633\u062C\u0644\u0629" : "Aucune donn\xE9e enregistr\xE9e"), baseDir),
          marginX + 8,
          y - 14,
          contentWidth - 16,
          fontReg,
          8.2,
          "center",
          PALETTE.muted
        );
        y -= emptyH + 8;
        continue;
      }
      section.rows.forEach((row, rowIdx) => {
        const cellWrapped = orderedCols.map((col, idx) => {
          const raw = row[col.key];
          const valStr = raw === null || raw === void 0 || raw === "" ? "\u2014" : String(raw);
          return wrapTextForPdf(valStr, colWidths[idx] - 8, fontReg, 8, baseDir);
        });
        const maxLines = Math.max(...cellWrapped.map((l) => l.length), 1);
        const rowH = Math.max(18, maxLines * 10.5 + 8);
        if (y - rowH < footerReserve) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          pages.push(page);
          y = drawAgencyHeader(page, true);
          drawTableHeader();
        }
        page.drawRectangle({
          x: marginX,
          y: y - rowH,
          width: contentWidth,
          height: rowH,
          color: rowIdx % 2 === 1 ? PALETTE.surface : PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.4
        });
        let cx = marginX;
        orderedCols.forEach((col, idx) => {
          const w = colWidths[idx];
          const align = col.align ?? (isRtl ? "right" : "left");
          const lines = cellWrapped[idx];
          lines.forEach((line, li) => {
            drawAlignedLine(page, line, cx + 4, y - 11.5 - li * 10.5, w - 8, fontReg, 8, align, PALETTE.ink);
          });
          cx += w;
        });
        y -= rowH;
      });
      y -= 8;
    } else if (section.type === "summary_box") {
      if (section.title) drawSectionHeading(section.title);
      const boxH = section.rows.length * 18 + 10;
      ensureSpace(boxH + 4);
      page.drawRectangle({
        x: marginX,
        y: y - boxH,
        width: contentWidth,
        height: boxH,
        color: PALETTE.surface,
        borderColor: PALETTE.border,
        borderWidth: 0.75
      });
      let sy = y - 16;
      for (const r of section.rows) {
        const lblFont = r.highlight ? fontBold : fontReg;
        const valFont = r.highlight ? fontBold : fontMono;
        const labelX = isRtl ? marginX + contentWidth * 0.42 : marginX + 10;
        const labelW = contentWidth * 0.56 - 10;
        const valX = isRtl ? marginX + 10 : marginX + contentWidth * 0.58;
        const valW = contentWidth * 0.42 - 14;
        drawAlignedLine(
          page,
          prepareLineForPdf(r.label, baseDir),
          labelX,
          sy,
          labelW,
          lblFont,
          r.highlight ? 9.5 : 8.5,
          isRtl ? "right" : "left",
          r.highlight ? PALETTE.accent : PALETTE.ink
        );
        drawAlignedLine(
          page,
          prepareLineForPdf(r.value, baseDir),
          valX,
          sy,
          valW,
          valFont,
          r.highlight ? 9.5 : 8.5,
          isRtl ? "left" : "right",
          r.highlight ? PALETTE.accent : PALETTE.ink
        );
        sy -= 18;
      }
      y -= boxH + 8;
    } else if (section.type === "text_block") {
      if (section.title) drawSectionHeading(section.title);
      const lines = wrapTextForPdf(section.text, contentWidth - 16, fontReg, 8.3, baseDir);
      let idx = 0;
      while (idx < lines.length) {
        const availableH = y - footerReserve - 16;
        const maxLinesFit = Math.max(1, Math.floor(availableH / 11.5));
        const chunk = lines.slice(idx, idx + maxLinesFit);
        const boxH = chunk.length * 11.5 + 12;
        page.drawRectangle({
          x: marginX,
          y: y - boxH,
          width: contentWidth,
          height: boxH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.5
        });
        chunk.forEach((line, li) => {
          drawAlignedLine(
            page,
            line,
            marginX + 8,
            y - 13 - li * 11.5,
            contentWidth - 16,
            fontReg,
            8.3,
            defaultAlign,
            section.muted ? PALETTE.slate : PALETTE.ink
          );
        });
        y -= boxH + 6;
        idx += chunk.length;
        if (idx < lines.length) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          pages.push(page);
          y = drawAgencyHeader(page, true);
        }
      }
    } else if (section.type === "signatures" && payload.template.showSignatureBoxes) {
      const sigH = 84;
      ensureSpace(sigH + 6);
      const boxW = (contentWidth - 14) / 2;
      const leftImg = await embedOptionalImage(pdfDoc, section.leftImageDataUrl);
      const rightImg = await embedOptionalImage(pdfDoc, section.rightImageDataUrl);
      const leftBox = {
        label: section.leftLabel,
        subtitle: section.leftSubtitle,
        img: leftImg,
        x: isRtl ? marginX + boxW + 14 : marginX
      };
      const rightBox = {
        label: section.rightLabel,
        subtitle: section.rightSubtitle,
        img: rightImg,
        x: isRtl ? marginX : marginX + boxW + 14
      };
      for (const box of [leftBox, rightBox]) {
        page.drawRectangle({
          x: box.x,
          y: y - sigH,
          width: boxW,
          height: sigH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.75
        });
        drawAlignedLine(
          page,
          prepareLineForPdf(box.label, baseDir),
          box.x + 8,
          y - 14,
          boxW - 16,
          fontBold,
          8.2,
          defaultAlign,
          PALETTE.slate
        );
        if (box.img) {
          const scaled = box.img.scaleToFit(boxW - 24, 46);
          page.drawImage(box.img, {
            x: box.x + (boxW - scaled.width) / 2,
            y: y - sigH + 16,
            width: scaled.width,
            height: scaled.height
          });
        }
        if (box.subtitle) {
          drawAlignedLine(
            page,
            prepareLineForPdf(box.subtitle, baseDir),
            box.x + 8,
            y - sigH + 6,
            boxW - 16,
            fontReg,
            7.2,
            defaultAlign,
            PALETTE.muted
          );
        }
      }
      y -= sigH + 8;
    }
  }
  const totalPages = pages.length;
  const footerText = sanitizePdfText(isRtl ? payload.template.footerAr : payload.template.footerFr);
  pages.forEach((p, idx) => {
    const pageNumText = isRtl ? `\u0635\u0641\u062D\u0629 ${idx + 1} / ${totalPages}` : `Page ${idx + 1} / ${totalPages}`;
    const lineY = 26;
    p.drawLine({
      start: { x: marginX, y: lineY + 8 },
      end: { x: pageWidth - marginX, y: lineY + 8 },
      thickness: 0.5,
      color: PALETTE.border
    });
    if (footerText) {
      const fLine = wrapTextForPdf(footerText, contentWidth - 90, fontReg, 7.2, baseDir)[0] ?? "";
      drawAlignedLine(
        p,
        fLine,
        isRtl ? marginX + 90 : marginX,
        lineY - 2,
        contentWidth - 90,
        fontReg,
        7.2,
        defaultAlign,
        PALETTE.muted
      );
    }
    drawAlignedLine(
      p,
      prepareLineForPdf(applyNumeralPreference(pageNumText, payload.numeralSystem), baseDir),
      isRtl ? marginX : marginX + contentWidth - 85,
      lineY - 2,
      85,
      fontReg,
      7.5,
      isRtl ? "left" : "right",
      PALETTE.slate
    );
  });
  return pdfDoc.save();
}
async function renderThermalReceiptPdf(payload) {
  const is58 = payload.format === "THERMAL_58MM";
  const pageWidth = is58 ? 164.41 : 226.77;
  const marginX = is58 ? 8 : 11;
  const contentWidth = pageWidth - marginX * 2;
  const isRtl = payload.language === "ar";
  const baseDir = isRtl ? "rtl" : "ltr";
  const align = isRtl ? "right" : "left";
  const baseFontSize = is58 ? 7.2 : 8.2;
  const smallFontSize = is58 ? 6.4 : 7.2;
  const pdfDoc = await import_pdf_lib.PDFDocument.create();
  pdfDoc.registerFontkit(import_fontkit.default);
  const fonts = loadFontBundle();
  const fontReg = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold = await pdfDoc.embedFont(fonts.bold, { subset: true });
  const ops = [];
  ops.push({ kind: "text", text: payload.template.agencyName || "Agence", size: baseFontSize + 1.4, bold: true, align: "center", gapAfter: 2 });
  if (payload.template.agencyPhone) {
    ops.push({ kind: "text", text: payload.template.agencyPhone, size: smallFontSize, align: "center", gapAfter: 1 });
  }
  if (payload.template.agencyAddress) {
    ops.push({ kind: "text", text: payload.template.agencyAddress, size: smallFontSize, align: "center", gapAfter: 2 });
  }
  ops.push({ kind: "hr" });
  ops.push({ kind: "text", text: payload.title, size: baseFontSize + 0.6, bold: true, align: "center", gapAfter: 2 });
  ops.push({ kind: "text", text: applyNumeralPreference(payload.documentNumber, payload.numeralSystem), size: baseFontSize, bold: true, align: "center", gapAfter: 2 });
  ops.push({ kind: "text", text: payload.issueDateDisplay, size: smallFontSize, align: "center", gapAfter: 2 });
  if (payload.isCopy) {
    ops.push({
      kind: "text",
      text: isRtl ? `*** \u0646\u0633\u062E\u0629 (#${payload.copyNumber ?? 1}) ***` : `*** COPIE (#${payload.copyNumber ?? 1}) ***`,
      size: baseFontSize,
      bold: true,
      align: "center",
      color: PALETTE.copyRed,
      gapAfter: 2
    });
  }
  ops.push({ kind: "hr" });
  for (const sec of payload.sections) {
    if (sec.type === "kv_grid") {
      if (sec.title) ops.push({ kind: "text", text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const item of sec.items) {
        ops.push({ kind: "kv", label: item.label, value: item.value || "\u2014", bold: item.emphasize });
      }
      ops.push({ kind: "hr" });
    } else if (sec.type === "table") {
      if (sec.title) ops.push({ kind: "text", text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const row of sec.rows) {
        const line = sec.columns.map((c) => String(row[c.key] ?? "\u2014")).join(" \xB7 ");
        ops.push({ kind: "text", text: line, size: smallFontSize, align, gapAfter: 2 });
      }
      ops.push({ kind: "hr" });
    } else if (sec.type === "summary_box") {
      if (sec.title) ops.push({ kind: "text", text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const r of sec.rows) {
        ops.push({ kind: "kv", label: r.label, value: r.value, bold: r.highlight });
      }
      ops.push({ kind: "hr" });
    } else if (sec.type === "text_block") {
      if (sec.title) ops.push({ kind: "text", text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      ops.push({ kind: "text", text: sec.text, size: smallFontSize, align, gapAfter: 3 });
    }
  }
  const footerTxt = isRtl ? payload.template.footerAr : payload.template.footerFr;
  if (footerTxt) {
    ops.push({ kind: "text", text: footerTxt, size: smallFontSize, align: "center", gapAfter: 3 });
  }
  let totalHeight = 24;
  const lineSpacing = 2.6;
  const computedLines = [];
  for (const op of ops) {
    if (op.kind === "hr") {
      totalHeight += 8;
      computedLines.push({ kind: "hr" });
    } else if (op.kind === "text") {
      const f = op.bold ? fontBold : fontReg;
      const wrapped = wrapTextForPdf(op.text, contentWidth, f, op.size, baseDir);
      totalHeight += wrapped.length * (op.size + lineSpacing) + (op.gapAfter ?? 2);
      computedLines.push({
        kind: "lines",
        lines: wrapped,
        size: op.size,
        bold: Boolean(op.bold),
        align: op.align ?? align,
        gapAfter: op.gapAfter ?? 2,
        color: op.color ?? PALETTE.ink
      });
    } else if (op.kind === "kv") {
      const f = op.bold ? fontBold : fontReg;
      const lblLines = wrapTextForPdf(`${op.label}:`, contentWidth * 0.48, fontReg, smallFontSize, baseDir);
      const valLines = wrapTextForPdf(op.value, contentWidth * 0.5, f, baseFontSize, baseDir);
      const rows = Math.max(lblLines.length, valLines.length);
      totalHeight += rows * (baseFontSize + lineSpacing) + 2;
      computedLines.push({ kind: "kv", lblLines, valLines, bold: Boolean(op.bold) });
    }
  }
  const pageHeight = Math.max(220, Math.ceil(totalHeight + 18));
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 14;
  for (const item of computedLines) {
    if (item.kind === "hr") {
      page.drawLine({
        start: { x: marginX, y: y - 3 },
        end: { x: pageWidth - marginX, y: y - 3 },
        thickness: 0.6,
        dashArray: [2, 2],
        color: PALETTE.slate
      });
      y -= 8;
    } else if (item.kind === "lines") {
      const f = item.bold ? fontBold : fontReg;
      for (const l of item.lines) {
        drawAlignedLine(page, l, marginX, y - item.size, contentWidth, f, item.size, item.align, item.color);
        y -= item.size + lineSpacing;
      }
      y -= item.gapAfter;
    } else if (item.kind === "kv") {
      const rows = Math.max(item.lblLines.length, item.valLines.length);
      const valFont = item.bold ? fontBold : fontReg;
      for (let i = 0; i < rows; i++) {
        const ll = item.lblLines[i] ?? "";
        const vl = item.valLines[i] ?? "";
        if (isRtl) {
          drawAlignedLine(page, ll, marginX + contentWidth * 0.52, y - baseFontSize, contentWidth * 0.48, fontReg, smallFontSize, "right", PALETTE.slate);
          drawAlignedLine(page, vl, marginX, y - baseFontSize, contentWidth * 0.5, valFont, baseFontSize, "left", PALETTE.ink);
        } else {
          drawAlignedLine(page, ll, marginX, y - baseFontSize, contentWidth * 0.48, fontReg, smallFontSize, "left", PALETTE.slate);
          drawAlignedLine(page, vl, marginX + contentWidth * 0.5, y - baseFontSize, contentWidth * 0.5, valFont, baseFontSize, "right", PALETTE.ink);
        }
        y -= baseFontSize + lineSpacing;
      }
      y -= 2;
    }
  }
  return pdfDoc.save();
}

// electron/database/services/depositService.ts
var import_node_crypto6 = __toESM(require("node:crypto"), 1);
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);
function mapDepositRow(r) {
  const amountMinor = Number(r.amount_minor ?? 0);
  const deductedAmountMinor = Number(r.deducted_amount_minor ?? 0);
  const refundedAmountMinor = Number(r.refunded_amount_minor ?? 0);
  return {
    id: r.id,
    contractId: r.contract_id,
    contractNumber: r.contract_number,
    contractStatus: r.contract_status,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    vehicleId: r.vehicle_id,
    vehicleLabel: r.vehicle_label,
    amountMinor,
    currency: r.currency,
    status: r.status,
    receivedDate: r.received_date,
    returnedDate: r.returned_date ?? null,
    deductedAmountMinor,
    refundedAmountMinor,
    remainingHeldMinor: Math.max(0, amountMinor - deductedAmountMinor - refundedAmountMinor),
    deductionReason: r.deduction_reason ?? null,
    receivedMethod: r.received_method ?? "CASH",
    refundMethod: r.refund_method ?? null,
    hasSupportingDoc: Boolean(r.supporting_doc_path),
    supportingDocOriginalName: r.supporting_doc_original_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function listDeposits(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("d.status = ?");
    params.push(filters.status);
  }
  if (filters?.customerId) {
    clauses.push("d.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push("(rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ?)");
    params.push(q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT d.*,
              rc.contract_number, rc.status AS contract_status, rc.vehicle_id,
              c.full_name AS customer_name, c.phone AS customer_phone,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       JOIN customers c ON c.id = d.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       ${where}
       ORDER BY d.id DESC`
  ).all(...params);
  return rows.map(mapDepositRow);
}
function listTrafficFines(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.contractId) {
    clauses.push("tf.contract_id = ?");
    params.push(filters.contractId);
  }
  if (filters?.customerId) {
    clauses.push("tf.customer_id = ?");
    params.push(filters.customerId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(
    `SELECT tf.*,
              rc.contract_number,
              c.full_name AS customer_name,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM traffic_fines tf
       LEFT JOIN rental_contracts rc ON rc.id = tf.contract_id
       JOIN customers c ON c.id = tf.customer_id
       JOIN vehicles v ON v.id = tf.vehicle_id
       ${where}
       ORDER BY tf.incurred_date DESC, tf.id DESC`
  ).all(...params).map((r) => ({
    id: r.id,
    contractId: r.contract_id ?? null,
    contractNumber: r.contract_number ?? null,
    vehicleId: r.vehicle_id,
    vehicleLabel: r.vehicle_label,
    customerId: r.customer_id,
    customerName: r.customer_name,
    fineType: r.fine_type,
    referenceNumber: r.reference_number ?? null,
    incurredDate: r.incurred_date,
    amountMinor: Number(r.amount_minor),
    isPaidByCustomer: r.is_paid_by_customer === 1,
    notes: r.notes ?? null,
    createdAt: r.created_at
  }));
}
function createTrafficFine(db, actor, input) {
  const tx = db.transaction(() => {
    const res = db.prepare(
      `INSERT INTO traffic_fines (
          contract_id, vehicle_id, customer_id, fine_type, reference_number,
          incurred_date, amount_minor, is_paid_by_customer, notes, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      input.contractId ?? null,
      input.vehicleId,
      input.customerId,
      input.fineType,
      input.referenceNumber?.trim() || null,
      input.incurredDate,
      input.amountMinor,
      input.notes?.trim() || null,
      actor.id
    );
    const fineId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "TRAFFIC_FINE_RECORDED",
      entityType: "traffic_fines",
      entityId: fineId,
      newValue: input
    });
    return listTrafficFines(db).find((f) => f.id === fineId);
  });
  return tx();
}
function getDepositDetail(db, depositId) {
  const row = db.prepare(
    `SELECT d.*,
              rc.contract_number, rc.status AS contract_status, rc.vehicle_id,
              rc.damage_charge_minor, rc.late_fee_minor, rc.extra_km_charge_minor, rc.other_charges_minor,
              c.full_name AS customer_name, c.phone AS customer_phone,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label
       FROM deposits d
       JOIN rental_contracts rc ON rc.id = d.contract_id
       JOIN customers c ON c.id = d.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       WHERE d.id = ?`
  ).get(depositId);
  if (!row) throw new AuthError("NOT_FOUND", "Caution introuvable");
  const movements = db.prepare(
    `SELECT dm.*, u.username AS recorded_by_username, tf.fine_type, tf.reference_number AS fine_reference
       FROM deposit_movements dm
       JOIN users u ON u.id = dm.recorded_by_user_id
       LEFT JOIN traffic_fines tf ON tf.id = dm.traffic_fine_id
       WHERE dm.deposit_id = ?
       ORDER BY dm.id ASC`
  ).all(depositId).map((m) => ({
    id: m.id,
    depositId: m.deposit_id,
    movementType: m.movement_type,
    amountMinor: Number(m.amount_minor),
    chargeCategory: m.charge_category ?? null,
    trafficFineId: m.traffic_fine_id ?? null,
    fineReference: m.fine_reference ?? null,
    paymentMethod: m.payment_method ?? null,
    reason: m.reason ?? null,
    recordedByUserId: m.recorded_by_user_id,
    recordedByUsername: m.recorded_by_username,
    createdAt: m.created_at
  }));
  const fines = listTrafficFines(db, { contractId: row.contract_id });
  return {
    deposit: mapDepositRow(row),
    contractCharges: {
      damageChargeMinor: Number(row.damage_charge_minor ?? 0),
      lateFeeMinor: Number(row.late_fee_minor ?? 0),
      extraKmChargeMinor: Number(row.extra_km_charge_minor ?? 0),
      otherChargesMinor: Number(row.other_charges_minor ?? 0)
    },
    movements,
    fines
  };
}
function settleDeposit(db, actor, vaultRootDir, vaultKey, input) {
  const tx = db.transaction(() => {
    const dep = db.prepare("SELECT * FROM deposits WHERE id = ?").get(input.depositId);
    if (!dep) throw new AuthError("NOT_FOUND", "Caution introuvable");
    const totalAmountMinor = Number(dep.amount_minor);
    const alreadyDeducted = Number(dep.deducted_amount_minor);
    const alreadyRefunded = Number(dep.refunded_amount_minor);
    const remainingHeld = Math.max(0, totalAmountMinor - alreadyDeducted - alreadyRefunded);
    if (input.deductedAmountMinor + input.refundedAmountMinor <= 0) {
      throw new AuthError("VALIDATION_ERROR", "Indiquez un montant d\xE9duit et/ou rembours\xE9 sup\xE9rieur \xE0 z\xE9ro");
    }
    if (input.deductedAmountMinor + input.refundedAmountMinor > remainingHeld) {
      throw new AuthError(
        "VALIDATION_ERROR",
        `Total d\xE9duit + rembours\xE9 d\xE9passe le solde retenu disponible (${remainingHeld / 100})`
      );
    }
    if (input.deductedAmountMinor > 0) {
      if (!input.deductionReason || input.deductionReason.trim().length < 3) {
        throw new AuthError(
          "VALIDATION_ERROR",
          "Un motif justifi\xE9 est obligatoire pour toute retenue sur caution"
        );
      }
      if (!input.chargeCategory) {
        throw new AuthError(
          "VALIDATION_ERROR",
          "S\xE9lectionnez la cat\xE9gorie de charge justifiant la retenue sur caution"
        );
      }
    }
    if (input.trafficFineId) {
      const fine = db.prepare("SELECT * FROM traffic_fines WHERE id = ?").get(input.trafficFineId);
      if (!fine) throw new AuthError("NOT_FOUND", "Amende associ\xE9e introuvable");
      if (fine.customer_id !== dep.customer_id) {
        throw new AuthError("VALIDATION_ERROR", "Cette amende appartient \xE0 un autre client");
      }
    }
    let nextDocPath = dep.supporting_doc_path ?? null;
    let nextDocName = dep.supporting_doc_original_name ?? null;
    let nextDocMime = dep.supporting_doc_mime_type ?? null;
    if (input.supportingDoc) {
      const validated = validateAndDecodeUpload({
        originalFileName: input.supportingDoc.originalFileName,
        mimeType: input.supportingDoc.mimeType,
        base64Data: input.supportingDoc.base64Data
      });
      const encrypted = encryptBuffer(validated.bytes, vaultKey);
      const opaqueName = `dep_${dep.id}_${import_node_crypto6.default.randomUUID()}.enc`;
      const relPath = import_node_path9.default.join("deposits", opaqueName);
      const fullPath = resolveConfinedPath(vaultRootDir, relPath);
      import_node_fs8.default.mkdirSync(import_node_path9.default.dirname(fullPath), { recursive: true });
      import_node_fs8.default.writeFileSync(fullPath, encrypted, { mode: 384 });
      nextDocPath = relPath;
      nextDocName = validated.safeFileName;
      nextDocMime = validated.mimeType;
    }
    if (input.deductedAmountMinor > 0) {
      db.prepare(
        `INSERT INTO deposit_movements (
          deposit_id, movement_type, amount_minor, charge_category, traffic_fine_id, reason, recorded_by_user_id
        ) VALUES (?, 'DEDUCTED', ?, ?, ?, ?, ?)`
      ).run(
        dep.id,
        input.deductedAmountMinor,
        input.chargeCategory ?? "OTHER",
        input.trafficFineId ?? null,
        input.deductionReason.trim(),
        actor.id
      );
      if (input.trafficFineId) {
        db.prepare("UPDATE traffic_fines SET is_paid_by_customer = 1 WHERE id = ?").run(input.trafficFineId);
      }
    }
    const refundMethod = input.refundMethod ?? "CASH";
    if (input.refundedAmountMinor > 0) {
      const refMovRes = db.prepare(
        `INSERT INTO deposit_movements (
            deposit_id, movement_type, amount_minor, payment_method, reason, recorded_by_user_id
          ) VALUES (?, 'REFUNDED', ?, ?, ?, ?)`
      ).run(
        dep.id,
        input.refundedAmountMinor,
        refundMethod,
        input.deductedAmountMinor > 0 ? "Remboursement du reliquat de caution" : "Restitution de caution client",
        actor.id
      );
      const contractRow = db.prepare("SELECT contract_number FROM rental_contracts WHERE id = ?").get(dep.contract_id);
      appendCashMovementIfOpenSession(db, {
        actorId: actor.id,
        currency: dep.currency,
        paymentMethod: refundMethod,
        movementType: "DEPOSIT_REFUND",
        amountMinor: input.refundedAmountMinor,
        depositMovementId: Number(refMovRes.lastInsertRowid),
        description: `Restitution caution (${contractRow?.contract_number ?? `#${dep.contract_id}`})`
      });
    }
    const nextDeducted = alreadyDeducted + input.deductedAmountMinor;
    const nextRefunded = alreadyRefunded + input.refundedAmountMinor;
    const isFullySettled = nextDeducted + nextRefunded >= totalAmountMinor;
    const nextStatus = !isFullySettled ? "HELD" : nextDeducted === 0 ? "RETURNED" : nextRefunded === 0 ? "FULLY_DEDUCTED" : "PARTIALLY_DEDUCTED";
    const reasonMerged = input.deductionReason?.trim() && dep.deduction_reason ? `${dep.deduction_reason} | ${input.deductionReason.trim()}` : input.deductionReason?.trim() || dep.deduction_reason || null;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    db.prepare(
      `UPDATE deposits
       SET status = ?,
           deducted_amount_minor = ?,
           refunded_amount_minor = ?,
           deduction_reason = ?,
           refund_method = COALESCE(?, refund_method),
           returned_date = ?,
           settled_by_user_id = ?,
           supporting_doc_path = ?,
           supporting_doc_original_name = ?,
           supporting_doc_mime_type = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextStatus,
      nextDeducted,
      nextRefunded,
      reasonMerged,
      input.refundedAmountMinor > 0 ? refundMethod : null,
      input.refundedAmountMinor > 0 || isFullySettled ? today : dep.returned_date,
      actor.id,
      nextDocPath,
      nextDocName,
      nextDocMime,
      dep.id
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "DEPOSIT_SETTLED",
      entityType: "deposits",
      entityId: dep.id,
      previousValue: { status: dep.status, deductedAmountMinor: alreadyDeducted, refundedAmountMinor: alreadyRefunded },
      newValue: {
        status: nextStatus,
        deductedAmountMinor: nextDeducted,
        refundedAmountMinor: nextRefunded,
        chargeCategory: input.chargeCategory ?? null
      },
      reason: input.deductionReason?.trim() || null
    });
    return getDepositDetail(db, dep.id);
  });
  return tx();
}
function readDepositDocument(db, vaultRootDir, vaultKey, depositId) {
  const row = db.prepare("SELECT * FROM deposits WHERE id = ?").get(depositId);
  if (!row || !row.supporting_doc_path) {
    throw new AuthError("NOT_FOUND", "Justificatif de caution introuvable");
  }
  const fullPath = resolveConfinedPath(vaultRootDir, row.supporting_doc_path);
  const encrypted = import_node_fs8.default.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);
  return {
    id: row.id,
    originalFileName: row.supporting_doc_original_name || "justificatif_caution",
    mimeType: row.supporting_doc_mime_type || "application/pdf",
    base64Data: plain.toString("base64")
  };
}

// electron/database/services/fleetService.ts
function mapVehicle(row) {
  return {
    id: row.id,
    internalCode: row.internal_code,
    matricule: row.matricule,
    vin: row.vin,
    brand: row.brand,
    model: row.model,
    year: row.year,
    color: row.color,
    category: row.category,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    seats: row.seats,
    currentOdometerKm: row.current_odometer_km,
    acquisitionDate: row.acquisition_date,
    acquisitionCostMinor: row.acquisition_cost_minor,
    defaultDailyRateMinor: row.default_daily_rate_minor,
    defaultWeeklyRateMinor: row.default_weekly_rate_minor,
    defaultMonthlyRateMinor: row.default_monthly_rate_minor,
    status: row.status,
    notes: row.notes,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function mapVehicleDoc(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    docType: row.doc_type,
    documentNumber: row.document_number,
    issueDate: row.issue_date,
    expirationDate: row.expiration_date,
    reminderDays: row.reminder_days,
    filePath: row.file_path,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function validateMatriculeAgainstSettings(db, matricule) {
  const enforce = db.prepare(
    "SELECT setting_value FROM application_settings WHERE setting_key = 'business.enforce_matricule_regex'"
  ).get();
  if (enforce?.setting_value === "false") return;
  const custom = db.prepare(
    "SELECT setting_value FROM application_settings WHERE setting_key = 'business.custom_matricule_regex'"
  ).get();
  const regex = custom?.setting_value && custom.setting_value.trim().length > 0 ? new RegExp(custom.setting_value.trim()) : STANDARD_ALGERIAN_MATRICULE_REGEX;
  if (!regex.test(matricule.trim())) {
    throw new AuthError(
      "VALIDATION_ERROR",
      `Format de matricule alg\xE9rien invalide (ex: 00123-124-16): ${matricule}`
    );
  }
}
function listVehicles(db, filters) {
  const clauses = [];
  const params = [];
  if (!filters?.includeArchived) {
    clauses.push("is_archived = 0");
  }
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.category && filters.category !== "ALL") {
    clauses.push("category = ?");
    params.push(filters.category);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push("(internal_code LIKE ? OR matricule LIKE ? OR brand LIKE ? OR model LIKE ? OR COALESCE(vin, '') LIKE ?)");
    params.push(q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM vehicles ${where} ORDER BY id DESC`).all(...params);
  return rows.map(mapVehicle);
}
function getVehicleProfile(db, vehicleId) {
  const row = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(vehicleId);
  if (!row) {
    throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
  }
  const documents = db.prepare("SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expiration_date ASC").all(vehicleId).map(mapVehicleDoc);
  const blockedPeriods = db.prepare(
    "SELECT * FROM vehicle_blocked_periods WHERE vehicle_id = ? ORDER BY start_date DESC"
  ).all(vehicleId).map((b) => ({
    id: b.id,
    vehicleId: b.vehicle_id,
    blockType: b.block_type,
    startDate: b.start_date,
    endDate: b.end_date,
    reason: b.reason,
    isActive: b.is_active === 1,
    createdAt: b.created_at
  }));
  const rentalHistory = db.prepare(
    `SELECT rc.*, c.full_name AS customer_name
       FROM rental_contracts rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE rc.vehicle_id = ?
       ORDER BY rc.start_date DESC`
  ).all(vehicleId).map((c) => ({
    id: c.id,
    contractNumber: c.contract_number,
    customerId: c.customer_id,
    customerName: c.customer_name,
    status: c.status,
    startDate: c.start_date,
    expectedReturnDate: c.expected_return_date,
    actualReturnDate: c.actual_return_date,
    totalContractAmountMinor: c.total_contract_amount_minor,
    currency: c.currency
  }));
  const reservations = db.prepare(
    `SELECT r.*, c.full_name AS customer_name
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.vehicle_id = ?
       ORDER BY r.start_date DESC`
  ).all(vehicleId).map((r) => ({
    id: r.id,
    reservationNumber: r.reservation_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    status: r.status,
    startDate: r.start_date,
    expectedReturnDate: r.expected_return_date,
    estimatedTotalMinor: r.estimated_total_minor
  }));
  return {
    vehicle: mapVehicle(row),
    documents,
    blockedPeriods,
    rentalHistory,
    reservations
  };
}
function createVehicle(db, actor, input) {
  validateMatriculeAgainstSettings(db, input.matricule);
  const tx = db.transaction(() => {
    const dupCode = db.prepare("SELECT id FROM vehicles WHERE internal_code = ?").get(input.internalCode.trim());
    if (dupCode) {
      throw new AuthError("CONFLICT", `Code interne d\xE9j\xE0 utilis\xE9: ${input.internalCode}`);
    }
    const dupMatricule = db.prepare("SELECT id FROM vehicles WHERE matricule = ?").get(input.matricule.trim());
    if (dupMatricule) {
      throw new AuthError("CONFLICT", `Matricule d\xE9j\xE0 enregistr\xE9: ${input.matricule}`);
    }
    const vin = input.vin?.trim() ? input.vin.trim() : null;
    if (vin) {
      const dupVin = db.prepare("SELECT id FROM vehicles WHERE vin = ?").get(vin);
      if (dupVin) {
        throw new AuthError("CONFLICT", `Num\xE9ro de ch\xE2ssis (VIN) d\xE9j\xE0 enregistr\xE9: ${vin}`);
      }
    }
    const res = db.prepare(
      `INSERT INTO vehicles (
          internal_code, matricule, vin, brand, model, year, color, category,
          fuel_type, transmission, seats, current_odometer_km, acquisition_date,
          acquisition_cost_minor, default_daily_rate_minor, default_weekly_rate_minor,
          default_monthly_rate_minor, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?)`
    ).run(
      input.internalCode.trim(),
      input.matricule.trim(),
      vin,
      input.brand.trim(),
      input.model.trim(),
      input.year,
      input.color.trim(),
      input.category.trim(),
      input.fuelType,
      input.transmission,
      input.seats,
      input.currentOdometerKm,
      input.acquisitionDate || null,
      input.acquisitionCostMinor ?? null,
      input.defaultDailyRateMinor,
      input.defaultWeeklyRateMinor ?? null,
      input.defaultMonthlyRateMinor ?? null,
      input.notes ?? null
    );
    const newId = Number(res.lastInsertRowid);
    const created = mapVehicle(db.prepare("SELECT * FROM vehicles WHERE id = ?").get(newId));
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_CREATED",
      entityType: "vehicles",
      entityId: newId,
      newValue: created
    });
    return created;
  });
  return tx();
}
function updateVehicle(db, actor, input) {
  if (input.matricule) {
    validateMatriculeAgainstSettings(db, input.matricule);
  }
  const tx = db.transaction(() => {
    const existingRow = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(input.id);
    if (!existingRow) {
      throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    }
    const prev = mapVehicle(existingRow);
    if (input.status && input.status !== prev.status) {
      const activeContract = db.prepare(
        "SELECT contract_number FROM rental_contracts WHERE vehicle_id = ? AND status IN ('ACTIVE', 'EXTENDED') LIMIT 1"
      ).get(input.id);
      if (activeContract && input.status === "AVAILABLE") {
        throw new AuthError(
          "CONFLICT",
          `Impossible de marquer le v\xE9hicule disponible: contrat actif ${activeContract.contract_number}`
        );
      }
      if (input.status === "RENTED" && !activeContract) {
        throw new AuthError(
          "VALIDATION_ERROR",
          "Le statut Lou\xE9 (RENTED) ne peut \xEAtre d\xE9fini manuellement sans contrat actif"
        );
      }
    }
    const nextVin = input.vin !== void 0 ? input.vin?.trim() || null : prev.vin;
    db.prepare(
      `UPDATE vehicles SET
        internal_code = ?, matricule = ?, vin = ?, brand = ?, model = ?, year = ?,
        color = ?, category = ?, fuel_type = ?, transmission = ?, seats = ?,
        current_odometer_km = ?, acquisition_date = ?, acquisition_cost_minor = ?,
        default_daily_rate_minor = ?, default_weekly_rate_minor = ?, default_monthly_rate_minor = ?,
        status = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.internalCode?.trim() ?? prev.internalCode,
      input.matricule?.trim() ?? prev.matricule,
      nextVin,
      input.brand?.trim() ?? prev.brand,
      input.model?.trim() ?? prev.model,
      input.year ?? prev.year,
      input.color?.trim() ?? prev.color,
      input.category?.trim() ?? prev.category,
      input.fuelType ?? prev.fuelType,
      input.transmission ?? prev.transmission,
      input.seats ?? prev.seats,
      input.currentOdometerKm ?? prev.currentOdometerKm,
      input.acquisitionDate !== void 0 ? input.acquisitionDate || null : prev.acquisitionDate,
      input.acquisitionCostMinor !== void 0 ? input.acquisitionCostMinor : prev.acquisitionCostMinor,
      input.defaultDailyRateMinor ?? prev.defaultDailyRateMinor,
      input.defaultWeeklyRateMinor !== void 0 ? input.defaultWeeklyRateMinor : prev.defaultWeeklyRateMinor,
      input.defaultMonthlyRateMinor !== void 0 ? input.defaultMonthlyRateMinor : prev.defaultMonthlyRateMinor,
      input.status ?? prev.status,
      input.notes !== void 0 ? input.notes : prev.notes,
      input.id
    );
    const updated = mapVehicle(db.prepare("SELECT * FROM vehicles WHERE id = ?").get(input.id));
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_UPDATED",
      entityType: "vehicles",
      entityId: input.id,
      previousValue: prev,
      newValue: updated
    });
    return updated;
  });
  return tx();
}
function archiveVehicle(db, actor, vehicleId) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(vehicleId);
    if (!existing) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    const activeOrReserved = db.prepare(
      "SELECT id FROM rental_contracts WHERE vehicle_id = ? AND status IN ('CONFIRMED', 'ACTIVE', 'EXTENDED') LIMIT 1"
    ).get(vehicleId);
    if (activeOrReserved) {
      throw new AuthError("CONFLICT", "Impossible d\u2019archiver un v\xE9hicule li\xE9 \xE0 un contrat actif ou confirm\xE9");
    }
    db.prepare(
      "UPDATE vehicles SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(vehicleId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_ARCHIVED",
      entityType: "vehicles",
      entityId: vehicleId,
      previousValue: { matricule: existing.matricule, isArchived: false },
      newValue: { isArchived: true }
    });
  });
  tx();
}
function upsertVehicleDocument(db, actor, input) {
  const tx = db.transaction(() => {
    const vehicle = db.prepare("SELECT id FROM vehicles WHERE id = ?").get(input.vehicleId);
    if (!vehicle) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    let docId;
    if (input.id) {
      db.prepare(
        `UPDATE vehicle_documents SET
          doc_type = ?, document_number = ?, issue_date = ?, expiration_date = ?,
          reminder_days = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND vehicle_id = ?`
      ).run(
        input.docType,
        input.documentNumber || null,
        input.issueDate || null,
        input.expirationDate,
        input.reminderDays,
        input.notes || null,
        input.id,
        input.vehicleId
      );
      docId = input.id;
    } else {
      const res = db.prepare(
        `INSERT INTO vehicle_documents (
            vehicle_id, doc_type, document_number, issue_date, expiration_date, reminder_days, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.vehicleId,
        input.docType,
        input.documentNumber || null,
        input.issueDate || null,
        input.expirationDate,
        input.reminderDays,
        input.notes || null
      );
      docId = Number(res.lastInsertRowid);
    }
    const saved = mapVehicleDoc(
      db.prepare("SELECT * FROM vehicle_documents WHERE id = ?").get(docId)
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_DOCUMENT_SAVED",
      entityType: "vehicle_documents",
      entityId: docId,
      newValue: saved
    });
    return saved;
  });
  return tx();
}
function createVehicleBlockedPeriod(db, actor, input) {
  const tx = db.transaction(() => {
    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate
    });
    if (!avail.available) {
      throw new AuthError(
        "CONFLICT",
        `P\xE9riode en conflit: ${avail.conflicts.map((c) => c.details).join(", ")}`
      );
    }
    const res = db.prepare(
      `INSERT INTO vehicle_blocked_periods (
          vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(input.vehicleId, input.blockType, input.startDate, input.endDate, input.reason.trim(), actor.id);
    const blockId = Number(res.lastInsertRowid);
    recomputeVehicleStatus(db, input.vehicleId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_BLOCKED_PERIOD_CREATED",
      entityType: "vehicle_blocked_periods",
      entityId: blockId,
      newValue: input
    });
    return { id: blockId, ...input, isActive: true };
  });
  return tx();
}
function releaseVehicleBlockedPeriod(db, actor, blockId) {
  const tx = db.transaction(() => {
    const block = db.prepare(
      "SELECT id, vehicle_id, block_type, is_active FROM vehicle_blocked_periods WHERE id = ?"
    ).get(blockId);
    if (!block) throw new AuthError("NOT_FOUND", "P\xE9riode bloqu\xE9e introuvable");
    if (block.is_active === 0) return;
    db.prepare(
      `UPDATE vehicle_blocked_periods
       SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(actor.id, blockId);
    recomputeVehicleStatus(db, block.vehicle_id, {
      releaseManualMaintenance: block.block_type === "MAINTENANCE"
    });
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_BLOCKED_PERIOD_RELEASED",
      entityType: "vehicle_blocked_periods",
      entityId: blockId
    });
  });
  tx();
}

// electron/database/services/inspectionService.ts
var import_node_crypto7 = __toESM(require("node:crypto"), 1);
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);

// shared/constants/inspections.ts
var DEFAULT_INSPECTION_CHECKLIST = [
  // Exterior & Body
  {
    itemKey: "exterior_body",
    category: "EXTERIOR",
    labelFr: "Carrosserie g\xE9n\xE9rale et peinture",
    labelAr: "\u0627\u0644\u0647\u064A\u0643\u0644 \u0627\u0644\u062E\u0627\u0631\u062C\u064A \u0648\u0627\u0644\u0637\u0644\u0627\u0621",
    sortOrder: 1
  },
  {
    itemKey: "windshield_windows",
    category: "EXTERIOR",
    labelFr: "Pare-brise et vitres",
    labelAr: "\u0627\u0644\u0632\u062C\u0627\u062C \u0627\u0644\u0623\u0645\u0627\u0645\u064A \u0648\u0627\u0644\u0646\u0648\u0627\u0641\u0630",
    sortOrder: 2
  },
  {
    itemKey: "lights_indicators",
    category: "EXTERIOR",
    labelFr: "Phares, feux arri\xE8re et clignotants",
    labelAr: "\u0627\u0644\u0623\u0636\u0648\u0627\u0621 \u0627\u0644\u0623\u0645\u0627\u0645\u064A\u0629 \u0648\u0627\u0644\u062E\u0644\u0641\u064A\u0629 \u0648\u0625\u0634\u0627\u0631\u0627\u062A \u0627\u0644\u0627\u0646\u0639\u0637\u0627\u0641",
    sortOrder: 3
  },
  {
    itemKey: "mirrors",
    category: "EXTERIOR",
    labelFr: "R\xE9troviseurs gauche et droit",
    labelAr: "\u0627\u0644\u0645\u0631\u0627\u064A\u0627 \u0627\u0644\u062C\u0627\u0646\u0628\u064A\u0629 \u0627\u0644\u064A\u0633\u0631\u0649 \u0648\u0627\u0644\u064A\u0645\u0646\u0649",
    sortOrder: 4
  },
  {
    itemKey: "tires_wheels",
    category: "EXTERIOR",
    labelFr: "Pneumatiques et jantes (4 roues)",
    labelAr: "\u0627\u0644\u0625\u0637\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0639\u062C\u0644\u0627\u062A (\u0627\u0644\u0623\u0631\u0628\u0639)",
    sortOrder: 5
  },
  {
    itemKey: "wipers",
    category: "EXTERIOR",
    labelFr: "Essuie-glaces avant / arri\xE8re",
    labelAr: "\u0645\u0627\u0633\u062D\u0627\u062A \u0627\u0644\u0632\u062C\u0627\u062C",
    sortOrder: 6
  },
  // Interior & Comfort
  {
    itemKey: "interior_cleanliness",
    category: "INTERIOR",
    labelFr: "Propret\xE9 et \xE9tat g\xE9n\xE9ral int\xE9rieur",
    labelAr: "\u0627\u0644\u0646\u0638\u0627\u0641\u0629 \u0648\u0627\u0644\u062D\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629 \u0644\u0644\u0645\u0642\u0635\u0648\u0631\u0629",
    sortOrder: 7
  },
  {
    itemKey: "seats_upholstery",
    category: "INTERIOR",
    labelFr: "Si\xE8ges et sellerie",
    labelAr: "\u0627\u0644\u0645\u0642\u0627\u0639\u062F \u0648\u0627\u0644\u062A\u0646\u062C\u064A\u062F",
    sortOrder: 8
  },
  {
    itemKey: "dashboard_controls",
    category: "INTERIOR",
    labelFr: "Tableau de bord et voyants",
    labelAr: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0642\u064A\u0627\u062F\u0629 \u0648\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A",
    sortOrder: 9
  },
  {
    itemKey: "air_conditioning",
    category: "INTERIOR",
    labelFr: "Climatisation et chauffage",
    labelAr: "\u0627\u0644\u062A\u0643\u064A\u064A\u0641 \u0648\u0627\u0644\u062A\u062F\u0641\u0626\u0629",
    sortOrder: 10
  },
  {
    itemKey: "radio_multimedia",
    category: "INTERIOR",
    labelFr: "Autoradio et \xE9cran multim\xE9dia",
    labelAr: "\u0627\u0644\u0645\u0630\u064A\u0627\u0639 \u0648\u0634\u0627\u0634\u0629 \u0627\u0644\u0648\u0633\u0627\u0626\u0637",
    sortOrder: 11
  },
  // Safety, Documents & Accessories
  {
    itemKey: "spare_tire",
    category: "SAFETY_DOCS",
    labelFr: "Roue de secours",
    labelAr: "\u0627\u0644\u0639\u062C\u0644\u0629 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629",
    sortOrder: 12
  },
  {
    itemKey: "jack_tools",
    category: "SAFETY_DOCS",
    labelFr: "Cric et cl\xE9 de d\xE9montage roue",
    labelAr: "\u0627\u0644\u0631\u0627\u0641\u0639\u0629 \u0648\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0639\u062C\u0644\u0627\u062A",
    sortOrder: 13
  },
  {
    itemKey: "warning_triangle_vest",
    category: "SAFETY_DOCS",
    labelFr: "Triangle de signalisation et gilet",
    labelAr: "\u0645\u062B\u0644\u062B \u0627\u0644\u062A\u062D\u0630\u064A\u0631 \u0648\u0633\u062A\u0631\u0629 \u0627\u0644\u0633\u0644\u0627\u0645\u0629",
    sortOrder: 14
  },
  {
    itemKey: "fire_extinguisher",
    category: "SAFETY_DOCS",
    labelFr: "Extincteur",
    labelAr: "\u0645\u0637\u0641\u0623\u0629 \u0627\u0644\u062D\u0631\u064A\u0642",
    sortOrder: 15
  },
  {
    itemKey: "registration_docs",
    category: "SAFETY_DOCS",
    labelFr: "Carte grise (documents v\xE9hicule)",
    labelAr: "\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0631\u0645\u0627\u062F\u064A\u0629",
    sortOrder: 16
  },
  {
    itemKey: "insurance_docs",
    category: "SAFETY_DOCS",
    labelFr: "Assurance, vignette et contr\xF4le technique",
    labelAr: "\u0634\u0647\u0627\u062F\u0629 \u0627\u0644\u062A\u0623\u0645\u064A\u0646 \u0648\u0642\u0633\u064A\u0645\u0629 \u0627\u0644\u0633\u064A\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u062A\u0642\u0646\u064A\u0629",
    sortOrder: 17
  },
  {
    itemKey: "keys_fobs",
    category: "SAFETY_DOCS",
    labelFr: "Cl\xE9s et t\xE9l\xE9commande",
    labelAr: "\u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0648\u062C\u0647\u0627\u0632 \u0627\u0644\u062A\u062D\u0643\u0645",
    sortOrder: 18
  }
];

// electron/database/services/inspectionService.ts
function mapInspection(r) {
  return {
    id: r.id,
    inspectionNumber: r.inspection_number,
    contractId: r.contract_id,
    vehicleId: r.vehicle_id,
    stage: r.stage,
    status: r.status ?? "DRAFT",
    odometerKm: Number(r.odometer_km),
    fuelLevelPercent: Number(r.fuel_level_percent),
    exteriorNotes: r.exterior_notes ?? null,
    interiorNotes: r.interior_notes ?? null,
    agencySignatureData: r.agency_signature_data ?? null,
    customerSignatureData: r.customer_signature_data ?? null,
    customerAcknowledged: r.customer_acknowledged === 1,
    customerAcknowledgmentNotes: r.customer_acknowledgment_notes ?? null,
    lateReturnMinutes: Number(r.late_return_minutes ?? 0),
    mileageDeltaKm: r.mileage_delta_km != null ? Number(r.mileage_delta_km) : null,
    inspectorUserId: r.inspector_user_id,
    inspectedAt: r.inspected_at,
    finalizedAt: r.finalized_at ?? null,
    finalizedByUserId: r.finalized_by_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at
  };
}
function mapItem(r) {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    itemKey: r.item_key,
    category: r.category ?? "GENERAL",
    labelFr: r.label_fr,
    labelAr: r.label_ar,
    condition: r.condition,
    notes: r.notes ?? null,
    sortOrder: Number(r.sort_order ?? 0)
  };
}
function mapPhoto(r) {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    damageId: r.damage_id ?? null,
    filePath: r.file_path,
    originalFileName: r.original_file_name ?? null,
    mimeType: r.mime_type ?? null,
    caption: r.caption ?? null,
    uploadedByUserId: r.uploaded_by_user_id ?? null,
    createdAt: r.created_at
  };
}
function mapDamage(r) {
  return {
    id: r.id,
    damageCode: r.damage_code,
    vehicleId: r.vehicle_id,
    contractId: r.contract_id ?? null,
    inspectionId: r.inspection_id ?? null,
    zoneCode: r.zone_code,
    diagramX: r.diagram_x != null ? Number(r.diagram_x) : null,
    diagramY: r.diagram_y != null ? Number(r.diagram_y) : null,
    damageType: r.damage_type,
    severity: r.severity,
    description: r.description,
    isPreExisting: r.is_pre_existing === 1,
    isNewlyDiscovered: r.is_newly_discovered === 1,
    status: r.status,
    estimatedRepairCostMinor: r.estimated_repair_cost_minor != null ? Number(r.estimated_repair_cost_minor) : null,
    repairReference: r.repair_reference ?? null,
    linkedExpenseId: r.linked_expense_id ?? null,
    reportedByUserId: r.reported_by_user_id,
    reportedAt: r.reported_at,
    updatedAt: r.updated_at
  };
}
function mapDamageResolution(r) {
  return {
    id: r.id,
    damageId: r.damage_id,
    previousStatus: r.previous_status ?? null,
    newStatus: r.new_status,
    notes: r.notes,
    repairReference: r.repair_reference ?? null,
    linkedExpenseId: r.linked_expense_id ?? null,
    recordedByUserId: r.recorded_by_user_id,
    recordedByUsername: r.recorded_by_username ?? void 0,
    createdAt: r.created_at
  };
}
function generateInspectionNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM vehicle_inspections").get();
  const next = (row?.max_id ?? 0) + 1;
  return `EDL-${year}-${String(next).padStart(5, "0")}`;
}
function generateDamageCode(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM vehicle_damages").get();
  const next = (row?.max_id ?? 0) + 1;
  return `DMG-${year}-${String(next).padStart(5, "0")}`;
}
function computeReturnDeltas(db, contractRow, returnOdometerKm, inspectedAt) {
  const depRow = db.prepare(
    "SELECT odometer_km FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
  ).get(contractRow.id);
  const baseOdometer = depRow ? Number(depRow.odometer_km) : Number(contractRow.departure_odometer_km ?? 0);
  const mileageDeltaKm = Math.max(0, returnOdometerKm - baseOdometer);
  const expectedMs = Date.parse(contractRow.expected_return_date);
  const actualMs = Date.parse(inspectedAt);
  const lateReturnMinutes = !Number.isNaN(expectedMs) && !Number.isNaN(actualMs) && actualMs > expectedMs ? Math.round((actualMs - expectedMs) / 6e4) : 0;
  return { mileageDeltaKm, lateReturnMinutes };
}
function buildDepartureReturnComparison(db, contractId) {
  const depRow = db.prepare(
    "SELECT * FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
  ).get(contractId);
  const retRow = db.prepare(
    "SELECT * FROM vehicle_inspections WHERE contract_id = ? AND stage = 'RETURN'"
  ).get(contractId);
  if (!depRow && !retRow) return null;
  const depItems = depRow ? db.prepare("SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC").all(depRow.id).map(mapItem) : [];
  const retItems = retRow ? db.prepare("SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC").all(retRow.id).map(mapItem) : [];
  const depDamages = depRow ? db.prepare("SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC").all(depRow.id).map(mapDamage) : [];
  const retDamages = retRow ? db.prepare("SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC").all(retRow.id).map(mapDamage) : [];
  const depMap = /* @__PURE__ */ new Map();
  for (const item of depItems) depMap.set(item.itemKey, item);
  const retMap = /* @__PURE__ */ new Map();
  for (const item of retItems) retMap.set(item.itemKey, item);
  const allKeys = Array.from(/* @__PURE__ */ new Set([...depMap.keys(), ...retMap.keys()]));
  const conditionRank = {
    GOOD: 0,
    DAMAGED: 1,
    MISSING: 2
  };
  const checklistDiffs = allKeys.map((key) => {
    const dep = depMap.get(key) ?? null;
    const ret = retMap.get(key) ?? null;
    const isDegraded = Boolean(
      dep && ret && conditionRank[ret.condition] > conditionRank[dep.condition]
    );
    const isMissingOnReturn = Boolean(
      ret && ret.condition === "MISSING" && (!dep || dep.condition !== "MISSING")
    );
    return {
      itemKey: key,
      labelFr: ret?.labelFr ?? dep?.labelFr ?? key,
      labelAr: ret?.labelAr ?? dep?.labelAr ?? key,
      category: ret?.category ?? dep?.category ?? "GENERAL",
      departureCondition: dep?.condition ?? null,
      departureNotes: dep?.notes ?? null,
      returnCondition: ret?.condition ?? null,
      returnNotes: ret?.notes ?? null,
      isDegraded,
      isMissingOnReturn
    };
  });
  const contract = db.prepare("SELECT departure_odometer_km, expected_return_date FROM rental_contracts WHERE id = ?").get(contractId);
  const odometerDeltaKm = retRow != null ? Math.max(
    0,
    Number(retRow.odometer_km) - Number(depRow ? depRow.odometer_km : contract?.departure_odometer_km ?? 0)
  ) : null;
  const fuelDeltaPercent = depRow && retRow ? Number(retRow.fuel_level_percent) - Number(depRow.fuel_level_percent) : null;
  const newlyDiscoveredDamages = retDamages.filter((d) => d.isNewlyDiscovered);
  const preExistingDamages = [
    ...depDamages,
    ...retDamages.filter((d) => d.isPreExisting && !d.isNewlyDiscovered)
  ];
  return {
    departureInspection: depRow ? mapInspection(depRow) : null,
    returnInspection: retRow ? mapInspection(retRow) : null,
    odometerDeltaKm,
    fuelDeltaPercent,
    lateReturnMinutes: retRow ? Number(retRow.late_return_minutes ?? 0) : 0,
    degradedItemsCount: checklistDiffs.filter((d) => d.isDegraded).length,
    missingAccessoriesCount: checklistDiffs.filter((d) => d.isMissingOnReturn).length,
    checklistDiffs,
    newlyDiscoveredDamages,
    preExistingDamages
  };
}
function listInspections(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.vehicleId) {
    clauses.push("vi.vehicle_id = ?");
    params.push(filters.vehicleId);
  }
  if (filters?.contractId) {
    clauses.push("vi.contract_id = ?");
    params.push(filters.contractId);
  }
  if (filters?.stage && filters.stage !== "ALL") {
    clauses.push("vi.stage = ?");
    params.push(filters.stage);
  }
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("vi.status = ?");
    params.push(filters.status);
  }
  if (filters?.onlyWithNewDamages) {
    clauses.push(
      "EXISTS (SELECT 1 FROM vehicle_damages vd WHERE vd.inspection_id = vi.id AND vd.is_newly_discovered = 1)"
    );
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      "(vi.inspection_number LIKE ? OR rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)"
    );
    params.push(q, q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT vi.*,
              rc.contract_number,
              rc.status AS contract_status,
              rc.expected_return_date,
              c.id AS customer_id,
              c.full_name AS customer_name,
              c.phone AS customer_phone,
              v.brand || ' ' || v.model AS vehicle_label,
              v.matricule AS vehicle_matricule,
              u.full_name AS inspector_name,
              u.username AS inspector_username,
              (SELECT COUNT(*) FROM inspection_photos ip WHERE ip.inspection_id = vi.id) AS photo_count,
              (SELECT COUNT(*) FROM vehicle_damages vd WHERE vd.inspection_id = vi.id) AS damage_count,
              (SELECT COUNT(*) FROM vehicle_damages vd WHERE vd.inspection_id = vi.id AND vd.is_newly_discovered = 1) AS new_damage_count,
              (SELECT COUNT(*) FROM inspection_items ii WHERE ii.inspection_id = vi.id AND ii.condition != 'GOOD') AS issue_item_count
       FROM vehicle_inspections vi
       JOIN rental_contracts rc ON rc.id = vi.contract_id
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = vi.vehicle_id
       JOIN users u ON u.id = vi.inspector_user_id
       ${where}
       ORDER BY vi.inspected_at DESC, vi.id DESC`
  ).all(...params);
  return rows.map((r) => ({
    ...mapInspection(r),
    contractNumber: r.contract_number,
    contractStatus: r.contract_status,
    expectedReturnDate: r.expected_return_date,
    customerId: Number(r.customer_id),
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    vehicleLabel: r.vehicle_label,
    vehicleMatricule: r.vehicle_matricule,
    inspectorName: r.inspector_name,
    inspectorUsername: r.inspector_username,
    photoCount: Number(r.photo_count ?? 0),
    damageCount: Number(r.damage_count ?? 0),
    newDamageCount: Number(r.new_damage_count ?? 0),
    issueItemCount: Number(r.issue_item_count ?? 0)
  }));
}
function getInspectionDetail(db, inspectionId) {
  const row = db.prepare(
    `SELECT vi.*,
              u.full_name AS inspector_name,
              u.username AS inspector_username,
              fu.full_name AS finalized_by_name
       FROM vehicle_inspections vi
       JOIN users u ON u.id = vi.inspector_user_id
       LEFT JOIN users fu ON fu.id = vi.finalized_by_user_id
       WHERE vi.id = ?`
  ).get(inspectionId);
  if (!row) {
    throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
  }
  const contractRow = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(row.contract_id);
  const vehicleRow = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(row.vehicle_id);
  const customerRow = db.prepare("SELECT * FROM customers WHERE id = ?").get(contractRow.customer_id);
  const items = db.prepare("SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC").all(inspectionId).map(mapItem);
  const photos = db.prepare("SELECT * FROM inspection_photos WHERE inspection_id = ? ORDER BY id ASC").all(inspectionId).map(mapPhoto);
  const damages = db.prepare("SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC").all(inspectionId).map(mapDamage);
  const comparison = row.stage === "RETURN" ? buildDepartureReturnComparison(db, row.contract_id) : null;
  return {
    inspection: {
      ...mapInspection(row),
      inspectorName: row.inspector_name,
      inspectorUsername: row.inspector_username,
      finalizedByName: row.finalized_by_name ?? null
    },
    contract: {
      id: contractRow.id,
      contractNumber: contractRow.contract_number,
      status: contractRow.status,
      startDate: contractRow.start_date,
      expectedReturnDate: contractRow.expected_return_date,
      actualReturnDate: contractRow.actual_return_date ?? null,
      departureOdometerKm: Number(contractRow.departure_odometer_km),
      returnOdometerKm: contractRow.return_odometer_km != null ? Number(contractRow.return_odometer_km) : null
    },
    vehicle: {
      id: vehicleRow.id,
      internalCode: vehicleRow.internal_code,
      matricule: vehicleRow.matricule,
      brand: vehicleRow.brand,
      model: vehicleRow.model,
      year: Number(vehicleRow.year),
      color: vehicleRow.color,
      category: vehicleRow.category,
      currentOdometerKm: Number(vehicleRow.current_odometer_km)
    },
    customer: {
      id: customerRow.id,
      customerType: customerRow.customer_type,
      fullName: customerRow.full_name,
      phone: customerRow.phone,
      drivingLicenceNumber: customerRow.driving_licence_number ?? null
    },
    items,
    photos,
    damages,
    comparison
  };
}
function getContractInspections(db, contractId) {
  const contractRow = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(contractId);
  if (!contractRow) {
    throw new AuthError("NOT_FOUND", "Contrat introuvable");
  }
  const depRow = db.prepare(
    "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
  ).get(contractId);
  const retRow = db.prepare(
    "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = 'RETURN'"
  ).get(contractId);
  const preExistingVehicleDamages = db.prepare(
    "SELECT * FROM vehicle_damages WHERE vehicle_id = ? AND status != 'REPAIRED' AND status != 'REJECTED' ORDER BY reported_at DESC"
  ).all(contractRow.vehicle_id).map(mapDamage);
  return {
    contractId,
    departure: depRow ? getInspectionDetail(db, depRow.id) : null,
    returnInspection: retRow ? getInspectionDetail(db, retRow.id) : null,
    comparison: buildDepartureReturnComparison(db, contractId),
    openVehicleDamages: preExistingVehicleDamages
  };
}
function createInspection(db, actor, input) {
  const tx = db.transaction(() => {
    const contractRow = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(input.contractId);
    if (!contractRow) {
      throw new AuthError("NOT_FOUND", "Contrat introuvable");
    }
    if (contractRow.status === "CANCELLED") {
      throw new AuthError("CONFLICT", "Impossible de cr\xE9er un \xE9tat des lieux pour un contrat annul\xE9");
    }
    const existingStage = db.prepare(
      "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = ?"
    ).get(input.contractId, input.stage);
    if (existingStage) {
      throw new AuthError(
        "CONFLICT",
        input.stage === "DEPARTURE" ? "Un \xE9tat des lieux d\xE9part existe d\xE9j\xE0 pour ce contrat (non rempla\xE7able)" : "Un \xE9tat des lieux retour existe d\xE9j\xE0 pour ce contrat"
      );
    }
    const inspectedAt = input.inspectedAt?.trim() || (/* @__PURE__ */ new Date()).toISOString();
    const deltas = input.stage === "RETURN" ? computeReturnDeltas(db, contractRow, input.odometerKm, inspectedAt) : { mileageDeltaKm: null, lateReturnMinutes: 0 };
    const inspectionNumber = generateInspectionNumber(db);
    const status = input.finalizeNow ? "FINALIZED" : "DRAFT";
    const finalizedAt = input.finalizeNow ? (/* @__PURE__ */ new Date()).toISOString() : null;
    const finalizedByUserId = input.finalizeNow ? actor.id : null;
    const res = db.prepare(
      `INSERT INTO vehicle_inspections (
          inspection_number, contract_id, vehicle_id, stage, status, odometer_km,
          fuel_level_percent, exterior_notes, interior_notes, agency_signature_data,
          customer_signature_data, customer_acknowledged, customer_acknowledgment_notes,
          late_return_minutes, mileage_delta_km, inspector_user_id, inspected_at,
          finalized_at, finalized_by_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    ).run(
      inspectionNumber,
      input.contractId,
      contractRow.vehicle_id,
      input.stage,
      status,
      input.odometerKm,
      input.fuelLevelPercent,
      input.exteriorNotes?.trim() || null,
      input.interiorNotes?.trim() || null,
      input.agencySignatureData || null,
      input.customerSignatureData || null,
      input.customerAcknowledged ? 1 : 0,
      input.customerAcknowledgmentNotes?.trim() || null,
      deltas.lateReturnMinutes,
      deltas.mileageDeltaKm,
      actor.id,
      inspectedAt,
      finalizedAt,
      finalizedByUserId
    );
    const inspectionId = Number(res.lastInsertRowid);
    const itemsToInsert = input.items && input.items.length > 0 ? input.items : DEFAULT_INSPECTION_CHECKLIST.map((tpl) => ({
      itemKey: tpl.itemKey,
      category: tpl.category,
      labelFr: tpl.labelFr,
      labelAr: tpl.labelAr,
      condition: "GOOD",
      notes: null,
      sortOrder: tpl.sortOrder
    }));
    const insertItemStmt = db.prepare(
      `INSERT INTO inspection_items (
        inspection_id, item_key, category, label_fr, label_ar, condition, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    itemsToInsert.forEach((item, idx) => {
      insertItemStmt.run(
        inspectionId,
        item.itemKey,
        item.category || "GENERAL",
        item.labelFr,
        item.labelAr,
        item.condition,
        item.notes?.trim() || null,
        item.sortOrder ?? idx + 1
      );
    });
    if (input.damages && input.damages.length > 0) {
      for (const dmg of input.damages) {
        const isPreExisting = dmg.isPreExisting !== void 0 ? dmg.isPreExisting : input.stage === "DEPARTURE";
        const isNewlyDiscovered = dmg.isNewlyDiscovered !== void 0 ? dmg.isNewlyDiscovered : input.stage === "RETURN" && !isPreExisting;
        const damageCode = generateDamageCode(db);
        const dmgRes = db.prepare(
          `INSERT INTO vehicle_damages (
              damage_code, vehicle_id, contract_id, inspection_id, zone_code,
              diagram_x, diagram_y, damage_type, severity, description,
              is_pre_existing, is_newly_discovered, status, estimated_repair_cost_minor,
              reported_by_user_id, reported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, ?)`
        ).run(
          damageCode,
          contractRow.vehicle_id,
          input.contractId,
          inspectionId,
          dmg.zoneCode,
          dmg.diagramX ?? null,
          dmg.diagramY ?? null,
          dmg.damageType,
          dmg.severity,
          dmg.description.trim(),
          isPreExisting ? 1 : 0,
          isNewlyDiscovered ? 1 : 0,
          dmg.estimatedRepairCostMinor ?? null,
          actor.id,
          inspectedAt
        );
        db.prepare(
          `INSERT INTO damage_resolution_records (
            damage_id, previous_status, new_status, notes, recorded_by_user_id
          ) VALUES (?, NULL, 'REPORTED', ?, ?)`
        ).run(
          Number(dmgRes.lastInsertRowid),
          `Signal\xE9 lors de l\u2019\xE9tat des lieux ${inspectionNumber} (${input.stage})`,
          actor.id
        );
      }
    }
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.odometerKm, contractRow.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: input.finalizeNow ? "INSPECTION_CREATED_AND_FINALIZED" : "INSPECTION_CREATED",
      entityType: "vehicle_inspections",
      entityId: inspectionId,
      newValue: {
        inspectionNumber,
        contractId: input.contractId,
        vehicleId: contractRow.vehicle_id,
        stage: input.stage,
        status,
        odometerKm: input.odometerKm,
        fuelLevelPercent: input.fuelLevelPercent,
        damageCount: input.damages?.length ?? 0
      }
    });
    return getInspectionDetail(db, inspectionId);
  });
  return tx();
}
function updateInspectionDraft(db, actor, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM vehicle_inspections WHERE id = ?").get(input.inspectionId);
    if (!current) {
      throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
    }
    if (current.status === "FINALIZED") {
      throw new AuthError(
        "CONFLICT",
        "Cet \xE9tat des lieux est d\xE9finitivement valid\xE9 et ne peut plus \xEAtre modifi\xE9"
      );
    }
    const contractRow = db.prepare("SELECT * FROM rental_contracts WHERE id = ?").get(current.contract_id);
    const nextOdo = input.odometerKm ?? Number(current.odometer_km);
    const nextFuel = input.fuelLevelPercent ?? Number(current.fuel_level_percent);
    const nextInspectedAt = input.inspectedAt?.trim() || current.inspected_at;
    const deltas = current.stage === "RETURN" ? computeReturnDeltas(db, contractRow, nextOdo, nextInspectedAt) : { mileageDeltaKm: null, lateReturnMinutes: 0 };
    db.prepare(
      `UPDATE vehicle_inspections
       SET odometer_km = ?,
           fuel_level_percent = ?,
           exterior_notes = ?,
           interior_notes = ?,
           agency_signature_data = ?,
           customer_signature_data = ?,
           customer_acknowledged = ?,
           customer_acknowledgment_notes = ?,
           late_return_minutes = ?,
           mileage_delta_km = ?,
           inspected_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextOdo,
      nextFuel,
      input.exteriorNotes !== void 0 ? input.exteriorNotes?.trim() || null : current.exterior_notes,
      input.interiorNotes !== void 0 ? input.interiorNotes?.trim() || null : current.interior_notes,
      input.agencySignatureData !== void 0 ? input.agencySignatureData || null : current.agency_signature_data,
      input.customerSignatureData !== void 0 ? input.customerSignatureData || null : current.customer_signature_data,
      input.customerAcknowledged !== void 0 ? input.customerAcknowledged ? 1 : 0 : current.customer_acknowledged,
      input.customerAcknowledgmentNotes !== void 0 ? input.customerAcknowledgmentNotes?.trim() || null : current.customer_acknowledgment_notes,
      deltas.lateReturnMinutes,
      deltas.mileageDeltaKm,
      nextInspectedAt,
      input.inspectionId
    );
    if (input.items && input.items.length > 0) {
      db.prepare("DELETE FROM inspection_items WHERE inspection_id = ?").run(input.inspectionId);
      const insertItemStmt = db.prepare(
        `INSERT INTO inspection_items (
          inspection_id, item_key, category, label_fr, label_ar, condition, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      input.items.forEach((item, idx) => {
        insertItemStmt.run(
          input.inspectionId,
          item.itemKey,
          item.category || "GENERAL",
          item.labelFr,
          item.labelAr,
          item.condition,
          item.notes?.trim() || null,
          item.sortOrder ?? idx + 1
        );
      });
    }
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextOdo, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INSPECTION_UPDATED",
      entityType: "vehicle_inspections",
      entityId: input.inspectionId,
      previousValue: { odometerKm: current.odometer_km, fuelLevelPercent: current.fuel_level_percent },
      newValue: { odometerKm: nextOdo, fuelLevelPercent: nextFuel }
    });
    return getInspectionDetail(db, input.inspectionId);
  });
  return tx();
}
function finalizeInspection(db, actor, inspectionId) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM vehicle_inspections WHERE id = ?").get(inspectionId);
    if (!current) {
      throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
    }
    if (current.status === "FINALIZED") {
      throw new AuthError("CONFLICT", "Cet \xE9tat des lieux est d\xE9j\xE0 finalis\xE9");
    }
    db.prepare(
      `UPDATE vehicle_inspections
       SET status = 'FINALIZED',
           finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           finalized_by_user_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(actor.id, inspectionId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INSPECTION_FINALIZED",
      entityType: "vehicle_inspections",
      entityId: inspectionId,
      newValue: {
        inspectionNumber: current.inspection_number,
        stage: current.stage,
        contractId: current.contract_id
      }
    });
    return getInspectionDetail(db, inspectionId);
  });
  return tx();
}
function uploadInspectionPhoto(db, actor, vaultRootDir, vaultKey, input) {
  const inspection = db.prepare("SELECT * FROM vehicle_inspections WHERE id = ?").get(input.inspectionId);
  if (!inspection) throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
  if (inspection.status === "FINALIZED") {
    throw new AuthError(
      "CONFLICT",
      "Impossible d\u2019ajouter une photo \xE0 un \xE9tat des lieux d\xE9j\xE0 finalis\xE9"
    );
  }
  if (input.damageId != null) {
    const dmg = db.prepare("SELECT id, vehicle_id FROM vehicle_damages WHERE id = ?").get(input.damageId);
    if (!dmg || dmg.vehicle_id !== inspection.vehicle_id) {
      throw new AuthError("VALIDATION_ERROR", "Dommage introuvable pour ce v\xE9hicule");
    }
  }
  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    allowedMimes: ["image/jpeg", "image/png", "image/webp"]
  });
  const encryptedBytes = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `insp_${input.inspectionId}_${import_node_crypto7.default.randomUUID()}.enc`;
  const relativePath = import_node_path10.default.join("inspections", opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  import_node_fs9.default.mkdirSync(import_node_path10.default.dirname(fullPath), { recursive: true });
  import_node_fs9.default.writeFileSync(fullPath, encryptedBytes, { mode: 384 });
  const res = db.prepare(
    `INSERT INTO inspection_photos (
        inspection_id, damage_id, file_path, original_file_name, mime_type, caption, uploaded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.inspectionId,
    input.damageId ?? null,
    relativePath,
    validated.safeFileName,
    validated.mimeType,
    input.caption?.trim() || null,
    actor.id
  );
  const photoId = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "INSPECTION_PHOTO_UPLOADED",
    entityType: "inspection_photos",
    entityId: photoId,
    newValue: { inspectionId: input.inspectionId, damageId: input.damageId ?? null }
  });
  return mapPhoto(db.prepare("SELECT * FROM inspection_photos WHERE id = ?").get(photoId));
}
function readInspectionPhoto(db, vaultRootDir, vaultKey, photoId) {
  const row = db.prepare("SELECT * FROM inspection_photos WHERE id = ?").get(photoId);
  if (!row) throw new AuthError("NOT_FOUND", "Photo d\u2019inspection introuvable");
  const fullPath = resolveConfinedPath(vaultRootDir, row.file_path);
  const encryptedBytes = import_node_fs9.default.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    damageId: row.damage_id ?? null,
    originalFileName: row.original_file_name ?? `photo-${row.id}.jpg`,
    mimeType: row.mime_type ?? "image/jpeg",
    caption: row.caption ?? null,
    base64Data: plainBytes.toString("base64")
  };
}
function deleteInspectionPhoto(db, actor, vaultRootDir, photoId) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM inspection_photos WHERE id = ?").get(photoId);
    if (!row) throw new AuthError("NOT_FOUND", "Photo d\u2019inspection introuvable");
    const insp = db.prepare("SELECT id, status FROM vehicle_inspections WHERE id = ?").get(row.inspection_id);
    if (insp?.status === "FINALIZED") {
      throw new AuthError(
        "CONFLICT",
        "Impossible de supprimer une photo d\u2019un \xE9tat des lieux finalis\xE9"
      );
    }
    db.prepare("DELETE FROM inspection_photos WHERE id = ?").run(photoId);
    try {
      const fullPath = resolveConfinedPath(vaultRootDir, row.file_path);
      if (import_node_fs9.default.existsSync(fullPath)) import_node_fs9.default.unlinkSync(fullPath);
    } catch {
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INSPECTION_PHOTO_DELETED",
      entityType: "inspection_photos",
      entityId: photoId,
      previousValue: { inspectionId: row.inspection_id, caption: row.caption }
    });
    return { deleted: true, id: photoId };
  });
  return tx();
}
function addVehicleDamage(db, actor, input) {
  const tx = db.transaction(() => {
    const vehicle = db.prepare("SELECT id FROM vehicles WHERE id = ?").get(input.vehicleId);
    if (!vehicle) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    let stage = null;
    if (input.inspectionId != null) {
      const insp = db.prepare("SELECT * FROM vehicle_inspections WHERE id = ?").get(input.inspectionId);
      if (!insp) throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
      if (insp.vehicle_id !== input.vehicleId) {
        throw new AuthError("VALIDATION_ERROR", "L\u2019\xE9tat des lieux ne correspond pas \xE0 ce v\xE9hicule");
      }
      if (insp.status === "FINALIZED") {
        throw new AuthError(
          "CONFLICT",
          "Impossible d\u2019ajouter un dommage sur un \xE9tat des lieux d\xE9j\xE0 finalis\xE9"
        );
      }
      stage = insp.stage;
    }
    const isPreExisting = input.isPreExisting !== void 0 ? input.isPreExisting : stage === "DEPARTURE";
    const isNewlyDiscovered = input.isNewlyDiscovered !== void 0 ? input.isNewlyDiscovered : stage === "RETURN" && !isPreExisting;
    const damageCode = generateDamageCode(db);
    const res = db.prepare(
      `INSERT INTO vehicle_damages (
          damage_code, vehicle_id, contract_id, inspection_id, zone_code,
          diagram_x, diagram_y, damage_type, severity, description,
          is_pre_existing, is_newly_discovered, status, estimated_repair_cost_minor,
          reported_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?)`
    ).run(
      damageCode,
      input.vehicleId,
      input.contractId ?? null,
      input.inspectionId ?? null,
      input.zoneCode,
      input.diagramX ?? null,
      input.diagramY ?? null,
      input.damageType,
      input.severity,
      input.description.trim(),
      isPreExisting ? 1 : 0,
      isNewlyDiscovered ? 1 : 0,
      input.estimatedRepairCostMinor ?? null,
      actor.id
    );
    const damageId = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO damage_resolution_records (
        damage_id, previous_status, new_status, notes, recorded_by_user_id
      ) VALUES (?, NULL, 'REPORTED', ?, ?)`
    ).run(damageId, input.description.trim(), actor.id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_DAMAGE_REPORTED",
      entityType: "vehicle_damages",
      entityId: damageId,
      newValue: {
        damageCode,
        vehicleId: input.vehicleId,
        inspectionId: input.inspectionId ?? null,
        zoneCode: input.zoneCode,
        damageType: input.damageType,
        severity: input.severity
      }
    });
    return mapDamage(db.prepare("SELECT * FROM vehicle_damages WHERE id = ?").get(damageId));
  });
  return tx();
}
function listVehicleDamages(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.vehicleId) {
    clauses.push("vd.vehicle_id = ?");
    params.push(filters.vehicleId);
  }
  if (filters?.contractId) {
    clauses.push("vd.contract_id = ?");
    params.push(filters.contractId);
  }
  if (filters?.inspectionId) {
    clauses.push("vd.inspection_id = ?");
    params.push(filters.inspectionId);
  }
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("vd.status = ?");
    params.push(filters.status);
  }
  if (filters?.onlyNewlyDiscovered) {
    clauses.push("vd.is_newly_discovered = 1");
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT vd.*,
              v.brand || ' ' || v.model AS vehicle_label,
              v.matricule AS vehicle_matricule,
              rc.contract_number,
              vi.inspection_number,
              vi.stage AS inspection_stage,
              e.expense_number AS linked_expense_number,
              u.full_name AS reported_by_name
       FROM vehicle_damages vd
       JOIN vehicles v ON v.id = vd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = vd.contract_id
       LEFT JOIN vehicle_inspections vi ON vi.id = vd.inspection_id
       LEFT JOIN expenses e ON e.id = vd.linked_expense_id
       JOIN users u ON u.id = vd.reported_by_user_id
       ${where}
       ORDER BY vd.reported_at DESC, vd.id DESC`
  ).all(...params);
  const historyStmt = db.prepare(
    `SELECT drr.*, u.username AS recorded_by_username
     FROM damage_resolution_records drr
     JOIN users u ON u.id = drr.recorded_by_user_id
     WHERE drr.damage_id = ?
     ORDER BY drr.created_at ASC, drr.id ASC`
  );
  return rows.map((r) => ({
    ...mapDamage(r),
    vehicleLabel: r.vehicle_label,
    vehicleMatricule: r.vehicle_matricule,
    contractNumber: r.contract_number ?? null,
    inspectionNumber: r.inspection_number ?? null,
    inspectionStage: r.inspection_stage ?? null,
    linkedExpenseNumber: r.linked_expense_number ?? null,
    reportedByName: r.reported_by_name,
    resolutionHistory: historyStmt.all(r.id).map(mapDamageResolution)
  }));
}
function updateDamageStatus(db, actor, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM vehicle_damages WHERE id = ?").get(input.damageId);
    if (!current) {
      throw new AuthError("NOT_FOUND", "Dommage introuvable");
    }
    if (input.linkedExpenseId != null) {
      const exp = db.prepare("SELECT id FROM expenses WHERE id = ?").get(input.linkedExpenseId);
      if (!exp) {
        throw new AuthError("NOT_FOUND", "D\xE9pense financi\xE8re li\xE9e introuvable");
      }
    }
    const nextEstimated = input.estimatedRepairCostMinor !== void 0 ? input.estimatedRepairCostMinor : current.estimated_repair_cost_minor;
    const nextRepairRef = input.repairReference !== void 0 ? input.repairReference?.trim() || null : current.repair_reference;
    const nextExpenseId = input.linkedExpenseId !== void 0 ? input.linkedExpenseId : current.linked_expense_id;
    db.prepare(
      `UPDATE vehicle_damages
       SET status = ?,
           estimated_repair_cost_minor = ?,
           repair_reference = ?,
           linked_expense_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.newStatus, nextEstimated, nextRepairRef, nextExpenseId, input.damageId);
    db.prepare(
      `INSERT INTO damage_resolution_records (
        damage_id, previous_status, new_status, notes, repair_reference, linked_expense_id, recorded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.damageId,
      current.status,
      input.newStatus,
      input.notes.trim(),
      nextRepairRef,
      nextExpenseId,
      actor.id
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_DAMAGE_STATUS_UPDATED",
      entityType: "vehicle_damages",
      entityId: input.damageId,
      previousValue: { status: current.status },
      newValue: {
        status: input.newStatus,
        repairReference: nextRepairRef,
        linkedExpenseId: nextExpenseId
      },
      reason: input.notes.trim()
    });
    const [updated] = listVehicleDamages(db, { vehicleId: current.vehicle_id }).filter(
      (d) => d.id === input.damageId
    );
    return updated;
  });
  return tx();
}
function getInspectionPdfPayload(db, vaultRootDir, vaultKey, inspectionId) {
  const detail = getInspectionDetail(db, inspectionId);
  const settingRows = db.prepare(
    "SELECT setting_key, setting_value FROM application_settings WHERE setting_group = 'agency'"
  ).all();
  const agency = {};
  for (const r of settingRows) agency[r.setting_key] = r.setting_value;
  const decryptedPhotos = detail.photos.map((p) => {
    try {
      const dec = readInspectionPhoto(db, vaultRootDir, vaultKey, p.id);
      return {
        ...p,
        dataUrl: `data:${dec.mimeType};base64,${dec.base64Data}`
      };
    } catch {
      return {
        ...p,
        dataUrl: null
      };
    }
  });
  return {
    ...detail,
    photos: decryptedPhotos,
    agency: {
      name: agency["agency.name"] || "Agence Location Auto",
      commercialName: agency["agency.commercial_name"] || "",
      address: agency["agency.address"] || "",
      phone: agency["agency.phone"] || "",
      email: agency["agency.email"] || "",
      nif: agency["agency.nif"] || "",
      rc: agency["agency.rc"] || ""
    }
  };
}

// electron/database/services/maintenanceService.ts
var import_node_crypto9 = __toESM(require("node:crypto"), 1);
var import_node_fs11 = __toESM(require("node:fs"), 1);
var import_node_path12 = __toESM(require("node:path"), 1);

// electron/database/services/expenseService.ts
var import_node_crypto8 = __toESM(require("node:crypto"), 1);
var import_node_fs10 = __toESM(require("node:fs"), 1);
var import_node_path11 = __toESM(require("node:path"), 1);
function generateExpenseNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM expenses").get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return `EXP-${year}-${String(seq).padStart(5, "0")}`;
}
function mapSupplier(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    wilayaCode: r.wilaya_code ?? null,
    specialty: r.specialty ?? null,
    nifNumber: r.nif_number ?? null,
    notes: r.notes ?? null,
    isArchived: r.is_archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function mapExpense(r) {
  return {
    id: r.id,
    expenseNumber: r.expense_number,
    category: r.category,
    vehicleId: r.vehicle_id ?? null,
    vehicleLabel: r.vehicle_label ?? null,
    supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    maintenanceRecordId: r.maintenance_record_id ?? null,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    expenseDate: r.expense_date,
    paymentMethod: r.payment_method,
    paymentReference: r.payment_reference ?? null,
    status: r.status ?? "POSTED",
    description: r.description,
    hasReceiptDoc: Boolean(r.receipt_file_path),
    receiptOriginalName: r.receipt_original_name ?? null,
    reversalReason: r.reversal_reason ?? null,
    reversedAt: r.reversed_at ?? null,
    reversedByUsername: r.reversed_by_username ?? null,
    recordedByUserId: r.recorded_by_user_id,
    recordedByUsername: r.recorded_by_username,
    createdAt: r.created_at
  };
}
function listSuppliers(db, includeArchived = false) {
  const where = includeArchived ? "" : "WHERE COALESCE(is_archived, 0) = 0";
  return db.prepare(`SELECT * FROM suppliers ${where} ORDER BY is_archived ASC, name ASC, id DESC`).all().map(mapSupplier);
}
function upsertSupplier(db, actor, input) {
  const tx = db.transaction(() => {
    if (input.id) {
      const existing = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(input.id);
      if (!existing) throw new AuthError("NOT_FOUND", "Fournisseur introuvable");
      db.prepare(
        `UPDATE suppliers
         SET name = ?, phone = ?, email = ?, address = ?, wilaya_code = ?,
             specialty = ?, nif_number = ?, notes = ?,
             is_archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        input.name.trim(),
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.address?.trim() || null,
        input.wilayaCode?.trim() || null,
        input.specialty?.trim() || null,
        input.nifNumber?.trim() || null,
        input.notes?.trim() || null,
        input.isArchived !== void 0 ? input.isArchived ? 1 : 0 : Number(existing.is_archived ?? 0),
        input.id
      );
      const updated = mapSupplier(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(input.id));
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: "SUPPLIER_UPDATED",
        entityType: "suppliers",
        entityId: input.id,
        previousValue: mapSupplier(existing),
        newValue: updated
      });
      return updated;
    }
    const res = db.prepare(
      `INSERT INTO suppliers (name, phone, email, address, wilaya_code, specialty, nif_number, notes, is_archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.name.trim(),
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.address?.trim() || null,
      input.wilayaCode?.trim() || null,
      input.specialty?.trim() || null,
      input.nifNumber?.trim() || null,
      input.notes?.trim() || null,
      input.isArchived ? 1 : 0
    );
    const id = Number(res.lastInsertRowid);
    const created = mapSupplier(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id));
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "SUPPLIER_CREATED",
      entityType: "suppliers",
      entityId: id,
      newValue: created
    });
    return created;
  });
  return tx();
}
function createSupplier(db, actor, input) {
  return upsertSupplier(db, actor, input);
}
function listExpenses(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.category && filters.category !== "ALL") {
    clauses.push("e.category = ?");
    params.push(filters.category);
  }
  if (filters?.vehicleId) {
    clauses.push("e.vehicle_id = ?");
    params.push(filters.vehicleId);
  } else if (filters?.scope === "VEHICLE") {
    clauses.push("e.vehicle_id IS NOT NULL");
  } else if (filters?.scope === "AGENCY") {
    clauses.push("e.vehicle_id IS NULL");
  }
  if (filters?.supplierId) {
    clauses.push("e.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("e.status = ?");
    params.push(filters.status);
  }
  if (filters?.dateFrom) {
    clauses.push("substr(e.expense_date, 1, 10) >= ?");
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push("substr(e.expense_date, 1, 10) <= ?");
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(e.expense_number LIKE ? OR e.description LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(v.matricule, '') LIKE ? OR COALESCE(e.payment_reference, '') LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT e.*,
              CASE WHEN v.id IS NOT NULL THEN (v.brand || ' ' || v.model || ' (' || v.matricule || ')') ELSE NULL END AS vehicle_label,
              s.name AS supplier_name,
              u.username AS recorded_by_username,
              er.reason AS reversal_reason,
              er.created_at AS reversed_at,
              ur.username AS reversed_by_username
       FROM expenses e
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       JOIN users u ON u.id = e.recorded_by_user_id
       LEFT JOIN expense_reversals er ON er.expense_id = e.id
       LEFT JOIN users ur ON ur.id = er.reversed_by_user_id
       ${where}
       ORDER BY e.expense_date DESC, e.id DESC`
  ).all(...params);
  return rows.map(mapExpense);
}
function recordExpense(db, actor, vaultRootDir, vaultKey, input) {
  const tx = db.transaction(() => {
    if (input.vehicleId) {
      const v = db.prepare("SELECT id FROM vehicles WHERE id = ?").get(input.vehicleId);
      if (!v) throw new AuthError("NOT_FOUND", "V\xE9hicule associ\xE9 introuvable");
    }
    if (input.supplierId) {
      const s = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.supplierId);
      if (!s) throw new AuthError("NOT_FOUND", "Fournisseur introuvable");
    }
    let receiptPath = null;
    let receiptName = null;
    let receiptMime = null;
    if (input.receiptDoc) {
      const validated = validateAndDecodeUpload({
        originalFileName: input.receiptDoc.originalFileName,
        mimeType: input.receiptDoc.mimeType,
        base64Data: input.receiptDoc.base64Data
      });
      const encrypted = encryptBuffer(validated.bytes, vaultKey);
      const opaqueName = `exp_${import_node_crypto8.default.randomUUID()}.enc`;
      const relPath = import_node_path11.default.join("expenses", opaqueName);
      const fullPath = resolveConfinedPath(vaultRootDir, relPath);
      import_node_fs10.default.mkdirSync(import_node_path11.default.dirname(fullPath), { recursive: true });
      import_node_fs10.default.writeFileSync(fullPath, encrypted, { mode: 384 });
      receiptPath = relPath;
      receiptName = validated.safeFileName;
      receiptMime = validated.mimeType;
    }
    const expenseNumber = generateExpenseNumber(db);
    const res = db.prepare(
      `INSERT INTO expenses (
          expense_number, category, vehicle_id, supplier_id, maintenance_record_id,
          amount_minor, currency, expense_date, payment_method, payment_reference,
          status, description, receipt_file_path, receipt_original_name, receipt_mime_type,
          recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)`
    ).run(
      expenseNumber,
      input.category,
      input.vehicleId ?? null,
      input.supplierId ?? null,
      input.maintenanceRecordId ?? null,
      input.amountMinor,
      input.currency,
      input.expenseDate,
      input.paymentMethod,
      input.paymentReference?.trim() || null,
      input.description.trim(),
      receiptPath,
      receiptName,
      receiptMime,
      actor.id
    );
    const expenseId = Number(res.lastInsertRowid);
    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      movementType: "EXPENSE",
      amountMinor: input.amountMinor,
      expenseId,
      description: `${expenseNumber} \xB7 ${input.description.trim()}`
    });
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "EXPENSE_RECORDED",
      entityType: "expenses",
      entityId: expenseId,
      newValue: {
        expenseNumber,
        category: input.category,
        vehicleId: input.vehicleId ?? null,
        amountMinor: input.amountMinor,
        paymentMethod: input.paymentMethod
      }
    });
    return listExpenses(db).find((e) => e.id === expenseId);
  });
  return tx();
}
function reverseExpense(db, actor, input) {
  const tx = db.transaction(() => {
    const exp = db.prepare("SELECT * FROM expenses WHERE id = ?").get(input.expenseId);
    if (!exp) throw new AuthError("NOT_FOUND", "D\xE9pense introuvable");
    if (exp.status === "REVERSED") {
      throw new AuthError("CONFLICT", "Cette d\xE9pense est d\xE9j\xE0 annul\xE9e par contre-passation");
    }
    const cashMov = db.prepare(
      `SELECT cm.id, cm.session_id, cs.status
         FROM cash_register_movements cm
         JOIN cash_register_sessions cs ON cs.id = cm.session_id
         WHERE cm.expense_id = ? AND cm.movement_type = 'EXPENSE'
         LIMIT 1`
    ).get(exp.id);
    let cashAdjMovementId = null;
    if (cashMov && cashMov.status === "OPEN") {
      const session2 = db.prepare("SELECT * FROM cash_register_sessions WHERE id = ?").get(cashMov.session_id);
      const nextAdj = Number(session2.cash_adjustments_minor ?? 0) + Number(exp.amount_minor);
      const nextExpected = Number(session2.expected_closing_minor) + Number(exp.amount_minor);
      const adjRes = db.prepare(
        `INSERT INTO cash_register_movements (
            session_id, movement_type, amount_minor, expense_id, description, recorded_by_user_id
          ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?)`
      ).run(
        cashMov.session_id,
        exp.amount_minor,
        exp.id,
        `Annulation d\xE9pense ${exp.expense_number}: ${input.reason.trim()}`,
        actor.id
      );
      cashAdjMovementId = Number(adjRes.lastInsertRowid);
      db.prepare(
        `UPDATE cash_register_sessions
         SET cash_adjustments_minor = ?, expected_closing_minor = ?
         WHERE id = ?`
      ).run(nextAdj, nextExpected, cashMov.session_id);
    }
    db.prepare("UPDATE expenses SET status = 'REVERSED' WHERE id = ?").run(exp.id);
    db.prepare(
      `INSERT INTO expense_reversals (expense_id, reason, reversed_by_user_id, cash_adjustment_movement_id)
       VALUES (?, ?, ?, ?)`
    ).run(exp.id, input.reason.trim(), actor.id, cashAdjMovementId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "EXPENSE_REVERSED",
      entityType: "expenses",
      entityId: exp.id,
      previousValue: { status: "POSTED", amountMinor: exp.amount_minor },
      newValue: { status: "REVERSED", cashAdjustmentMovementId: cashAdjMovementId },
      reason: input.reason.trim()
    });
    return listExpenses(db).find((e) => e.id === exp.id);
  });
  return tx();
}
function readExpenseDocument(db, vaultRootDir, vaultKey, expenseId) {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(expenseId);
  if (!row || !row.receipt_file_path) {
    throw new AuthError("NOT_FOUND", "Pi\xE8ce justificative de d\xE9pense introuvable");
  }
  const fullPath = resolveConfinedPath(vaultRootDir, row.receipt_file_path);
  const encrypted = import_node_fs10.default.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);
  return {
    id: row.id,
    originalFileName: row.receipt_original_name || "justificatif_depense",
    mimeType: row.receipt_mime_type || "application/pdf",
    base64Data: plain.toString("base64")
  };
}

// electron/database/services/maintenanceService.ts
function addDaysToDate(dateStr, days) {
  const base = /* @__PURE__ */ new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
function generateMaintenanceNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM maintenance_records").get();
  const seq = (row?.max_id ?? 0) + 1;
  return `MNT-${year}-${String(seq).padStart(5, "0")}`;
}
function mapMaintenanceType(r) {
  return {
    id: Number(r.id),
    code: r.code,
    nameFr: r.name_fr,
    nameAr: r.name_ar,
    defaultKmInterval: r.default_km_interval != null ? Number(r.default_km_interval) : null,
    defaultDayInterval: r.default_day_interval != null ? Number(r.default_day_interval) : null,
    kmWarningThreshold: Number(r.km_warning_threshold ?? 1e3),
    dayWarningThreshold: Number(r.day_warning_threshold ?? 14),
    isActive: r.is_active === 1
  };
}
function mapSchedule(r) {
  return {
    id: Number(r.id),
    vehicleId: Number(r.vehicle_id),
    maintenanceTypeId: Number(r.maintenance_type_id),
    kmInterval: r.km_interval != null ? Number(r.km_interval) : null,
    dayInterval: r.day_interval != null ? Number(r.day_interval) : null,
    kmWarningThreshold: Number(r.km_warning_threshold ?? 1e3),
    dayWarningThreshold: Number(r.day_warning_threshold ?? 14),
    isActive: r.is_active === 1,
    notes: r.notes ?? null,
    updatedByUserId: r.updated_by_user_id != null ? Number(r.updated_by_user_id) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function mapMaintenanceRecord(r) {
  return {
    id: Number(r.id),
    recordNumber: r.record_number ?? `MNT-${r.id}`,
    vehicleId: Number(r.vehicle_id),
    maintenanceTypeId: Number(r.maintenance_type_id),
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    status: r.status ?? "COMPLETED",
    isEmergency: r.is_emergency === 1,
    workDescription: r.work_description,
    performedDate: r.performed_date,
    scheduledStartDate: r.scheduled_start_date ?? null,
    scheduledEndDate: r.scheduled_end_date ?? null,
    odometerKm: Number(r.odometer_km),
    nextDueDate: r.next_due_date ?? null,
    nextDueOdometerKm: r.next_due_odometer_km != null ? Number(r.next_due_odometer_km) : null,
    laborCostMinor: Number(r.labor_cost_minor ?? 0),
    partsCostMinor: Number(r.parts_cost_minor ?? 0),
    totalCostMinor: Number(r.total_cost_minor ?? 0),
    technicianName: r.technician_name ?? null,
    notes: r.notes ?? null,
    invoiceFilePath: r.invoice_file_path ?? null,
    invoiceOriginalName: r.invoice_original_name ?? null,
    invoiceMimeType: r.invoice_mime_type ?? null,
    blockedPeriodId: r.blocked_period_id != null ? Number(r.blocked_period_id) : null,
    partsConsumedLocked: r.parts_consumed_locked === 1,
    recordedByUserId: Number(r.recorded_by_user_id),
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    vehicleLabel: r.vehicle_label,
    vehicleMatricule: r.vehicle_matricule,
    maintenanceTypeCode: r.maintenance_type_code,
    maintenanceTypeNameFr: r.maintenance_type_name_fr,
    maintenanceTypeNameAr: r.maintenance_type_name_ar,
    supplierName: r.supplier_name ?? null,
    recordedByUsername: r.recorded_by_username,
    linkedExpenseId: r.linked_expense_id != null ? Number(r.linked_expense_id) : null,
    linkedExpenseNumber: r.linked_expense_number ?? null,
    blockIsActive: r.block_is_active === 1
  };
}
function listMaintenanceTypes(db, includeInactive = true) {
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return db.prepare(`SELECT * FROM maintenance_types ${where} ORDER BY id ASC`).all().map(mapMaintenanceType);
}
function upsertMaintenanceType(db, actor, input) {
  const tx = db.transaction(() => {
    const cleanCode = input.code.trim().toUpperCase().replace(/\s+/g, "_");
    if (input.id) {
      const existing = db.prepare("SELECT * FROM maintenance_types WHERE id = ?").get(input.id);
      if (!existing) throw new AuthError("NOT_FOUND", "Type de maintenance introuvable");
      const dup2 = db.prepare("SELECT id FROM maintenance_types WHERE code = ? AND id != ?").get(cleanCode, input.id);
      if (dup2) throw new AuthError("CONFLICT", `Code type d\xE9j\xE0 utilis\xE9: ${cleanCode}`);
      db.prepare(
        `UPDATE maintenance_types
         SET code = ?, name_fr = ?, name_ar = ?, default_km_interval = ?, default_day_interval = ?,
             km_warning_threshold = ?, day_warning_threshold = ?, is_active = ?
         WHERE id = ?`
      ).run(
        cleanCode,
        input.nameFr.trim(),
        input.nameAr.trim(),
        input.defaultKmInterval ?? null,
        input.defaultDayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0,
        input.id
      );
      const updated = mapMaintenanceType(
        db.prepare("SELECT * FROM maintenance_types WHERE id = ?").get(input.id)
      );
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: "MAINTENANCE_TYPE_UPDATED",
        entityType: "maintenance_types",
        entityId: input.id,
        previousValue: mapMaintenanceType(existing),
        newValue: updated
      });
      syncOperationalAlerts(db);
      return updated;
    }
    const dup = db.prepare("SELECT id FROM maintenance_types WHERE code = ?").get(cleanCode);
    if (dup) throw new AuthError("CONFLICT", `Code type d\xE9j\xE0 utilis\xE9: ${cleanCode}`);
    const res = db.prepare(
      `INSERT INTO maintenance_types (
          code, name_fr, name_ar, default_km_interval, default_day_interval,
          km_warning_threshold, day_warning_threshold, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cleanCode,
      input.nameFr.trim(),
      input.nameAr.trim(),
      input.defaultKmInterval ?? null,
      input.defaultDayInterval ?? null,
      input.kmWarningThreshold,
      input.dayWarningThreshold,
      input.isActive ? 1 : 0
    );
    const id = Number(res.lastInsertRowid);
    const created = mapMaintenanceType(
      db.prepare("SELECT * FROM maintenance_types WHERE id = ?").get(id)
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "MAINTENANCE_TYPE_CREATED",
      entityType: "maintenance_types",
      entityId: id,
      newValue: created
    });
    syncOperationalAlerts(db);
    return created;
  });
  return tx();
}
function upsertVehicleMaintenanceSchedule(db, actor, input) {
  const tx = db.transaction(() => {
    const v = db.prepare("SELECT id FROM vehicles WHERE id = ?").get(input.vehicleId);
    if (!v) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    const mt = db.prepare("SELECT id FROM maintenance_types WHERE id = ?").get(input.maintenanceTypeId);
    if (!mt) throw new AuthError("NOT_FOUND", "Type de maintenance introuvable");
    const existing = db.prepare(
      "SELECT * FROM vehicle_maintenance_schedules WHERE vehicle_id = ? AND maintenance_type_id = ?"
    ).get(input.vehicleId, input.maintenanceTypeId);
    let schedId;
    if (existing) {
      db.prepare(
        `UPDATE vehicle_maintenance_schedules
         SET km_interval = ?, day_interval = ?, km_warning_threshold = ?, day_warning_threshold = ?,
             is_active = ?, notes = ?, updated_by_user_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        input.kmInterval ?? null,
        input.dayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0,
        input.notes?.trim() || null,
        actor.id,
        existing.id
      );
      schedId = Number(existing.id);
    } else {
      const res = db.prepare(
        `INSERT INTO vehicle_maintenance_schedules (
            vehicle_id, maintenance_type_id, km_interval, day_interval,
            km_warning_threshold, day_warning_threshold, is_active, notes, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.vehicleId,
        input.maintenanceTypeId,
        input.kmInterval ?? null,
        input.dayInterval ?? null,
        input.kmWarningThreshold,
        input.dayWarningThreshold,
        input.isActive ? 1 : 0,
        input.notes?.trim() || null,
        actor.id
      );
      schedId = Number(res.lastInsertRowid);
    }
    const schedule = mapSchedule(
      db.prepare("SELECT * FROM vehicle_maintenance_schedules WHERE id = ?").get(schedId)
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "VEHICLE_MAINTENANCE_SCHEDULE_SAVED",
      entityType: "vehicle_maintenance_schedules",
      entityId: schedId,
      previousValue: existing ? mapSchedule(existing) : null,
      newValue: schedule
    });
    syncOperationalAlerts(db);
    const dueItem = getVehicleMaintenanceDueSummary(db, input.vehicleId).find(
      (d) => d.maintenanceTypeId === input.maintenanceTypeId
    );
    return { schedule, dueItem };
  });
  return tx();
}
function listMaintenanceRecords(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.vehicleId) {
    clauses.push("mr.vehicle_id = ?");
    params.push(filters.vehicleId);
  }
  if (filters?.maintenanceTypeId) {
    clauses.push("mr.maintenance_type_id = ?");
    params.push(filters.maintenanceTypeId);
  }
  if (filters?.status && filters.status !== "ALL") {
    clauses.push("mr.status = ?");
    params.push(filters.status);
  }
  if (filters?.isEmergency) {
    clauses.push("mr.is_emergency = 1");
  }
  if (filters?.dateFrom) {
    clauses.push("substr(mr.performed_date, 1, 10) >= ?");
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push("substr(mr.performed_date, 1, 10) <= ?");
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(COALESCE(mr.record_number, '') LIKE ? OR mr.work_description LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR mt.name_fr LIKE ? OR COALESCE(s.name, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT mr.*,
              v.brand || ' ' || v.model || ' (' || v.matricule || ')' AS vehicle_label,
              v.matricule AS vehicle_matricule,
              mt.code AS maintenance_type_code,
              mt.name_fr AS maintenance_type_name_fr,
              mt.name_ar AS maintenance_type_name_ar,
              s.name AS supplier_name,
              u.username AS recorded_by_username,
              e.id AS linked_expense_id,
              e.expense_number AS linked_expense_number,
              COALESCE(vbp.is_active, 0) AS block_is_active
       FROM maintenance_records mr
       JOIN vehicles v ON v.id = mr.vehicle_id
       JOIN maintenance_types mt ON mt.id = mr.maintenance_type_id
       LEFT JOIN suppliers s ON s.id = mr.supplier_id
       JOIN users u ON u.id = mr.recorded_by_user_id
       LEFT JOIN expenses e ON e.maintenance_record_id = mr.id AND e.status = 'POSTED'
       LEFT JOIN vehicle_blocked_periods vbp ON vbp.id = mr.blocked_period_id
       ${where}
       ORDER BY mr.performed_date DESC, mr.id DESC`
  ).all(...params);
  return rows.map(mapMaintenanceRecord);
}
function getMaintenanceRecordDetail(db, recordId) {
  const row = listMaintenanceRecords(db).find((r) => r.id === recordId);
  if (!row) throw new AuthError("NOT_FOUND", "Intervention de maintenance introuvable");
  const parts = db.prepare(
    `SELECT mp.*, ip.part_code, ip.part_name
       FROM maintenance_parts mp
       JOIN inventory_parts ip ON ip.id = mp.part_id
       WHERE mp.maintenance_record_id = ?
       ORDER BY mp.id ASC`
  ).all(recordId).map((p) => ({
    id: Number(p.id),
    maintenanceRecordId: Number(p.maintenance_record_id),
    partId: Number(p.part_id),
    partCode: p.part_code,
    partName: p.part_name,
    quantityUsed: Number(p.quantity_used),
    unitCostMinor: Number(p.unit_cost_minor),
    totalCostMinor: Number(p.total_cost_minor)
  }));
  const blockedPeriod = row.blockedPeriodId ? db.prepare("SELECT * FROM vehicle_blocked_periods WHERE id = ?").get(row.blockedPeriodId) : null;
  return {
    record: row,
    parts,
    blockedPeriod: blockedPeriod ? {
      id: Number(blockedPeriod.id),
      startDate: blockedPeriod.start_date,
      endDate: blockedPeriod.end_date,
      isActive: blockedPeriod.is_active === 1,
      reason: blockedPeriod.reason
    } : null
  };
}
function getVehicleMaintenanceOverview(db, vehicleId) {
  const v = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(vehicleId);
  if (!v) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
  const dueSummary = getVehicleMaintenanceDueSummary(db, vehicleId);
  const records = listMaintenanceRecords(db, { vehicleId });
  const alerts = listOperationalAlerts(db, { vehicleId, includeResolved: false });
  return {
    vehicleId: Number(v.id),
    currentOdometerKm: Number(v.current_odometer_km),
    status: v.status,
    dueSummary,
    records,
    alerts
  };
}
function saveEncryptedInvoice(vaultRootDir, vaultKey, doc) {
  const validated = validateAndDecodeUpload({
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    base64Data: doc.base64Data
  });
  const encrypted = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `mnt_${import_node_crypto9.default.randomUUID()}.enc`;
  const relPath = import_node_path12.default.join("maintenance", opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relPath);
  import_node_fs11.default.mkdirSync(import_node_path12.default.dirname(fullPath), { recursive: true });
  import_node_fs11.default.writeFileSync(fullPath, encrypted, { mode: 384 });
  return {
    filePath: relPath,
    originalName: validated.safeFileName,
    mimeType: validated.mimeType
  };
}
function computeNextDueDefaults(db, vehicleId, maintenanceTypeId, performedDate, odometerKm, explicitNextDate, explicitNextKm) {
  if (explicitNextDate !== void 0 && explicitNextKm !== void 0) {
    return {
      nextDueDate: explicitNextDate || null,
      nextDueOdometerKm: explicitNextKm ?? null
    };
  }
  const sched = db.prepare(
    "SELECT km_interval, day_interval, is_active FROM vehicle_maintenance_schedules WHERE vehicle_id = ? AND maintenance_type_id = ?"
  ).get(vehicleId, maintenanceTypeId);
  const mt = db.prepare("SELECT default_km_interval, default_day_interval FROM maintenance_types WHERE id = ?").get(maintenanceTypeId);
  const kmInterval = sched ? sched.km_interval : mt?.default_km_interval;
  const dayInterval = sched ? sched.day_interval : mt?.default_day_interval;
  const isActive = sched ? sched.is_active === 1 : true;
  const computedDate = explicitNextDate !== void 0 ? explicitNextDate || null : isActive && dayInterval != null ? addDaysToDate(performedDate, Number(dayInterval)) : null;
  const computedKm = explicitNextKm !== void 0 ? explicitNextKm ?? null : isActive && kmInterval != null ? odometerKm + Number(kmInterval) : null;
  return { nextDueDate: computedDate, nextDueOdometerKm: computedKm };
}
function syncMaintenanceExpenseOnce(db, actor, vaultRootDir, vaultKey, params) {
  if (params.totalCostMinor <= 0) return null;
  const existingPosted = db.prepare(
    "SELECT id FROM expenses WHERE maintenance_record_id = ? AND status = 'POSTED' LIMIT 1"
  ).get(params.maintenanceRecordId);
  if (existingPosted) {
    return existingPosted.id;
  }
  const exp = recordExpense(db, actor, vaultRootDir, vaultKey, {
    category: params.financeCategory,
    vehicleId: params.vehicleId,
    supplierId: params.supplierId,
    maintenanceRecordId: params.maintenanceRecordId,
    amountMinor: params.totalCostMinor,
    currency: "DZD",
    expenseDate: params.performedDate.slice(0, 10),
    paymentMethod: params.paymentMethod,
    paymentReference: params.paymentReference ?? null,
    description: `${params.recordNumber} \xB7 ${params.workDescription}`
  });
  return exp.id;
}
function syncMaintenancePartsRows(db, recordId, partsUsed) {
  const merged = /* @__PURE__ */ new Map();
  for (const item of partsUsed) {
    const existing = merged.get(item.partId);
    if (existing) {
      existing.quantityUsed += item.quantityUsed;
      if (item.unitCostMinor !== void 0) existing.unitCostOverride = item.unitCostMinor;
    } else {
      merged.set(item.partId, {
        quantityUsed: item.quantityUsed,
        unitCostOverride: item.unitCostMinor
      });
    }
  }
  db.prepare("DELETE FROM maintenance_parts WHERE maintenance_record_id = ?").run(recordId);
  let computedPartsCost = 0;
  const insertStmt = db.prepare(
    `INSERT INTO maintenance_parts (
      maintenance_record_id, part_id, quantity_used, unit_cost_minor, total_cost_minor
    ) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [partId, entry] of merged.entries()) {
    const part = db.prepare(
      "SELECT id, part_code, part_name, unit_purchase_price_minor, COALESCE(is_archived, 0) AS is_archived FROM inventory_parts WHERE id = ?"
    ).get(partId);
    if (!part) throw new AuthError("NOT_FOUND", `Pi\xE8ce d\xE9tach\xE9e #${partId} introuvable`);
    if (part.is_archived === 1) {
      throw new AuthError("CONFLICT", `La pi\xE8ce ${part.part_code} est archiv\xE9e`);
    }
    const unitCost = entry.unitCostOverride !== void 0 ? Number(entry.unitCostOverride) : Number(part.unit_purchase_price_minor ?? 0);
    const totalLine = unitCost * entry.quantityUsed;
    computedPartsCost += totalLine;
    insertStmt.run(recordId, partId, entry.quantityUsed, unitCost, totalLine);
  }
  return computedPartsCost;
}
function consumeLockedMaintenancePartsOnce(db, actor, params) {
  const rec = db.prepare("SELECT parts_consumed_locked FROM maintenance_records WHERE id = ?").get(params.recordId);
  if (!rec || rec.parts_consumed_locked === 1) {
    return;
  }
  const rows = db.prepare(
    "SELECT id, part_id, quantity_used, unit_cost_minor FROM maintenance_parts WHERE maintenance_record_id = ? ORDER BY id ASC"
  ).all(params.recordId);
  if (rows.length === 0) {
    return;
  }
  const movDate = params.performedDate.slice(0, 10);
  for (const row of rows) {
    const part = db.prepare(
      "SELECT id, part_code, part_name, quantity_available FROM inventory_parts WHERE id = ?"
    ).get(row.part_id);
    if (!part) {
      throw new AuthError("NOT_FOUND", `Pi\xE8ce d\xE9tach\xE9e #${row.part_id} introuvable`);
    }
    const available = Number(part.quantity_available ?? 0);
    const needed = Number(row.quantity_used);
    if (available < needed) {
      throw new AuthError(
        "CONFLICT",
        `Stock insuffisant pour ${part.part_code} (${part.part_name}) : disponible ${available}, requis ${needed}.`
      );
    }
    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = quantity_available - ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(needed, part.id);
    db.prepare(
      `INSERT INTO inventory_movements (
        part_id, movement_type, quantity_delta, unit_cost_minor,
        maintenance_record_id, vehicle_id, reference_code, movement_date,
        notes, recorded_by_user_id
      ) VALUES (?, 'MAINTENANCE_USE', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      part.id,
      -needed,
      Number(row.unit_cost_minor),
      params.recordId,
      params.vehicleId,
      params.recordNumber,
      movDate,
      `Consommation atelier (${params.recordNumber})`,
      actor.id
    );
  }
  db.prepare("UPDATE maintenance_records SET parts_consumed_locked = 1 WHERE id = ?").run(params.recordId);
}
function createMaintenanceRecord(db, actor, vaultRootDir, vaultKey, input) {
  const tx = db.transaction(() => {
    const vehicle = db.prepare("SELECT * FROM vehicles WHERE id = ? AND is_archived = 0").get(input.vehicleId);
    if (!vehicle) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable ou archiv\xE9");
    const mt = db.prepare("SELECT * FROM maintenance_types WHERE id = ?").get(input.maintenanceTypeId);
    if (!mt) throw new AuthError("NOT_FOUND", "Type de maintenance introuvable");
    if (input.supplierId != null) {
      const sup = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.supplierId);
      if (!sup) throw new AuthError("NOT_FOUND", "Fournisseur / Garage introuvable");
    }
    const status = input.status ?? "COMPLETED";
    const laborCostMinor = Number(input.laborCostMinor ?? 0);
    const partsCostMinor = Number(input.partsCostMinor ?? 0);
    const totalCostMinor = laborCostMinor + partsCostMinor;
    if (input.scheduledStartDate && input.scheduledEndDate && Date.parse(input.scheduledEndDate) <= Date.parse(input.scheduledStartDate)) {
      throw new AuthError("VALIDATION_ERROR", "La date de fin pr\xE9vue doit \xEAtre post\xE9rieure au d\xE9but");
    }
    const shouldBlock = Boolean(input.blockVehicle) && (status === "SCHEDULED" || status === "IN_PROGRESS");
    let blockedPeriodId = null;
    const recordNumber = generateMaintenanceNumber(db);
    if (shouldBlock) {
      const bStart = input.scheduledStartDate?.trim() || (input.performedDate.length === 10 ? `${input.performedDate}T08:00` : input.performedDate);
      const bEnd = input.scheduledEndDate?.trim() || `${addDaysToDate(bStart, 1)}T18:00`;
      const avail = checkVehicleAvailability(db, {
        vehicleId: input.vehicleId,
        startDate: bStart,
        endDate: bEnd,
        allowVehicleInMaintenance: true
      });
      if (!avail.available) {
        throw new AuthError(
          "CONFLICT",
          `Impossible de bloquer le v\xE9hicule: ${avail.conflicts.map((c) => c.details).join(", ")}`
        );
      }
      const bRes = db.prepare(
        `INSERT INTO vehicle_blocked_periods (
            vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
          ) VALUES (?, 'MAINTENANCE', ?, ?, ?, 1, ?)`
      ).run(
        input.vehicleId,
        bStart,
        bEnd,
        `${recordNumber} \xB7 ${mt.name_fr}: ${input.workDescription.trim()}`,
        actor.id
      );
      blockedPeriodId = Number(bRes.lastInsertRowid);
    }
    let nextDueDate = input.nextDueDate ?? null;
    let nextDueOdometerKm = input.nextDueOdometerKm ?? null;
    if (status === "COMPLETED") {
      const defaults = computeNextDueDefaults(
        db,
        input.vehicleId,
        input.maintenanceTypeId,
        input.performedDate,
        input.odometerKm,
        input.nextDueDate,
        input.nextDueOdometerKm
      );
      nextDueDate = defaults.nextDueDate;
      nextDueOdometerKm = defaults.nextDueOdometerKm;
    }
    let invoiceFilePath = null;
    let invoiceOriginalName = null;
    let invoiceMimeType = null;
    if (input.invoiceDoc) {
      const savedDoc = saveEncryptedInvoice(vaultRootDir, vaultKey, input.invoiceDoc);
      invoiceFilePath = savedDoc.filePath;
      invoiceOriginalName = savedDoc.originalName;
      invoiceMimeType = savedDoc.mimeType;
    }
    const completedAt = status === "COMPLETED" ? (/* @__PURE__ */ new Date()).toISOString() : null;
    const res = db.prepare(
      `INSERT INTO maintenance_records (
          record_number, vehicle_id, maintenance_type_id, supplier_id, status, is_emergency,
          work_description, performed_date, scheduled_start_date, scheduled_end_date,
          odometer_km, next_due_date, next_due_odometer_km,
          labor_cost_minor, parts_cost_minor, total_cost_minor,
          technician_name, notes, invoice_file_path, invoice_original_name, invoice_mime_type,
          blocked_period_id, recorded_by_user_id, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    ).run(
      recordNumber,
      input.vehicleId,
      input.maintenanceTypeId,
      input.supplierId ?? null,
      status,
      input.isEmergency ? 1 : 0,
      input.workDescription.trim(),
      input.performedDate,
      input.scheduledStartDate?.trim() || null,
      input.scheduledEndDate?.trim() || null,
      input.odometerKm,
      nextDueDate,
      nextDueOdometerKm,
      laborCostMinor,
      partsCostMinor,
      totalCostMinor,
      input.technicianName?.trim() || null,
      input.notes?.trim() || null,
      invoiceFilePath,
      invoiceOriginalName,
      invoiceMimeType,
      blockedPeriodId,
      actor.id,
      completedAt
    );
    const recordId = Number(res.lastInsertRowid);
    let effectivePartsCostMinor = partsCostMinor;
    if (input.partsUsed && input.partsUsed.length > 0) {
      effectivePartsCostMinor = syncMaintenancePartsRows(db, recordId, input.partsUsed);
      const recomputedTotal = laborCostMinor + effectivePartsCostMinor;
      db.prepare("UPDATE maintenance_records SET parts_cost_minor = ?, total_cost_minor = ? WHERE id = ?").run(
        effectivePartsCostMinor,
        recomputedTotal,
        recordId
      );
      if (status === "COMPLETED") {
        consumeLockedMaintenancePartsOnce(db, actor, {
          recordId,
          recordNumber,
          vehicleId: input.vehicleId,
          performedDate: input.performedDate
        });
      }
    }
    const effectiveTotalCostMinor = laborCostMinor + effectivePartsCostMinor;
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.odometerKm, input.vehicleId);
    recomputeVehicleStatus(db, input.vehicleId);
    const financeAmountMinor = input.financeExpenseScope === "LABOR_ONLY" ? laborCostMinor : effectiveTotalCostMinor;
    if (input.recordInFinance && financeAmountMinor > 0) {
      syncMaintenanceExpenseOnce(db, actor, vaultRootDir, vaultKey, {
        maintenanceRecordId: recordId,
        recordNumber,
        vehicleId: input.vehicleId,
        supplierId: input.supplierId ?? null,
        totalCostMinor: financeAmountMinor,
        performedDate: input.performedDate,
        workDescription: input.financeExpenseScope === "LABOR_ONLY" ? `${input.workDescription} (Main d'\u0153uvre)` : input.workDescription,
        financeCategory: input.financeCategory ?? (input.isEmergency ? "REPAIRS" : "MAINTENANCE"),
        paymentMethod: input.paymentMethod ?? "CASH",
        paymentReference: input.paymentReference ?? null
      });
    }
    syncOperationalAlerts(db);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "MAINTENANCE_CREATED",
      entityType: "maintenance_records",
      entityId: recordId,
      newValue: {
        recordNumber,
        vehicleId: input.vehicleId,
        maintenanceTypeId: input.maintenanceTypeId,
        status,
        isEmergency: Boolean(input.isEmergency),
        totalCostMinor: effectiveTotalCostMinor,
        partsCount: input.partsUsed?.length ?? 0,
        blockedPeriodId
      }
    });
    return getMaintenanceRecordDetail(db, recordId);
  });
  return tx();
}
function updateMaintenanceRecord(db, actor, vaultRootDir, vaultKey, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM maintenance_records WHERE id = ?").get(input.recordId);
    if (!current) throw new AuthError("NOT_FOUND", "Intervention de maintenance introuvable");
    const nextStatus = input.status ?? current.status;
    if (current.status === "CANCELLED" && nextStatus !== "CANCELLED") {
      throw new AuthError("CONFLICT", "Une maintenance annul\xE9e ne peut pas \xEAtre r\xE9ouverte");
    }
    if (current.status === "COMPLETED" && (nextStatus === "SCHEDULED" || nextStatus === "IN_PROGRESS")) {
      throw new AuthError("CONFLICT", "Une maintenance cl\xF4tur\xE9e ne peut pas repasser en cours");
    }
    if (input.supplierId != null) {
      const sup = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.supplierId);
      if (!sup) throw new AuthError("NOT_FOUND", "Fournisseur / Garage introuvable");
    }
    const nextSupplierId = input.supplierId !== void 0 ? input.supplierId : current.supplier_id;
    const nextWorkDesc = input.workDescription?.trim() || current.work_description;
    const nextPerformedDate = input.performedDate?.trim() || current.performed_date;
    const nextScheduledStart = input.scheduledStartDate !== void 0 ? input.scheduledStartDate?.trim() || null : current.scheduled_start_date;
    const nextScheduledEnd = input.scheduledEndDate !== void 0 ? input.scheduledEndDate?.trim() || null : current.scheduled_end_date;
    if (nextScheduledStart && nextScheduledEnd && Date.parse(nextScheduledEnd) <= Date.parse(nextScheduledStart)) {
      throw new AuthError("VALIDATION_ERROR", "La date de fin pr\xE9vue doit \xEAtre post\xE9rieure au d\xE9but");
    }
    const nextOdometerKm = input.odometerKm ?? Number(current.odometer_km);
    const nextLabor = input.laborCostMinor ?? Number(current.labor_cost_minor ?? 0);
    let nextParts = input.partsCostMinor ?? Number(current.parts_cost_minor ?? 0);
    const partsAlreadyLocked = current.parts_consumed_locked === 1;
    if (input.partsUsed !== void 0) {
      if (partsAlreadyLocked) {
        const existingParts = db.prepare(
          "SELECT part_id, quantity_used FROM maintenance_parts WHERE maintenance_record_id = ?"
        ).all(input.recordId);
        const sameParts = existingParts.length === input.partsUsed.length && input.partsUsed.every(
          (pu) => existingParts.some((ep) => ep.part_id === pu.partId && ep.quantity_used === pu.quantityUsed)
        );
        if (!sameParts) {
          throw new AuthError(
            "CONFLICT",
            "Les pi\xE8ces d\xE9tach\xE9es d\xE9j\xE0 d\xE9duites du stock sont verrouill\xE9es pour \xE9viter toute double d\xE9duction."
          );
        }
      } else {
        nextParts = syncMaintenancePartsRows(db, input.recordId, input.partsUsed);
      }
    }
    const nextTotal = nextLabor + nextParts;
    const recordNumber = current.record_number || `MNT-${current.id}`;
    let nextDueDate = input.nextDueDate !== void 0 ? input.nextDueDate : current.next_due_date;
    let nextDueOdometerKm = input.nextDueOdometerKm !== void 0 ? input.nextDueOdometerKm : current.next_due_odometer_km != null ? Number(current.next_due_odometer_km) : null;
    if (nextStatus === "COMPLETED") {
      const defaults = computeNextDueDefaults(
        db,
        current.vehicle_id,
        current.maintenance_type_id,
        nextPerformedDate,
        nextOdometerKm,
        input.nextDueDate !== void 0 ? input.nextDueDate : nextDueDate ?? void 0,
        input.nextDueOdometerKm !== void 0 ? input.nextDueOdometerKm : nextDueOdometerKm ?? void 0
      );
      nextDueDate = defaults.nextDueDate;
      nextDueOdometerKm = defaults.nextDueOdometerKm;
    }
    let blockedPeriodId = current.blocked_period_id != null ? Number(current.blocked_period_id) : null;
    let releasedMaintenanceBlock = false;
    if (nextStatus === "COMPLETED" || nextStatus === "CANCELLED") {
      if (blockedPeriodId != null) {
        db.prepare(
          `UPDATE vehicle_blocked_periods
           SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND is_active = 1`
        ).run(actor.id, blockedPeriodId);
        releasedMaintenanceBlock = true;
      }
      if (current.status === "IN_PROGRESS") {
        releasedMaintenanceBlock = true;
      }
    } else if (input.blockVehicle === false && blockedPeriodId != null) {
      db.prepare(
        `UPDATE vehicle_blocked_periods
         SET is_active = 0, released_by_user_id = ?, released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND is_active = 1`
      ).run(actor.id, blockedPeriodId);
      releasedMaintenanceBlock = true;
    } else if (input.blockVehicle === true) {
      const activeExisting = blockedPeriodId != null ? db.prepare(
        "SELECT id, is_active FROM vehicle_blocked_periods WHERE id = ?"
      ).get(blockedPeriodId) : null;
      if (!activeExisting || activeExisting.is_active === 0) {
        const bStart = nextScheduledStart || (nextPerformedDate.length === 10 ? `${nextPerformedDate}T08:00` : nextPerformedDate);
        const bEnd = nextScheduledEnd || `${addDaysToDate(bStart, 1)}T18:00`;
        const avail = checkVehicleAvailability(db, {
          vehicleId: current.vehicle_id,
          startDate: bStart,
          endDate: bEnd,
          excludeMaintenanceId: current.id
        });
        if (!avail.available) {
          throw new AuthError(
            "CONFLICT",
            `Impossible de bloquer le v\xE9hicule: ${avail.conflicts.map((c) => c.details).join(", ")}`
          );
        }
        const mt = db.prepare("SELECT name_fr FROM maintenance_types WHERE id = ?").get(current.maintenance_type_id);
        const bRes = db.prepare(
          `INSERT INTO vehicle_blocked_periods (
              vehicle_id, block_type, start_date, end_date, reason, is_active, created_by_user_id
            ) VALUES (?, 'MAINTENANCE', ?, ?, ?, 1, ?)`
        ).run(
          current.vehicle_id,
          bStart,
          bEnd,
          `${recordNumber} \xB7 ${mt?.name_fr ?? "Maintenance"}: ${nextWorkDesc}`,
          actor.id
        );
        blockedPeriodId = Number(bRes.lastInsertRowid);
      }
    }
    let invoiceFilePath = current.invoice_file_path;
    let invoiceOriginalName = current.invoice_original_name;
    let invoiceMimeType = current.invoice_mime_type;
    if (input.invoiceDoc) {
      const savedDoc = saveEncryptedInvoice(vaultRootDir, vaultKey, input.invoiceDoc);
      invoiceFilePath = savedDoc.filePath;
      invoiceOriginalName = savedDoc.originalName;
      invoiceMimeType = savedDoc.mimeType;
    }
    const completedAt = nextStatus === "COMPLETED" ? current.completed_at || (/* @__PURE__ */ new Date()).toISOString() : current.completed_at;
    db.prepare(
      `UPDATE maintenance_records
       SET status = ?,
           supplier_id = ?,
           work_description = ?,
           performed_date = ?,
           scheduled_start_date = ?,
           scheduled_end_date = ?,
           odometer_km = ?,
           next_due_date = ?,
           next_due_odometer_km = ?,
           labor_cost_minor = ?,
           parts_cost_minor = ?,
           total_cost_minor = ?,
           technician_name = ?,
           notes = ?,
           invoice_file_path = ?,
           invoice_original_name = ?,
           invoice_mime_type = ?,
           blocked_period_id = ?,
           completed_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextStatus,
      nextSupplierId ?? null,
      nextWorkDesc,
      nextPerformedDate,
      nextScheduledStart,
      nextScheduledEnd,
      nextOdometerKm,
      nextDueDate ?? null,
      nextDueOdometerKm,
      nextLabor,
      nextParts,
      nextTotal,
      input.technicianName !== void 0 ? input.technicianName?.trim() || null : current.technician_name,
      input.notes !== void 0 ? input.notes?.trim() || null : current.notes,
      invoiceFilePath,
      invoiceOriginalName,
      invoiceMimeType,
      blockedPeriodId,
      completedAt,
      input.recordId
    );
    if (nextStatus === "COMPLETED" && !partsAlreadyLocked) {
      consumeLockedMaintenancePartsOnce(db, actor, {
        recordId: input.recordId,
        recordNumber,
        vehicleId: current.vehicle_id,
        performedDate: nextPerformedDate
      });
    }
    if (nextStatus !== "CANCELLED") {
      db.prepare(
        `UPDATE vehicles
         SET current_odometer_km = MAX(current_odometer_km, ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(nextOdometerKm, current.vehicle_id);
    }
    recomputeVehicleStatus(db, current.vehicle_id, {
      releaseManualMaintenance: releasedMaintenanceBlock
    });
    const financeAmountMinor = input.financeExpenseScope === "LABOR_ONLY" ? nextLabor : nextTotal;
    if (input.recordInFinance && financeAmountMinor > 0 && nextStatus !== "CANCELLED") {
      syncMaintenanceExpenseOnce(db, actor, vaultRootDir, vaultKey, {
        maintenanceRecordId: input.recordId,
        recordNumber,
        vehicleId: current.vehicle_id,
        supplierId: nextSupplierId ?? null,
        totalCostMinor: financeAmountMinor,
        performedDate: nextPerformedDate,
        workDescription: input.financeExpenseScope === "LABOR_ONLY" ? `${nextWorkDesc} (Main d'\u0153uvre)` : nextWorkDesc,
        financeCategory: input.financeCategory ?? (current.is_emergency === 1 ? "REPAIRS" : "MAINTENANCE"),
        paymentMethod: input.paymentMethod ?? "CASH",
        paymentReference: input.paymentReference ?? null
      });
    }
    syncOperationalAlerts(db);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: nextStatus === "COMPLETED" && current.status !== "COMPLETED" ? "MAINTENANCE_COMPLETED" : nextStatus === "CANCELLED" && current.status !== "CANCELLED" ? "MAINTENANCE_CANCELLED" : "MAINTENANCE_UPDATED",
      entityType: "maintenance_records",
      entityId: input.recordId,
      previousValue: {
        status: current.status,
        odometerKm: current.odometer_km,
        totalCostMinor: current.total_cost_minor
      },
      newValue: {
        status: nextStatus,
        odometerKm: nextOdometerKm,
        totalCostMinor: nextTotal,
        blockedPeriodId
      }
    });
    return getMaintenanceRecordDetail(db, input.recordId);
  });
  return tx();
}
function readMaintenanceInvoice(db, vaultRootDir, vaultKey, recordId) {
  const row = db.prepare("SELECT * FROM maintenance_records WHERE id = ?").get(recordId);
  if (!row || !row.invoice_file_path) {
    throw new AuthError("NOT_FOUND", "Facture de maintenance introuvable");
  }
  const fullPath = resolveConfinedPath(vaultRootDir, row.invoice_file_path);
  const encrypted = import_node_fs11.default.readFileSync(fullPath);
  const plain = decryptBuffer(encrypted, vaultKey);
  return {
    id: Number(row.id),
    originalFileName: row.invoice_original_name || `facture_maintenance_${row.id}.pdf`,
    mimeType: row.invoice_mime_type || "application/pdf",
    base64Data: plain.toString("base64")
  };
}

// electron/database/services/reportService.ts
var import_exceljs = __toESM(require("exceljs"), 1);

// electron/database/services/financeReportService.ts
function getDefaultDateRange() {
  const now = /* @__PURE__ */ new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return {
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`
  };
}
function escapeCsvCell(val) {
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  let s = val == null ? "" : String(val);
  if (/^[\t\r ]*[=+\-@]/.test(s) || s.startsWith("	") || s.startsWith("\r")) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function getVehicleProfitabilityReport(db, params) {
  const dateFrom = params?.dateFrom?.slice(0, 10) || null;
  const dateTo = params?.dateTo?.slice(0, 10) || null;
  const vehicles = db.prepare(
    `SELECT * FROM vehicles ${params?.includeArchived ? "" : "WHERE is_archived = 0"} ORDER BY id DESC`
  ).all();
  const contractDateFilter = dateFrom && dateTo ? "AND substr(rc.start_date, 1, 10) >= ? AND substr(rc.start_date, 1, 10) <= ?" : "";
  const paymentDateFilter = dateFrom && dateTo ? "AND substr(cp.payment_date, 1, 10) >= ? AND substr(cp.payment_date, 1, 10) <= ?" : "";
  const expenseDateFilter = dateFrom && dateTo ? "AND substr(e.expense_date, 1, 10) >= ? AND substr(e.expense_date, 1, 10) <= ?" : "";
  const rangeArgs = dateFrom && dateTo ? [dateFrom, dateTo] : [];
  return vehicles.map((v) => {
    const revRow = db.prepare(
      `SELECT COUNT(*) AS contract_count,
                COALESCE(SUM(rc.total_contract_amount_minor), 0) AS rental_revenue_minor,
                COALESCE(SUM(MAX(1, CAST(ROUND((julianday(COALESCE(rc.actual_return_date, rc.expected_return_date)) - julianday(rc.start_date))) AS INTEGER))), 0) AS rented_days
         FROM rental_contracts rc
         WHERE rc.vehicle_id = ? AND rc.status != 'CANCELLED' ${contractDateFilter}`
    ).get(v.id, ...rangeArgs);
    const colRow = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END), 0) AS collected_net_minor
         FROM contract_payments cp
         JOIN rental_contracts rc ON rc.id = cp.contract_id
         WHERE rc.vehicle_id = ? ${paymentDateFilter}`
    ).get(v.id, ...rangeArgs);
    const expRow = db.prepare(
      `SELECT COALESCE(SUM(e.amount_minor), 0) AS expenses_minor
         FROM expenses e
         WHERE e.vehicle_id = ? AND e.status = 'POSTED' ${expenseDateFilter}`
    ).get(v.id, ...rangeArgs);
    const rentalRevenueMinor = Number(revRow?.rental_revenue_minor ?? 0);
    const collectedMinor = Number(colRow?.collected_net_minor ?? 0);
    const expensesMinor = Number(expRow?.expenses_minor ?? 0);
    const netProfitMinor = rentalRevenueMinor - expensesMinor;
    const acquisitionCostMinor = v.acquisition_cost_minor != null ? Number(v.acquisition_cost_minor) : null;
    const roiPercent = acquisitionCostMinor && acquisitionCostMinor > 0 ? Number((netProfitMinor / acquisitionCostMinor * 100).toFixed(1)) : null;
    return {
      vehicleId: v.id,
      internalCode: v.internal_code,
      matricule: v.matricule,
      brand: v.brand,
      model: v.model,
      category: v.category,
      contractCount: Number(revRow?.contract_count ?? 0),
      rentedDays: Number(revRow?.rented_days ?? 0),
      rentalRevenueMinor,
      collectedMinor,
      expensesMinor,
      netProfitMinor,
      acquisitionCostMinor,
      roiPercent
    };
  });
}
function getVehicleFinanceSummary(db, vehicleId) {
  const expenses = listExpenses(db, { vehicleId });
  const profit = getVehicleProfitabilityReport(db, { includeArchived: true }).find(
    (p) => p.vehicleId === vehicleId
  );
  const fineRow = db.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total_fines_minor,
              COALESCE(SUM(CASE WHEN is_paid_by_customer = 0 THEN amount_minor ELSE 0 END), 0) AS unpaid_fines_minor
       FROM traffic_fines
       WHERE vehicle_id = ?`
  ).get(vehicleId);
  return {
    vehicleId,
    expenses,
    profitability: profit ?? {
      vehicleId,
      internalCode: "",
      matricule: "",
      brand: "",
      model: "",
      category: "",
      contractCount: 0,
      rentedDays: 0,
      rentalRevenueMinor: 0,
      collectedMinor: 0,
      expensesMinor: 0,
      netProfitMinor: 0,
      acquisitionCostMinor: null,
      roiPercent: null
    },
    totalFinesMinor: Number(fineRow?.total_fines_minor ?? 0),
    unpaidFinesMinor: Number(fineRow?.unpaid_fines_minor ?? 0)
  };
}
function getFinancialDashboardReports(db, params) {
  const defaults = getDefaultDateRange();
  const dateFrom = (params?.dateFrom || defaults.dateFrom).slice(0, 10);
  const dateTo = (params?.dateTo || defaults.dateTo).slice(0, 10);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const periodContractRevRow = db.prepare(
    `SELECT COALESCE(SUM(total_contract_amount_minor), 0) AS total_rev_minor,
              COUNT(*) AS contract_count
       FROM rental_contracts
       WHERE status != 'CANCELLED'
         AND substr(start_date, 1, 10) >= ?
         AND substr(start_date, 1, 10) <= ?`
  ).get(dateFrom, dateTo);
  const periodAdjRevRow = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS adj_net_minor
       FROM customer_financial_adjustments
       WHERE substr(adjustment_date, 1, 10) >= ?
         AND substr(adjustment_date, 1, 10) <= ?`
  ).get(dateFrom, dateTo);
  const periodContractRevenueMinor = Number(periodContractRevRow?.total_rev_minor ?? 0);
  const periodAdjustmentsNetMinor = Number(periodAdjRevRow?.adj_net_minor ?? 0);
  const periodTotalRevenueMinor = Math.max(0, periodContractRevenueMinor + periodAdjustmentsNetMinor);
  const paymentRowsInRange = db.prepare(
    `SELECT direction, method, COALESCE(SUM(amount_minor), 0) AS total_minor
       FROM contract_payments
       WHERE substr(payment_date, 1, 10) >= ?
         AND substr(payment_date, 1, 10) <= ?
       GROUP BY direction, method`
  ).all(dateFrom, dateTo);
  let periodPaymentInflowsMinor = 0;
  let periodPaymentRefundsMinor = 0;
  const collectedByMethod = {
    CASH: 0,
    CCP: 0,
    BARIDIMOB: 0,
    BANK_TRANSFER: 0,
    OTHER: 0
  };
  for (const r of paymentRowsInRange) {
    const amt = Number(r.total_minor ?? 0);
    if (r.direction === "INFLOW") {
      periodPaymentInflowsMinor += amt;
      collectedByMethod[r.method] = (collectedByMethod[r.method] ?? 0) + amt;
    } else {
      periodPaymentRefundsMinor += amt;
      collectedByMethod[r.method] = (collectedByMethod[r.method] ?? 0) - amt;
    }
  }
  const periodCollectedNetMinor = periodPaymentInflowsMinor - periodPaymentRefundsMinor;
  const portfolioContracts = db.prepare(
    `SELECT rc.id, rc.status, rc.expected_return_date, rc.total_contract_amount_minor,
              COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                        FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
       FROM rental_contracts rc
       WHERE rc.status != 'CANCELLED'`
  ).all();
  const allAdjRow = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                                WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                                ELSE 0 END), 0) AS adj_net_minor
       FROM customer_financial_adjustments`
  ).get();
  const portfolioContractsBilledMinor = portfolioContracts.reduce(
    (s, c) => s + Number(c.total_contract_amount_minor ?? 0),
    0
  );
  const portfolioBilledMinor = Math.max(0, portfolioContractsBilledMinor + Number(allAdjRow?.adj_net_minor ?? 0));
  const portfolioCollectedNetMinor = portfolioContracts.reduce(
    (s, c) => s + Number(c.paid_net_minor ?? 0),
    0
  );
  const portfolioOutstandingMinor = Math.max(0, portfolioBilledMinor - portfolioCollectedNetMinor);
  const portfolioOverdueMinor = Math.min(
    portfolioOutstandingMinor,
    portfolioContracts.reduce((s, c) => {
      const rem = Math.max(0, Number(c.total_contract_amount_minor ?? 0) - Number(c.paid_net_minor ?? 0));
      if (rem > 0 && (c.status === "COMPLETED" || String(c.expected_return_date) < nowIso)) {
        return s + rem;
      }
      return s;
    }, 0)
  );
  const expByCatRows = db.prepare(
    `SELECT category,
              COALESCE(SUM(CASE WHEN vehicle_id IS NOT NULL THEN amount_minor ELSE 0 END), 0) AS vehicle_minor,
              COALESCE(SUM(CASE WHEN vehicle_id IS NULL THEN amount_minor ELSE 0 END), 0) AS agency_minor,
              COALESCE(SUM(amount_minor), 0) AS total_minor
       FROM expenses
       WHERE status = 'POSTED'
         AND substr(expense_date, 1, 10) >= ?
         AND substr(expense_date, 1, 10) <= ?
       GROUP BY category
       ORDER BY total_minor DESC`
  ).all(dateFrom, dateTo);
  let periodExpensesMinor = 0;
  let vehicleExpensesMinor = 0;
  let agencyExpensesMinor = 0;
  const expensesByCategory = expByCatRows.map((r) => {
    const t = Number(r.total_minor ?? 0);
    const vm = Number(r.vehicle_minor ?? 0);
    const am = Number(r.agency_minor ?? 0);
    periodExpensesMinor += t;
    vehicleExpensesMinor += vm;
    agencyExpensesMinor += am;
    return {
      category: r.category,
      vehicleMinor: vm,
      agencyMinor: am,
      totalMinor: t
    };
  });
  const depLiabilityRow = db.prepare(
    `SELECT COUNT(CASE WHEN (amount_minor - deducted_amount_minor - refunded_amount_minor) > 0 THEN 1 END) AS held_count,
              COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS currently_held_dzd_minor
       FROM deposits
       WHERE currency = 'DZD'`
  ).get();
  const depEurLiabilityRow = db.prepare(
    `SELECT COALESCE(SUM(MAX(0, amount_minor - deducted_amount_minor - refunded_amount_minor)), 0) AS currently_held_eur_minor
       FROM deposits
       WHERE currency = 'EUR'`
  ).get();
  const depMovInRange = db.prepare(
    `SELECT dm.movement_type, COALESCE(SUM(dm.amount_minor), 0) AS total_minor
       FROM deposit_movements dm
       JOIN deposits d ON d.id = dm.deposit_id
       WHERE d.currency = 'DZD'
         AND substr(dm.created_at, 1, 10) >= ?
         AND substr(dm.created_at, 1, 10) <= ?
       GROUP BY dm.movement_type`
  ).all(dateFrom, dateTo);
  let periodDepositsReceivedMinor = 0;
  let periodDepositsDeductedMinor = 0;
  let periodDepositsRefundedMinor = 0;
  for (const m of depMovInRange) {
    const amt = Number(m.total_minor ?? 0);
    if (m.movement_type === "RECEIVED") periodDepositsReceivedMinor += amt;
    if (m.movement_type === "DEDUCTED") periodDepositsDeductedMinor += amt;
    if (m.movement_type === "REFUNDED") periodDepositsRefundedMinor += amt;
  }
  const currentCash = getCurrentCashSession(db);
  const cumulativeCashRow = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS cash_in_payments
       FROM contract_payments
       WHERE method = 'CASH' AND currency = 'DZD'`
  ).get();
  const cumulativeCashExpensesRow = db.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS cash_expenses
       FROM expenses
       WHERE payment_method = 'CASH' AND currency = 'DZD' AND status = 'POSTED'`
  ).get();
  const agencyOperatingCashNetMinor = Number(cumulativeCashRow?.cash_in_payments ?? 0) - Number(cumulativeCashExpensesRow?.cash_expenses ?? 0);
  const dailyMap = /* @__PURE__ */ new Map();
  const ensureDay = (d) => {
    let entry = dailyMap.get(d);
    if (!entry) {
      entry = {
        date: d,
        contractRevenueMinor: 0,
        adjustmentsNetMinor: 0,
        totalRevenueMinor: 0,
        collectedMinor: 0,
        expensesMinor: 0
      };
      dailyMap.set(d, entry);
    }
    return entry;
  };
  db.prepare(
    `SELECT substr(start_date, 1, 10) AS day, COALESCE(SUM(total_contract_amount_minor), 0) AS amt
     FROM rental_contracts
     WHERE status != 'CANCELLED' AND substr(start_date, 1, 10) >= ? AND substr(start_date, 1, 10) <= ?
     GROUP BY day`
  ).all(dateFrom, dateTo).forEach((r) => {
    const e = ensureDay(r.day);
    e.contractRevenueMinor += Number(r.amt);
  });
  db.prepare(
    `SELECT substr(adjustment_date, 1, 10) AS day,
            COALESCE(SUM(CASE WHEN adjustment_type = 'DEBIT_CHARGE' THEN amount_minor
                              WHEN adjustment_type IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -amount_minor
                              ELSE 0 END), 0) AS amt
     FROM customer_financial_adjustments
     WHERE substr(adjustment_date, 1, 10) >= ? AND substr(adjustment_date, 1, 10) <= ?
     GROUP BY day`
  ).all(dateFrom, dateTo).forEach((r) => {
    const e = ensureDay(r.day);
    e.adjustmentsNetMinor += Number(r.amt);
  });
  db.prepare(
    `SELECT substr(payment_date, 1, 10) AS day,
            COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS amt
     FROM contract_payments
     WHERE substr(payment_date, 1, 10) >= ? AND substr(payment_date, 1, 10) <= ?
     GROUP BY day`
  ).all(dateFrom, dateTo).forEach((r) => {
    const e = ensureDay(r.day);
    e.collectedMinor += Number(r.amt);
  });
  db.prepare(
    `SELECT substr(expense_date, 1, 10) AS day, COALESCE(SUM(amount_minor), 0) AS amt
     FROM expenses
     WHERE status = 'POSTED' AND substr(expense_date, 1, 10) >= ? AND substr(expense_date, 1, 10) <= ?
     GROUP BY day`
  ).all(dateFrom, dateTo).forEach((r) => {
    const e = ensureDay(r.day);
    e.expensesMinor += Number(r.amt);
  });
  const dailyRevenue = Array.from(dailyMap.values()).map((d) => ({
    ...d,
    totalRevenueMinor: Math.max(0, d.contractRevenueMinor + d.adjustmentsNetMinor)
  })).sort((a, b) => a.date.localeCompare(b.date));
  const monthlyMap = /* @__PURE__ */ new Map();
  for (const d of dailyRevenue) {
    const m = d.date.slice(0, 7);
    const cur = monthlyMap.get(m) ?? {
      month: m,
      contractRevenueMinor: 0,
      adjustmentsNetMinor: 0,
      totalRevenueMinor: 0,
      collectedMinor: 0,
      expensesMinor: 0
    };
    cur.contractRevenueMinor += d.contractRevenueMinor;
    cur.adjustmentsNetMinor += d.adjustmentsNetMinor;
    cur.totalRevenueMinor += d.totalRevenueMinor;
    cur.collectedMinor += d.collectedMinor;
    cur.expensesMinor += d.expensesMinor;
    monthlyMap.set(m, cur);
  }
  const monthlyRevenue = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  const vehicleProfitability = getVehicleProfitabilityReport(db, { dateFrom, dateTo });
  return {
    dateFrom,
    dateTo,
    currency: "DZD",
    summary: {
      contractCount: Number(periodContractRevRow?.contract_count ?? 0),
      rentalRevenueMinor: periodTotalRevenueMinor,
      collectedNetMinor: periodCollectedNetMinor,
      paymentInflowsMinor: periodPaymentInflowsMinor,
      paymentRefundsMinor: periodPaymentRefundsMinor,
      expensesMinor: periodExpensesMinor,
      vehicleExpensesMinor,
      agencyExpensesMinor,
      netOperatingIncomeMinor: periodTotalRevenueMinor - periodExpensesMinor,
      portfolioBilledMinor,
      portfolioCollectedNetMinor,
      portfolioOutstandingMinor,
      portfolioOverdueMinor,
      depositsCurrentlyHeldDzdMinor: Number(depLiabilityRow?.currently_held_dzd_minor ?? 0),
      depositsCurrentlyHeldEurMinor: Number(depEurLiabilityRow?.currently_held_eur_minor ?? 0),
      depositsHeldCount: Number(depLiabilityRow?.held_count ?? 0),
      periodDepositsReceivedMinor,
      periodDepositsDeductedMinor,
      periodDepositsRefundedMinor,
      totalRefundsMinor: periodPaymentRefundsMinor + periodDepositsRefundedMinor,
      openCashSessionBalanceMinor: currentCash.session ? currentCash.session.expectedClosingMinor : null,
      openCashSessionDate: currentCash.session ? currentCash.session.sessionDate : null,
      lastClosedCashBalanceMinor: currentCash.suggestedOpeningBalanceMinor,
      agencyOperatingCashNetMinor
    },
    collectedByMethod,
    expensesByCategory,
    dailyRevenue,
    monthlyRevenue,
    vehicleProfitability
  };
}
function buildFinancialReportCsv(report, lang = "fr") {
  const lines = [];
  const toDzd = (minor) => (minor / 100).toFixed(2);
  lines.push(
    lang === "ar" ? `\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0645\u0627\u0644\u064A (${report.dateFrom} -> ${report.dateTo})` : `Rapport Financier (${report.dateFrom} -> ${report.dateTo})`
  );
  lines.push("");
  lines.push(lang === "ar" ? "\u0627\u0644\u0645\u0624\u0634\u0631,\u0627\u0644\u0642\u064A\u0645\u0629 (\u062F\u062C)" : "Indicateur,Montant (DZD)");
  const s = report.summary;
  const kpis = lang === "ar" ? [
    ["\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0627\u0644\u0643\u0631\u0627\u0621 (\u062F\u0648\u0646 \u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A)", toDzd(s.rentalRevenueMinor)],
    ["\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u062D\u0635\u0644\u0629 \u0627\u0644\u0635\u0627\u0641\u064A\u0629", toDzd(s.collectedNetMinor)],
    ["\u0627\u0644\u0645\u0633\u062A\u062D\u0642\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0629 (\u0627\u0644\u0645\u062D\u0641\u0638\u0629)", toDzd(s.portfolioOutstandingMinor)],
    ["\u0627\u0644\u062F\u064A\u0648\u0646 \u0627\u0644\u0645\u062A\u0623\u062E\u0631\u0629", toDzd(s.portfolioOverdueMinor)],
    ["\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629", toDzd(s.expensesMinor)],
    ["\u0635\u0627\u0641\u064A \u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u0627\u0633\u062A\u063A\u0644\u0627\u0644", toDzd(s.netOperatingIncomeMinor)],
    ["\u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u062D\u062A\u062C\u0632\u0629 (\u0627\u0644\u062A\u0632\u0627\u0645 \u0645\u0627\u0644\u064A)", toDzd(s.depositsCurrentlyHeldDzdMinor)],
    ["\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u0633\u062A\u0631\u062F\u0629 (\u0643\u0631\u0627\u0621 + \u0643\u0641\u0627\u0644\u0627\u062A)", toDzd(s.totalRefundsMinor)],
    ["\u0648\u0636\u0639\u064A\u0629 \u0627\u0644\u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0645\u0641\u062A\u0648\u062D", s.openCashSessionBalanceMinor != null ? toDzd(s.openCashSessionBalanceMinor) : "\u0645\u063A\u0644\u0642"]
  ] : [
    ["Chiffre d\u2019affaires locatif (hors cautions)", toDzd(s.rentalRevenueMinor)],
    ["Encaissements nets de location", toDzd(s.collectedNetMinor)],
    ["Solde restant \xE0 encaisser (Portefeuille)", toDzd(s.portfolioOutstandingMinor)],
    ["Cr\xE9ances \xE9chues / en retard", toDzd(s.portfolioOverdueMinor)],
    ["D\xE9penses valid\xE9es", toDzd(s.expensesMinor)],
    ["R\xE9sultat net d\u2019exploitation", toDzd(s.netOperatingIncomeMinor)],
    ["Cautions d\xE9tenues (Passif / Dette)", toDzd(s.depositsCurrentlyHeldDzdMinor)],
    ["Remboursements (Location + Cautions)", toDzd(s.totalRefundsMinor)],
    ["Solde caisse ouverte", s.openCashSessionBalanceMinor != null ? toDzd(s.openCashSessionBalanceMinor) : "Ferm\xE9e"]
  ];
  for (const [k, v] of kpis) {
    lines.push(`${escapeCsvCell(k)},${escapeCsvCell(v)}`);
  }
  lines.push("");
  lines.push(
    lang === "ar" ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E,\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0627\u0644\u0643\u0631\u0627\u0621,\u0627\u0644\u0645\u062D\u0635\u0651\u0644 \u0627\u0644\u0635\u0627\u0641\u064A,\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641" : "Date,Revenu locatif (DZD),Encaissement net (DZD),D\xE9penses (DZD)"
  );
  for (const d of report.dailyRevenue) {
    lines.push(
      [
        escapeCsvCell(d.date),
        escapeCsvCell(toDzd(d.totalRevenueMinor)),
        escapeCsvCell(toDzd(d.collectedMinor)),
        escapeCsvCell(toDzd(d.expensesMinor))
      ].join(",")
    );
  }
  lines.push("");
  lines.push(
    lang === "ar" ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629,\u0627\u0644\u062A\u0631\u0642\u064A\u0645,\u0627\u0644\u0639\u0642\u0648\u062F,\u0627\u0644\u0623\u064A\u0627\u0645,\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0627\u0644\u0643\u0631\u0627\u0621,\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641,\u0635\u0627\u0641\u064A \u0627\u0644\u0631\u0628\u062D,\u0627\u0644\u0639\u0627\u0626\u062F %" : "V\xE9hicule,Matricule,Contrats,Jours lou\xE9s,Revenu locatif (DZD),D\xE9penses (DZD),Marge nette (DZD),ROI (%)"
  );
  for (const vp of report.vehicleProfitability) {
    lines.push(
      [
        escapeCsvCell(`${vp.brand} ${vp.model}`),
        escapeCsvCell(vp.matricule),
        escapeCsvCell(vp.contractCount),
        escapeCsvCell(vp.rentedDays),
        escapeCsvCell(toDzd(vp.rentalRevenueMinor)),
        escapeCsvCell(toDzd(vp.expensesMinor)),
        escapeCsvCell(toDzd(vp.netProfitMinor)),
        escapeCsvCell(vp.roiPercent != null ? `${vp.roiPercent}%` : "\u2014")
      ].join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

// electron/database/services/reportService.ts
function defaultRange() {
  const now = /* @__PURE__ */ new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return { dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${d}` };
}
function sanitizeSpreadsheetText(raw) {
  if (raw === null || raw === void 0) return "";
  const str = String(raw).replace(/\r\n/g, " ").replace(/[\r\n]/g, " ");
  if (/^[\t\r ]*[=+\-@]/.test(str) || str.startsWith("	") || str.startsWith("\r")) {
    return `'${str}`;
  }
  return str;
}
function escapeSafeCsvCell(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  const safe = sanitizeSpreadsheetText(raw);
  if (safe.includes(",") || safe.includes('"') || safe.includes(";") || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
function generateReportDataset(db, rawFilter) {
  const defaults = defaultRange();
  const dateFrom = (rawFilter.dateFrom || defaults.dateFrom).slice(0, 10);
  const dateTo = (rawFilter.dateTo || defaults.dateTo).slice(0, 10);
  const lang = rawFilter.language ?? "fr";
  const filter = {
    ...rawFilter,
    dateFrom,
    dateTo,
    language: lang
  };
  const disclosuresFr = [
    "Les cautions (d\xE9p\xF4ts de garantie) sont des dettes fiduciaires et sont STRICTEMENT EXCLUES du chiffre d\u2019affaires locatif.",
    "Le chiffre d\u2019affaires contract\xE9 (valeur totale des contrats), les encaissements effectifs et le reste \xE0 recouvrer sont pr\xE9sent\xE9s s\xE9par\xE9ment.",
    "Les pi\xE8ces de rechange consomm\xE9es en maintenance sont suivies sans double comptabilisation avec les d\xE9penses de maintenance li\xE9es.",
    "La rentabilit\xE9 par v\xE9hicule refl\xE8te les flux op\xE9rationnels de la p\xE9riode (loyers moins charges/maintenance directes) et n\u2019int\xE8gre ni amortissement comptable ni financement."
  ];
  const disclosuresAr = [
    "\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0636\u0645\u0627\u0646 (\u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A) \u062A\u064F\u0639\u062F \u0623\u0645\u0627\u0646\u0629 \u0645\u0633\u062A\u0631\u062F\u0629 \u0648\u0647\u064A \u0645\u0633\u062A\u0628\u0639\u062F\u0629 \u062A\u0645\u0627\u0645\u0627\u064B \u0645\u0646 \u0631\u0642\u0645 \u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0643\u0631\u0627\u0621.",
    "\u064A\u062A\u0645 \u0641\u0635\u0644 \u0631\u0642\u0645 \u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0645\u062A\u0639\u0627\u0642\u062F \u0639\u0644\u064A\u0647 \u0639\u0646 \u0627\u0644\u062A\u062D\u0635\u064A\u0644\u0627\u062A \u0627\u0644\u0646\u0642\u062F\u064A\u0629/\u0627\u0644\u0628\u0646\u0643\u064A\u0629 \u0627\u0644\u0641\u0639\u0644\u064A\u0629 \u0648\u0639\u0646 \u0627\u0644\u0630\u0645\u0645 \u0627\u0644\u0645\u062A\u0628\u0642\u064A\u0629 \u0644\u062F\u0649 \u0627\u0644\u0632\u0628\u0627\u0626\u0646.",
    "\u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631 \u0627\u0644\u0645\u0633\u062A\u0647\u0644\u0643\u0629 \u0641\u064A \u0627\u0644\u0635\u064A\u0627\u0646\u0629 \u0644\u0627 \u064A\u062A\u0645 \u0627\u062D\u062A\u0633\u0627\u0628\u0647\u0627 \u0645\u0631\u062A\u064A\u0646 \u0645\u0639 \u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0635\u064A\u0627\u0646\u0629 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629.",
    "\u0645\u0624\u0634\u0631 \u0645\u0631\u062F\u0648\u062F\u064A\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u064A\u0639\u0643\u0633 \u0627\u0644\u062A\u062F\u0641\u0642\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629 \u0644\u0644\u0641\u062A\u0631\u0629 \u0627\u0644\u0645\u062D\u062F\u062F\u0629 \u0641\u0642\u0637 \u0648\u0644\u0627 \u064A\u0634\u0645\u0644 \u0627\u0644\u0627\u0633\u062A\u0647\u0644\u0627\u0643 \u0627\u0644\u0645\u062D\u0627\u0633\u0628\u064A \u0623\u0648 \u062A\u0643\u0627\u0644\u064A\u0641 \u0627\u0644\u062A\u0645\u0648\u064A\u0644."
  ];
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const kpis = [];
  const sections = [];
  const wantSection = (key) => {
    if (filter.category !== "CUSTOM") return true;
    const picked = filter.includeSections ?? [];
    return picked.length === 0 || picked.includes(key);
  };
  const contractClauses = [
    "rc.status != 'CANCELLED'",
    "substr(rc.start_date, 1, 10) >= ?",
    "substr(rc.start_date, 1, 10) <= ?"
  ];
  const contractArgs = [dateFrom, dateTo];
  if (filter.customerId) {
    contractClauses.push("rc.customer_id = ?");
    contractArgs.push(filter.customerId);
  }
  if (filter.vehicleId) {
    contractClauses.push("rc.vehicle_id = ?");
    contractArgs.push(filter.vehicleId);
  }
  if (filter.userId) {
    contractClauses.push("rc.created_by_user_id = ?");
    contractArgs.push(filter.userId);
  }
  if (filter.status) {
    contractClauses.push("rc.status = ?");
    contractArgs.push(filter.status);
  }
  if (filter.category === "FINANCIAL" || filter.category === "CUSTOM") {
    const dash = getFinancialDashboardReports(db, { dateFrom, dateTo });
    const payClauses = [
      "substr(cp.payment_date, 1, 10) >= ?",
      "substr(cp.payment_date, 1, 10) <= ?"
    ];
    const payArgs = [dateFrom, dateTo];
    if (filter.customerId) {
      payClauses.push("rc.customer_id = ?");
      payArgs.push(filter.customerId);
    }
    if (filter.vehicleId) {
      payClauses.push("rc.vehicle_id = ?");
      payArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      payClauses.push("cp.recorded_by_user_id = ?");
      payArgs.push(filter.userId);
    }
    if (filter.transactionType && ["INFLOW", "REFUND"].includes(filter.transactionType)) {
      payClauses.push("cp.direction = ?");
      payArgs.push(filter.transactionType);
    }
    const paymentRows = db.prepare(
      `SELECT cp.*, rc.contract_number, c.full_name AS customer_name,
                v.matricule, u.username AS recorded_by_username
         FROM contract_payments cp
         JOIN rental_contracts rc ON rc.id = cp.contract_id
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = rc.vehicle_id
         LEFT JOIN users u ON u.id = cp.recorded_by_user_id
         WHERE ${payClauses.join(" AND ")}
         ORDER BY cp.payment_date DESC, cp.id DESC`
    ).all(...payArgs);
    let totalInflowMinor = 0;
    let totalRefundMinor = 0;
    const byMethod = /* @__PURE__ */ new Map();
    for (const p of paymentRows) {
      const amt = Number(p.amount_minor ?? 0);
      const cur = byMethod.get(p.method) ?? { method: p.method, inflows: 0, refunds: 0, count: 0 };
      cur.count += 1;
      if (p.direction === "INFLOW") {
        totalInflowMinor += amt;
        cur.inflows += amt;
      } else {
        totalRefundMinor += amt;
        cur.refunds += amt;
      }
      byMethod.set(p.method, cur);
    }
    const netCollectedMinor = totalInflowMinor - totalRefundMinor;
    const expClauses = [
      "e.status = 'POSTED'",
      "substr(e.expense_date, 1, 10) >= ?",
      "substr(e.expense_date, 1, 10) <= ?"
    ];
    const expArgs = [dateFrom, dateTo];
    if (filter.vehicleId) {
      expClauses.push("e.vehicle_id = ?");
      expArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      expClauses.push("e.recorded_by_user_id = ?");
      expArgs.push(filter.userId);
    }
    if (filter.expenseCategory) {
      expClauses.push("e.category = ?");
      expArgs.push(filter.expenseCategory);
    }
    const expenseRows = db.prepare(
      `SELECT e.*, v.matricule, s.name AS supplier_name, u.username AS recorded_by_username
         FROM expenses e
         LEFT JOIN vehicles v ON v.id = e.vehicle_id
         LEFT JOIN suppliers s ON s.id = e.supplier_id
         LEFT JOIN users u ON u.id = e.recorded_by_user_id
         WHERE ${expClauses.join(" AND ")}
         ORDER BY e.expense_date DESC, e.id DESC`
    ).all(...expArgs);
    const totalExpensesMinor = expenseRows.reduce((s, r) => s + Number(r.amount_minor ?? 0), 0);
    const contractedRow = db.prepare(
      `SELECT COALESCE(SUM(rc.total_contract_amount_minor), 0) AS total_minor, COUNT(*) AS cnt
         FROM rental_contracts rc
         WHERE ${contractClauses.join(" AND ")}`
    ).get(...contractArgs);
    const contractedMinor = Number(contractedRow?.total_minor ?? 0);
    if (filter.category === "FINANCIAL") {
      kpis.push(
        {
          key: "contracted_revenue",
          labelFr: "Revenus locatifs contract\xE9s",
          labelAr: "\u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u062A\u0639\u0627\u0642\u062F \u0639\u0644\u064A\u0647\u0627",
          valueDisplay: formatMoneyForDoc(contractedMinor, "DZD", lang),
          numericValue: contractedMinor / 100,
          unit: "DZD",
          tone: "neutral",
          noteFr: `${Number(contractedRow?.cnt ?? 0)} contrat(s) hors annul\xE9s (hors cautions)`,
          noteAr: `${Number(contractedRow?.cnt ?? 0)} \u0639\u0642\u062F (\u0628\u0627\u0633\u062A\u062B\u0646\u0627\u0621 \u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A)`
        },
        {
          key: "net_collected",
          labelFr: "Encaissements nets per\xE7us",
          labelAr: "\u0627\u0644\u062A\u062D\u0635\u064A\u0644\u0627\u062A \u0627\u0644\u0635\u0627\u0641\u064A\u0629 \u0627\u0644\u0645\u0633\u062A\u0644\u0645\u0629",
          valueDisplay: formatMoneyForDoc(netCollectedMinor, "DZD", lang),
          numericValue: netCollectedMinor / 100,
          unit: "DZD",
          tone: "positive"
        },
        {
          key: "total_expenses",
          labelFr: "D\xE9penses comptabilis\xE9es",
          labelAr: "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0645\u0633\u062C\u0644\u0629",
          valueDisplay: formatMoneyForDoc(totalExpensesMinor, "DZD", lang),
          numericValue: totalExpensesMinor / 100,
          unit: "DZD",
          tone: "warning"
        },
        {
          key: "net_cash_flow",
          labelFr: "Flux net (Encaiss\xE9 - D\xE9penses)",
          labelAr: "\u0627\u0644\u062A\u062F\u0641\u0642 \u0627\u0644\u0635\u0627\u0641\u064A (\u0627\u0644\u0645\u062D\u0635\u0644 - \u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641)",
          valueDisplay: formatMoneyForDoc(netCollectedMinor - totalExpensesMinor, "DZD", lang),
          numericValue: (netCollectedMinor - totalExpensesMinor) / 100,
          unit: "DZD",
          tone: netCollectedMinor - totalExpensesMinor >= 0 ? "positive" : "danger"
        },
        {
          key: "receivables_total",
          labelFr: "Cr\xE9ances clients impay\xE9es",
          labelAr: "\u0645\u0633\u062A\u062D\u0642\u0627\u062A \u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u063A\u064A\u0631 \u0627\u0644\u0645\u0633\u062F\u062F\u0629",
          valueDisplay: formatMoneyForDoc(dash.summary.portfolioOutstandingMinor, "DZD", lang),
          numericValue: dash.summary.portfolioOutstandingMinor / 100,
          unit: "DZD",
          tone: dash.summary.portfolioOutstandingMinor > 0 ? "danger" : "neutral"
        },
        {
          key: "deposits_held",
          labelFr: "Cautions actuellement d\xE9tenues (Hors CA)",
          labelAr: "\u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u062D\u062A\u062C\u0632\u0629 \u062D\u0627\u0644\u064A\u0627\u064B (\u062E\u0627\u0631\u062C \u0631\u0642\u0645 \u0627\u0644\u0623\u0639\u0645\u0627\u0644)",
          valueDisplay: formatMoneyForDoc(dash.summary.depositsCurrentlyHeldDzdMinor, "DZD", lang),
          numericValue: dash.summary.depositsCurrentlyHeldDzdMinor / 100,
          unit: "DZD",
          tone: "neutral"
        }
      );
    }
    if (wantSection("revenue_payments")) {
      sections.push({
        id: "payments_by_method",
        titleFr: "Encaissements & remboursements par moyen de paiement",
        titleAr: "\u0627\u0644\u062A\u062D\u0635\u064A\u0644\u0627\u062A \u0648\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u0633\u062A\u0631\u062C\u0639\u0629 \u062D\u0633\u0628 \u0648\u0633\u064A\u0644\u0629 \u0627\u0644\u062F\u0641\u0639",
        columns: [
          { key: "method", labelFr: "Moyen", labelAr: "\u0627\u0644\u0648\u0633\u064A\u0644\u0629", type: "text" },
          { key: "count", labelFr: "Op\xE9rations", labelAr: "\u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A", type: "number" },
          { key: "inflowsMinor", labelFr: "Encaiss\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u062D\u0635\u0644 (\u062F\u062C)", type: "currency_minor" },
          { key: "refundsMinor", labelFr: "Rembours\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u0633\u062A\u0631\u062C\u0639 (\u062F\u062C)", type: "currency_minor" },
          { key: "netMinor", labelFr: "Net (DZD)", labelAr: "\u0627\u0644\u0635\u0627\u0641\u064A (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: Array.from(byMethod.values()).map((m) => ({
          method: m.method,
          count: m.count,
          inflowsMinor: m.inflows,
          refundsMinor: m.refunds,
          netMinor: m.inflows - m.refunds
        })),
        totalsRow: {
          method: lang === "ar" ? "\u0627\u0644\u0645\u062C\u0645\u0648\u0639" : "Total",
          count: paymentRows.length,
          inflowsMinor: totalInflowMinor,
          refundsMinor: totalRefundMinor,
          netMinor: netCollectedMinor
        }
      });
      sections.push({
        id: "revenue_payments",
        titleFr: "Journal d\xE9taill\xE9 des paiements",
        titleAr: "\u0633\u062C\u0644 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0627\u062A \u0627\u0644\u062A\u0641\u0635\u064A\u0644\u064A",
        columns: [
          { key: "receiptNumber", labelFr: "Re\xE7u", labelAr: "\u0627\u0644\u0648\u0635\u0644", type: "text" },
          { key: "paymentDate", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" },
          { key: "contractNumber", labelFr: "Contrat", labelAr: "\u0627\u0644\u0639\u0642\u062F", type: "text" },
          { key: "customerName", labelFr: "Client", labelAr: "\u0627\u0644\u0632\u0628\u0648\u0646", type: "text" },
          { key: "direction", labelFr: "Sens", labelAr: "\u0627\u0644\u0646\u0648\u0639", type: "text" },
          { key: "method", labelFr: "Moyen", labelAr: "\u0627\u0644\u0648\u0633\u064A\u0644\u0629", type: "text" },
          { key: "amountMinor", labelFr: "Montant (DZD)", labelAr: "\u0627\u0644\u0645\u0628\u0644\u063A (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: paymentRows.map((p) => ({
          receiptNumber: p.receipt_number,
          paymentDate: p.payment_date.slice(0, 10),
          contractNumber: p.contract_number,
          customerName: p.customer_name,
          direction: p.direction,
          method: p.method,
          amountMinor: Number(p.amount_minor ?? 0)
        }))
      });
    }
    if (wantSection("expenses")) {
      sections.push({
        id: "expenses",
        titleFr: "D\xE9penses par poste et v\xE9hicule",
        titleAr: "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u062D\u0633\u0628 \u0627\u0644\u0641\u0626\u0629 \u0648\u0627\u0644\u0645\u0631\u0643\u0628\u0629",
        columns: [
          { key: "expenseNumber", labelFr: "R\xE9f.", labelAr: "\u0627\u0644\u0645\u0631\u062C\u0639", type: "text" },
          { key: "expenseDate", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" },
          { key: "category", labelFr: "Cat\xE9gorie", labelAr: "\u0627\u0644\u0641\u0626\u0629", type: "text" },
          { key: "vehicleMatricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "supplierName", labelFr: "Fournisseur", labelAr: "\u0627\u0644\u0645\u0648\u0631\u062F", type: "text" },
          { key: "paymentMethod", labelFr: "Paiement", labelAr: "\u0627\u0644\u062F\u0641\u0639", type: "text" },
          { key: "description", labelFr: "Libell\xE9", labelAr: "\u0627\u0644\u0628\u064A\u0627\u0646", type: "text" },
          { key: "amountMinor", labelFr: "Montant (DZD)", labelAr: "\u0627\u0644\u0645\u0628\u0644\u063A (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: expenseRows.map((e) => ({
          expenseNumber: e.expense_number,
          expenseDate: e.expense_date.slice(0, 10),
          category: e.category,
          vehicleMatricule: e.matricule ?? (lang === "ar" ? "\u0639\u0627\u0645" : "Agence"),
          supplierName: e.supplier_name ?? "\u2014",
          paymentMethod: e.payment_method,
          description: e.description,
          amountMinor: Number(e.amount_minor ?? 0)
        })),
        totalsRow: {
          expenseNumber: lang === "ar" ? "\u0627\u0644\u0645\u062C\u0645\u0648\u0639" : "Total",
          amountMinor: totalExpensesMinor
        }
      });
    }
    if (wantSection("deposits")) {
      const depClauses = ["1=1"];
      const depArgs = [];
      if (filter.customerId) {
        depClauses.push("rc.customer_id = ?");
        depArgs.push(filter.customerId);
      }
      if (filter.vehicleId) {
        depClauses.push("rc.vehicle_id = ?");
        depArgs.push(filter.vehicleId);
      }
      if (filter.status && ["HELD", "PARTIALLY_DEDUCTED", "FULLY_DEDUCTED", "RETURNED"].includes(filter.status)) {
        depClauses.push("d.status = ?");
        depArgs.push(filter.status);
      }
      const deposits = db.prepare(
        `SELECT d.*, rc.contract_number, c.full_name AS customer_name, v.matricule
           FROM deposits d
           JOIN rental_contracts rc ON rc.id = d.contract_id
           JOIN customers c ON c.id = rc.customer_id
           JOIN vehicles v ON v.id = rc.vehicle_id
           WHERE ${depClauses.join(" AND ")}
           ORDER BY d.id DESC`
      ).all(...depArgs);
      sections.push({
        id: "deposits",
        titleFr: "Suivi des cautions (Hors chiffre d\u2019affaires)",
        titleAr: "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A (\u062E\u0627\u0631\u062C \u0631\u0642\u0645 \u0627\u0644\u0623\u0639\u0645\u0627\u0644)",
        columns: [
          { key: "contractNumber", labelFr: "Contrat", labelAr: "\u0627\u0644\u0639\u0642\u062F", type: "text" },
          { key: "customerName", labelFr: "Client", labelAr: "\u0627\u0644\u0632\u0628\u0648\u0646", type: "text" },
          { key: "vehicleMatricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "amountMinor", labelFr: "Initial (DZD)", labelAr: "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0623\u0648\u0644\u064A (\u062F\u062C)", type: "currency_minor" },
          { key: "deductedAmountMinor", labelFr: "Retenu (DZD)", labelAr: "\u0627\u0644\u0645\u0642\u062A\u0637\u0639 (\u062F\u062C)", type: "currency_minor" },
          { key: "refundedAmountMinor", labelFr: "Restitu\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u0633\u062A\u0631\u062C\u0639 (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: deposits.map((d) => ({
          contractNumber: d.contract_number,
          customerName: d.customer_name,
          vehicleMatricule: d.matricule,
          status: d.status,
          amountMinor: Number(d.amount_minor ?? 0),
          deductedAmountMinor: Number(d.deducted_amount_minor ?? 0),
          refundedAmountMinor: Number(d.refunded_amount_minor ?? 0)
        }))
      });
    }
    if (wantSection("customer_balances")) {
      let accounts = listCustomerFinancialAccounts(db);
      if (filter.customerId) {
        accounts = accounts.filter((a) => a.customerId === filter.customerId);
      }
      sections.push({
        id: "customer_balances",
        titleFr: "Soldes financiers clients & cr\xE9ances \xE9chues",
        titleAr: "\u0623\u0631\u0635\u062F\u0629 \u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u0648\u0627\u0644\u0630\u0645\u0645 \u0627\u0644\u0645\u062A\u0623\u062E\u0631\u0629",
        columns: [
          { key: "fullName", labelFr: "Client", labelAr: "\u0627\u0644\u0632\u0628\u0648\u0646", type: "text" },
          { key: "phone", labelFr: "T\xE9l\xE9phone", labelAr: "\u0627\u0644\u0647\u0627\u062A\u0641", type: "text" },
          { key: "totalContractedMinor", labelFr: "Factur\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u0633\u062A\u062D\u0642 (\u062F\u062C)", type: "currency_minor" },
          { key: "netPaidMinor", labelFr: "Pay\xE9 net (DZD)", labelAr: "\u0627\u0644\u0645\u062F\u0641\u0648\u0639 \u0627\u0644\u0635\u0627\u0641\u064A (\u062F\u062C)", type: "currency_minor" },
          { key: "outstandingBalanceMinor", labelFr: "Solde d\xFB (DZD)", labelAr: "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0628\u0642\u064A (\u062F\u062C)", type: "currency_minor" },
          { key: "overdueBalanceMinor", labelFr: "Dont \xE9chu (DZD)", labelAr: "\u0645\u0646\u0647\u0627 \u0627\u0644\u0645\u062A\u0623\u062E\u0631 (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: accounts.map((a) => ({
          fullName: a.fullName,
          phone: a.phone,
          totalContractedMinor: a.totalChargedMinor,
          netPaidMinor: a.netPaidMinor,
          outstandingBalanceMinor: a.outstandingBalanceMinor,
          overdueBalanceMinor: a.overdueDebtMinor
        }))
      });
    }
    if (wantSection("cash_sessions")) {
      const cashSessions = db.prepare(
        `SELECT cs.*, uo.username AS opened_by_username, uc.username AS closed_by_username
           FROM cash_register_sessions cs
           LEFT JOIN users uo ON uo.id = cs.opened_by_user_id
           LEFT JOIN users uc ON uc.id = cs.closed_by_user_id
           WHERE substr(cs.session_date, 1, 10) >= ? AND substr(cs.session_date, 1, 10) <= ?
           ORDER BY cs.session_date DESC, cs.id DESC`
      ).all(dateFrom, dateTo);
      sections.push({
        id: "cash_sessions",
        titleFr: "Sessions de caisse & rapprochements",
        titleAr: "\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0635\u0646\u062F\u0648\u0642 \u0648\u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629",
        columns: [
          { key: "sessionDate", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "openingBalanceMinor", labelFr: "Ouverture", labelAr: "\u0627\u0644\u0627\u0641\u062A\u062A\u0627\u062D", type: "currency_minor" },
          { key: "cashReceivedMinor", labelFr: "Recettes", labelAr: "\u0627\u0644\u0645\u062F\u0627\u062E\u064A\u0644", type: "currency_minor" },
          { key: "cashExpensesMinor", labelFr: "D\xE9penses", labelAr: "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641", type: "currency_minor" },
          { key: "expectedClosingMinor", labelFr: "Attendu", labelAr: "\u0627\u0644\u0645\u062A\u0648\u0642\u0639", type: "currency_minor" },
          { key: "actualClosingMinor", labelFr: "R\xE9el", labelAr: "\u0627\u0644\u0641\u0639\u0644\u064A", type: "currency_minor" },
          { key: "discrepancyMinor", labelFr: "\xC9cart", labelAr: "\u0627\u0644\u0641\u0627\u0631\u0642", type: "currency_minor" }
        ],
        rows: cashSessions.map((cs) => ({
          sessionDate: cs.session_date,
          status: cs.status,
          openingBalanceMinor: Number(cs.opening_balance_minor ?? 0),
          cashReceivedMinor: Number(cs.cash_received_minor ?? 0),
          cashExpensesMinor: Number(cs.cash_expenses_minor ?? 0),
          expectedClosingMinor: Number(cs.expected_closing_minor ?? 0),
          actualClosingMinor: cs.actual_closing_minor != null ? Number(cs.actual_closing_minor) : null,
          discrepancyMinor: cs.discrepancy_minor != null ? Number(cs.discrepancy_minor) : null
        }))
      });
    }
  }
  if (filter.category === "FLEET" || filter.category === "CUSTOM") {
    let profitability = getVehicleProfitabilityReport(db, { dateFrom, dateTo, includeArchived: false });
    if (filter.vehicleId) {
      profitability = profitability.filter((p) => p.vehicleId === filter.vehicleId);
    }
    const totalFleetCount = db.prepare("SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0").get()?.c ?? 0;
    const rentedCount = db.prepare("SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0 AND status = 'RENTED'").get()?.c ?? 0;
    const maintCount = db.prepare("SELECT COUNT(*) AS c FROM vehicles WHERE is_archived = 0 AND status = 'MAINTENANCE'").get()?.c ?? 0;
    const maintClauses = [
      "substr(mr.performed_date, 1, 10) >= ?",
      "substr(mr.performed_date, 1, 10) <= ?",
      "mr.status != 'CANCELLED'"
    ];
    const maintArgs = [dateFrom, dateTo];
    if (filter.vehicleId) {
      maintClauses.push("mr.vehicle_id = ?");
      maintArgs.push(filter.vehicleId);
    }
    const maintRows = db.prepare(
      `SELECT mr.*, v.matricule, v.brand, v.model, mt.name_fr AS type_name_fr, mt.name_ar AS type_name_ar
         FROM maintenance_records mr
         JOIN vehicles v ON v.id = mr.vehicle_id
         JOIN maintenance_types mt ON mt.id = mr.maintenance_type_id
         WHERE ${maintClauses.join(" AND ")}
         ORDER BY mr.performed_date DESC, mr.id DESC`
    ).all(...maintArgs);
    const totalMaintCostMinor = maintRows.reduce((s, r) => s + Number(r.total_cost_minor ?? 0), 0);
    const invParts = db.prepare("SELECT * FROM inventory_parts WHERE COALESCE(is_archived, 0) = 0 ORDER BY part_name ASC").all();
    const totalStockValueMinor = invParts.reduce(
      (s, p) => s + Number(p.quantity_available ?? 0) * Number(p.unit_purchase_price_minor ?? 0),
      0
    );
    const lowStockCount = invParts.filter((p) => Number(p.quantity_available) <= Number(p.minimum_stock)).length;
    if (filter.category === "FLEET") {
      kpis.push(
        {
          key: "fleet_active",
          labelFr: "V\xE9hicules actifs / En location",
          labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0627\u062A \u0627\u0644\u0646\u0634\u0637\u0629 / \u0627\u0644\u0645\u0624\u062C\u0631\u0629",
          valueDisplay: `${totalFleetCount} (${rentedCount})`,
          numericValue: totalFleetCount,
          tone: "neutral"
        },
        {
          key: "fleet_maintenance",
          labelFr: "V\xE9hicules en maintenance",
          labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0627\u062A \u0641\u064A \u0627\u0644\u0635\u064A\u0627\u0646\u0629",
          valueDisplay: String(maintCount),
          numericValue: maintCount,
          tone: maintCount > 0 ? "warning" : "positive"
        },
        {
          key: "maint_period_cost",
          labelFr: "Co\xFBt interventions maintenance (p\xE9riode)",
          labelAr: "\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0635\u064A\u0627\u0646\u0629 (\u0627\u0644\u0641\u062A\u0631\u0629)",
          valueDisplay: formatMoneyForDoc(totalMaintCostMinor, "DZD", lang),
          numericValue: totalMaintCostMinor / 100,
          unit: "DZD",
          tone: "warning"
        },
        {
          key: "inventory_value",
          labelFr: "Valeur stock pi\xE8ces d\xE9tach\xE9es",
          labelAr: "\u0642\u064A\u0645\u0629 \u0645\u062E\u0632\u0648\u0646 \u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631",
          valueDisplay: formatMoneyForDoc(totalStockValueMinor, "DZD", lang),
          numericValue: totalStockValueMinor / 100,
          unit: "DZD",
          tone: lowStockCount > 0 ? "warning" : "neutral",
          noteFr: `${lowStockCount} r\xE9f\xE9rence(s) sous seuil`,
          noteAr: `${lowStockCount} \u0635\u0646\u0641 \u062A\u062D\u062A \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649`
        }
      );
    }
    if (wantSection("fleet_utilization")) {
      sections.push({
        id: "fleet_utilization",
        titleFr: "Utilisation & performance op\xE9rationnelle par v\xE9hicule",
        titleAr: "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0631\u0643\u0628\u0627\u062A \u0648\u0627\u0644\u0623\u062F\u0627\u0621 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A",
        columns: [
          { key: "matricule", labelFr: "Matricule", labelAr: "\u0627\u0644\u062A\u0631\u0642\u064A\u0645", type: "text" },
          { key: "vehicle", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "contractCount", labelFr: "Contrats", labelAr: "\u0627\u0644\u0639\u0642\u0648\u062F", type: "number" },
          { key: "rentedDays", labelFr: "Jours lou\xE9s", labelAr: "\u0623\u064A\u0627\u0645 \u0627\u0644\u0643\u0631\u0627\u0621", type: "number" },
          { key: "rentalRevenueMinor", labelFr: "Contract\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u062A\u0639\u0627\u0642\u062F (\u062F\u062C)", type: "currency_minor" },
          { key: "collectedMinor", labelFr: "Encaiss\xE9 (DZD)", labelAr: "\u0627\u0644\u0645\u062D\u0635\u0644 (\u062F\u062C)", type: "currency_minor" },
          { key: "expensesMinor", labelFr: "D\xE9penses directes", labelAr: "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629", type: "currency_minor" },
          { key: "netProfitMinor", labelFr: "Marge op\xE9r.", labelAr: "\u0627\u0644\u0647\u0627\u0645\u0634 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A", type: "currency_minor" }
        ],
        rows: profitability.map((p) => ({
          matricule: p.matricule,
          vehicle: `${p.brand} ${p.model}`,
          contractCount: p.contractCount,
          rentedDays: p.rentedDays,
          rentalRevenueMinor: p.rentalRevenueMinor,
          collectedMinor: p.collectedMinor,
          expensesMinor: p.expensesMinor,
          netProfitMinor: p.netProfitMinor
        }))
      });
    }
    if (wantSection("maintenance")) {
      sections.push({
        id: "maintenance",
        titleFr: "Historique et co\xFBts de maintenance",
        titleAr: "\u0633\u062C\u0644 \u0648\u062A\u0643\u0627\u0644\u064A\u0641 \u0627\u0644\u0635\u064A\u0627\u0646\u0629",
        columns: [
          { key: "recordNumber", labelFr: "N\xB0", labelAr: "\u0627\u0644\u0631\u0642\u0645", type: "text" },
          { key: "performedDate", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" },
          { key: "matricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "type", labelFr: "Type", labelAr: "\u0627\u0644\u0646\u0648\u0639", type: "text" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "odometerKm", labelFr: "Kilom\xE9trage", labelAr: "\u0627\u0644\u0639\u062F\u0627\u062F", type: "number" },
          { key: "laborCostMinor", labelFr: "Main d\u2019\u0153uvre", labelAr: "\u0627\u0644\u064A\u062F \u0627\u0644\u0639\u0627\u0645\u0644\u0629", type: "currency_minor" },
          { key: "partsCostMinor", labelFr: "Pi\xE8ces", labelAr: "\u0627\u0644\u0642\u0637\u0639", type: "currency_minor" },
          { key: "totalCostMinor", labelFr: "Total (DZD)", labelAr: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: maintRows.map((m) => ({
          recordNumber: m.record_number || `MNT-${m.id}`,
          performedDate: String(m.performed_date).slice(0, 10),
          matricule: m.matricule,
          type: lang === "ar" ? m.type_name_ar : m.type_name_fr,
          status: m.status,
          odometerKm: Number(m.odometer_km ?? 0),
          laborCostMinor: Number(m.labor_cost_minor ?? 0),
          partsCostMinor: Number(m.parts_cost_minor ?? 0),
          totalCostMinor: Number(m.total_cost_minor ?? 0)
        }))
      });
      const vehiclesForDue = db.prepare(
        `SELECT id, brand, model, matricule, current_odometer_km FROM vehicles WHERE is_archived = 0 ${filter.vehicleId ? "AND id = ?" : ""}`
      ).all(...filter.vehicleId ? [filter.vehicleId] : []);
      const dueAlerts = [];
      for (const v of vehiclesForDue) {
        const items = getVehicleMaintenanceDueSummary(db, v.id, today);
        for (const it of items) {
          if (it.alertState !== "OK") {
            dueAlerts.push({
              matricule: v.matricule,
              item: lang === "ar" ? it.nameAr : it.nameFr,
              alertState: it.alertState,
              remainingKm: it.remainingKm,
              remainingDays: it.remainingDays,
              nextDueDate: it.nextDueDate
            });
          }
        }
      }
      sections.push({
        id: "maintenance_due",
        titleFr: "\xC9ch\xE9ances de maintenance pr\xE9ventive & alertes",
        titleAr: "\u0627\u0633\u062A\u062D\u0642\u0627\u0642\u0627\u062A \u0627\u0644\u0635\u064A\u0627\u0646\u0629 \u0627\u0644\u0648\u0642\u0627\u0626\u064A\u0629 \u0648\u0627\u0644\u062A\u0646\u0628\u064A\u0647\u0627\u062A",
        columns: [
          { key: "matricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "item", labelFr: "Op\xE9ration", labelAr: "\u0627\u0644\u0639\u0645\u0644\u064A\u0629", type: "text" },
          { key: "alertState", labelFr: "\xC9tat", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "remainingKm", labelFr: "Km restants", labelAr: "\u0643\u0645 \u0645\u062A\u0628\u0642\u064A", type: "number" },
          { key: "remainingDays", labelFr: "Jours restants", labelAr: "\u0623\u064A\u0627\u0645 \u0645\u062A\u0628\u0642\u064A\u0629", type: "number" },
          { key: "nextDueDate", labelFr: "\xC9ch\xE9ance", labelAr: "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0627\u0633\u062A\u062D\u0642\u0627\u0642", type: "date" }
        ],
        rows: dueAlerts
      });
    }
    if (wantSection("inventory")) {
      sections.push({
        id: "inventory",
        titleFr: "\xC9tat du stock de pi\xE8ces d\xE9tach\xE9es",
        titleAr: "\u0648\u0636\u0639\u064A\u0629 \u0645\u062E\u0632\u0648\u0646 \u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631",
        columns: [
          { key: "partCode", labelFr: "R\xE9f.", labelAr: "\u0627\u0644\u0631\u0645\u0632", type: "text" },
          { key: "partName", labelFr: "D\xE9signation", labelAr: "\u0627\u0644\u062A\u0633\u0645\u064A\u0629", type: "text" },
          { key: "category", labelFr: "Cat\xE9gorie", labelAr: "\u0627\u0644\u0641\u0626\u0629", type: "text" },
          { key: "quantityAvailable", labelFr: "Stock", labelAr: "\u0627\u0644\u0645\u062A\u0648\u0641\u0631", type: "number" },
          { key: "minimumStock", labelFr: "Seuil min.", labelAr: "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649", type: "number" },
          { key: "unitPurchasePriceMinor", labelFr: "Prix unit.", labelAr: "\u0633\u0639\u0631 \u0627\u0644\u0648\u062D\u062F\u0629", type: "currency_minor" },
          { key: "stockValueMinor", labelFr: "Valeur (DZD)", labelAr: "\u0627\u0644\u0642\u064A\u0645\u0629 (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: invParts.map((p) => ({
          partCode: p.part_code,
          partName: p.part_name,
          category: p.category,
          quantityAvailable: Number(p.quantity_available ?? 0),
          minimumStock: Number(p.minimum_stock ?? 0),
          unitPurchasePriceMinor: Number(p.unit_purchase_price_minor ?? 0),
          stockValueMinor: Number(p.quantity_available ?? 0) * Number(p.unit_purchase_price_minor ?? 0)
        }))
      });
    }
  }
  if (filter.category === "OPERATIONAL" || filter.category === "CUSTOM") {
    const contracts = db.prepare(
      `SELECT rc.*, c.full_name AS customer_name, v.matricule, v.brand, v.model
         FROM rental_contracts rc
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = rc.vehicle_id
         WHERE ${contractClauses.join(" AND ")}
         ORDER BY rc.start_date DESC, rc.id DESC`
    ).all(...contractArgs);
    const inspClauses = [
      "substr(vi.inspected_at, 1, 10) >= ?",
      "substr(vi.inspected_at, 1, 10) <= ?"
    ];
    const inspArgs = [dateFrom, dateTo];
    if (filter.vehicleId) {
      inspClauses.push("vi.vehicle_id = ?");
      inspArgs.push(filter.vehicleId);
    }
    if (filter.customerId) {
      inspClauses.push("rc.customer_id = ?");
      inspArgs.push(filter.customerId);
    }
    const inspections = db.prepare(
      `SELECT vi.*, rc.contract_number, c.full_name AS customer_name, v.matricule
         FROM vehicle_inspections vi
         JOIN rental_contracts rc ON rc.id = vi.contract_id
         JOIN customers c ON c.id = rc.customer_id
         JOIN vehicles v ON v.id = vi.vehicle_id
         WHERE ${inspClauses.join(" AND ")}
         ORDER BY vi.inspected_at DESC, vi.id DESC`
    ).all(...inspArgs);
    const dmgClauses = ["1=1"];
    const dmgArgs = [];
    if (filter.vehicleId) {
      dmgClauses.push("vd.vehicle_id = ?");
      dmgArgs.push(filter.vehicleId);
    }
    const damages = db.prepare(
      `SELECT vd.*, v.matricule, rc.contract_number
         FROM vehicle_damages vd
         JOIN vehicles v ON v.id = vd.vehicle_id
         LEFT JOIN rental_contracts rc ON rc.id = vd.contract_id
         WHERE ${dmgClauses.join(" AND ")}
         ORDER BY vd.reported_at DESC, vd.id DESC`
    ).all(...dmgArgs);
    const overdueContracts = contracts.filter(
      (c) => ["ACTIVE", "EXTENDED"].includes(c.status) && String(c.expected_return_date).slice(0, 10) < today
    );
    const expiringCustomerDocs = db.prepare(
      `SELECT cd.*, c.full_name, c.phone
         FROM customer_documents cd
         JOIN customers c ON c.id = cd.customer_id
         WHERE c.is_archived = 0
           AND COALESCE(cd.is_archived, 0) = 0
           AND cd.expiration_date IS NOT NULL
         ORDER BY cd.expiration_date ASC`
    ).all();
    const blacklistedCount = db.prepare("SELECT COUNT(*) AS c FROM customers WHERE is_archived = 0 AND risk_status = 'BLACKLISTED'").get()?.c ?? 0;
    if (filter.category === "OPERATIONAL") {
      kpis.push(
        {
          key: "contracts_period",
          labelFr: "Contrats sur la p\xE9riode",
          labelAr: "\u0627\u0644\u0639\u0642\u0648\u062F \u062E\u0644\u0627\u0644 \u0627\u0644\u0641\u062A\u0631\u0629",
          valueDisplay: String(contracts.length),
          numericValue: contracts.length,
          tone: "neutral"
        },
        {
          key: "overdue_returns",
          labelFr: "Retours en retard (actifs)",
          labelAr: "\u0627\u0644\u0625\u0631\u062C\u0627\u0639\u0627\u062A \u0627\u0644\u0645\u062A\u0623\u062E\u0631\u0629",
          valueDisplay: String(overdueContracts.length),
          numericValue: overdueContracts.length,
          tone: overdueContracts.length > 0 ? "danger" : "positive"
        },
        {
          key: "inspections_period",
          labelFr: "\xC9tats des lieux effectu\xE9s",
          labelAr: "\u0645\u0639\u0627\u064A\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0643\u0628\u0627\u062A \u0627\u0644\u0645\u0646\u062C\u0632\u0629",
          valueDisplay: String(inspections.length),
          numericValue: inspections.length,
          tone: "neutral"
        },
        {
          key: "open_damages",
          labelFr: "Dommages non cl\xF4tur\xE9s",
          labelAr: "\u0627\u0644\u0623\u0636\u0631\u0627\u0631 \u0642\u064A\u062F \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629",
          valueDisplay: String(damages.filter((d) => !["REPAIRED", "REJECTED"].includes(d.status)).length),
          numericValue: damages.filter((d) => !["REPAIRED", "REJECTED"].includes(d.status)).length,
          tone: "warning"
        },
        {
          key: "blacklisted_customers",
          labelFr: "Clients liste noire",
          labelAr: "\u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u0641\u064A \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0633\u0648\u062F\u0627\u0621",
          valueDisplay: String(blacklistedCount),
          numericValue: blacklistedCount,
          tone: blacklistedCount > 0 ? "danger" : "neutral"
        }
      );
    }
    if (wantSection("contracts")) {
      sections.push({
        id: "contracts",
        titleFr: "Contrats de location & prolongations",
        titleAr: "\u0639\u0642\u0648\u062F \u0627\u0644\u0643\u0631\u0627\u0621 \u0648\u0627\u0644\u062A\u0645\u062F\u064A\u062F\u0627\u062A",
        columns: [
          { key: "contractNumber", labelFr: "Contrat", labelAr: "\u0627\u0644\u0639\u0642\u062F", type: "text" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "customerName", labelFr: "Client", labelAr: "\u0627\u0644\u0632\u0628\u0648\u0646", type: "text" },
          { key: "matricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "startDate", labelFr: "D\xE9but", labelAr: "\u0627\u0644\u0628\u062F\u0627\u064A\u0629", type: "date" },
          { key: "expectedReturnDate", labelFr: "Retour pr\xE9vu", labelAr: "\u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0645\u062A\u0648\u0642\u0639", type: "date" },
          { key: "totalContractAmountMinor", labelFr: "Total (DZD)", labelAr: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A (\u062F\u062C)", type: "currency_minor" }
        ],
        rows: contracts.map((c) => ({
          contractNumber: c.contract_number,
          status: c.status,
          customerName: c.customer_name,
          matricule: c.matricule,
          startDate: String(c.start_date).slice(0, 10),
          expectedReturnDate: String(c.expected_return_date).slice(0, 10),
          totalContractAmountMinor: Number(c.total_contract_amount_minor ?? 0)
        }))
      });
    }
    if (wantSection("inspections_damages")) {
      sections.push({
        id: "inspections",
        titleFr: "\xC9tats des lieux (D\xE9part & Retour)",
        titleAr: "\u0645\u062D\u0627\u0636\u0631 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 (\u0627\u0644\u0627\u0646\u0637\u0644\u0627\u0642 \u0648\u0627\u0644\u0639\u0648\u062F\u0629)",
        columns: [
          { key: "inspectionNumber", labelFr: "N\xB0", labelAr: "\u0627\u0644\u0631\u0642\u0645", type: "text" },
          { key: "stage", labelFr: "\xC9tape", labelAr: "\u0627\u0644\u0645\u0631\u062D\u0644\u0629", type: "text" },
          { key: "contractNumber", labelFr: "Contrat", labelAr: "\u0627\u0644\u0639\u0642\u062F", type: "text" },
          { key: "matricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "odometerKm", labelFr: "Compteur (km)", labelAr: "\u0627\u0644\u0639\u062F\u0627\u062F (\u0643\u0645)", type: "number" },
          { key: "fuelLevelPercent", labelFr: "Carburant %", labelAr: "\u0627\u0644\u0648\u0642\u0648\u062F %", type: "percent" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "inspectedAt", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" }
        ],
        rows: inspections.map((i) => ({
          inspectionNumber: i.inspection_number,
          stage: i.stage,
          contractNumber: i.contract_number,
          matricule: i.matricule,
          odometerKm: Number(i.odometer_km ?? 0),
          fuelLevelPercent: Number(i.fuel_level_percent ?? 0),
          status: i.status,
          inspectedAt: String(i.inspected_at).slice(0, 10)
        }))
      });
      sections.push({
        id: "damages",
        titleFr: "Dommages signal\xE9s & suivi de r\xE9paration",
        titleAr: "\u0627\u0644\u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u0645\u0635\u0631\u062D \u0628\u0647\u0627 \u0648\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u062A\u0635\u0644\u064A\u062D",
        columns: [
          { key: "matricule", labelFr: "V\xE9hicule", labelAr: "\u0627\u0644\u0645\u0631\u0643\u0628\u0629", type: "text" },
          { key: "contractNumber", labelFr: "Contrat", labelAr: "\u0627\u0644\u0639\u0642\u062F", type: "text" },
          { key: "zoneCode", labelFr: "Zone", labelAr: "\u0627\u0644\u0645\u0646\u0637\u0642\u0629", type: "text" },
          { key: "damageType", labelFr: "Type", labelAr: "\u0627\u0644\u0646\u0648\u0639", type: "text" },
          { key: "severity", labelFr: "Gravit\xE9", labelAr: "\u0627\u0644\u062E\u0637\u0648\u0631\u0629", type: "text" },
          { key: "status", labelFr: "Statut", labelAr: "\u0627\u0644\u062D\u0627\u0644\u0629", type: "text" },
          { key: "estimatedRepairCostMinor", labelFr: "Estimation", labelAr: "\u0627\u0644\u062A\u0642\u062F\u064A\u0631", type: "currency_minor" }
        ],
        rows: damages.map((d) => ({
          matricule: d.matricule,
          contractNumber: d.contract_number ?? "\u2014",
          zoneCode: d.zone_code,
          damageType: d.damage_type,
          severity: d.severity,
          status: d.status,
          estimatedRepairCostMinor: d.estimated_repair_cost_minor != null ? Number(d.estimated_repair_cost_minor) : null
        }))
      });
    }
    if (wantSection("customer_documents")) {
      sections.push({
        id: "customer_documents",
        titleFr: "Documents clients avec \xE9ch\xE9ance",
        titleAr: "\u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u0630\u0627\u062A \u062A\u0627\u0631\u064A\u062E \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629",
        columns: [
          { key: "fullName", labelFr: "Client", labelAr: "\u0627\u0644\u0632\u0628\u0648\u0646", type: "text" },
          { key: "phone", labelFr: "T\xE9l\xE9phone", labelAr: "\u0627\u0644\u0647\u0627\u062A\u0641", type: "text" },
          { key: "docCategory", labelFr: "Cat\xE9gorie", labelAr: "\u0627\u0644\u0635\u0646\u0641", type: "text" },
          { key: "documentNumber", labelFr: "N\xB0 pi\xE8ce", labelAr: "\u0631\u0642\u0645 \u0627\u0644\u0648\u062B\u064A\u0642\u0629", type: "text" },
          { key: "expirationDate", labelFr: "Expiration", labelAr: "\u0627\u0644\u0627\u0646\u062A\u0647\u0627\u0621", type: "date" }
        ],
        rows: expiringCustomerDocs.map((d) => ({
          fullName: d.full_name,
          phone: d.phone,
          docCategory: d.doc_category,
          documentNumber: d.document_number ?? d.original_file_name,
          expirationDate: String(d.expiration_date).slice(0, 10)
        }))
      });
    }
  }
  if ((filter.category === "OPERATIONAL" || filter.category === "CUSTOM") && wantSection("documents_archive")) {
    const docClauses = [
      "substr(gd.created_at, 1, 10) >= ?",
      "substr(gd.created_at, 1, 10) <= ?"
    ];
    const docArgs = [dateFrom, dateTo];
    if (filter.documentKind) {
      docClauses.push("gd.document_kind = ?");
      docArgs.push(filter.documentKind);
    }
    if (filter.customerId) {
      docClauses.push("gd.customer_id = ?");
      docArgs.push(filter.customerId);
    }
    if (filter.vehicleId) {
      docClauses.push("gd.vehicle_id = ?");
      docArgs.push(filter.vehicleId);
    }
    if (filter.userId) {
      docClauses.push("gd.generated_by_user_id = ?");
      docArgs.push(filter.userId);
    }
    const docs = db.prepare(
      `SELECT gd.document_number, gd.document_kind, gd.format, gd.language, gd.is_copy,
                gd.reprint_count, gd.generated_by_username, gd.created_at
         FROM generated_documents gd
         WHERE ${docClauses.join(" AND ")}
         ORDER BY gd.created_at DESC, gd.id DESC`
    ).all(...docArgs);
    sections.push({
      id: "documents_archive",
      titleFr: "Journal des documents \xE9mis & r\xE9\xE9ditions",
      titleAr: "\u0633\u062C\u0644 \u0627\u0644\u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u0645\u0635\u062F\u0631\u0629 \u0648\u0627\u0644\u0646\u0633\u062E",
      columns: [
        { key: "documentNumber", labelFr: "N\xB0 Document", labelAr: "\u0631\u0642\u0645 \u0627\u0644\u0648\u062B\u064A\u0642\u0629", type: "text" },
        { key: "documentKind", labelFr: "Type", labelAr: "\u0627\u0644\u0646\u0648\u0639", type: "text" },
        { key: "format", labelFr: "Format", labelAr: "\u0627\u0644\u0635\u064A\u063A\u0629", type: "text" },
        { key: "language", labelFr: "Langue", labelAr: "\u0627\u0644\u0644\u063A\u0629", type: "text" },
        { key: "isCopy", labelFr: "Copie", labelAr: "\u0646\u0633\u062E\u0629", type: "text" },
        { key: "generatedByUsername", labelFr: "\xC9mis par", labelAr: "\u0627\u0644\u0645\u0635\u062F\u0631", type: "text" },
        { key: "createdAt", labelFr: "Date", labelAr: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", type: "date" }
      ],
      rows: docs.map((d) => ({
        documentNumber: d.document_number,
        documentKind: d.document_kind,
        format: d.format,
        language: d.language.toUpperCase(),
        isCopy: d.is_copy === 1 ? lang === "ar" ? "\u0646\u0639\u0645" : "COPIE" : lang === "ar" ? "\u0623\u0635\u0644\u064A" : "ORIGINAL",
        generatedByUsername: d.generated_by_username,
        createdAt: String(d.created_at).slice(0, 10)
      }))
    });
  }
  if (filter.category === "CUSTOM" && kpis.length === 0) {
    const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
    kpis.push(
      {
        key: "custom_sections",
        labelFr: "Sections incluses",
        labelAr: "\u0627\u0644\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0645\u0634\u0645\u0648\u0644\u0629",
        valueDisplay: String(sections.length),
        numericValue: sections.length,
        tone: "neutral"
      },
      {
        key: "custom_rows",
        labelFr: "Lignes agr\xE9g\xE9es",
        labelAr: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u062C\u0644\u0627\u062A",
        valueDisplay: String(totalRows),
        numericValue: totalRows,
        tone: "neutral"
      }
    );
  }
  const titles = {
    FINANCIAL: { fr: "Rapport Financier Consolid\xE9", ar: "\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062C\u0645\u0639" },
    FLEET: { fr: "Rapport Parc Automobile & Maintenance", ar: "\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0623\u0633\u0637\u0648\u0644 \u0648\u0627\u0644\u0635\u064A\u0627\u0646\u0629 \u0648\u0627\u0644\u0645\u062E\u0632\u0648\u0646" },
    OPERATIONAL: { fr: "Rapport Op\xE9rationnel d\u2019Agence", ar: "\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A \u0644\u0644\u0648\u0643\u0627\u0644\u0629" },
    CUSTOM: { fr: "Rapport Personnalis\xE9 Multi-Modules", ar: "\u062A\u0642\u0631\u064A\u0631 \u0645\u062E\u0635\u0635 \u0645\u062A\u0639\u062F\u062F \u0627\u0644\u0648\u062D\u062F\u0627\u062A" }
  };
  return {
    category: filter.category,
    reportCode: filter.reportCode || `${filter.category}_${dateFrom}_${dateTo}`,
    titleFr: titles[filter.category].fr,
    titleAr: titles[filter.category].ar,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    appliedFilters: filter,
    accountingDisclosuresFr: disclosuresFr,
    accountingDisclosuresAr: disclosuresAr,
    kpis,
    sections
  };
}
function buildReportCsv(dataset, lang) {
  const isAr = lang === "ar";
  const lines = [];
  lines.push(escapeSafeCsvCell(isAr ? dataset.titleAr : dataset.titleFr));
  lines.push(
    [
      escapeSafeCsvCell(isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "P\xE9riode"),
      escapeSafeCsvCell(`${dataset.appliedFilters.dateFrom ?? ""} -> ${dataset.appliedFilters.dateTo ?? ""}`)
    ].join(",")
  );
  for (const disc of isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr) {
    lines.push([escapeSafeCsvCell(isAr ? "\u0645\u0644\u0627\u062D\u0638\u0629 \u0645\u062D\u0627\u0633\u0628\u064A\u0629" : "Note comptable"), escapeSafeCsvCell(disc)].join(","));
  }
  if (dataset.kpis.length > 0) {
    lines.push("");
    lines.push([escapeSafeCsvCell(isAr ? "\u0627\u0644\u0645\u0624\u0634\u0631" : "Indicateur"), escapeSafeCsvCell(isAr ? "\u0627\u0644\u0642\u064A\u0645\u0629" : "Valeur")].join(","));
    for (const k of dataset.kpis) {
      lines.push([escapeSafeCsvCell(isAr ? k.labelAr : k.labelFr), escapeSafeCsvCell(k.valueDisplay)].join(","));
    }
  }
  for (const sec of dataset.sections) {
    lines.push("");
    lines.push(escapeSafeCsvCell(isAr ? sec.titleAr : sec.titleFr));
    lines.push(sec.columns.map((c) => escapeSafeCsvCell(isAr ? c.labelAr : c.labelFr)).join(","));
    for (const row of sec.rows) {
      lines.push(
        sec.columns.map((c) => {
          const raw = row[c.key];
          if (c.type === "currency_minor" && typeof raw === "number") {
            return escapeSafeCsvCell(Number((raw / 100).toFixed(2)));
          }
          return escapeSafeCsvCell(raw);
        }).join(",")
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
async function buildReportXlsx(dataset, lang) {
  const isAr = lang === "ar";
  const workbook = new import_exceljs.default.Workbook();
  workbook.creator = "Gestion Agence de Location ERP";
  workbook.created = /* @__PURE__ */ new Date();
  const summarySheet = workbook.addWorksheet(isAr ? "\u0627\u0644\u0645\u0644\u062E\u0635 \u0648\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A" : "Synth\xE8se & KPI", {
    views: [{ rightToLeft: isAr }]
  });
  summarySheet.columns = [
    { key: "a", width: 42 },
    { key: "b", width: 28 },
    { key: "c", width: 46 }
  ];
  const titleRow = summarySheet.addRow([isAr ? dataset.titleAr : dataset.titleFr]);
  titleRow.font = { bold: true, size: 14 };
  summarySheet.addRow([
    isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "P\xE9riode",
    `${dataset.appliedFilters.dateFrom ?? ""} -> ${dataset.appliedFilters.dateTo ?? ""}`,
    formatDateForDoc(dataset.generatedAt, lang, "latin", true)
  ]);
  summarySheet.addRow([]);
  const kpiHdr = summarySheet.addRow([
    isAr ? "\u0627\u0644\u0645\u0624\u0634\u0631" : "Indicateur",
    isAr ? "\u0627\u0644\u0642\u064A\u0645\u0629" : "Valeur",
    isAr ? "\u0645\u0644\u0627\u062D\u0638\u0629" : "Pr\xE9cision"
  ]);
  kpiHdr.font = { bold: true };
  for (const k of dataset.kpis) {
    const row = summarySheet.addRow([
      sanitizeSpreadsheetText(isAr ? k.labelAr : k.labelFr),
      k.unit === "DZD" ? Number(k.numericValue.toFixed(2)) : sanitizeSpreadsheetText(k.valueDisplay),
      sanitizeSpreadsheetText((isAr ? k.noteAr : k.noteFr) ?? "")
    ]);
    if (k.unit === "DZD") {
      row.getCell(2).numFmt = "#,##0.00";
    }
  }
  summarySheet.addRow([]);
  const discHdr = summarySheet.addRow([isAr ? "\u0636\u0648\u0627\u0628\u0637 \u0648\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0645\u062D\u0627\u0633\u0628\u064A\u0629" : "Disclosures & principes comptables"]);
  discHdr.font = { bold: true };
  for (const d of isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr) {
    summarySheet.addRow([sanitizeSpreadsheetText(d)]);
  }
  const usedNames = /* @__PURE__ */ new Set(["Synth\xE8se & KPI", "\u0627\u0644\u0645\u0644\u062E\u0635 \u0648\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A"]);
  dataset.sections.forEach((sec, idx) => {
    const rawName = (isAr ? sec.titleAr : sec.titleFr).replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 26);
    let sheetName = rawName || `Section ${idx + 1}`;
    if (usedNames.has(sheetName)) {
      sheetName = `${sheetName.slice(0, 25)}_${idx + 1}`;
    }
    usedNames.add(sheetName);
    const ws = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: isAr }] });
    ws.columns = sec.columns.map((c) => ({
      header: sanitizeSpreadsheetText(isAr ? c.labelAr : c.labelFr),
      key: c.key,
      width: c.type === "text" ? 24 : 18
    }));
    ws.getRow(1).font = { bold: true };
    for (const r of sec.rows) {
      const values = sec.columns.map((c) => {
        const raw = r[c.key];
        if (raw === null || raw === void 0) return "";
        if (c.type === "currency_minor" && typeof raw === "number") {
          return Number((raw / 100).toFixed(2));
        }
        if ((c.type === "number" || c.type === "percent") && typeof raw === "number") {
          return raw;
        }
        return sanitizeSpreadsheetText(raw);
      });
      const added = ws.addRow(values);
      sec.columns.forEach((c, ci) => {
        if (c.type === "currency_minor") {
          added.getCell(ci + 1).numFmt = "#,##0.00";
        }
      });
    }
    if (sec.totalsRow) {
      const totalValues = sec.columns.map((c) => {
        const raw = sec.totalsRow?.[c.key];
        if (raw === null || raw === void 0) return "";
        if (c.type === "currency_minor" && typeof raw === "number") {
          return Number((raw / 100).toFixed(2));
        }
        if (typeof raw === "number") return raw;
        return sanitizeSpreadsheetText(raw);
      });
      const tr = ws.addRow(totalValues);
      tr.font = { bold: true };
      sec.columns.forEach((c, ci) => {
        if (c.type === "currency_minor") {
          tr.getCell(ci + 1).numFmt = "#,##0.00";
        }
      });
    }
  });
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
function reportDatasetToPdfSections(dataset, lang, numerals = "latin") {
  const isAr = lang === "ar";
  const blocks = [];
  if (dataset.kpis.length > 0) {
    blocks.push({
      type: "kv_grid",
      title: isAr ? "\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629" : "Indicateurs cl\xE9s de la p\xE9riode",
      columns: 2,
      items: dataset.kpis.map((k) => ({
        label: isAr ? k.labelAr : k.labelFr,
        value: applyNumeralPreference(k.valueDisplay, numerals),
        emphasize: k.tone === "positive" || k.tone === "danger"
      }))
    });
  }
  for (const sec of dataset.sections) {
    const mappedRows = sec.rows.slice(0, 250).map((r) => {
      const out = {};
      for (const col of sec.columns) {
        const raw = r[col.key];
        if (raw === null || raw === void 0) {
          out[col.key] = "\u2014";
        } else if (col.type === "currency_minor" && typeof raw === "number") {
          out[col.key] = formatMoneyForDoc(raw, "DZD", lang, numerals);
        } else if (col.type === "date") {
          out[col.key] = formatDateForDoc(String(raw), lang, numerals, false);
        } else if (col.type === "percent" && typeof raw === "number") {
          out[col.key] = applyNumeralPreference(`${raw}%`, numerals);
        } else {
          out[col.key] = applyNumeralPreference(String(raw), numerals);
        }
      }
      return out;
    });
    blocks.push({
      type: "table",
      title: isAr ? sec.titleAr : sec.titleFr,
      columns: sec.columns.map((c) => ({
        key: c.key,
        label: isAr ? c.labelAr : c.labelFr,
        widthWeight: c.type === "text" ? 1.4 : 1,
        align: c.type === "currency_minor" || c.type === "number" || c.type === "percent" ? isAr ? "left" : "right" : isAr ? "right" : "left"
      })),
      rows: mappedRows
    });
  }
  blocks.push({
    type: "text_block",
    title: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0648\u0645\u0646\u0647\u062C\u064A\u0629 \u0627\u0644\u0645\u062D\u0627\u0633\u0628\u0629" : "Notes comptables et limites d\u2019analyse",
    muted: true,
    text: (isAr ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr).join("\n")
  });
  return blocks;
}

// electron/documents/templates.ts
var ALL_DOCUMENT_KINDS = [
  "RENTAL_CONTRACT",
  "CONTRACT_AMENDMENT",
  "DEPARTURE_INSPECTION",
  "RETURN_INSPECTION",
  "DAMAGE_REPORT",
  "PAYMENT_RECEIPT",
  "DEPOSIT_RECEIPT",
  "DEPOSIT_SETTLEMENT",
  "INVOICE",
  "EXPENSE_RECEIPT",
  "MAINTENANCE_REPORT",
  "VEHICLE_HISTORY",
  "CUSTOMER_STATEMENT",
  "CASH_REGISTER_CLOSING",
  "FINANCIAL_SUMMARY",
  "CUSTOM_REPORT"
];
var DEFAULT_PREFIXES = {
  RENTAL_CONTRACT: "CTR",
  CONTRACT_AMENDMENT: "AVN",
  DEPARTURE_INSPECTION: "EDL-D",
  RETURN_INSPECTION: "EDL-R",
  DAMAGE_REPORT: "DMG",
  PAYMENT_RECEIPT: "REC",
  DEPOSIT_RECEIPT: "CAU",
  DEPOSIT_SETTLEMENT: "DEC",
  INVOICE: "FAC",
  EXPENSE_RECEIPT: "DEP",
  MAINTENANCE_REPORT: "MNT",
  VEHICLE_HISTORY: "HIST",
  CUSTOMER_STATEMENT: "REL",
  CASH_REGISTER_CLOSING: "CAI",
  FINANCIAL_SUMMARY: "FIN",
  CUSTOM_REPORT: "RPT"
};
function loadTemplateConfigFromDb(db) {
  const s = getAllSettings(db);
  const prefixes = {};
  for (const kind of ALL_DOCUMENT_KINDS) {
    prefixes[kind] = s[`documents.prefix_${kind}`] || DEFAULT_PREFIXES[kind];
  }
  return {
    agencyName: s["agency.name"] || "Agence de Location",
    agencyAddress: s["agency.address"] || "",
    agencyPhone: s["agency.phone"] || "",
    agencyEmail: s["agency.email"] || "",
    agencyWilayaCode: s["agency.wilaya_code"] || "16",
    rcNumber: s["agency.rc"] || s["agency.rc_number"] || "",
    nifNumber: s["agency.nif"] || s["agency.nif_number"] || "",
    nisNumber: s["agency.nis"] || s["agency.nis_number"] || "",
    artNumber: s["agency.art"] || s["agency.art_number"] || "",
    logoVaultPath: s["agency.logo_vault_path"] || "",
    logoMimeType: s["agency.logo_mime_type"] || "",
    defaultLanguage: s["documents.default_language"] === "ar" ? "ar" : "fr",
    defaultFormat: ["A4_PDF", "A4_LANDSCAPE_PDF", "THERMAL_80MM", "THERMAL_58MM"].includes(s["documents.default_format"]) ? s["documents.default_format"] : "A4_PDF",
    thermalWidth: s["documents.thermal_width"] === "58MM" ? "58MM" : "80MM",
    defaultPrinterA4: s["documents.default_printer_a4"] || "",
    defaultPrinterThermal: s["documents.default_printer_thermal"] || "",
    showLogo: s["documents.show_logo"] !== "0",
    showFiscalIds: s["documents.show_fiscal_ids"] !== "0",
    showSignatureBoxes: s["documents.show_signature_boxes"] !== "0",
    invoiceFiscallyCompliant: s["documents.invoice_fiscally_compliant"] === "1",
    invoiceTaxRatePercent: Number(s["documents.invoice_tax_rate_percent"] ?? 0) || 0,
    templateVersion: Number(s["documents.template_version"] ?? 1) || 1,
    footerFr: s["documents.footer_fr"] || "Document g\xE9n\xE9r\xE9 localement par le syst\xE8me de gestion de l\u2019agence.",
    footerAr: s["documents.footer_ar"] || "\u0648\u062B\u064A\u0642\u0629 \u0635\u0627\u062F\u0631\u0629 \u0645\u062D\u0644\u064A\u0627\u064B \u0639\u0646 \u0646\u0638\u0627\u0645 \u062A\u0633\u064A\u064A\u0631 \u0627\u0644\u0648\u0643\u0627\u0644\u0629.",
    signatureAgencyFr: s["documents.signature_agency_fr"] || "Cachet & signature de l\u2019agence",
    signatureAgencyAr: s["documents.signature_agency_ar"] || "\u062E\u062A\u0645 \u0648\u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0648\u0643\u0627\u0644\u0629",
    signatureCustomerFr: s["documents.signature_customer_fr"] || "Lu et approuv\xE9 \u2014 Signature du client",
    signatureCustomerAr: s["documents.signature_customer_ar"] || "\u0642\u0631\u0626 \u0648\u0635\u0648\u062F\u0642 \u0639\u0644\u064A\u0647 \u2014 \u062A\u0648\u0642\u064A\u0639 \u0627\u0644\u0632\u0628\u0648\u0646",
    contractTermsFr: s["documents.contract_terms_fr"] || "",
    contractTermsAr: s["documents.contract_terms_ar"] || "",
    invoiceDisclaimerFr: s["documents.invoice_disclaimer_fr"] || "Document de facturation g\xE9n\xE9r\xE9 localement selon la configuration de l\u2019agence.",
    invoiceDisclaimerAr: s["documents.invoice_disclaimer_ar"] || "\u0641\u0627\u062A\u0648\u0631\u0629 \u0635\u0627\u062F\u0631\u0629 \u0645\u062D\u0644\u064A\u0627\u064B \u0648\u0641\u0642 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629 \u0645\u0646 \u0637\u0631\u0641 \u0627\u0644\u0648\u0643\u0627\u0644\u0629.",
    prefixes
  };
}
function getDocumentTitle(kind, lang) {
  const labels = {
    RENTAL_CONTRACT: { fr: "CONTRAT DE LOCATION DE V\xC9HICULE", ar: "\u0639\u0642\u062F \u0643\u0631\u0627\u0621 \u0645\u0631\u0643\u0628\u0629" },
    CONTRACT_AMENDMENT: { fr: "AVENANT / PROLONGATION DE CONTRAT", ar: "\u0645\u0644\u062D\u0642 \u0648\u062A\u0645\u062F\u064A\u062F \u0639\u0642\u062F \u0643\u0631\u0627\u0621" },
    DEPARTURE_INSPECTION: { fr: "\xC9TAT DES LIEUX DE D\xC9PART", ar: "\u0645\u062D\u0636\u0631 \u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0639\u0646\u062F \u0627\u0644\u0627\u0646\u0637\u0644\u0627\u0642" },
    RETURN_INSPECTION: { fr: "\xC9TAT DES LIEUX DE RETOUR", ar: "\u0645\u062D\u0636\u0631 \u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0639\u0646\u062F \u0627\u0644\u0639\u0648\u062F\u0629" },
    DAMAGE_REPORT: { fr: "RAPPORT COMPARATIF DES DOMMAGES", ar: "\u062A\u0642\u0631\u064A\u0631 \u0645\u0642\u0627\u0631\u0646\u0629 \u0627\u0644\u0623\u0636\u0631\u0627\u0631" },
    PAYMENT_RECEIPT: { fr: "RE\xC7U DE PAIEMENT", ar: "\u0648\u0635\u0644 \u062F\u0641\u0639" },
    DEPOSIT_RECEIPT: { fr: "RE\xC7U DE CAUTION (D\xC9P\xD4T DE GARANTIE)", ar: "\u0648\u0635\u0644 \u0627\u0633\u062A\u0644\u0627\u0645 \u0643\u0641\u0627\u0644\u0629 \u0636\u0645\u0627\u0646" },
    DEPOSIT_SETTLEMENT: { fr: "D\xC9COMPTE DE RESTITUTION DE CAUTION", ar: "\u0643\u0634\u0641 \u062A\u0635\u0641\u064A\u0629 \u0648\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0643\u0641\u0627\u0644\u0629" },
    INVOICE: { fr: "FACTURE CLIENT", ar: "\u0641\u0627\u062A\u0648\u0631\u0629 \u0632\u0628\u0648\u0646" },
    EXPENSE_RECEIPT: { fr: "BON / JUSTIFICATIF DE D\xC9PENSE", ar: "\u0633\u0646\u062F \u0648\u0625\u062B\u0628\u0627\u062A \u0645\u0635\u0631\u0648\u0641" },
    MAINTENANCE_REPORT: { fr: "FICHE D\u2019INTERVENTION MAINTENANCE", ar: "\u0628\u0637\u0627\u0642\u0629 \u062A\u062F\u062E\u0644 \u0627\u0644\u0635\u064A\u0627\u0646\u0629" },
    VEHICLE_HISTORY: { fr: "DOSSIER HISTORIQUE DU V\xC9HICULE", ar: "\u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u0643\u0627\u0645\u0644 \u0644\u0644\u0645\u0631\u0643\u0628\u0629" },
    CUSTOMER_STATEMENT: { fr: "RELEV\xC9 DE COMPTE CLIENT", ar: "\u0643\u0634\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0632\u0628\u0648\u0646" },
    CASH_REGISTER_CLOSING: { fr: "PROC\xC8S-VERBAL DE CL\xD4TURE DE CAISSE", ar: "\u0645\u062D\u0636\u0631 \u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u064A\u0648\u0645\u064A" },
    FINANCIAL_SUMMARY: { fr: "SYNTH\xC8SE FINANCI\xC8RE P\xC9RIODIQUE", ar: "\u0627\u0644\u0645\u0644\u062E\u0635 \u0627\u0644\u0645\u0627\u0644\u064A \u0627\u0644\u062F\u0648\u0631\u064A" },
    CUSTOM_REPORT: { fr: "RAPPORT D\u2019EXPLOITATION PERSONNALIS\xC9", ar: "\u062A\u0642\u0631\u064A\u0631 \u062A\u0634\u063A\u064A\u0644\u064A \u0645\u062E\u0635\u0635" }
  };
  return lang === "ar" ? labels[kind].ar : labels[kind].fr;
}
function buildDocumentContentFromDb(db, params) {
  const lang = params.language;
  const numSys = params.numeralSystem;
  const isAr = lang === "ar";
  const tpl = params.template;
  const title = getDocumentTitle(params.documentKind, lang);
  const money = (minor, cur = "DZD") => formatMoneyForDoc(minor, cur, lang, numSys);
  const dt = (iso, time = false) => formatDateForDoc(iso, lang, numSys, time);
  const num = (v) => v === null || v === void 0 || v === "" ? "\u2014" : applyNumeralPreference(String(v), numSys);
  switch (params.documentKind) {
    case "RENTAL_CONTRACT": {
      if (!params.contractId) throw new AuthError("VALIDATION_ERROR", "Contrat requis pour g\xE9n\xE9rer le contrat de location");
      const detail = getContractDetail(db, params.contractId);
      const c = detail.contract;
      const custProf = getCustomerProfile(db, c.customerId);
      const customer = custProf.customer;
      const vehProf = getVehicleProfile(db, c.vehicleId);
      const vehicle = vehProf.vehicle;
      const currency = c.currency || "DZD";
      const paidNet = detail.payments.reduce(
        (s, p) => s + (p.direction === "INFLOW" ? p.amountMinor : -p.amountMinor),
        0
      );
      const mileageLabel = c.mileageMode === "UNLIMITED" ? isAr ? "\u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F" : "Illimit\xE9" : c.mileageMode === "DAILY_ALLOWANCE" ? `${num(c.dailyMileageAllowanceKm ?? 0)} ${isAr ? "\u0643\u0645 / \u064A\u0648\u0645" : "km / jour"}` : `${num(c.includedTotalKm ?? 0)} ${isAr ? "\u0643\u0645 \u0625\u062C\u0645\u0627\u0644\u064A" : "km forfait"}`;
      const sections = [
        {
          type: "kv_grid",
          title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0642\u062F" : "Identification du contrat",
          columns: 2,
          items: [
            { label: isAr ? "\u0631\u0642\u0645 \u0627\u0644\u0639\u0642\u062F" : "N\xB0 Contrat", value: num(c.contractNumber), emphasize: true },
            { label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", value: c.status },
            { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0627\u0646\u0637\u0644\u0627\u0642" : "Date de d\xE9part", value: dt(c.startDate, true) },
            { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0645\u062A\u0648\u0642\u0639" : "Retour pr\xE9vu", value: dt(c.expectedReturnDate, true) },
            { label: isAr ? "\u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u0623\u0635\u0644\u064A\u0629" : "Fin initiale", value: dt(c.originalEndDate, true) },
            { label: isAr ? "\u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0641\u0639\u0644\u064A" : "Retour effectif", value: dt(c.actualReturnDate, true) }
          ]
        },
        {
          type: "kv_grid",
          title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0623\u062C\u0631" : "Locataire (Client)",
          columns: 2,
          items: [
            { label: isAr ? "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 / \u0627\u0644\u0634\u0631\u0643\u0629" : "Nom / Raison sociale", value: custProf.company?.companyName ? `${custProf.company.companyName} (${customer.fullName})` : customer.fullName, emphasize: true },
            { label: isAr ? "\u0627\u0644\u0647\u0627\u062A\u0641" : "T\xE9l\xE9phone", value: num(customer.phone) },
            { label: isAr ? "\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062A\u0639\u0631\u064A\u0641 / \u062C\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631" : "CNI / Passeport", value: num(customer.cniNumber || customer.passportNumber) },
            { label: isAr ? "\u0631\u062E\u0635\u0629 \u0627\u0644\u0633\u064A\u0627\u0642\u0629" : "Permis de conduire", value: num(customer.drivingLicenceNumber) },
            { label: isAr ? "\u0627\u0644\u0639\u0646\u0648\u0627\u0646" : "Adresse", value: customer.address || "\u2014" },
            { label: isAr ? "\u0627\u0644\u0648\u0644\u0627\u064A\u0629" : "Wilaya", value: num(customer.wilayaCode) }
          ]
        },
        {
          type: "kv_grid",
          title: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0627\u0644\u0645\u0624\u062C\u0631\u0629" : "V\xE9hicule lou\xE9",
          columns: 2,
          items: [
            { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "Marque & Mod\xE8le", value: `${vehicle.brand} ${vehicle.model} (${num(vehicle.year)})`, emphasize: true },
            { label: isAr ? "\u0627\u0644\u062A\u0631\u0642\u064A\u0645" : "Matricule", value: num(vehicle.matricule), emphasize: true },
            { label: isAr ? "\u0627\u0644\u0648\u0642\u0648\u062F / \u0646\u0627\u0642\u0644 \u0627\u0644\u062D\u0631\u0643\u0629" : "\xC9nergie / Bo\xEEte", value: `${vehicle.fuelType} \xB7 ${vehicle.transmission}` },
            { label: isAr ? "\u0646\u0638\u0627\u0645 \u0627\u0644\u0645\u0633\u0627\u0641\u0629" : "Forfait kilom\xE9trique", value: mileageLabel },
            { label: isAr ? "\u0627\u0644\u0639\u062F\u0627\u062F \u0639\u0646\u062F \u0627\u0644\u0627\u0646\u0637\u0644\u0627\u0642" : "Compteur d\xE9part", value: `${num(c.departureOdometerKm)} km` },
            { label: isAr ? "\u062A\u0639\u0631\u064A\u0641\u0629 \u0627\u0644\u0643\u064A\u0644\u0648\u0645\u062A\u0631 \u0627\u0644\u0625\u0636\u0627\u0641\u064A" : "Tarif km suppl.", value: `${money(c.extraKmRateMinor, currency)} / km` }
          ]
        },
        {
          type: "summary_box",
          title: isAr ? "\u0627\u0644\u062A\u0633\u0639\u064A\u0631 \u0648\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u062A\u0639\u0627\u0642\u062F \u0639\u0644\u064A\u0647" : "D\xE9compte financier du contrat",
          rows: [
            { label: isAr ? "\u0645\u0628\u0644\u063A \u0627\u0644\u0643\u0631\u0627\u0621 \u0627\u0644\u0623\u0633\u0627\u0633\u064A" : "Location de base", value: money(c.baseRentalTotalMinor, currency) },
            { label: isAr ? "\u0627\u0644\u062A\u062E\u0641\u064A\u0636 \u0627\u0644\u0645\u0645\u0646\u0648\u062D" : "Remise accord\xE9e", value: `-${money(c.discountMinor, currency)}` },
            { label: isAr ? "\u0627\u0644\u062A\u0645\u062F\u064A\u062F\u0627\u062A \u0627\u0644\u0625\u0636\u0627\u0641\u064A\u0629" : "Prolongations", value: money(c.extensionTotalMinor, currency) },
            { label: isAr ? "\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0643\u064A\u0644\u0648\u0645\u062A\u0631\u0627\u062A / \u0627\u0644\u062A\u0623\u062E\u064A\u0631 / \u0627\u0644\u0623\u0636\u0631\u0627\u0631" : "Km suppl. / Retard / Dommages", value: money(c.extraKmChargeMinor + c.lateFeeMinor + c.damageChargeMinor + c.otherChargesMinor, currency) },
            { label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0644\u0644\u0639\u0642\u062F" : "TOTAL CONTRACTUEL", value: money(c.totalContractAmountMinor, currency), highlight: true },
            { label: isAr ? "\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0629" : "Total encaiss\xE9 net", value: money(paidNet, currency) },
            { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0628\u0642\u064A \u0644\u0644\u062F\u0641\u0639" : "Reste \xE0 r\xE9gler", value: money(Math.max(0, c.totalContractAmountMinor - paidNet), currency), highlight: true },
            ...detail.deposit ? [{ label: isAr ? "\u0643\u0641\u0627\u0644\u0629 \u0627\u0644\u0636\u0645\u0627\u0646 (\u062E\u0627\u0631\u062C \u0645\u0628\u0644\u063A \u0627\u0644\u0643\u0631\u0627\u0621)" : "Caution de garantie (hors loyer)", value: `${money(detail.deposit.amountMinor, detail.deposit.currency)} (${detail.deposit.status})` }] : []
          ]
        }
      ];
      const terms = (isAr ? tpl.contractTermsAr : tpl.contractTermsFr) || params.notes || "";
      if (terms) {
        sections.push({
          type: "text_block",
          title: isAr ? "\u0627\u0644\u0634\u0631\u0648\u0637 \u0648\u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A \u0627\u0644\u062A\u0639\u0627\u0642\u062F\u064A\u0629" : "Conditions g\xE9n\xE9rales & engagements",
          text: terms,
          muted: true
        });
      }
      sections.push({
        type: "signatures",
        leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
        rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
        leftSubtitle: tpl.agencyName,
        rightSubtitle: customer.fullName
      });
      return {
        title,
        subtitle: `${c.contractNumber} \xB7 ${customer.fullName} \xB7 ${vehicle.matricule}`,
        sections,
        links: { contractId: c.id, customerId: c.customerId, vehicleId: c.vehicleId }
      };
    }
    case "CONTRACT_AMENDMENT": {
      if (!params.contractId) throw new AuthError("VALIDATION_ERROR", "Contrat requis pour l\u2019avenant");
      const detail = getContractDetail(db, params.contractId);
      const ext = params.extensionId ? detail.extensions.find((e) => e.id === params.extensionId) : detail.extensions[0];
      if (!ext) throw new AuthError("NOT_FOUND", "Aucune prolongation enregistr\xE9e pour ce contrat");
      const currency = detail.contract.currency || "DZD";
      return {
        title,
        subtitle: `${detail.contract.contractNumber} \xB7 ${detail.contract.customerName}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062A\u0645\u062F\u064A\u062F" : "D\xE9tails de la prolongation",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0639\u0642\u062F \u0627\u0644\u0623\u0635\u0644\u064A" : "Contrat concern\xE9", value: num(detail.contract.contractNumber), emphasize: true },
              { label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Client", value: detail.contract.customerName },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: detail.contract.vehicleLabel },
              { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u0633\u0627\u0628\u0642" : "Ancienne date retour", value: dt(ext.previousReturnDate, true) },
              { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0627\u0644\u062C\u062F\u064A\u062F" : "Nouvelle date retour", value: dt(ext.newReturnDate, true), emphasize: true },
              { label: isAr ? "\u0627\u0644\u0643\u064A\u0644\u0648\u0645\u062A\u0631\u0627\u062A \u0627\u0644\u0645\u0636\u0627\u0641\u0629" : "Km additionnels", value: `${num(ext.additionalKmAllowance)} km` }
            ]
          },
          {
            type: "summary_box",
            title: isAr ? "\u0627\u0644\u0623\u062B\u0631 \u0627\u0644\u0645\u0627\u0644\u064A \u0644\u0644\u0645\u0644\u062D\u0642" : "Impact financier de l\u2019avenant",
            rows: [
              { label: isAr ? "\u0645\u0628\u0644\u063A \u0627\u0644\u062A\u0645\u062F\u064A\u062F \u0627\u0644\u0625\u0636\u0627\u0641\u064A" : "Suppl\xE9ment de prolongation", value: money(ext.additionalAmountMinor, currency), highlight: true },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0639\u0642\u062F \u0627\u0644\u0645\u062D\u062F\u062B" : "Nouveau total contractuel", value: money(detail.contract.totalContractAmountMinor, currency), highlight: true }
            ]
          },
          ...ext.notes ? [{ type: "text_block", title: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A" : "Notes", text: ext.notes }] : [],
          {
            type: "signatures",
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: detail.contract.customerName
          }
        ],
        links: { contractId: detail.contract.id, customerId: detail.contract.customerId, vehicleId: detail.contract.vehicleId }
      };
    }
    case "DEPARTURE_INSPECTION":
    case "RETURN_INSPECTION": {
      let inspId = params.inspectionId ?? null;
      if (!inspId && params.contractId) {
        const wantedStage = params.documentKind === "DEPARTURE_INSPECTION" ? "DEPARTURE" : "RETURN";
        const found = db.prepare(
          "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = ? ORDER BY id DESC LIMIT 1"
        ).get(params.contractId, wantedStage);
        inspId = found?.id ?? null;
      }
      if (!inspId) throw new AuthError("NOT_FOUND", "\xC9tat des lieux introuvable");
      const detail = getInspectionDetail(db, inspId);
      const insp = detail.inspection;
      const condLabel = (c) => isAr ? c === "GOOD" ? "\u0633\u0644\u064A\u0645" : c === "DAMAGED" ? "\u0645\u062A\u0636\u0631\u0631" : "\u0645\u0641\u0642\u0648\u062F" : c === "GOOD" ? "Bon" : c === "DAMAGED" ? "Endommag\xE9" : "Manquant";
      return {
        title,
        subtitle: `${insp.inspectionNumber} \xB7 ${detail.contract.contractNumber} \xB7 ${detail.vehicle.matricule}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629" : "Informations g\xE9n\xE9rales",
            columns: 2,
            items: [
              { label: isAr ? "\u0631\u0642\u0645 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629" : "N\xB0 Inspection", value: num(insp.inspectionNumber), emphasize: true },
              { label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", value: num(detail.contract.contractNumber) },
              { label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Client", value: detail.customer.fullName },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: `${detail.vehicle.brand} ${detail.vehicle.model} (${num(detail.vehicle.matricule)})` },
              { label: isAr ? "\u0627\u0644\u0639\u062F\u0627\u062F" : "Kilom\xE9trage", value: `${num(insp.odometerKm)} km`, emphasize: true },
              { label: isAr ? "\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0648\u0642\u0648\u062F" : "Niveau carburant", value: `${num(insp.fuelLevelPercent)} %`, emphasize: true },
              { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629" : "Date d\u2019inspection", value: dt(insp.inspectedAt, true) },
              { label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", value: insp.status }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0641\u062D\u0635 \u0627\u0644\u062A\u0641\u0635\u064A\u0644\u064A\u0629" : "Grille de contr\xF4le d\xE9taill\xE9e",
            columns: [
              { key: "category", label: isAr ? "\u0627\u0644\u0641\u0626\u0629" : "Cat\xE9gorie", widthWeight: 0.9 },
              { key: "label", label: isAr ? "\u0627\u0644\u0639\u0646\u0635\u0631" : "\xC9l\xE9ment contr\xF4l\xE9", widthWeight: 1.8 },
              { key: "condition", label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "\xC9tat", widthWeight: 0.9 },
              { key: "notes", label: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A" : "Observations", widthWeight: 1.6 }
            ],
            rows: detail.items.map((it) => ({
              category: it.category,
              label: isAr ? it.labelAr : it.labelFr,
              condition: condLabel(it.condition),
              notes: it.notes || "\u2014"
            }))
          },
          {
            type: "table",
            title: isAr ? "\u0627\u0644\u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u0645\u0633\u062C\u0644\u0629" : "Dommages relev\xE9s",
            columns: [
              { key: "zone", label: isAr ? "\u0627\u0644\u0645\u0646\u0637\u0642\u0629" : "Zone", widthWeight: 1 },
              { key: "type", label: isAr ? "\u0627\u0644\u0646\u0648\u0639" : "Type", widthWeight: 0.9 },
              { key: "severity", label: isAr ? "\u0627\u0644\u062E\u0637\u0648\u0631\u0629" : "Gravit\xE9", widthWeight: 0.9 },
              { key: "description", label: isAr ? "\u0627\u0644\u0648\u0635\u0641" : "Description", widthWeight: 2 }
            ],
            rows: detail.damages.map((d) => ({
              zone: d.zoneCode,
              type: d.damageType,
              severity: d.severity,
              description: d.description
            }))
          },
          ...insp.exteriorNotes || insp.interiorNotes || insp.customerAcknowledgmentNotes ? [
            {
              type: "text_block",
              title: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629" : "Notes ext\xE9rieures & int\xE9rieures",
              text: [insp.exteriorNotes, insp.interiorNotes, insp.customerAcknowledgmentNotes].filter(Boolean).join("\n")
            }
          ] : [],
          {
            type: "signatures",
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftImageDataUrl: insp.agencySignatureData,
            rightImageDataUrl: insp.customerSignatureData,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: detail.customer.fullName
          }
        ],
        links: {
          contractId: insp.contractId,
          inspectionId: insp.id,
          customerId: detail.customer.id,
          vehicleId: detail.vehicle.id
        }
      };
    }
    case "DAMAGE_REPORT": {
      if (!params.contractId) throw new AuthError("VALIDATION_ERROR", "Contrat requis pour le rapport des dommages");
      const ci = getContractInspections(db, params.contractId);
      const ctDetail = getContractDetail(db, params.contractId);
      const veh = getVehicleProfile(db, ctDetail.contract.vehicleId).vehicle;
      const cmp = ci.comparison;
      const preExisting = cmp?.preExistingDamages ?? ci.openVehicleDamages;
      const newlyDiscovered = cmp?.newlyDiscoveredDamages ?? [];
      const allDamages = [...preExisting, ...newlyDiscovered];
      const estTotal = newlyDiscovered.reduce((s, d) => s + Number(d.estimatedRepairCostMinor ?? 0), 0);
      return {
        title,
        subtitle: `${ctDetail.contract.contractNumber} \xB7 ${ctDetail.contract.customerName} \xB7 ${veh.matricule}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0645\u0644\u062E\u0635 \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0629 (\u0627\u0646\u0637\u0644\u0627\u0642 / \u0639\u0648\u062F\u0629)" : "Synth\xE8se comparative D\xE9part / Retour",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", value: num(ctDetail.contract.contractNumber), emphasize: true },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: `${veh.brand} ${veh.model} (${num(veh.matricule)})` },
              { label: isAr ? "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629" : "Distance parcourue", value: cmp?.odometerDeltaKm != null ? `${num(cmp.odometerDeltaKm)} km` : "\u2014" },
              { label: isAr ? "\u0641\u0627\u0631\u0642 \u0627\u0644\u0648\u0642\u0648\u062F" : "Variation carburant", value: cmp?.fuelDeltaPercent != null ? `${num(cmp.fuelDeltaPercent)} %` : "\u2014" },
              { label: isAr ? "\u0623\u0636\u0631\u0627\u0631 \u0633\u0627\u0628\u0642\u0629" : "Dommages pr\xE9existants", value: num(preExisting.length) },
              { label: isAr ? "\u0623\u0636\u0631\u0627\u0631 \u062C\u062F\u064A\u062F\u0629 \u0645\u0643\u062A\u0634\u0641\u0629" : "Nouveaux dommages", value: num(newlyDiscovered.length), emphasize: true }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u0633\u062C\u0644 \u0627\u0644\u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u0645\u0642\u0627\u0631\u0646" : "D\xE9tail des dommages constat\xE9s",
            columns: [
              { key: "origin", label: isAr ? "\u0627\u0644\u0623\u0635\u0644" : "Origine", widthWeight: 1 },
              { key: "zone", label: isAr ? "\u0627\u0644\u0645\u0646\u0637\u0642\u0629" : "Zone", widthWeight: 1 },
              { key: "severity", label: isAr ? "\u0627\u0644\u062E\u0637\u0648\u0631\u0629" : "Gravit\xE9", widthWeight: 0.9 },
              { key: "status", label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", widthWeight: 0.9 },
              { key: "description", label: isAr ? "\u0627\u0644\u0648\u0635\u0641" : "Description", widthWeight: 1.8 },
              { key: "cost", label: isAr ? "\u0627\u0644\u062A\u0642\u062F\u064A\u0631" : "Estimation", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: allDamages.map((d) => ({
              origin: d.isNewlyDiscovered ? isAr ? "\u062C\u062F\u064A\u062F" : "NOUVEAU" : isAr ? "\u0633\u0627\u0628\u0642" : "Pr\xE9existant",
              zone: `${d.zoneCode} (${d.damageType})`,
              severity: d.severity,
              status: d.status,
              description: d.description,
              cost: d.estimatedRepairCostMinor != null ? money(d.estimatedRepairCostMinor) : "\u2014"
            }))
          },
          {
            type: "summary_box",
            title: isAr ? "\u062A\u0642\u062F\u064A\u0631 \u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629" : "Estimation financi\xE8re",
            rows: [
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062A\u0642\u062F\u064A\u0631\u0627\u062A \u0644\u0644\u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629" : "Total estim\xE9 nouveaux dommages", value: money(estTotal), highlight: true }
            ]
          },
          {
            type: "signatures",
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftImageDataUrl: ci.returnInspection?.inspection.agencySignatureData ?? ci.departure?.inspection.agencySignatureData,
            rightImageDataUrl: ci.returnInspection?.inspection.customerSignatureData ?? ci.departure?.inspection.customerSignatureData,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: ctDetail.contract.customerName
          }
        ],
        links: {
          contractId: ctDetail.contract.id,
          inspectionId: ci.returnInspection?.inspection.id ?? ci.departure?.inspection.id ?? null,
          customerId: ctDetail.contract.customerId,
          vehicleId: ctDetail.contract.vehicleId
        }
      };
    }
    case "PAYMENT_RECEIPT": {
      if (!params.paymentId) throw new AuthError("VALIDATION_ERROR", "Paiement requis pour le re\xE7u");
      const p = db.prepare(
        `SELECT cp.*, rc.contract_number, rc.customer_id, rc.vehicle_id, rc.total_contract_amount_minor,
                  c.full_name AS customer_name, c.phone AS customer_phone,
                  v.matricule, v.brand, v.model, u.full_name AS recorded_by_name
           FROM contract_payments cp
           JOIN rental_contracts rc ON rc.id = cp.contract_id
           JOIN customers c ON c.id = rc.customer_id
           JOIN vehicles v ON v.id = rc.vehicle_id
           LEFT JOIN users u ON u.id = cp.recorded_by_user_id
           WHERE cp.id = ?`
      ).get(params.paymentId);
      if (!p) throw new AuthError("NOT_FOUND", "Paiement introuvable");
      const totals = db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS net_paid_minor
           FROM contract_payments WHERE contract_id = ?`
      ).get(p.contract_id);
      const netPaid = Number(totals?.net_paid_minor ?? 0);
      const remaining = Math.max(0, Number(p.total_contract_amount_minor) - netPaid);
      const currency = p.currency || "DZD";
      return {
        title,
        subtitle: `${p.receipt_number} \xB7 ${p.contract_number}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0648\u0635\u0644" : "R\xE9f\xE9rences du r\xE8glement",
            columns: 2,
            items: [
              { label: isAr ? "\u0631\u0642\u0645 \u0627\u0644\u0648\u0635\u0644" : "N\xB0 Re\xE7u", value: num(p.receipt_number), emphasize: true },
              { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0639\u0645\u0644\u064A\u0629" : "Date paiement", value: dt(p.payment_date, true) },
              { label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", value: num(p.contract_number) },
              { label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Client", value: `${p.customer_name} (${num(p.customer_phone)})` },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: `${p.brand} ${p.model} (${num(p.matricule)})` },
              { label: isAr ? "\u0648\u0633\u064A\u0644\u0629 \u0627\u0644\u062F\u0641\u0639" : "Mode de r\xE8glement", value: `${p.method}${p.payment_reference ? ` \xB7 ${p.payment_reference}` : ""}` }
            ]
          },
          {
            type: "summary_box",
            title: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0648\u0627\u0644\u0648\u0636\u0639\u064A\u0629 \u0627\u0644\u0645\u0627\u0644\u064A\u0629" : "Montant & situation du contrat",
            rows: [
              {
                label: p.direction === "REFUND" ? isAr ? "\u0645\u0628\u0644\u063A \u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639" : "Montant rembours\xE9" : isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u062F\u0641\u0648\u0639" : "Montant encaiss\xE9",
                value: money(Number(p.amount_minor), currency),
                highlight: true
              },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0639\u0642\u062F" : "Total contrat", value: money(Number(p.total_contract_amount_minor), currency) },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u0641\u0648\u0639 \u062D\u062A\u0649 \u0627\u0644\u0622\u0646" : "Total pay\xE9 cumul\xE9", value: money(netPaid, currency) },
              { label: isAr ? "\u0627\u0644\u0628\u0627\u0642\u064A \u0627\u0644\u0645\u0633\u062A\u062D\u0642" : "Solde restant d\xFB", value: money(remaining, currency), highlight: true }
            ]
          },
          ...p.description ? [{ type: "text_block", title: isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "Libell\xE9", text: p.description }] : [],
          {
            type: "signatures",
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftSubtitle: p.recorded_by_name || tpl.agencyName,
            rightSubtitle: p.customer_name
          }
        ],
        links: {
          contractId: Number(p.contract_id),
          paymentId: Number(p.id),
          customerId: Number(p.customer_id),
          vehicleId: Number(p.vehicle_id)
        }
      };
    }
    case "DEPOSIT_RECEIPT":
    case "DEPOSIT_SETTLEMENT": {
      let depId = params.depositId ?? null;
      if (!depId && params.contractId) {
        const dRow = db.prepare("SELECT id FROM deposits WHERE contract_id = ?").get(params.contractId);
        depId = dRow?.id ?? null;
      }
      if (!depId) throw new AuthError("VALIDATION_ERROR", "Caution requise");
      const det = getDepositDetail(db, depId);
      const dep = det.deposit;
      const currency = dep.currency || "DZD";
      const sections = [
        {
          type: "kv_grid",
          title: isAr ? "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0643\u0641\u0627\u0644\u0629" : "Identification du d\xE9p\xF4t de garantie",
          columns: 2,
          items: [
            { label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", value: num(dep.contractNumber), emphasize: true },
            { label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Client", value: dep.customerName },
            { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: dep.vehicleLabel },
            { label: isAr ? "\u062D\u0627\u0644\u0629 \u0627\u0644\u0643\u0641\u0627\u0644\u0629" : "Statut caution", value: dep.status, emphasize: true },
            { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645" : "Date de d\xE9p\xF4t", value: dt(dep.receivedDate, true) },
            { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0635\u0641\u064A\u0629" : "Date de r\xE8glement", value: dt(dep.returnedDate, true) }
          ]
        },
        {
          type: "summary_box",
          title: isAr ? "\u062A\u0648\u0627\u0632\u0646 \u0645\u0628\u0644\u063A \u0627\u0644\u0636\u0645\u0627\u0646" : "Situation de la caution",
          rows: [
            { label: isAr ? "\u0645\u0628\u0644\u063A \u0627\u0644\u0643\u0641\u0627\u0644\u0629 \u0627\u0644\u0623\u0648\u0644\u064A" : "Montant initial consign\xE9", value: money(dep.amountMinor, currency), highlight: true },
            { label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0642\u062A\u0637\u0639" : "Total retenu (dommages / frais)", value: money(dep.deductedAmountMinor, currency) },
            { label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0633\u062A\u0631\u062C\u0639 \u0644\u0644\u0632\u0628\u0648\u0646" : "Montant restitu\xE9 au client", value: money(dep.refundedAmountMinor, currency), highlight: true },
            { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0628\u0642\u064A \u0642\u064A\u062F \u0627\u0644\u062D\u062C\u0632" : "Solde encore bloqu\xE9", value: money(Math.max(0, dep.amountMinor - dep.deductedAmountMinor - dep.refundedAmountMinor), currency) }
          ]
        }
      ];
      if (params.documentKind === "DEPOSIT_SETTLEMENT" || det.movements.length > 0) {
        sections.push({
          type: "table",
          title: isAr ? "\u062D\u0631\u0643\u0627\u062A \u0627\u0644\u0643\u0641\u0627\u0644\u0629 \u0648\u0627\u0644\u0627\u0642\u062A\u0637\u0627\u0639\u0627\u062A" : "Journal des mouvements & d\xE9ductions",
          columns: [
            { key: "date", label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", widthWeight: 1 },
            { key: "type", label: isAr ? "\u0627\u0644\u0639\u0645\u0644\u064A\u0629" : "Op\xE9ration", widthWeight: 1 },
            { key: "reason", label: isAr ? "\u0627\u0644\u062A\u0628\u0631\u064A\u0631" : "Motif / Cat\xE9gorie", widthWeight: 1.8 },
            { key: "amount", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
          ],
          rows: det.movements.map((m) => ({
            date: dt(m.createdAt, false),
            type: `${m.movementType}${m.paymentMethod ? ` (${m.paymentMethod})` : ""}`,
            reason: [m.chargeCategory, m.reason].filter(Boolean).join(" \xB7 ") || "\u2014",
            amount: money(m.amountMinor, currency)
          }))
        });
      }
      sections.push({
        type: "text_block",
        title: isAr ? "\u062A\u0646\u0628\u064A\u0647 \u0642\u0627\u0646\u0648\u0646\u064A \u0648\u0645\u062D\u0627\u0633\u0628\u064A" : "Mention de garantie",
        muted: true,
        text: isAr ? "\u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0643\u0641\u0627\u0644\u0629 \u0643\u0623\u0645\u0627\u0646\u0629 \u0644\u0636\u0645\u0627\u0646 \u0633\u0644\u0627\u0645\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0648\u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A \u0627\u0644\u062A\u0639\u0627\u0642\u062F\u064A\u0629\u060C \u0648\u062A\u064F\u0631\u062F \u0639\u0646\u062F \u0627\u0644\u0625\u0631\u062C\u0627\u0639 \u0628\u0639\u062F \u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629." : "La caution constitue un d\xE9p\xF4t de garantie non assimil\xE9 \xE0 un loyer et est restitu\xE9e conform\xE9ment aux constatations de retour."
      });
      sections.push({
        type: "signatures",
        leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
        rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
        leftSubtitle: tpl.agencyName,
        rightSubtitle: dep.customerName
      });
      return {
        title,
        subtitle: `${dep.contractNumber} \xB7 ${dep.customerName}`,
        sections,
        links: { contractId: dep.contractId, depositId: dep.id, customerId: dep.customerId, vehicleId: dep.vehicleId }
      };
    }
    case "INVOICE": {
      if (!params.contractId) throw new AuthError("VALIDATION_ERROR", "Contrat requis pour \xE9mettre la facture");
      const detail = getContractDetail(db, params.contractId);
      const c = detail.contract;
      const custProf = getCustomerProfile(db, c.customerId);
      const customer = custProf.customer;
      const company = custProf.company;
      const veh = getVehicleProfile(db, c.vehicleId).vehicle;
      const currency = c.currency || "DZD";
      const taxRate = params.taxRatePercent ?? tpl.invoiceTaxRatePercent ?? 0;
      const grossSubtotal = c.baseRentalTotalMinor + c.extensionTotalMinor + c.extraKmChargeMinor + c.lateFeeMinor + c.damageChargeMinor + c.otherChargesMinor;
      const discount = c.discountMinor;
      const netHt = Math.max(0, grossSubtotal - discount);
      const taxMinor = Math.round(netHt * taxRate / 100);
      const totalTtc = netHt + taxMinor;
      const paidNet = detail.payments.reduce((s, p) => s + (p.direction === "INFLOW" ? p.amountMinor : -p.amountMinor), 0);
      const lineRows = [
        { item: isAr ? "\u0643\u0631\u0627\u0621 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A" : `Location v\xE9hicule (${veh.brand} ${veh.model} \xB7 ${veh.matricule})`, amount: money(c.baseRentalTotalMinor, currency) }
      ];
      if (c.extensionTotalMinor > 0) lineRows.push({ item: isAr ? "\u062A\u0645\u062F\u064A\u062F\u0627\u062A \u0627\u0644\u0639\u0642\u062F" : "Prolongations de contrat", amount: money(c.extensionTotalMinor, currency) });
      if (c.extraKmChargeMinor > 0) lineRows.push({ item: isAr ? "\u0643\u064A\u0644\u0648\u0645\u062A\u0631\u0627\u062A \u0625\u0636\u0627\u0641\u064A\u0629" : "Kilom\xE9trage suppl\xE9mentaire", amount: money(c.extraKmChargeMinor, currency) });
      if (c.lateFeeMinor > 0) lineRows.push({ item: isAr ? "\u063A\u0631\u0627\u0645\u0629 \u0627\u0644\u062A\u0623\u062E\u064A\u0631" : "Frais de retard", amount: money(c.lateFeeMinor, currency) });
      if (c.damageChargeMinor > 0) lineRows.push({ item: isAr ? "\u062A\u0639\u0648\u064A\u0636 \u0627\u0644\u0623\u0636\u0631\u0627\u0631" : "Refacturation dommages", amount: money(c.damageChargeMinor, currency) });
      if (c.otherChargesMinor > 0) lineRows.push({ item: isAr ? "\u0631\u0633\u0648\u0645 \u0623\u062E\u0631\u0649" : "Autres frais", amount: money(c.otherChargesMinor, currency) });
      if (discount > 0) lineRows.push({ item: isAr ? "\u062A\u062E\u0641\u064A\u0636 \u062A\u062C\u0627\u0631\u064A" : "Remise commerciale", amount: `-${money(discount, currency)}` });
      const issueDateIso = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      return {
        title,
        subtitle: `${c.contractNumber} \xB7 ${customer.fullName}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0648\u0627\u0644\u0632\u0628\u0648\u0646" : "Facturation & client",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Factur\xE9 \xE0", value: company?.companyName || customer.fullName, emphasize: true },
              { label: isAr ? "\u0627\u0644\u0639\u0642\u062F \u0627\u0644\u0645\u0631\u062C\u0639\u064A" : "Contrat de r\xE9f\xE9rence", value: num(c.contractNumber) },
              { label: isAr ? "\u0627\u0644\u0647\u0627\u062A\u0641 / \u0627\u0644\u0639\u0646\u0648\u0627\u0646" : "T\xE9l / Adresse", value: [num(customer.phone), customer.address].filter(Boolean).join(" \xB7 ") },
              ...company ? [{ label: isAr ? "\u0627\u0644\u0633\u062C\u0644 / \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062C\u0628\u0627\u0626\u064A \u0644\u0644\u0632\u0628\u0648\u0646" : "RC / NIF Client", value: [company.rcNumber, company.nifNumber].filter(Boolean).join(" \xB7 ") || "\u2014" }] : [{ label: isAr ? "\u0631\u0642\u0645 \u0627\u0644\u062A\u0639\u0631\u064A\u0641" : "CNI / Permis", value: num(customer.cniNumber || customer.drivingLicenceNumber) }]
            ]
          },
          {
            type: "table",
            title: isAr ? "\u062A\u0641\u0635\u064A\u0644 \u0627\u0644\u0628\u0646\u0648\u062F \u0627\u0644\u0645\u0641\u0648\u062A\u0631\u0629" : "D\xE9tail des prestations factur\xE9es",
            columns: [
              { key: "item", label: isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "D\xE9signation", widthWeight: 3 },
              { key: "amount", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1.2, align: isAr ? "left" : "right" }
            ],
            rows: lineRows
          },
          {
            type: "summary_box",
            title: isAr ? "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0648\u0627\u0644\u0631\u0635\u064A\u062F" : "R\xE9capitulatif facture",
            rows: [
              { label: isAr ? "\u0627\u0644\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0635\u0627\u0641\u064A" : "Total net HT", value: money(netHt, currency) },
              { label: isAr ? `\u0627\u0644\u0636\u0631\u064A\u0628\u0629 (${num(taxRate)}%)` : `Taxe / TVA (${num(taxRate)}%)`, value: money(taxMinor, currency) },
              { label: isAr ? "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0633\u062A\u062D\u0642" : "TOTAL FACTUR\xC9", value: money(totalTtc, currency), highlight: true },
              { label: isAr ? "\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u0633\u062F\u062F\u0629" : "D\xE9j\xE0 r\xE9gl\xE9", value: money(paidNet, currency) },
              { label: isAr ? "\u0627\u0644\u0628\u0627\u0642\u064A \u0644\u0644\u062F\u0641\u0639" : "Net \xE0 payer", value: money(Math.max(0, totalTtc - paidNet), currency), highlight: true }
            ]
          },
          {
            type: "text_block",
            title: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0629 \u0642\u0627\u0646\u0648\u0646\u064A\u0629" : "Mention de facturation",
            muted: true,
            text: (isAr ? tpl.invoiceDisclaimerAr : tpl.invoiceDisclaimerFr) + (tpl.invoiceFiscallyCompliant ? "" : isAr ? "\n(\u0648\u0636\u0639 \u0627\u0644\u0641\u0648\u062A\u0631\u0629 \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629 \u063A\u064A\u0631 \u0627\u0644\u062C\u0628\u0627\u0626\u064A\u0629)" : "\n(Statut : document de facturation interne selon param\xE9trage agence)")
          }
        ],
        links: { contractId: c.id, customerId: c.customerId, vehicleId: c.vehicleId },
        invoiceCreateData: {
          contractId: c.id,
          customerId: c.customerId,
          issueDate: issueDateIso,
          subtotalMinor: netHt,
          discountMinor: discount,
          taxRatePercent: taxRate,
          taxMinor,
          totalMinor: totalTtc,
          currency,
          isFiscallyCompliant: tpl.invoiceFiscallyCompliant,
          notes: params.notes ?? null
        }
      };
    }
    case "EXPENSE_RECEIPT": {
      if (!params.expenseId) throw new AuthError("VALIDATION_ERROR", "D\xE9pense requise");
      const e = db.prepare(
        `SELECT e.*, v.matricule, v.brand, v.model, s.name AS supplier_name, u.full_name AS recorded_by_name
           FROM expenses e
           LEFT JOIN vehicles v ON v.id = e.vehicle_id
           LEFT JOIN suppliers s ON s.id = e.supplier_id
           LEFT JOIN users u ON u.id = e.recorded_by_user_id
           WHERE e.id = ?`
      ).get(params.expenseId);
      if (!e) throw new AuthError("NOT_FOUND", "D\xE9pense introuvable");
      const currency = e.currency || "DZD";
      return {
        title,
        subtitle: `${e.expense_number} \xB7 ${e.category}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0635\u0631\u0648\u0641" : "D\xE9tails de la d\xE9pense",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0645\u0631\u062C\u0639" : "N\xB0 D\xE9pense", value: num(e.expense_number), emphasize: true },
              { label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", value: dt(e.expense_date) },
              { label: isAr ? "\u0627\u0644\u0641\u0626\u0629" : "Cat\xE9gorie", value: e.category },
              { label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", value: e.status || "POSTED" },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0627\u0644\u0645\u0639\u0646\u064A\u0629" : "V\xE9hicule affect\xE9", value: e.matricule ? `${e.brand} ${e.model} (${num(e.matricule)})` : isAr ? "\u0645\u0635\u0627\u0631\u064A\u0641 \u0639\u0627\u0645\u0629 \u0644\u0644\u0648\u0643\u0627\u0644\u0629" : "Charge g\xE9n\xE9rale agence" },
              { label: isAr ? "\u0627\u0644\u0645\u0648\u0631\u062F" : "Fournisseur", value: e.supplier_name || "\u2014" },
              { label: isAr ? "\u0648\u0633\u064A\u0644\u0629 \u0627\u0644\u062F\u0641\u0639" : "Moyen de paiement", value: `${e.payment_method}${e.payment_reference ? ` \xB7 ${e.payment_reference}` : ""}` },
              { label: isAr ? "\u0633\u062C\u0644\u062A \u0645\u0646 \u0637\u0631\u0641" : "Enregistr\xE9 par", value: e.recorded_by_name || "\u2014" }
            ]
          },
          {
            type: "summary_box",
            title: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0635\u0631\u0648\u0641" : "Montant engag\xE9",
            rows: [
              { label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" : "Montant de la d\xE9pense", value: money(Number(e.amount_minor), currency), highlight: true }
            ]
          },
          { type: "text_block", title: isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "Description / Objet", text: e.description }
        ],
        links: {
          expenseId: Number(e.id),
          vehicleId: e.vehicle_id != null ? Number(e.vehicle_id) : null,
          maintenanceRecordId: e.maintenance_record_id != null ? Number(e.maintenance_record_id) : null
        }
      };
    }
    case "MAINTENANCE_REPORT": {
      if (!params.maintenanceRecordId) throw new AuthError("VALIDATION_ERROR", "Intervention maintenance requise");
      const det = getMaintenanceRecordDetail(db, params.maintenanceRecordId);
      const r = det.record;
      return {
        title,
        subtitle: `${r.recordNumber || `MNT-${r.id}`} \xB7 ${r.vehicleMatricule}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u062F\u062E\u0644" : "Fiche d\u2019intervention",
            columns: 2,
            items: [
              { label: isAr ? "\u0631\u0642\u0645 \u0627\u0644\u062A\u062F\u062E\u0644" : "N\xB0 Intervention", value: num(r.recordNumber || `MNT-${r.id}`), emphasize: true },
              { label: isAr ? "\u0646\u0648\u0639 \u0627\u0644\u0635\u064A\u0627\u0646\u0629" : "Type", value: isAr ? r.maintenanceTypeNameAr : r.maintenanceTypeNameFr },
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", value: r.vehicleLabel, emphasize: true },
              { label: isAr ? "\u0627\u0644\u0639\u062F\u0627\u062F \u0627\u0644\u0645\u0633\u062C\u0644" : "Kilom\xE9trage relev\xE9", value: `${num(r.odometerKm)} km` },
              { label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date r\xE9alisation", value: dt(r.performedDate) },
              { label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", value: r.status },
              { label: isAr ? "\u0627\u0644\u0645\u0648\u0631\u062F / \u0627\u0644\u0648\u0631\u0634\u0629" : "Atelier / Fournisseur", value: r.supplierName || r.technicianName || "\u2014" },
              { label: isAr ? "\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0642\u0627\u062F\u0645" : "Prochaine \xE9ch\xE9ance", value: [dt(r.nextDueDate), r.nextDueOdometerKm != null ? `${num(r.nextDueOdometerKm)} km` : ""].filter(Boolean).join(" \xB7 ") }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631 \u0627\u0644\u0645\u0633\u062A\u0647\u0644\u0643\u0629 \u0645\u0646 \u0627\u0644\u0645\u062E\u0632\u0648\u0646" : "Pi\xE8ces d\xE9tach\xE9es consomm\xE9es",
            columns: [
              { key: "code", label: isAr ? "\u0627\u0644\u0631\u0645\u0632" : "R\xE9f.", widthWeight: 1 },
              { key: "name", label: isAr ? "\u0627\u0644\u0642\u0637\u0639\u0629" : "D\xE9signation", widthWeight: 1.8 },
              { key: "qty", label: isAr ? "\u0627\u0644\u0643\u0645\u064A\u0629" : "Qt\xE9", widthWeight: 0.7, align: "center" },
              { key: "unitCost", label: isAr ? "\u0633\u0639\u0631 \u0627\u0644\u0648\u062D\u062F\u0629" : "Co\xFBt unit.", widthWeight: 1, align: isAr ? "left" : "right" },
              { key: "total", label: isAr ? "\u0627\u0644\u0645\u062C\u0645\u0648\u0639" : "Sous-total", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: det.parts.map((pc) => ({
              code: pc.partCode,
              name: pc.partName,
              qty: num(pc.quantityUsed),
              unitCost: money(pc.unitCostMinor),
              total: money(pc.totalCostMinor)
            }))
          },
          {
            type: "summary_box",
            title: isAr ? "\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0635\u064A\u0627\u0646\u0629" : "R\xE9capitulatif des co\xFBts",
            rows: [
              { label: isAr ? "\u0627\u0644\u064A\u062F \u0627\u0644\u0639\u0627\u0645\u0644\u0629" : "Main d\u2019\u0153uvre", value: money(r.laborCostMinor) },
              { label: isAr ? "\u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631" : "Pi\xE8ces d\xE9tach\xE9es", value: money(r.partsCostMinor) },
              { label: isAr ? "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A\u0629" : "CO\xDBT TOTAL", value: money(r.totalCostMinor), highlight: true }
            ]
          },
          { type: "text_block", title: isAr ? "\u0627\u0644\u0623\u0634\u063A\u0627\u0644 \u0627\u0644\u0645\u0646\u062C\u0632\u0629" : "Travaux effectu\xE9s", text: [r.workDescription, r.notes].filter(Boolean).join("\n") }
        ],
        links: { maintenanceRecordId: r.id, vehicleId: r.vehicleId }
      };
    }
    case "VEHICLE_HISTORY": {
      if (!params.vehicleId) throw new AuthError("VALIDATION_ERROR", "V\xE9hicule requis");
      const vehProf = getVehicleProfile(db, params.vehicleId);
      const overview = getVehicleMaintenanceOverview(db, params.vehicleId);
      const v = vehProf.vehicle;
      const docs = db.prepare("SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expiration_date ASC").all(params.vehicleId);
      const contracts = db.prepare(
        `SELECT rc.contract_number, rc.status, rc.start_date, rc.expected_return_date, rc.total_contract_amount_minor, c.full_name
           FROM rental_contracts rc JOIN customers c ON c.id = rc.customer_id
           WHERE rc.vehicle_id = ? ORDER BY rc.start_date DESC LIMIT 40`
      ).all(params.vehicleId);
      const expenses = db.prepare("SELECT expense_number, expense_date, category, amount_minor, description FROM expenses WHERE vehicle_id = ? AND status = 'POSTED' ORDER BY expense_date DESC LIMIT 40").all(params.vehicleId);
      return {
        title,
        subtitle: `${v.brand} ${v.model} (${v.matricule})`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "Fiche technique du v\xE9hicule",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "Mod\xE8le", value: `${v.brand} ${v.model} (${num(v.year)})`, emphasize: true },
              { label: isAr ? "\u0627\u0644\u062A\u0631\u0642\u064A\u0645" : "Matricule", value: num(v.matricule), emphasize: true },
              { label: "VIN", value: num(v.vin) },
              { label: isAr ? "\u0627\u0644\u0639\u062F\u0627\u062F \u0627\u0644\u062D\u0627\u0644\u064A" : "Kilom\xE9trage actuel", value: `${num(v.currentOdometerKm)} km` },
              { label: isAr ? "\u0627\u0644\u0641\u0626\u0629 / \u0627\u0644\u062D\u0627\u0644\u0629" : "Cat\xE9gorie / Statut", value: `${v.category} \xB7 ${v.status}` },
              { label: isAr ? "\u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u064A\u0648\u0645\u064A \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A" : "Tarif journalier", value: money(v.defaultDailyRateMinor) }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u0627\u0644\u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u0625\u062F\u0627\u0631\u064A\u0629" : "Documents administratifs",
            columns: [
              { key: "docType", label: isAr ? "\u0627\u0644\u0648\u062B\u064A\u0642\u0629" : "Type", widthWeight: 1.2 },
              { key: "num", label: isAr ? "\u0627\u0644\u0631\u0642\u0645" : "N\xB0", widthWeight: 1.2 },
              { key: "exp", label: isAr ? "\u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629" : "Expiration", widthWeight: 1 }
            ],
            rows: docs.map((d) => ({ docType: d.doc_type, num: d.document_number || "\u2014", exp: dt(d.expiration_date) }))
          },
          {
            type: "table",
            title: isAr ? "\u0633\u062C\u0644 \u0627\u0644\u0639\u0642\u0648\u062F" : "Historique des locations",
            columns: [
              { key: "num", label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", widthWeight: 1 },
              { key: "cust", label: isAr ? "\u0627\u0644\u0632\u0628\u0648\u0646" : "Client", widthWeight: 1.5 },
              { key: "period", label: isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "P\xE9riode", widthWeight: 1.4 },
              { key: "total", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: contracts.map((c) => ({
              num: c.contract_number,
              cust: c.full_name,
              period: `${dt(c.start_date)} -> ${dt(c.expected_return_date)}`,
              total: money(Number(c.total_contract_amount_minor))
            }))
          },
          {
            type: "table",
            title: isAr ? "\u0633\u062C\u0644 \u0627\u0644\u0635\u064A\u0627\u0646\u0629" : "Historique de maintenance",
            columns: [
              { key: "date", label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", widthWeight: 0.9 },
              { key: "type", label: isAr ? "\u0627\u0644\u0639\u0645\u0644\u064A\u0629" : "Intervention", widthWeight: 1.5 },
              { key: "km", label: isAr ? "\u0627\u0644\u0639\u062F\u0627\u062F" : "Km", widthWeight: 0.8 },
              { key: "cost", label: isAr ? "\u0627\u0644\u062A\u0643\u0644\u0641\u0629" : "Co\xFBt", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: overview.records.slice(0, 40).map((mr) => ({
              date: dt(mr.performedDate),
              type: mr.workDescription,
              km: `${num(mr.odometerKm)} km`,
              cost: money(mr.totalCostMinor)
            }))
          },
          {
            type: "table",
            title: isAr ? "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "D\xE9penses directes affect\xE9es",
            columns: [
              { key: "ref", label: isAr ? "\u0627\u0644\u0645\u0631\u062C\u0639" : "R\xE9f.", widthWeight: 1 },
              { key: "date", label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", widthWeight: 0.9 },
              { key: "cat", label: isAr ? "\u0627\u0644\u0641\u0626\u0629" : "Cat\xE9gorie", widthWeight: 1 },
              { key: "amt", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: expenses.map((ex) => ({
              ref: ex.expense_number,
              date: dt(ex.expense_date),
              cat: ex.category,
              amt: money(Number(ex.amount_minor))
            }))
          }
        ],
        links: { vehicleId: params.vehicleId }
      };
    }
    case "CUSTOMER_STATEMENT": {
      if (!params.customerId) throw new AuthError("VALIDATION_ERROR", "Client requis pour le relev\xE9 de compte");
      const profile = getCustomerProfile(db, params.customerId);
      const cust = profile.customer;
      const fin = computeCustomerFinancialMetrics(db, params.customerId);
      const payments = db.prepare(
        `SELECT cp.receipt_number, cp.payment_date, cp.direction, cp.method, cp.amount_minor, cp.currency, rc.contract_number
           FROM contract_payments cp
           JOIN rental_contracts rc ON rc.id = cp.contract_id
           WHERE rc.customer_id = ?
           ORDER BY cp.payment_date DESC, cp.id DESC`
      ).all(params.customerId);
      const adjustments = db.prepare(
        `SELECT adjustment_date, adjustment_type, amount_minor, currency, reason
           FROM customer_financial_adjustments WHERE customer_id = ? ORDER BY adjustment_date DESC`
      ).all(params.customerId);
      return {
        title,
        subtitle: `${cust.fullName} \xB7 ${cust.phone}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0632\u0628\u0648\u0646" : "Identification du client",
            columns: 2,
            items: [
              { label: isAr ? "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644" : "Client", value: cust.fullName, emphasize: true },
              { label: isAr ? "\u0627\u0644\u0647\u0627\u062A\u0641" : "T\xE9l\xE9phone", value: num(cust.phone) },
              { label: isAr ? "\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0645\u062E\u0627\u0637\u0631" : "Niveau de risque", value: cust.riskStatus },
              { label: isAr ? "\u0627\u0644\u0639\u0646\u0648\u0627\u0646" : "Adresse", value: cust.address || "\u2014" }
            ]
          },
          {
            type: "summary_box",
            title: isAr ? "\u0645\u0644\u062E\u0635 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0627\u0644\u064A" : "Situation financi\xE8re globale",
            rows: [
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0639\u0642\u0648\u062F \u0627\u0644\u0645\u0633\u062A\u062D\u0642\u0629" : "Total factur\xE9 (Contrats)", value: money(fin.totalChargedMinor) },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0635\u0627\u0641\u064A\u0629" : "Ajustements nets (Avoirs / D\xE9bits)", value: money(fin.debitAdjustmentsMinor - fin.creditAndWriteOffMinor) },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u0641\u0648\u0639 \u0627\u0644\u0635\u0627\u0641\u064A" : "Total r\xE9gl\xE9 net", value: money(fin.netPaidMinor) },
              { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0645\u062A\u0628\u0642\u064A \u0644\u0644\u062F\u0641\u0639" : "SOLDE RESTANT D\xDB", value: money(fin.outstandingBalanceMinor), highlight: true },
              { label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u062A\u0623\u062E\u0631 \u0639\u0646 \u0627\u0644\u0633\u062F\u0627\u062F" : "Dont solde \xE9chu / en retard", value: money(fin.overdueDebtMinor) },
              { label: isAr ? "\u0627\u0644\u0643\u0641\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u062D\u062C\u0648\u0632\u0629 \u062D\u0627\u0644\u064A\u0627\u064B" : "Cautions actuellement d\xE9tenues", value: money(fin.heldDepositsMinor) }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u0633\u062C\u0644 \u0627\u0644\u0639\u0642\u0648\u062F" : "Contrats du client",
            columns: [
              { key: "num", label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", widthWeight: 1 },
              { key: "veh", label: isAr ? "\u0627\u0644\u0645\u0631\u0643\u0628\u0629" : "V\xE9hicule", widthWeight: 1.5 },
              { key: "dates", label: isAr ? "\u0627\u0644\u0641\u062A\u0631\u0629" : "P\xE9riode", widthWeight: 1.3 },
              { key: "status", label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", widthWeight: 0.8 },
              { key: "total", label: isAr ? "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: profile.rentalHistory.map((r) => ({
              num: r.contractNumber,
              veh: r.vehicleLabel,
              dates: `${dt(r.startDate)} -> ${dt(r.expectedReturnDate)}`,
              status: r.status,
              total: money(r.totalContractAmountMinor, r.currency)
            }))
          },
          {
            type: "table",
            title: isAr ? "\u0633\u062C\u0644 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0627\u062A \u0648\u0627\u0644\u0627\u0633\u062A\u0631\u062C\u0627\u0639\u0627\u062A" : "Paiements & remboursements",
            columns: [
              { key: "rec", label: isAr ? "\u0627\u0644\u0648\u0635\u0644" : "Re\xE7u", widthWeight: 1 },
              { key: "date", label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", widthWeight: 0.9 },
              { key: "ctr", label: isAr ? "\u0627\u0644\u0639\u0642\u062F" : "Contrat", widthWeight: 1 },
              { key: "dir", label: isAr ? "\u0627\u0644\u0639\u0645\u0644\u064A\u0629" : "Type", widthWeight: 1 },
              { key: "amt", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: payments.map((p) => ({
              rec: p.receipt_number,
              date: dt(p.payment_date),
              ctr: p.contract_number,
              dir: `${p.direction} (${p.method})`,
              amt: money(Number(p.amount_minor), p.currency || "DZD")
            }))
          },
          ...adjustments.length > 0 ? [
            {
              type: "table",
              title: isAr ? "\u0627\u0644\u062A\u0633\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u0627\u0644\u064A\u0629" : "Ajustements & avoirs",
              columns: [
                { key: "date", label: isAr ? "\u0627\u0644\u062A\u0627\u0631\u064A\u062E" : "Date", widthWeight: 0.9 },
                { key: "type", label: isAr ? "\u0627\u0644\u0646\u0648\u0639" : "Type", widthWeight: 1 },
                { key: "reason", label: isAr ? "\u0627\u0644\u0633\u0628\u0628" : "Motif", widthWeight: 1.8 },
                { key: "amt", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
              ],
              rows: adjustments.map((a) => ({
                date: dt(a.adjustment_date),
                type: a.adjustment_type,
                reason: a.reason,
                amt: money(Number(a.amount_minor), a.currency || "DZD")
              }))
            }
          ] : []
        ],
        links: { customerId: cust.id }
      };
    }
    case "CASH_REGISTER_CLOSING": {
      let sid = params.cashSessionId ?? null;
      if (!sid) {
        const latest = db.prepare("SELECT id FROM cash_register_sessions ORDER BY id DESC LIMIT 1").get();
        sid = latest?.id ?? null;
      }
      if (!sid) throw new AuthError("NOT_FOUND", "Aucune session de caisse disponible");
      const det = getCashSessionDetail(db, sid);
      const s = det.session;
      return {
        title,
        subtitle: `${s.sessionDate} \xB7 ${s.status}`,
        sections: [
          {
            type: "kv_grid",
            title: isAr ? "\u0628\u064A\u0627\u0646\u0627\u062A \u062C\u0644\u0633\u0629 \u0627\u0644\u0635\u0646\u062F\u0648\u0642" : "Identification de la session de caisse",
            columns: 2,
            items: [
              { label: isAr ? "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062C\u0644\u0633\u0629" : "Date session", value: dt(s.sessionDate), emphasize: true },
              { label: isAr ? "\u0627\u0644\u062D\u0627\u0644\u0629" : "Statut", value: s.status },
              { label: isAr ? "\u0641\u062A\u062D \u0628\u0648\u0627\u0633\u0637\u0629" : "Ouverte par", value: `${s.openedByUsername || "\u2014"} (${dt(s.openedAt, true)})` },
              { label: isAr ? "\u0625\u063A\u0644\u0627\u0642 \u0628\u0648\u0627\u0633\u0637\u0629" : "Cl\xF4tur\xE9e par", value: s.closedByUsername ? `${s.closedByUsername} (${dt(s.closedAt, true)})` : "\u2014" }
            ]
          },
          {
            type: "summary_box",
            title: isAr ? "\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0646\u0642\u062F\u064A\u0629" : "R\xE9conciliation de caisse",
            rows: [
              { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0627\u0641\u062A\u062A\u0627\u062D\u064A" : "Fond d\u2019ouverture", value: money(s.openingBalanceMinor) },
              { label: isAr ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u0627\u062E\u064A\u0644 \u0627\u0644\u0646\u0642\u062F\u064A\u0629" : "Total encaissements esp\xE8ces", value: money(s.cashReceivedMinor) },
              { label: isAr ? "\u0627\u0644\u0645\u0628\u0627\u0644\u063A \u0627\u0644\u0645\u0633\u062A\u0631\u062C\u0639\u0629 \u0646\u0642\u062F\u0627\u064B" : "Remboursements esp\xE8ces", value: `-${money(s.cashRefundedMinor)}` },
              { label: isAr ? "\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0646\u0642\u062F\u064A\u0629" : "D\xE9penses en esp\xE8ces", value: `-${money(s.cashExpensesMinor)}` },
              { label: isAr ? "\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0635\u0646\u062F\u0648\u0642" : "Ajustements manuels", value: money(s.cashAdjustmentsMinor ?? 0) },
              { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0646\u0638\u0631\u064A \u0627\u0644\u0645\u062A\u0648\u0642\u0639" : "SOLDE TH\xC9ORIQUE ATTENDU", value: money(s.expectedClosingMinor), highlight: true },
              { label: isAr ? "\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0641\u0639\u0644\u064A \u0627\u0644\u0645\u0639\u062F\u0648\u062F" : "SOLDE R\xC9EL COMPT\xC9", value: s.actualClosingMinor != null ? money(s.actualClosingMinor) : "\u2014", highlight: true },
              { label: isAr ? "\u0641\u0627\u0631\u0642 \u0627\u0644\u0635\u0646\u062F\u0648\u0642" : "\xC9cart de caisse", value: s.discrepancyMinor != null ? money(s.discrepancyMinor) : "\u2014" }
            ]
          },
          {
            type: "table",
            title: isAr ? "\u062A\u0641\u0635\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0627\u062A \u0627\u0644\u0646\u0642\u062F\u064A\u0629" : "Mouvements de caisse enregistr\xE9s",
            columns: [
              { key: "time", label: isAr ? "\u0627\u0644\u0648\u0642\u062A" : "Horodatage", widthWeight: 1.1 },
              { key: "type", label: isAr ? "\u0627\u0644\u0646\u0648\u0639" : "Type", widthWeight: 1.2 },
              { key: "desc", label: isAr ? "\u0627\u0644\u0628\u064A\u0627\u0646" : "Libell\xE9", widthWeight: 2 },
              { key: "amt", label: isAr ? "\u0627\u0644\u0645\u0628\u0644\u063A" : "Montant", widthWeight: 1, align: isAr ? "left" : "right" }
            ],
            rows: det.movements.map((m) => ({
              time: dt(m.createdAt, true),
              type: m.movementType,
              desc: m.description || "\u2014",
              amt: money(m.amountMinor)
            }))
          },
          ...s.discrepancyNotes || s.openingNotes ? [{ type: "text_block", title: isAr ? "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u0625\u063A\u0644\u0627\u0642" : "Observations ouverture / cl\xF4ture", text: [s.openingNotes, s.discrepancyNotes].filter(Boolean).join("\n") }] : [],
          {
            type: "signatures",
            leftLabel: isAr ? "\u0623\u0645\u064A\u0646 \u0627\u0644\u0635\u0646\u062F\u0648\u0642 / \u0627\u0644\u0648\u0643\u064A\u0644" : "Caissier / Agent",
            rightLabel: isAr ? "\u0627\u0644\u0645\u062F\u064A\u0631 / \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629" : "Visa Direction",
            leftSubtitle: s.openedByUsername || "\u2014",
            rightSubtitle: s.closedByUsername || tpl.agencyName
          }
        ],
        links: { cashSessionId: s.id }
      };
    }
    case "FINANCIAL_SUMMARY":
    case "CUSTOM_REPORT": {
      const effectiveFilter = params.reportFilter ?? {
        category: params.documentKind === "FINANCIAL_SUMMARY" ? "FINANCIAL" : "CUSTOM",
        dateFrom: params.dateFrom ?? void 0,
        dateTo: params.dateTo ?? void 0,
        customerId: params.customerId ?? void 0,
        vehicleId: params.vehicleId ?? void 0,
        language: lang
      };
      const dataset = generateReportDataset(db, { ...effectiveFilter, language: lang });
      return {
        title: isAr ? dataset.titleAr : dataset.titleFr,
        subtitle: `${dt(dataset.appliedFilters.dateFrom)} -> ${dt(dataset.appliedFilters.dateTo)}`,
        sections: reportDatasetToPdfSections(dataset, lang, numSys),
        links: {
          customerId: effectiveFilter.customerId ?? null,
          vehicleId: effectiveFilter.vehicleId ?? null
        }
      };
    }
  }
}

// electron/database/services/documentService.ts
function allocateDocumentNumber(db, prefix) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9-]/g, "").toUpperCase() || "DOC";
  const pattern = `${cleanPrefix}-${year}-%`;
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM generated_documents WHERE document_number LIKE ?").get(pattern);
  let seq = Number(row?.cnt ?? 0) + 1;
  while (true) {
    const candidate = `${cleanPrefix}-${year}-${String(seq).padStart(4, "0")}`;
    const exists = db.prepare("SELECT id FROM generated_documents WHERE document_number = ?").get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}
function allocateInvoiceNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE ?").get(`INV-${year}-%`);
  let seq = Number(row?.cnt ?? 0) + 1;
  while (true) {
    const candidate = `INV-${year}-${String(seq).padStart(4, "0")}`;
    const exists = db.prepare("SELECT id FROM invoices WHERE invoice_number = ?").get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}
function mapGeneratedDocument(r) {
  return {
    id: Number(r.id),
    documentNumber: r.document_number,
    documentKind: r.document_kind,
    format: r.format,
    title: r.title || r.document_number,
    language: r.language === "ar" ? "ar" : "fr",
    numeralSystem: r.numeral_system === "arabic" ? "arabic" : "latin",
    contractId: r.contract_id != null ? Number(r.contract_id) : null,
    paymentId: r.payment_id != null ? Number(r.payment_id) : null,
    depositId: r.deposit_id != null ? Number(r.deposit_id) : null,
    inspectionId: r.inspection_id != null ? Number(r.inspection_id) : null,
    invoiceId: r.invoice_id != null ? Number(r.invoice_id) : null,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    vehicleId: r.vehicle_id != null ? Number(r.vehicle_id) : null,
    maintenanceRecordId: r.maintenance_record_id != null ? Number(r.maintenance_record_id) : null,
    expenseId: r.expense_id != null ? Number(r.expense_id) : null,
    cashSessionId: r.cash_session_id != null ? Number(r.cash_session_id) : null,
    isCopy: Number(r.is_copy ?? 0) === 1,
    sourceDocumentId: r.source_document_id != null ? Number(r.source_document_id) : null,
    sourceDocumentNumber: r.source_document_number ?? null,
    reprintCount: Number(r.reprint_count ?? 0),
    templateVersion: Number(r.template_version ?? 1),
    generationStatus: r.generation_status === "FAILED" ? "FAILED" : "READY",
    filePath: r.file_path,
    originalFileName: r.original_file_name || `${r.document_number}.pdf`,
    mimeType: r.mime_type || "application/pdf",
    fileSizeBytes: Number(r.file_size_bytes ?? 0),
    sha256Hash: r.sha256_hash ?? null,
    generatedByUserId: Number(r.generated_by_user_id),
    generatedByUsername: r.generated_by_username || "system",
    lastPrintedAt: r.last_printed_at ?? null,
    lastPrintedByUserId: r.last_printed_by_user_id != null ? Number(r.last_printed_by_user_id) : null,
    customerName: r.customer_name ?? null,
    vehicleLabel: r.vehicle_label ?? null,
    contractNumber: r.contract_number ?? null,
    createdAt: r.created_at
  };
}
function loadAgencyLogoFromVault(template, vaultRootDir, vaultKey) {
  if (!template.logoVaultPath || !template.logoMimeType) return null;
  try {
    const full = resolveConfinedPath(vaultRootDir, template.logoVaultPath);
    if (!import_node_fs12.default.existsSync(full)) return null;
    const dec = decryptBuffer(import_node_fs12.default.readFileSync(full), vaultKey);
    return { bytes: dec, mimeType: template.logoMimeType };
  } catch {
    return null;
  }
}
function getDocumentTemplateConfig(db) {
  return loadTemplateConfigFromDb(db);
}
function updateDocumentTemplateConfig(db, actor, input) {
  const current = loadTemplateConfigFromDb(db);
  const updates = [
    {
      key: "documents.template_version",
      group: "documents",
      value: String(current.templateVersion + 1)
    }
  ];
  const add = (key, val) => {
    if (val !== void 0) updates.push({ key, group: "documents", value: val });
  };
  add("documents.default_language", input.defaultLanguage);
  add("documents.default_format", input.defaultFormat);
  add("documents.thermal_width", input.thermalWidth);
  add("documents.default_printer_a4", input.defaultPrinterA4);
  add("documents.default_printer_thermal", input.defaultPrinterThermal);
  if (input.showLogo !== void 0) add("documents.show_logo", input.showLogo ? "1" : "0");
  if (input.showFiscalIds !== void 0) add("documents.show_fiscal_ids", input.showFiscalIds ? "1" : "0");
  if (input.showSignatureBoxes !== void 0) add("documents.show_signature_boxes", input.showSignatureBoxes ? "1" : "0");
  if (input.invoiceFiscallyCompliant !== void 0) add("documents.invoice_fiscally_compliant", input.invoiceFiscallyCompliant ? "1" : "0");
  if (input.invoiceTaxRatePercent !== void 0) add("documents.invoice_tax_rate_percent", String(input.invoiceTaxRatePercent));
  add("documents.footer_fr", input.footerFr);
  add("documents.footer_ar", input.footerAr);
  add("documents.signature_agency_fr", input.signatureAgencyFr);
  add("documents.signature_agency_ar", input.signatureAgencyAr);
  add("documents.signature_customer_fr", input.signatureCustomerFr);
  add("documents.signature_customer_ar", input.signatureCustomerAr);
  add("documents.contract_terms_fr", input.contractTermsFr);
  add("documents.contract_terms_ar", input.contractTermsAr);
  add("documents.invoice_disclaimer_fr", input.invoiceDisclaimerFr);
  add("documents.invoice_disclaimer_ar", input.invoiceDisclaimerAr);
  if (input.prefixes) {
    for (const kind of ALL_DOCUMENT_KINDS) {
      const p = input.prefixes[kind];
      if (p) add(`documents.prefix_${kind}`, p.toUpperCase());
    }
  }
  updateSettingsBatch(db, actor, updates);
  return loadTemplateConfigFromDb(db);
}
function uploadAgencyLogo(db, actor, vaultRootDir, vaultKey, input) {
  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    allowedMimes: ["image/png", "image/jpeg"],
    maxBytes: 3 * 1024 * 1024
  });
  const encrypted = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `agency_logo_${import_node_crypto10.default.randomUUID()}.enc`;
  const relativePath = import_node_path13.default.join("branding", opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  import_node_fs12.default.mkdirSync(import_node_path13.default.dirname(fullPath), { recursive: true });
  import_node_fs12.default.writeFileSync(fullPath, encrypted, { mode: 384 });
  updateSettingsBatch(db, actor, [
    { key: "agency.logo_vault_path", group: "agency", value: relativePath },
    { key: "agency.logo_mime_type", group: "agency", value: validated.mimeType }
  ]);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "AGENCY_LOGO_UPDATED",
    entityType: "application_settings",
    entityId: "agency.logo_vault_path",
    newValue: { mimeType: validated.mimeType, originalFileName: validated.safeFileName }
  });
  return loadTemplateConfigFromDb(db);
}
function readAgencyLogo(db, vaultRootDir, vaultKey) {
  const tpl = loadTemplateConfigFromDb(db);
  const loaded = loadAgencyLogoFromVault(tpl, vaultRootDir, vaultKey);
  if (!loaded) return null;
  return { mimeType: loaded.mimeType, base64Data: loaded.bytes.toString("base64") };
}
async function generateAndArchiveDocument(db, actor, vaultRootDir, vaultKey, input) {
  const template = loadTemplateConfigFromDb(db);
  const language = input.language ?? template.defaultLanguage ?? "fr";
  const numeralSystem = input.numeralSystem ?? "latin";
  const format = input.format ?? (input.documentKind === "FINANCIAL_SUMMARY" || input.documentKind === "CUSTOM_REPORT" ? template.defaultFormat : "A4_PDF");
  const built = buildDocumentContentFromDb(db, {
    documentKind: input.documentKind,
    language,
    numeralSystem,
    template,
    contractId: input.contractId,
    extensionId: input.extensionId,
    paymentId: input.paymentId,
    depositId: input.depositId,
    inspectionId: input.inspectionId,
    invoiceId: input.invoiceId,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    maintenanceRecordId: input.maintenanceRecordId,
    expenseId: input.expenseId,
    cashSessionId: input.cashSessionId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    reportFilter: input.reportFilter,
    notes: input.notes,
    taxRatePercent: input.taxRatePercent
  });
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const issueDateDisplay = formatDateForDoc(nowIso, language, numeralSystem, true);
  const prefix = template.prefixes[input.documentKind] || "DOC";
  const documentNumber = allocateDocumentNumber(db, prefix);
  const logoBytes = loadAgencyLogoFromVault(template, vaultRootDir, vaultKey);
  const payload = {
    documentNumber,
    title: built.title,
    subtitle: built.subtitle,
    issueDateDisplay,
    format,
    language,
    numeralSystem,
    isCopy: false,
    template,
    logoBytes,
    sections: built.sections
  };
  const pdfBytes = Buffer.from(await renderDocumentToPdf(payload));
  const sha256Hash = import_node_crypto10.default.createHash("sha256").update(pdfBytes).digest("hex");
  const encryptedBytes = encryptBuffer(pdfBytes, vaultKey);
  const opaqueFileName = `doc_${documentNumber}_${import_node_crypto10.default.randomUUID()}.pdf.enc`;
  const relativePath = import_node_path13.default.join("documents", opaqueFileName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  import_node_fs12.default.mkdirSync(import_node_path13.default.dirname(fullPath), { recursive: true });
  import_node_fs12.default.writeFileSync(fullPath, encryptedBytes, { mode: 384 });
  const snapshot = {
    title: built.title,
    subtitle: built.subtitle ?? null,
    issueDateDisplay,
    sections: built.sections
  };
  const tx = db.transaction(() => {
    let createdInvoice2 = null;
    let effectiveInvoiceId = built.links.invoiceId ?? input.invoiceId ?? null;
    if (input.documentKind === "INVOICE" && built.invoiceCreateData && !effectiveInvoiceId) {
      const invNum = allocateInvoiceNumber(db);
      const invData = built.invoiceCreateData;
      const invRes = db.prepare(
        `INSERT INTO invoices (
            invoice_number, contract_id, customer_id, issue_date,
            subtotal_minor, discount_minor, tax_rate_percent, tax_minor, total_minor,
            currency, is_fiscally_compliant, pdf_file_path, notes, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invNum,
        invData.contractId,
        invData.customerId,
        invData.issueDate,
        invData.subtotalMinor,
        invData.discountMinor,
        invData.taxRatePercent,
        invData.taxMinor,
        invData.totalMinor,
        invData.currency,
        invData.isFiscallyCompliant ? 1 : 0,
        relativePath,
        invData.notes,
        actor.id
      );
      effectiveInvoiceId = Number(invRes.lastInsertRowid);
      const invRow = db.prepare("SELECT * FROM invoices WHERE id = ?").get(effectiveInvoiceId);
      createdInvoice2 = {
        id: Number(invRow.id),
        invoiceNumber: invRow.invoice_number,
        contractId: Number(invRow.contract_id),
        customerId: Number(invRow.customer_id),
        issueDate: invRow.issue_date,
        subtotalMinor: Number(invRow.subtotal_minor),
        discountMinor: Number(invRow.discount_minor ?? 0),
        taxMinor: Number(invRow.tax_minor),
        taxRatePercent: Number(invRow.tax_rate_percent ?? 0),
        totalMinor: Number(invRow.total_minor),
        currency: invRow.currency || "DZD",
        isFiscallyCompliant: Number(invRow.is_fiscally_compliant) === 1,
        pdfFilePath: invRow.pdf_file_path ?? null,
        notes: invRow.notes ?? null,
        createdByUserId: Number(invRow.created_by_user_id),
        createdAt: invRow.created_at
      };
    }
    const res = db.prepare(
      `INSERT INTO generated_documents (
          document_number, document_kind, format, title, language, numeral_system,
          contract_id, payment_id, deposit_id, inspection_id, invoice_id,
          customer_id, vehicle_id, maintenance_record_id, expense_id, cash_session_id,
          is_copy, source_document_id, reprint_count, template_version, generation_status,
          file_path, original_file_name, mime_type, file_size_bytes, sha256_hash,
          metadata_snapshot_json, template_snapshot_json,
          generated_by_user_id, generated_by_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, 'READY', ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)`
    ).run(
      documentNumber,
      input.documentKind,
      format,
      built.title,
      language,
      numeralSystem,
      built.links.contractId ?? null,
      built.links.paymentId ?? null,
      built.links.depositId ?? null,
      built.links.inspectionId ?? null,
      effectiveInvoiceId,
      built.links.customerId ?? null,
      built.links.vehicleId ?? null,
      built.links.maintenanceRecordId ?? null,
      built.links.expenseId ?? null,
      built.links.cashSessionId ?? null,
      template.templateVersion,
      relativePath,
      `${documentNumber}.pdf`,
      pdfBytes.length,
      sha256Hash,
      JSON.stringify(snapshot),
      JSON.stringify(template),
      actor.id,
      actor.username
    );
    const docId2 = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "DOCUMENT_GENERATED",
      entityType: "generated_documents",
      entityId: docId2,
      newValue: {
        documentNumber,
        documentKind: input.documentKind,
        format,
        language,
        sha256Hash,
        invoiceId: effectiveInvoiceId
      }
    });
    return { docId: docId2, createdInvoice: createdInvoice2 };
  });
  const { docId, createdInvoice } = tx();
  return {
    document: getDocumentById(db, docId),
    invoice: createdInvoice,
    pdfBase64: pdfBytes.toString("base64")
  };
}
async function reprintArchivedDocument(db, actor, vaultRootDir, vaultKey, input) {
  const requestedRow = db.prepare("SELECT * FROM generated_documents WHERE id = ?").get(input.sourceDocumentId);
  if (!requestedRow) throw new AuthError("NOT_FOUND", "Document archive introuvable");
  const canonicalId = requestedRow.source_document_id != null ? Number(requestedRow.source_document_id) : Number(requestedRow.id);
  const canonicalRow = db.prepare("SELECT * FROM generated_documents WHERE id = ?").get(canonicalId);
  if (!canonicalRow) throw new AuthError("NOT_FOUND", "Document source original introuvable");
  let snapshot = {};
  let templateSnap = loadTemplateConfigFromDb(db);
  try {
    snapshot = JSON.parse(canonicalRow.metadata_snapshot_json || "{}");
  } catch {
    snapshot = {};
  }
  try {
    const parsedTpl = JSON.parse(canonicalRow.template_snapshot_json || "{}");
    if (parsedTpl && parsedTpl.agencyName) {
      templateSnap = { ...templateSnap, ...parsedTpl };
    }
  } catch {
  }
  if (!Array.isArray(snapshot.sections)) {
    throw new AuthError("VALIDATION_ERROR", "Ce document archiv\xE9 ne contient pas de instantan\xE9 r\xE9\xE9ditable.");
  }
  const nextCopyNumber = Number(canonicalRow.reprint_count ?? 0) + 1;
  const copyDocNumber = `${canonicalRow.document_number}-C${String(nextCopyNumber).padStart(2, "0")}`;
  const format = input.format ?? canonicalRow.format;
  const language = input.language ?? canonicalRow.language ?? "fr";
  const numeralSystem = canonicalRow.numeral_system === "arabic" ? "arabic" : "latin";
  const logoBytes = loadAgencyLogoFromVault(templateSnap, vaultRootDir, vaultKey);
  const payload = {
    documentNumber: copyDocNumber,
    title: snapshot.title || canonicalRow.title || canonicalRow.document_number,
    subtitle: snapshot.subtitle ?? void 0,
    issueDateDisplay: snapshot.issueDateDisplay || formatDateForDoc(canonicalRow.created_at, language, numeralSystem, true),
    format,
    language,
    numeralSystem,
    isCopy: true,
    sourceDocumentNumber: canonicalRow.document_number,
    copyNumber: nextCopyNumber,
    template: templateSnap,
    logoBytes,
    sections: snapshot.sections
  };
  const pdfBytes = Buffer.from(await renderDocumentToPdf(payload));
  const sha256Hash = import_node_crypto10.default.createHash("sha256").update(pdfBytes).digest("hex");
  const encrypted = encryptBuffer(pdfBytes, vaultKey);
  const opaqueFileName = `doc_${copyDocNumber}_${import_node_crypto10.default.randomUUID()}.pdf.enc`;
  const relativePath = import_node_path13.default.join("documents", opaqueFileName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);
  import_node_fs12.default.mkdirSync(import_node_path13.default.dirname(fullPath), { recursive: true });
  import_node_fs12.default.writeFileSync(fullPath, encrypted, { mode: 384 });
  const copyId = db.transaction(() => {
    db.prepare("UPDATE generated_documents SET reprint_count = reprint_count + 1 WHERE id = ?").run(canonicalId);
    const res = db.prepare(
      `INSERT INTO generated_documents (
          document_number, document_kind, format, title, language, numeral_system,
          contract_id, payment_id, deposit_id, inspection_id, invoice_id,
          customer_id, vehicle_id, maintenance_record_id, expense_id, cash_session_id,
          is_copy, source_document_id, reprint_count, template_version, generation_status,
          file_path, original_file_name, mime_type, file_size_bytes, sha256_hash,
          metadata_snapshot_json, template_snapshot_json,
          generated_by_user_id, generated_by_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, 'READY', ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)`
    ).run(
      copyDocNumber,
      canonicalRow.document_kind,
      format,
      payload.title,
      language,
      numeralSystem,
      canonicalRow.contract_id,
      canonicalRow.payment_id,
      canonicalRow.deposit_id,
      canonicalRow.inspection_id,
      canonicalRow.invoice_id,
      canonicalRow.customer_id,
      canonicalRow.vehicle_id,
      canonicalRow.maintenance_record_id,
      canonicalRow.expense_id,
      canonicalRow.cash_session_id,
      canonicalId,
      Number(canonicalRow.template_version ?? 1),
      relativePath,
      `${copyDocNumber}.pdf`,
      pdfBytes.length,
      sha256Hash,
      canonicalRow.metadata_snapshot_json,
      canonicalRow.template_snapshot_json,
      actor.id,
      actor.username
    );
    const newId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "DOCUMENT_REPRINTED",
      entityType: "generated_documents",
      entityId: newId,
      previousValue: { sourceDocumentId: canonicalId, sourceDocumentNumber: canonicalRow.document_number },
      newValue: { copyDocumentNumber: copyDocNumber, copyNumber: nextCopyNumber, format, language }
    });
    return newId;
  })();
  return {
    document: getDocumentById(db, copyId),
    pdfBase64: pdfBytes.toString("base64")
  };
}
function listDocuments(db, filter) {
  const clauses = [];
  const args = [];
  if (filter?.search) {
    clauses.push("(gd.document_number LIKE ? OR gd.title LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR rc.contract_number LIKE ?)");
    const q = `%${filter.search.trim()}%`;
    args.push(q, q, q, q, q);
  }
  if (filter?.documentKind) {
    clauses.push("gd.document_kind = ?");
    args.push(filter.documentKind);
  }
  if (filter?.format) {
    clauses.push("gd.format = ?");
    args.push(filter.format);
  }
  if (filter?.customerId) {
    clauses.push("gd.customer_id = ?");
    args.push(filter.customerId);
  }
  if (filter?.vehicleId) {
    clauses.push("gd.vehicle_id = ?");
    args.push(filter.vehicleId);
  }
  if (filter?.contractId) {
    clauses.push("gd.contract_id = ?");
    args.push(filter.contractId);
  }
  if (filter?.dateFrom) {
    clauses.push("substr(gd.created_at, 1, 10) >= ?");
    args.push(filter.dateFrom.slice(0, 10));
  }
  if (filter?.dateTo) {
    clauses.push("substr(gd.created_at, 1, 10) <= ?");
    args.push(filter.dateTo.slice(0, 10));
  }
  if (filter?.isCopy !== void 0) {
    clauses.push("gd.is_copy = ?");
    args.push(filter.isCopy ? 1 : 0);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(filter?.limit ?? 200)));
  const rows = db.prepare(
    `SELECT gd.*,
              src.document_number AS source_document_number,
              c.full_name AS customer_name,
              CASE WHEN v.id IS NOT NULL THEN v.brand || ' ' || v.model || ' (' || v.matricule || ')' ELSE NULL END AS vehicle_label,
              rc.contract_number AS contract_number
       FROM generated_documents gd
       LEFT JOIN generated_documents src ON src.id = gd.source_document_id
       LEFT JOIN customers c ON c.id = gd.customer_id
       LEFT JOIN vehicles v ON v.id = gd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = gd.contract_id
       ${where}
       ORDER BY gd.created_at DESC, gd.id DESC
       LIMIT ?`
  ).all(...args, limit);
  return rows.map(mapGeneratedDocument);
}
function getDocumentById(db, documentId) {
  const row = db.prepare(
    `SELECT gd.*,
              src.document_number AS source_document_number,
              c.full_name AS customer_name,
              CASE WHEN v.id IS NOT NULL THEN v.brand || ' ' || v.model || ' (' || v.matricule || ')' ELSE NULL END AS vehicle_label,
              rc.contract_number AS contract_number
       FROM generated_documents gd
       LEFT JOIN generated_documents src ON src.id = gd.source_document_id
       LEFT JOIN customers c ON c.id = gd.customer_id
       LEFT JOIN vehicles v ON v.id = gd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = gd.contract_id
       WHERE gd.id = ?`
  ).get(documentId);
  if (!row) throw new AuthError("NOT_FOUND", "Document introuvable dans les archives");
  return mapGeneratedDocument(row);
}
function readArchivedDocumentPdf(db, vaultRootDir, vaultKey, documentId) {
  const doc = getDocumentById(db, documentId);
  const fullPath = resolveConfinedPath(vaultRootDir, doc.filePath);
  if (!import_node_fs12.default.existsSync(fullPath)) {
    throw new AuthError(
      "NOT_FOUND",
      `Fichier PDF archiv\xE9 introuvable dans le coffre (${doc.documentNumber}).`
    );
  }
  const encryptedBytes = import_node_fs12.default.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);
  return {
    document: doc,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    base64Data: plainBytes.toString("base64")
  };
}
function recordDocumentPrintEvent(db, actor, documentId, details) {
  const existing = getDocumentById(db, documentId);
  db.prepare(
    `UPDATE generated_documents
     SET last_printed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_printed_by_user_id = ?
     WHERE id = ?`
  ).run(actor.id, documentId);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "DOCUMENT_PRINTED",
    entityType: "generated_documents",
    entityId: documentId,
    newValue: {
      documentNumber: existing.documentNumber,
      printerName: details.printerName ?? "system-default",
      copies: details.copies ?? 1,
      silent: Boolean(details.silent)
    }
  });
  return getDocumentById(db, documentId);
}

// electron/main/printService.ts
var import_node_crypto11 = __toESM(require("node:crypto"), 1);
var import_node_fs13 = __toESM(require("node:fs"), 1);
var import_node_os3 = __toESM(require("node:os"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);
function createNoopPrintAdapter() {
  return {
    async listPrinters() {
      return [];
    },
    async printPdf() {
      throw new Error(
        "Impression OS directe indisponible dans cet environnement. Utilisez la pr\xE9visualisation ou l\u2019export PDF."
      );
    }
  };
}
function createElectronPrintAdapter(electronModule) {
  const { BrowserWindow: BrowserWindow2 } = electronModule;
  return {
    async listPrinters() {
      const windows = BrowserWindow2.getAllWindows();
      const targetWin = windows[0];
      if (targetWin && !targetWin.isDestroyed()) {
        const list = await targetWin.webContents.getPrintersAsync();
        return (list || []).map((p) => ({
          name: String(p.name),
          displayName: String(p.displayName || p.name),
          description: String(p.description || ""),
          status: Number(p.status ?? 0),
          isDefault: Boolean(p.isDefault)
        }));
      }
      const tempWin = new BrowserWindow2({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      try {
        await tempWin.loadURL("about:blank");
        const list = await tempWin.webContents.getPrintersAsync();
        return (list || []).map((p) => ({
          name: String(p.name),
          displayName: String(p.displayName || p.name),
          description: String(p.description || ""),
          status: Number(p.status ?? 0),
          isDefault: Boolean(p.isDefault)
        }));
      } finally {
        if (!tempWin.isDestroyed()) tempWin.destroy();
      }
    },
    async printPdf(req) {
      const tempDir = import_node_fs13.default.mkdtempSync(import_node_path14.default.join(import_node_os3.default.tmpdir(), "erp-print-"));
      const tempPdfPath = import_node_path14.default.join(tempDir, `${req.documentNumber.replace(/[^A-Za-z0-9_-]/g, "_")}_${import_node_crypto11.default.randomUUID()}.pdf`);
      import_node_fs13.default.writeFileSync(tempPdfPath, req.pdfBytes, { mode: 384 });
      const printWin = new BrowserWindow2({
        show: false,
        width: 820,
        height: 1100,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          plugins: true
        }
      });
      try {
        await printWin.loadFile(tempPdfPath);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const copies = Math.max(1, Math.min(10, req.copies ?? 1));
        const landscape = req.format === "A4_LANDSCAPE_PDF";
        const result = await new Promise((resolve, reject) => {
          printWin.webContents.print(
            {
              silent: Boolean(req.silent),
              printBackground: true,
              deviceName: req.printerName || void 0,
              copies,
              landscape
            },
            (success, failureReason) => {
              if (!success) {
                reject(new Error(failureReason || "Impression annul\xE9e ou \xE9chou\xE9e par le spouler syst\xE8me."));
                return;
              }
              resolve({
                printed: true,
                printerName: req.printerName || null,
                copies,
                message: "Document envoy\xE9 \xE0 l\u2019imprimante."
              });
            }
          );
        });
        return result;
      } finally {
        if (!printWin.isDestroyed()) printWin.destroy();
        try {
          import_node_fs13.default.rmSync(tempDir, { recursive: true, force: true });
        } catch {
        }
      }
    }
  };
}

// electron/database/services/inventoryService.ts
function mapInventoryPart(r) {
  const qty = Number(r.quantity_available ?? 0);
  const min = Number(r.minimum_stock ?? 0);
  const unitPrice = Number(r.unit_purchase_price_minor ?? 0);
  const stockStatus = qty <= 0 ? "OUT_OF_STOCK" : qty <= min ? "LOW_STOCK" : "IN_STOCK";
  return {
    id: Number(r.id),
    partCode: r.part_code,
    partName: r.part_name,
    category: r.category,
    description: r.description ?? null,
    unitLabel: r.unit_label ?? "PIECE",
    compatibleModels: r.compatible_models ?? null,
    quantityAvailable: qty,
    minimumStock: min,
    unitPurchasePriceMinor: unitPrice,
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    storageLocation: r.storage_location ?? null,
    lastPurchaseDate: r.last_purchase_date ?? null,
    isArchived: r.is_archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    supplierName: r.supplier_name ?? null,
    stockValueMinor: qty * unitPrice,
    stockStatus
  };
}
function mapInventoryMovement(r) {
  return {
    id: Number(r.id),
    partId: Number(r.part_id),
    movementType: r.movement_type,
    quantityDelta: Number(r.quantity_delta),
    unitCostMinor: Number(r.unit_cost_minor ?? 0),
    maintenanceRecordId: r.maintenance_record_id != null ? Number(r.maintenance_record_id) : null,
    vehicleId: r.vehicle_id != null ? Number(r.vehicle_id) : null,
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    referenceCode: r.reference_code ?? null,
    expenseId: r.expense_id != null ? Number(r.expense_id) : null,
    movementDate: r.movement_date ?? String(r.created_at).slice(0, 10),
    notes: r.notes ?? null,
    overrideReason: r.override_reason ?? null,
    recordedByUserId: Number(r.recorded_by_user_id),
    createdAt: r.created_at,
    partCode: r.part_code,
    partName: r.part_name,
    unitLabel: r.unit_label ?? "PIECE",
    maintenanceRecordNumber: r.maintenance_record_number ?? null,
    vehicleLabel: r.vehicle_label ?? null,
    supplierName: r.supplier_name ?? null,
    expenseNumber: r.expense_number ?? null,
    recordedByUsername: r.recorded_by_username
  };
}
function listInventoryParts(db, filters) {
  const clauses = [];
  const params = [];
  if (!filters?.includeArchived) {
    clauses.push("COALESCE(ip.is_archived, 0) = 0");
  }
  if (filters?.category && filters.category !== "ALL") {
    clauses.push("ip.category = ?");
    params.push(filters.category);
  }
  if (filters?.supplierId) {
    clauses.push("ip.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters?.stockState === "OUT") {
    clauses.push("ip.quantity_available <= 0");
  } else if (filters?.stockState === "LOW") {
    clauses.push("ip.quantity_available > 0 AND ip.quantity_available <= ip.minimum_stock");
  } else if (filters?.stockState === "IN_STOCK") {
    clauses.push("ip.quantity_available > ip.minimum_stock");
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(ip.part_code LIKE ? OR ip.part_name LIKE ? OR COALESCE(ip.compatible_models, '') LIKE ? OR COALESCE(ip.storage_location, '') LIKE ? OR COALESCE(s.name, '') LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT ip.*, s.name AS supplier_name
       FROM inventory_parts ip
       LEFT JOIN suppliers s ON s.id = ip.supplier_id
       ${where}
       ORDER BY
         CASE WHEN ip.quantity_available <= 0 THEN 0 WHEN ip.quantity_available <= ip.minimum_stock THEN 1 ELSE 2 END ASC,
         ip.part_name ASC,
         ip.id DESC`
  ).all(...params);
  return rows.map(mapInventoryPart);
}
function getInventoryOverview(db) {
  const parts = listInventoryParts(db, { includeArchived: false });
  const totalSkuCount = parts.length;
  const totalUnitsInStock = parts.reduce((acc, p) => acc + p.quantityAvailable, 0);
  const totalValuationMinor = parts.reduce((acc, p) => acc + p.stockValueMinor, 0);
  const lowStockCount = parts.filter((p) => p.stockStatus === "LOW_STOCK").length;
  const outOfStockCount = parts.filter((p) => p.stockStatus === "OUT_OF_STOCK").length;
  const categories = Array.from(new Set(parts.map((p) => p.category))).sort((a, b) => a.localeCompare(b));
  const stockAlerts = listOperationalAlerts(db, { category: "LOW_STOCK", includeResolved: false });
  return {
    totalSkuCount,
    totalUnitsInStock,
    totalValuationMinor,
    lowStockCount,
    outOfStockCount,
    categories,
    stockAlerts
  };
}
function listInventoryMovements(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.partId) {
    clauses.push("im.part_id = ?");
    params.push(filters.partId);
  }
  if (filters?.movementType && filters.movementType !== "ALL") {
    clauses.push("im.movement_type = ?");
    params.push(filters.movementType);
  }
  if (filters?.vehicleId) {
    clauses.push("im.vehicle_id = ?");
    params.push(filters.vehicleId);
  }
  if (filters?.supplierId) {
    clauses.push("im.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters?.dateFrom) {
    clauses.push("substr(im.movement_date, 1, 10) >= ?");
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push("substr(im.movement_date, 1, 10) <= ?");
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(ip.part_code LIKE ? OR ip.part_name LIKE ? OR COALESCE(im.reference_code, '') LIKE ? OR COALESCE(im.notes, '') LIKE ? OR COALESCE(mr.record_number, '') LIKE ? OR COALESCE(v.matricule, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters?.limit ?? 250, 1), 1e3);
  params.push(limit);
  const rows = db.prepare(
    `SELECT im.*,
              ip.part_code,
              ip.part_name,
              ip.unit_label,
              mr.record_number AS maintenance_record_number,
              CASE WHEN v.id IS NOT NULL THEN (v.brand || ' ' || v.model || ' (' || v.matricule || ')') ELSE NULL END AS vehicle_label,
              s.name AS supplier_name,
              e.expense_number AS expense_number,
              u.username AS recorded_by_username
       FROM inventory_movements im
       JOIN inventory_parts ip ON ip.id = im.part_id
       JOIN users u ON u.id = im.recorded_by_user_id
       LEFT JOIN maintenance_records mr ON mr.id = im.maintenance_record_id
       LEFT JOIN vehicles v ON v.id = im.vehicle_id
       LEFT JOIN suppliers s ON s.id = im.supplier_id
       LEFT JOIN expenses e ON e.id = im.expense_id
       ${where}
       ORDER BY im.movement_date DESC, im.id DESC
       LIMIT ?`
  ).all(...params);
  return rows.map(mapInventoryMovement);
}
function getInventoryPartDetail(db, partId) {
  const part = listInventoryParts(db, { includeArchived: true }).find((p) => p.id === partId);
  if (!part) throw new AuthError("NOT_FOUND", "Pi\xE8ce d\xE9tach\xE9e introuvable");
  const movements = listInventoryMovements(db, { partId, limit: 150 });
  return { part, movements };
}
function upsertInventoryPart(db, actor, input) {
  const tx = db.transaction(() => {
    const cleanCode = input.partCode.trim().toUpperCase();
    if (input.supplierId != null) {
      const sup = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.supplierId);
      if (!sup) throw new AuthError("NOT_FOUND", "Fournisseur introuvable");
    }
    if (input.id) {
      const existing = db.prepare("SELECT * FROM inventory_parts WHERE id = ?").get(input.id);
      if (!existing) throw new AuthError("NOT_FOUND", "Pi\xE8ce d\xE9tach\xE9e introuvable");
      const dup2 = db.prepare("SELECT id FROM inventory_parts WHERE part_code = ? AND id != ?").get(cleanCode, input.id);
      if (dup2) throw new AuthError("CONFLICT", `Code pi\xE8ce d\xE9j\xE0 utilis\xE9 : ${cleanCode}`);
      db.prepare(
        `UPDATE inventory_parts
         SET part_code = ?,
             part_name = ?,
             category = ?,
             description = ?,
             unit_label = ?,
             compatible_models = ?,
             minimum_stock = ?,
             unit_purchase_price_minor = ?,
             supplier_id = ?,
             storage_location = ?,
             is_archived = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        cleanCode,
        input.partName.trim(),
        input.category.trim(),
        input.description?.trim() || null,
        input.unitLabel?.trim() || "PIECE",
        input.compatibleModels?.trim() || null,
        input.minimumStock,
        input.unitPurchasePriceMinor,
        input.supplierId ?? null,
        input.storageLocation?.trim() || null,
        input.isArchived !== void 0 ? input.isArchived ? 1 : 0 : Number(existing.is_archived ?? 0),
        input.id
      );
      syncOperationalAlerts(db);
      const updated = getInventoryPartDetail(db, input.id);
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: "INVENTORY_PART_UPDATED",
        entityType: "inventory_parts",
        entityId: input.id,
        previousValue: mapInventoryPart(existing),
        newValue: updated.part
      });
      return updated;
    }
    const dup = db.prepare("SELECT id FROM inventory_parts WHERE part_code = ?").get(cleanCode);
    if (dup) throw new AuthError("CONFLICT", `Code pi\xE8ce d\xE9j\xE0 utilis\xE9 : ${cleanCode}`);
    const initialQty = Number(input.initialStock ?? 0);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const res = db.prepare(
      `INSERT INTO inventory_parts (
          part_code, part_name, category, description, unit_label, compatible_models,
          quantity_available, minimum_stock, unit_purchase_price_minor, supplier_id,
          storage_location, last_purchase_date, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0)`
    ).run(
      cleanCode,
      input.partName.trim(),
      input.category.trim(),
      input.description?.trim() || null,
      input.unitLabel?.trim() || "PIECE",
      input.compatibleModels?.trim() || null,
      input.minimumStock,
      input.unitPurchasePriceMinor,
      input.supplierId ?? null,
      input.storageLocation?.trim() || null,
      initialQty > 0 ? today : null
    );
    const partId = Number(res.lastInsertRowid);
    if (initialQty > 0) {
      db.prepare(
        `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          supplier_id, movement_date, notes, recorded_by_user_id
        ) VALUES (?, 'INITIAL_STOCK', ?, ?, ?, ?, ?, ?)`
      ).run(
        partId,
        initialQty,
        input.unitPurchasePriceMinor,
        input.supplierId ?? null,
        today,
        "Stock initial \xE0 la cr\xE9ation de la fiche",
        actor.id
      );
      db.prepare("UPDATE inventory_parts SET quantity_available = ? WHERE id = ?").run(initialQty, partId);
    }
    syncOperationalAlerts(db);
    const created = getInventoryPartDetail(db, partId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INVENTORY_PART_CREATED",
      entityType: "inventory_parts",
      entityId: partId,
      newValue: created.part
    });
    return created;
  });
  return tx();
}
function archiveInventoryPart(db, actor, partId, archived = true) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM inventory_parts WHERE id = ?").get(partId);
    if (!existing) throw new AuthError("NOT_FOUND", "Pi\xE8ce d\xE9tach\xE9e introuvable");
    db.prepare(
      `UPDATE inventory_parts
       SET is_archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(archived ? 1 : 0, partId);
    syncOperationalAlerts(db);
    const updated = getInventoryPartDetail(db, partId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: archived ? "INVENTORY_PART_ARCHIVED" : "INVENTORY_PART_UNARCHIVED",
      entityType: "inventory_parts",
      entityId: partId,
      newValue: { isArchived: archived }
    });
    return updated;
  });
  return tx();
}
function recordInventoryMovement(db, actor, vaultRootDir, vaultKey, input) {
  const tx = db.transaction(() => {
    const part = db.prepare("SELECT * FROM inventory_parts WHERE id = ?").get(input.partId);
    if (!part) throw new AuthError("NOT_FOUND", "Pi\xE8ce d\xE9tach\xE9e introuvable");
    if (part.is_archived === 1) {
      throw new AuthError("CONFLICT", "Impossible d\u2019enregistrer un mouvement sur une pi\xE8ce archiv\xE9e");
    }
    if (input.supplierId != null) {
      const sup = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.supplierId);
      if (!sup) throw new AuthError("NOT_FOUND", "Fournisseur introuvable");
    }
    if (input.vehicleId != null) {
      const veh = db.prepare("SELECT id FROM vehicles WHERE id = ?").get(input.vehicleId);
      if (!veh) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
    }
    const qty = Math.abs(Math.trunc(input.quantity));
    if (qty <= 0) {
      throw new AuthError("VALIDATION_ERROR", "La quantit\xE9 doit \xEAtre strictement positive");
    }
    const delta = input.movementType === "WITHDRAWAL" ? -qty : qty;
    const currentQty = Number(part.quantity_available ?? 0);
    const nextQty = currentQty + delta;
    if (nextQty < 0) {
      throw new AuthError(
        "CONFLICT",
        `Stock insuffisant pour ${part.part_code} (${part.part_name}) : disponible ${currentQty}, demand\xE9 ${qty}.`
      );
    }
    const unitCost = input.unitCostMinor !== void 0 ? Number(input.unitCostMinor) : Number(part.unit_purchase_price_minor ?? 0);
    const movDate = (input.movementDate || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10);
    const effSupplierId = input.supplierId !== void 0 ? input.supplierId : part.supplier_id ?? null;
    let linkedExpenseId = null;
    if (input.movementType === "PURCHASE" && input.recordInFinance && unitCost * qty > 0) {
      const exp = recordExpense(db, actor, vaultRootDir, vaultKey, {
        category: "SPARE_PARTS",
        vehicleId: input.vehicleId ?? null,
        supplierId: effSupplierId,
        amountMinor: unitCost * qty,
        currency: "DZD",
        expenseDate: movDate,
        paymentMethod: input.paymentMethod ?? "CASH",
        paymentReference: input.paymentReference ?? input.referenceCode ?? null,
        description: `Achat pi\xE8ce ${part.part_code} \xB7 ${part.part_name} (\xD7${qty})`
      });
      linkedExpenseId = exp.id;
    }
    const res = db.prepare(
      `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          maintenance_record_id, vehicle_id, supplier_id, reference_code,
          expense_id, movement_date, notes, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.partId,
      input.movementType,
      delta,
      unitCost,
      input.maintenanceRecordId ?? null,
      input.vehicleId ?? null,
      effSupplierId,
      input.referenceCode?.trim() || null,
      linkedExpenseId,
      movDate,
      input.notes?.trim() || null,
      actor.id
    );
    const movId = Number(res.lastInsertRowid);
    const nextUnitPrice = (input.movementType === "PURCHASE" || input.movementType === "ENTRY") && unitCost > 0 ? unitCost : Number(part.unit_purchase_price_minor ?? 0);
    const nextPurchaseDate = input.movementType === "PURCHASE" ? movDate : part.last_purchase_date ?? null;
    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = ?,
           unit_purchase_price_minor = ?,
           last_purchase_date = ?,
           supplier_id = COALESCE(supplier_id, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextQty, nextUnitPrice, nextPurchaseDate, effSupplierId, input.partId);
    syncOperationalAlerts(db);
    const movement = listInventoryMovements(db, { partId: input.partId, limit: 20 }).find(
      (m) => m.id === movId
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INVENTORY_MOVEMENT_RECORDED",
      entityType: "inventory_movements",
      entityId: movId,
      newValue: {
        partId: input.partId,
        partCode: part.part_code,
        movementType: input.movementType,
        quantityDelta: delta,
        resultingQty: nextQty,
        linkedExpenseId
      }
    });
    return {
      movement,
      part: getInventoryPartDetail(db, input.partId).part
    };
  });
  return tx();
}
function adjustInventoryStock(db, actor, input) {
  const tx = db.transaction(() => {
    const part = db.prepare("SELECT * FROM inventory_parts WHERE id = ?").get(input.partId);
    if (!part) throw new AuthError("NOT_FOUND", "Pi\xE8ce d\xE9tach\xE9e introuvable");
    if (part.is_archived === 1) {
      throw new AuthError("CONFLICT", "Impossible d\u2019ajuster le stock d\u2019une pi\xE8ce archiv\xE9e");
    }
    const delta = Math.trunc(input.quantityDelta);
    if (delta === 0) {
      throw new AuthError("VALIDATION_ERROR", "L\u2019\xE9cart d\u2019ajustement ne peut pas \xEAtre z\xE9ro");
    }
    const currentQty = Number(part.quantity_available ?? 0);
    const nextQty = currentQty + delta;
    if (nextQty < 0) {
      throw new AuthError(
        "CONFLICT",
        `Ajustement refus\xE9 : le stock ne peut pas devenir n\xE9gatif (${currentQty} + ${delta} = ${nextQty}).`
      );
    }
    const movDate = (input.movementDate || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10);
    const unitCost = Number(part.unit_purchase_price_minor ?? 0);
    const res = db.prepare(
      `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          movement_date, notes, override_reason, recorded_by_user_id
        ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, ?, ?)`
    ).run(
      input.partId,
      delta,
      unitCost,
      movDate,
      input.notes?.trim() || null,
      input.overrideReason.trim(),
      actor.id
    );
    const movId = Number(res.lastInsertRowid);
    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextQty, input.partId);
    syncOperationalAlerts(db);
    const movement = listInventoryMovements(db, { partId: input.partId, limit: 20 }).find(
      (m) => m.id === movId
    );
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "INVENTORY_STOCK_ADJUSTED",
      entityType: "inventory_movements",
      entityId: movId,
      previousValue: { quantityAvailable: currentQty },
      newValue: { quantityAvailable: nextQty, quantityDelta: delta },
      reason: input.overrideReason.trim()
    });
    return {
      movement,
      part: getInventoryPartDetail(db, input.partId).part
    };
  });
  return tx();
}

// electron/database/services/paymentService.ts
function generatePaymentCodes2(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM contract_payments").get();
  const seq = (countRow?.cnt ?? 0) + 1;
  return {
    transactionCode: `TXN-${year}-${String(seq).padStart(5, "0")}`,
    receiptNumber: `REC-${year}-${String(seq).padStart(5, "0")}`
  };
}
function mapPaymentRow(row) {
  return {
    id: row.id,
    transactionCode: row.transaction_code,
    receiptNumber: row.receipt_number,
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    vehicleLabel: row.vehicle_label,
    direction: row.direction,
    method: row.method,
    paymentReference: row.payment_reference ?? null,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    paymentDate: row.payment_date,
    description: row.description ?? null,
    recordedByUserId: row.recorded_by_user_id,
    recordedByUsername: row.recorded_by_username,
    reversalOfPaymentId: row.reversal_of_payment_id ?? null,
    reversedByPaymentId: row.reversed_by_payment_id ?? null,
    isReversed: row.reversed_by_payment_id != null,
    createdAt: row.created_at
  };
}
function listPayments(db, filters) {
  const clauses = [];
  const params = [];
  if (filters?.contractId) {
    clauses.push("cp.contract_id = ?");
    params.push(filters.contractId);
  }
  if (filters?.customerId) {
    clauses.push("cp.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters?.method && filters.method !== "ALL") {
    clauses.push("cp.method = ?");
    params.push(filters.method);
  }
  if (filters?.direction && filters.direction !== "ALL") {
    clauses.push("cp.direction = ?");
    params.push(filters.direction);
  }
  if (filters?.dateFrom) {
    clauses.push("substr(cp.payment_date, 1, 10) >= ?");
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push("substr(cp.payment_date, 1, 10) <= ?");
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(cp.transaction_code LIKE ? OR cp.receipt_number LIKE ? OR COALESCE(cp.payment_reference, '') LIKE ? OR rc.contract_number LIKE ? OR c.full_name LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT cp.*,
              rc.contract_number,
              c.full_name AS customer_name,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              u.username AS recorded_by_username,
              rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN customers c ON c.id = cp.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       ${where}
       ORDER BY cp.payment_date DESC, cp.id DESC`
  ).all(...params);
  return rows.map(mapPaymentRow);
}
function getPaymentReceipt(db, paymentId) {
  const row = db.prepare(
    `SELECT cp.*,
              rc.contract_number, rc.total_contract_amount_minor, rc.start_date, rc.expected_return_date,
              c.full_name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
              (v.brand || ' ' || v.model || ' (' || v.matricule || ')') AS vehicle_label,
              u.username AS recorded_by_username, u.full_name AS recorded_by_full_name,
              rev.id AS reversed_by_payment_id
       FROM contract_payments cp
       JOIN rental_contracts rc ON rc.id = cp.contract_id
       JOIN customers c ON c.id = cp.customer_id
       JOIN vehicles v ON v.id = rc.vehicle_id
       JOIN users u ON u.id = cp.recorded_by_user_id
       LEFT JOIN contract_payments rev ON rev.reversal_of_payment_id = cp.id
       WHERE cp.id = ?`
  ).get(paymentId);
  if (!row) throw new AuthError("NOT_FOUND", "Paiement introuvable");
  const totals = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS paid_net_minor
       FROM contract_payments WHERE contract_id = ?`
  ).get(row.contract_id);
  const settings = getAllSettings(db);
  const paidNetMinor = Number(totals?.paid_net_minor ?? 0);
  const contractTotalMinor = Number(row.total_contract_amount_minor ?? 0);
  return {
    payment: mapPaymentRow(row),
    agency: {
      name: settings["agency.commercial_name"] || settings["agency.name"] || "Agence Location",
      address: settings["agency.address"] || "",
      phone: settings["agency.phone"] || "",
      nif: settings["agency.nif"] || "",
      rc: settings["agency.rc"] || ""
    },
    contract: {
      id: row.contract_id,
      contractNumber: row.contract_number,
      vehicleLabel: row.vehicle_label,
      startDate: row.start_date,
      expectedReturnDate: row.expected_return_date,
      totalContractAmountMinor: contractTotalMinor,
      paidNetMinor,
      outstandingMinor: Math.max(0, contractTotalMinor - paidNetMinor)
    },
    customer: {
      id: row.customer_id,
      fullName: row.customer_name,
      phone: row.customer_phone,
      address: row.customer_address ?? null
    },
    recordedByFullName: row.recorded_by_full_name
  };
}
function recordPayment(db, actor, input) {
  const tx = db.transaction(() => {
    const contract = db.prepare(
      `SELECT rc.*,
                COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                          FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
         FROM rental_contracts rc
         WHERE rc.id = ?`
    ).get(input.contractId);
    if (!contract) throw new AuthError("NOT_FOUND", "Contrat introuvable");
    if (contract.status === "CANCELLED") {
      throw new AuthError("CONFLICT", "Impossible d\u2019enregistrer un paiement sur un contrat annul\xE9");
    }
    if (input.currency !== contract.currency) {
      throw new AuthError(
        "VALIDATION_ERROR",
        `La devise du paiement (${input.currency}) doit correspondre \xE0 celle du contrat (${contract.currency})`
      );
    }
    const totalAmountMinor = Number(contract.total_contract_amount_minor);
    const paidNetMinor = Number(contract.paid_net_minor ?? 0);
    if (input.direction === "INFLOW") {
      const remaining = Math.max(0, totalAmountMinor - paidNetMinor);
      if (input.amountMinor > remaining) {
        throw new AuthError(
          "VALIDATION_ERROR",
          `Le montant (${input.amountMinor / 100}) d\xE9passe le solde restant du contrat (${remaining / 100})`
        );
      }
    } else {
      if (input.amountMinor > paidNetMinor) {
        throw new AuthError(
          "VALIDATION_ERROR",
          `Le remboursement (${input.amountMinor / 100}) d\xE9passe le net d\xE9j\xE0 encaiss\xE9 (${paidNetMinor / 100})`
        );
      }
    }
    const codes = generatePaymentCodes2(db);
    const res = db.prepare(
      `INSERT INTO contract_payments (
          transaction_code, receipt_number, contract_id, customer_id, direction, method,
          payment_reference, amount_minor, currency, payment_date, description, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      codes.transactionCode,
      codes.receiptNumber,
      contract.id,
      contract.customer_id,
      input.direction,
      input.method,
      input.paymentReference?.trim() || null,
      input.amountMinor,
      input.currency,
      input.paymentDate,
      input.description?.trim() || (input.direction === "REFUND" ? "Remboursement client" : "Paiement location"),
      actor.id
    );
    const paymentId = Number(res.lastInsertRowid);
    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: input.currency,
      paymentMethod: input.method,
      movementType: input.direction === "INFLOW" ? "PAYMENT_INFLOW" : "PAYMENT_REFUND",
      amountMinor: input.amountMinor,
      paymentId,
      description: `${codes.receiptNumber} (${contract.contract_number})`
    });
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: input.direction === "INFLOW" ? "PAYMENT_RECORDED" : "PAYMENT_REFUNDED",
      entityType: "contract_payments",
      entityId: paymentId,
      newValue: {
        transactionCode: codes.transactionCode,
        receiptNumber: codes.receiptNumber,
        contractId: contract.id,
        direction: input.direction,
        method: input.method,
        amountMinor: input.amountMinor
      }
    });
    return getPaymentReceipt(db, paymentId);
  });
  return tx();
}
function reversePayment(db, actor, input) {
  const tx = db.transaction(() => {
    const orig = db.prepare("SELECT * FROM contract_payments WHERE id = ?").get(input.paymentId);
    if (!orig) throw new AuthError("NOT_FOUND", "Paiement introuvable");
    if (orig.reversal_of_payment_id != null) {
      throw new AuthError("CONFLICT", "Une \xE9criture d\u2019annulation ne peut pas \xEAtre contre-pass\xE9e");
    }
    const alreadyReversed = db.prepare(
      "SELECT id FROM contract_payments WHERE reversal_of_payment_id = ? LIMIT 1"
    ).get(orig.id);
    if (alreadyReversed) {
      throw new AuthError("CONFLICT", "Ce paiement a d\xE9j\xE0 fait l\u2019objet d\u2019une contre-passation");
    }
    const contract = db.prepare(
      `SELECT rc.*,
                COALESCE((SELECT SUM(CASE WHEN cp.direction = 'INFLOW' THEN cp.amount_minor ELSE -cp.amount_minor END)
                          FROM contract_payments cp WHERE cp.contract_id = rc.id), 0) AS paid_net_minor
         FROM rental_contracts rc WHERE rc.id = ?`
    ).get(orig.contract_id);
    const reversalDirection = orig.direction === "INFLOW" ? "REFUND" : "INFLOW";
    const paidNetMinor = Number(contract.paid_net_minor ?? 0);
    if (reversalDirection === "REFUND" && orig.amount_minor > paidNetMinor) {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Contre-passation impossible : le solde net encaiss\xE9 du contrat deviendrait n\xE9gatif"
      );
    }
    if (reversalDirection === "INFLOW" && paidNetMinor + orig.amount_minor > Number(contract.total_contract_amount_minor)) {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Contre-passation impossible : le total encaiss\xE9 d\xE9passerait le total du contrat"
      );
    }
    const codes = generatePaymentCodes2(db);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const revRes = db.prepare(
      `INSERT INTO contract_payments (
          transaction_code, receipt_number, contract_id, customer_id, direction, method,
          payment_reference, amount_minor, currency, payment_date, description,
          recorded_by_user_id, reversal_of_payment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      codes.transactionCode,
      codes.receiptNumber,
      orig.contract_id,
      orig.customer_id,
      reversalDirection,
      orig.method,
      orig.payment_reference,
      orig.amount_minor,
      orig.currency,
      today,
      `Annulation ${orig.receipt_number}: ${input.reason.trim()}`,
      actor.id,
      orig.id
    );
    const reversalId = Number(revRes.lastInsertRowid);
    appendCashMovementIfOpenSession(db, {
      actorId: actor.id,
      currency: orig.currency,
      paymentMethod: orig.method,
      movementType: reversalDirection === "INFLOW" ? "PAYMENT_INFLOW" : "PAYMENT_REFUND",
      amountMinor: orig.amount_minor,
      paymentId: reversalId,
      description: `Annulation ${orig.receipt_number} (${contract.contract_number})`
    });
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "PAYMENT_REVERSED",
      entityType: "contract_payments",
      entityId: reversalId,
      previousValue: { originalPaymentId: orig.id, receiptNumber: orig.receipt_number },
      newValue: { reversalPaymentId: reversalId, receiptNumber: codes.receiptNumber },
      reason: input.reason.trim()
    });
    return getPaymentReceipt(db, reversalId);
  });
  return tx();
}

// electron/database/services/pricingService.ts
function calculateRentalPrice(db, input) {
  const startMs = Date.parse(input.startDate);
  const endMs = Date.parse(input.endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new AuthError("VALIDATION_ERROR", "Plage de dates invalide pour le calcul tarifaire");
  }
  const vehicle = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(input.vehicleId);
  if (!vehicle) throw new AuthError("NOT_FOUND", "V\xE9hicule introuvable");
  const days = Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1e3)));
  const startDay = input.startDate.slice(0, 10);
  const endDay = input.endDate.slice(0, 10);
  const maxDiscountSetting = db.prepare(
    "SELECT setting_value FROM application_settings WHERE setting_key = 'business.max_agent_discount_percent'"
  ).get();
  const maxAgentDiscountPercent = Number(maxDiscountSetting?.setting_value ?? 10);
  let dailyRate = Number(vehicle.default_daily_rate_minor);
  let weeklyRate = vehicle.default_weekly_rate_minor != null ? Number(vehicle.default_weekly_rate_minor) : null;
  let monthlyRate = vehicle.default_monthly_rate_minor != null ? Number(vehicle.default_monthly_rate_minor) : null;
  let customerDefaultDiscountPct = 0;
  let appliedTier = "DAILY";
  let appliedRuleSource = `${vehicle.brand} ${vehicle.model} (Tarif v\xE9hicule)`;
  let grossTotalMinor = 0;
  let lineItemType = "DAILY_RATE";
  const tier = input.pricingTier ?? "AUTO";
  if (tier === "CUSTOM" && input.customTotalMinor != null) {
    appliedTier = "CUSTOM";
    appliedRuleSource = "Tarif contractuel personnalis\xE9";
    grossTotalMinor = Math.round(input.customTotalMinor);
    dailyRate = Math.round(grossTotalMinor / days);
    lineItemType = "CUSTOM_RATE";
  } else if (tier === "CUSTOM" && input.customDailyRateMinor != null) {
    appliedTier = "CUSTOM";
    appliedRuleSource = "Tarif journalier personnalis\xE9";
    dailyRate = Math.round(input.customDailyRateMinor);
    grossTotalMinor = dailyRate * days;
    lineItemType = "CUSTOM_RATE";
  } else {
    const seasonal = db.prepare(
      `SELECT * FROM seasonal_rates
         WHERE is_active = 1
           AND start_date <= ?
           AND end_date >= ?
           AND (vehicle_id = ? OR vehicle_category = ? OR (vehicle_id IS NULL AND vehicle_category IS NULL))
         ORDER BY
           CASE WHEN vehicle_id IS NOT NULL THEN 0 WHEN vehicle_category IS NOT NULL THEN 1 ELSE 2 END,
           id DESC
         LIMIT 1`
    ).get(endDay, startDay, vehicle.id, vehicle.category);
    if (seasonal) {
      dailyRate = Number(seasonal.daily_rate_minor);
      weeklyRate = seasonal.weekly_rate_minor != null ? Number(seasonal.weekly_rate_minor) : weeklyRate;
      monthlyRate = seasonal.monthly_rate_minor != null ? Number(seasonal.monthly_rate_minor) : monthlyRate;
      appliedTier = "SEASONAL";
      appliedRuleSource = `Saison: ${seasonal.name}`;
      lineItemType = "SEASONAL_RATE";
    }
    if (input.customerId) {
      const custRate = db.prepare(
        `SELECT * FROM customer_custom_rates
           WHERE customer_id = ?
             AND is_active = 1
             AND (vehicle_id = ? OR vehicle_category = ? OR (vehicle_id IS NULL AND vehicle_category IS NULL))
           ORDER BY
             CASE WHEN vehicle_id IS NOT NULL THEN 0 WHEN vehicle_category IS NOT NULL THEN 1 ELSE 2 END,
             id DESC
           LIMIT 1`
      ).get(input.customerId, vehicle.id, vehicle.category);
      if (custRate) {
        if (custRate.daily_rate_minor != null) dailyRate = Number(custRate.daily_rate_minor);
        if (custRate.weekly_rate_minor != null) weeklyRate = Number(custRate.weekly_rate_minor);
        if (custRate.monthly_rate_minor != null) monthlyRate = Number(custRate.monthly_rate_minor);
        customerDefaultDiscountPct = Number(custRate.default_discount_percent ?? 0);
        appliedTier = "CUSTOMER_CUSTOM";
        appliedRuleSource = "Tarif sp\xE9cifique client";
      }
    }
    if (tier === "MONTHLY" || tier === "AUTO" && days >= 30 && monthlyRate != null) {
      const effMonthly = monthlyRate ?? dailyRate * 30;
      const months = Math.floor(days / 30);
      const remDays = days % 30;
      const effRemDaily = Math.round(effMonthly / 30);
      grossTotalMinor = months > 0 ? months * effMonthly + remDays * effRemDaily : days * effRemDaily;
      if (appliedTier === "DAILY") appliedTier = "MONTHLY";
      lineItemType = "MONTHLY_RATE";
      dailyRate = Math.round(grossTotalMinor / days);
    } else if (tier === "WEEKLY" || tier === "AUTO" && days >= 7 && weeklyRate != null) {
      const effWeekly = weeklyRate ?? dailyRate * 7;
      const weeks = Math.floor(days / 7);
      const remDays = days % 7;
      const effRemDaily = Math.round(effWeekly / 7);
      grossTotalMinor = weeks > 0 ? weeks * effWeekly + remDays * effRemDaily : days * effRemDaily;
      if (appliedTier === "DAILY") appliedTier = "WEEKLY";
      lineItemType = "WEEKLY_RATE";
      dailyRate = Math.round(grossTotalMinor / days);
    } else {
      grossTotalMinor = dailyRate * days;
    }
  }
  const lineItems = [
    {
      itemType: lineItemType,
      label: `${appliedRuleSource} (${days} j)`,
      quantity: days,
      unitPriceMinor: dailyRate,
      totalMinor: grossTotalMinor
    }
  ];
  const discountType = input.discountType && input.discountType !== "NONE" ? input.discountType : customerDefaultDiscountPct > 0 ? "PERCENT" : "NONE";
  const discountVal = input.discountType && input.discountType !== "NONE" ? input.discountValue ?? 0 : customerDefaultDiscountPct;
  let discountMinor = 0;
  if (discountType === "FIXED" && discountVal > 0) {
    discountMinor = Math.min(grossTotalMinor, Math.round(discountVal));
    lineItems.push({
      itemType: "FIXED_DISCOUNT",
      label: "Remise fixe accord\xE9e",
      quantity: 1,
      unitPriceMinor: -discountMinor,
      totalMinor: -discountMinor
    });
  } else if (discountType === "PERCENT" && discountVal > 0) {
    const pct = Math.min(100, Math.max(0, discountVal));
    discountMinor = Math.min(grossTotalMinor, Math.round(grossTotalMinor * pct / 100));
    lineItems.push({
      itemType: "PERCENT_DISCOUNT",
      label: `Remise (${pct}%)`,
      quantity: pct,
      unitPriceMinor: 0,
      totalMinor: -discountMinor
    });
  }
  const netTotalMinor = Math.max(0, grossTotalMinor - discountMinor);
  const discountPercentEffective = grossTotalMinor > 0 ? Number((discountMinor / grossTotalMinor * 100).toFixed(2)) : 0;
  return {
    days,
    appliedTier,
    appliedRuleSource,
    unitDailyRateMinor: dailyRate,
    grossTotalMinor,
    discountMinor,
    netTotalMinor,
    discountPercentEffective,
    maxAgentDiscountPercent,
    requiresAdminDiscountOverride: discountPercentEffective > maxAgentDiscountPercent,
    lineItems
  };
}
function listPricingRules(db) {
  const seasonalRates = db.prepare(
    `SELECT sr.*, v.matricule, v.brand, v.model
       FROM seasonal_rates sr
       LEFT JOIN vehicles v ON v.id = sr.vehicle_id
       ORDER BY sr.start_date DESC`
  ).all().map((r) => ({
    id: r.id,
    name: r.name,
    vehicleCategory: r.vehicle_category,
    vehicleId: r.vehicle_id,
    vehicleLabel: r.vehicle_id ? `${r.brand} ${r.model} (${r.matricule})` : null,
    startDate: r.start_date,
    endDate: r.end_date,
    dailyRateMinor: r.daily_rate_minor,
    weeklyRateMinor: r.weekly_rate_minor,
    monthlyRateMinor: r.monthly_rate_minor,
    isActive: r.is_active === 1
  }));
  const customerRates = db.prepare(
    `SELECT cr.*, c.full_name AS customer_name, v.matricule, v.brand, v.model
       FROM customer_custom_rates cr
       JOIN customers c ON c.id = cr.customer_id
       LEFT JOIN vehicles v ON v.id = cr.vehicle_id
       WHERE cr.is_active = 1
       ORDER BY cr.id DESC`
  ).all().map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    vehicleCategory: r.vehicle_category,
    vehicleId: r.vehicle_id,
    vehicleLabel: r.vehicle_id ? `${r.brand} ${r.model} (${r.matricule})` : null,
    dailyRateMinor: r.daily_rate_minor,
    weeklyRateMinor: r.weekly_rate_minor,
    monthlyRateMinor: r.monthly_rate_minor,
    defaultDiscountPercent: r.default_discount_percent,
    notes: r.notes
  }));
  return { seasonalRates, customerRates };
}
function createSeasonalRate(db, actor, input) {
  const res = db.prepare(
    `INSERT INTO seasonal_rates (
        name, vehicle_category, vehicle_id, start_date, end_date,
        daily_rate_minor, weekly_rate_minor, monthly_rate_minor, is_active, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    input.name.trim(),
    input.vehicleCategory || null,
    input.vehicleId ?? null,
    input.startDate,
    input.endDate,
    input.dailyRateMinor,
    input.weeklyRateMinor ?? null,
    input.monthlyRateMinor ?? null,
    actor.id
  );
  const id = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "SEASONAL_RATE_CREATED",
    entityType: "seasonal_rates",
    entityId: id,
    newValue: input
  });
  return { id, ...input };
}
function deleteSeasonalRate(db, actor, id) {
  db.prepare("DELETE FROM seasonal_rates WHERE id = ?").run(id);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "SEASONAL_RATE_DELETED",
    entityType: "seasonal_rates",
    entityId: id
  });
}
function upsertCustomerCustomRate(db, actor, input) {
  const res = db.prepare(
    `INSERT INTO customer_custom_rates (
        customer_id, vehicle_category, vehicle_id, daily_rate_minor,
        weekly_rate_minor, monthly_rate_minor, default_discount_percent, notes, is_active, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    input.customerId,
    input.vehicleCategory || null,
    input.vehicleId ?? null,
    input.dailyRateMinor ?? null,
    input.weeklyRateMinor ?? null,
    input.monthlyRateMinor ?? null,
    input.defaultDiscountPercent ?? 0,
    input.notes || null,
    actor.id
  );
  const id = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: "CUSTOMER_RATE_CREATED",
    entityType: "customer_custom_rates",
    entityId: id,
    newValue: input
  });
  return { id, ...input };
}

// electron/database/services/reservationService.ts
function generateReservationNumber(db) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const countRow = db.prepare(
    "SELECT COUNT(*) AS cnt FROM reservations WHERE reservation_number LIKE ?"
  ).get(`RES-${year}-%`);
  const seq = (countRow?.cnt ?? 0) + 1;
  return `RES-${year}-${String(seq).padStart(4, "0")}`;
}
function listReservations(db, statusFilter) {
  const where = statusFilter && statusFilter !== "ALL" ? "WHERE r.status = ?" : "";
  const params = statusFilter && statusFilter !== "ALL" ? [statusFilter] : [];
  return db.prepare(
    `SELECT r.*, c.full_name AS customer_name, c.phone AS customer_phone,
              v.matricule, v.brand, v.model
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       JOIN vehicles v ON v.id = r.vehicle_id
       ${where}
       ORDER BY r.start_date ASC, r.id DESC`
  ).all(...params).map((r) => ({
    id: r.id,
    reservationNumber: r.reservation_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    vehicleId: r.vehicle_id,
    vehicleLabel: `${r.brand} ${r.model} (${r.matricule})`,
    startDate: r.start_date,
    expectedReturnDate: r.expected_return_date,
    estimatedTotalMinor: r.estimated_total_minor,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at
  }));
}
function createReservation(db, actor, input) {
  const tx = db.transaction(() => {
    const customer = db.prepare(
      "SELECT id, is_archived FROM customers WHERE id = ?"
    ).get(input.customerId);
    if (!customer || customer.is_archived === 1) {
      throw new AuthError("NOT_FOUND", "Client introuvable ou archiv\xE9");
    }
    const avail = checkVehicleAvailability(db, {
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.expectedReturnDate
    });
    if (!avail.available) {
      throw new AuthError(
        "CONFLICT",
        `V\xE9hicule indisponible: ${avail.conflicts.map((c) => c.details).join(" ; ")}`
      );
    }
    const reservationNumber = generateReservationNumber(db);
    const res = db.prepare(
      `INSERT INTO reservations (
          reservation_number, customer_id, vehicle_id, start_date, expected_return_date,
          estimated_total_minor, status, notes, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      reservationNumber,
      input.customerId,
      input.vehicleId,
      input.startDate,
      input.expectedReturnDate,
      input.estimatedTotalMinor,
      input.status,
      input.notes ?? null,
      actor.id
    );
    const id = Number(res.lastInsertRowid);
    recomputeVehicleStatus(db, input.vehicleId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "RESERVATION_CREATED",
      entityType: "reservations",
      entityId: id,
      newValue: { reservationNumber, ...input }
    });
    return listReservations(db).find((r) => r.id === id);
  });
  return tx();
}
function updateReservationStatus(db, actor, input) {
  const tx = db.transaction(() => {
    const current = db.prepare("SELECT * FROM reservations WHERE id = ?").get(input.reservationId);
    if (!current) throw new AuthError("NOT_FOUND", "R\xE9servation introuvable");
    if (current.status === "CONVERTED") {
      throw new AuthError("CONFLICT", "R\xE9servation d\xE9j\xE0 convertie en contrat");
    }
    if (input.status === "CONFIRMED" && current.status !== "CONFIRMED") {
      const avail = checkVehicleAvailability(db, {
        vehicleId: current.vehicle_id,
        startDate: current.start_date,
        endDate: current.expected_return_date,
        excludeReservationId: current.id
      });
      if (!avail.available) {
        throw new AuthError(
          "CONFLICT",
          `Impossible de confirmer la r\xE9servation: ${avail.conflicts.map((c) => c.details).join(" ; ")}`
        );
      }
    }
    db.prepare(
      `UPDATE reservations
       SET status = ?, notes = COALESCE(?, notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.status, input.notes ?? null, input.reservationId);
    recomputeVehicleStatus(db, current.vehicle_id);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "RESERVATION_STATUS_UPDATED",
      entityType: "reservations",
      entityId: input.reservationId,
      previousValue: { status: current.status },
      newValue: { status: input.status }
    });
    return listReservations(db).find((r) => r.id === input.reservationId);
  });
  return tx();
}

// electron/database/services/userService.ts
function listUsers(db) {
  const rows = db.prepare(
    `SELECT u.*, r.code AS role_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
  ).all();
  const overrideStmt = db.prepare(
    `SELECT p.code, up.granted
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ?`
  );
  return rows.map((row) => {
    const user = mapRawUser(row);
    const permissions = resolveEffectivePermissions(db, user.id, user.roleId);
    const overrides = overrideStmt.all(user.id).map((o) => ({
      code: o.code,
      granted: o.granted === 1
    }));
    return { ...user, permissions, permissionOverrides: overrides };
  });
}
function listAllPermissions(db) {
  return db.prepare(
    "SELECT id, code, module, description_fr, description_ar FROM permissions ORDER BY module, id"
  ).all().map((p) => ({
    id: p.id,
    code: p.code,
    module: p.module,
    descriptionFr: p.description_fr,
    descriptionAr: p.description_ar
  }));
}
function createUser(db, actor, input) {
  const tx = db.transaction(() => {
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(input.username.trim());
    if (exists) {
      throw new AuthError("CONFLICT", `Le nom d'utilisateur "${input.username}" existe d\xE9j\xE0`);
    }
    const role = db.prepare("SELECT id FROM roles WHERE code = ?").get(input.roleCode);
    if (!role) {
      throw new AuthError("VALIDATION_ERROR", "R\xF4le invalide");
    }
    const hash = hashPassword(input.password);
    const res = db.prepare(
      `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
         VALUES (?, ?, ?, ?, 1)`
    ).run(input.username.trim(), input.fullName.trim(), hash, role.id);
    const newId = Number(res.lastInsertRowid);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "USER_CREATED",
      entityType: "users",
      entityId: newId,
      newValue: { username: input.username.trim(), fullName: input.fullName.trim(), roleCode: input.roleCode }
    });
    return newId;
  });
  const userId = tx();
  return listUsers(db).find((u) => u.id === userId);
}
function updateUser(db, sessionStore, actor, targetUserId, input) {
  const tx = db.transaction(() => {
    const current = db.prepare(
      `SELECT u.*, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
    ).get(targetUserId);
    if (!current) {
      throw new AuthError("NOT_FOUND", "Utilisateur introuvable");
    }
    if (targetUserId === actor.id && input.isActive === false) {
      throw new AuthError("VALIDATION_ERROR", "Vous ne pouvez pas d\xE9sactiver votre propre compte");
    }
    if (targetUserId === actor.id && input.roleCode && input.roleCode !== "ADMIN") {
      throw new AuthError("VALIDATION_ERROR", "Vous ne pouvez pas r\xE9trograder votre propre r\xF4le ADMIN");
    }
    let roleId = current.role_id;
    if (input.roleCode) {
      const roleRow = db.prepare("SELECT id FROM roles WHERE code = ?").get(input.roleCode);
      if (!roleRow) throw new AuthError("VALIDATION_ERROR", "R\xF4le invalide");
      roleId = roleRow.id;
    }
    const nextActive = input.isActive !== void 0 ? input.isActive ? 1 : 0 : current.is_active;
    const nextFullName = input.fullName !== void 0 ? input.fullName.trim() : current.full_name;
    const nextFailed = input.unlockAccount ? 0 : current.failed_login_attempts;
    const nextLockedUntil = input.unlockAccount ? null : current.locked_until;
    const nextHash = input.resetPassword ? hashPassword(input.resetPassword) : current.password_hash;
    db.prepare(
      `UPDATE users
       SET full_name = ?, role_id = ?, is_active = ?,
           failed_login_attempts = ?, locked_until = ?, password_hash = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextFullName, roleId, nextActive, nextFailed, nextLockedUntil, nextHash, targetUserId);
    if (input.permissionOverrides) {
      const delStmt = db.prepare("DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?");
      const upsertStmt = db.prepare(
        `INSERT INTO user_permissions (user_id, permission_id, granted, granted_by_user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, permission_id) DO UPDATE SET granted = excluded.granted, granted_by_user_id = excluded.granted_by_user_id`
      );
      const findPerm = db.prepare("SELECT id FROM permissions WHERE code = ?");
      for (const ov of input.permissionOverrides) {
        const perm = findPerm.get(ov.code);
        if (!perm) continue;
        if (ov.granted === null) {
          delStmt.run(targetUserId, perm.id);
        } else {
          upsertStmt.run(targetUserId, perm.id, ov.granted ? 1 : 0, actor.id);
        }
      }
    }
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: "USER_UPDATED",
      entityType: "users",
      entityId: targetUserId,
      previousValue: {
        fullName: current.full_name,
        roleCode: current.role_code,
        isActive: current.is_active === 1
      },
      newValue: {
        fullName: nextFullName,
        roleCode: input.roleCode ?? current.role_code,
        isActive: nextActive === 1,
        passwordReset: Boolean(input.resetPassword),
        unlockAccount: Boolean(input.unlockAccount),
        permissionOverridesCount: input.permissionOverrides?.length ?? 0
      }
    });
  });
  tx();
  const updated = listUsers(db).find((u) => u.id === targetUserId);
  sessionStore.updateUserSnapshot(targetUserId, updated, updated.permissions);
  return updated;
}

// electron/database/services/wilayaService.ts
function mapWilaya(row) {
  return {
    code: row.code,
    nameFr: row.name_fr,
    nameAr: row.name_ar,
    isNewlyCreated2026: row.is_newly_created_2026 === 1,
    parentWilayaCode: row.parent_wilaya_code,
    decreeReference: row.decree_reference,
    effectiveYear: row.effective_year,
    isActive: row.is_active === 1,
    notes: row.notes,
    updatedAt: row.updated_at
  };
}
function listWilayas(db, activeOnly = false) {
  const sql = activeOnly ? "SELECT * FROM wilayas WHERE is_active = 1 ORDER BY CAST(code AS INTEGER), code" : "SELECT * FROM wilayas ORDER BY CAST(code AS INTEGER), code";
  return db.prepare(sql).all().map(mapWilaya);
}
function upsertWilaya(db, actor, input) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM wilayas WHERE code = ?").get(input.code);
    db.prepare(
      `INSERT INTO wilayas (
        code, name_fr, name_ar, is_newly_created_2026, parent_wilaya_code,
        decree_reference, effective_year, is_active, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(code) DO UPDATE SET
        name_fr = excluded.name_fr,
        name_ar = excluded.name_ar,
        is_newly_created_2026 = excluded.is_newly_created_2026,
        parent_wilaya_code = excluded.parent_wilaya_code,
        decree_reference = excluded.decree_reference,
        effective_year = excluded.effective_year,
        is_active = excluded.is_active,
        notes = excluded.notes,
        updated_at = excluded.updated_at`
    ).run(
      input.code.trim(),
      input.nameFr.trim(),
      input.nameAr.trim(),
      input.isNewlyCreated2026 ? 1 : 0,
      input.parentWilayaCode || null,
      input.decreeReference || null,
      input.effectiveYear,
      input.isActive ? 1 : 0,
      input.notes || null
    );
    const updated = db.prepare("SELECT * FROM wilayas WHERE code = ?").get(input.code.trim());
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: existing ? "WILAYA_UPDATED" : "WILAYA_CREATED",
      entityType: "wilayas",
      entityId: input.code.trim(),
      previousValue: existing ? mapWilaya(existing) : null,
      newValue: mapWilaya(updated)
    });
    return mapWilaya(updated);
  });
  return tx();
}

// electron/ipc/contracts.ts
var IPC_CHANNELS = {
  AUTH_STATUS: "auth:status",
  AUTH_BOOTSTRAP_ADMIN: "auth:bootstrapAdmin",
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  AUTH_LOCK: "auth:lock",
  AUTH_UNLOCK: "auth:unlock",
  AUTH_ME: "auth:me",
  AUTH_CHANGE_PASSWORD: "auth:changePassword",
  USERS_LIST: "users:list",
  USERS_PERMISSIONS: "users:permissions",
  USERS_CREATE: "users:create",
  USERS_UPDATE: "users:update",
  SETTINGS_GET_ALL: "settings:getAll",
  SETTINGS_UPDATE_BATCH: "settings:updateBatch",
  WILAYAS_LIST: "wilayas:list",
  WILAYAS_UPSERT: "wilayas:upsert",
  DASHBOARD_SUMMARY: "dashboard:summary",
  VEHICLES_LIST: "vehicles:list",
  VEHICLES_GET: "vehicles:get",
  VEHICLES_CREATE: "vehicles:create",
  VEHICLES_UPDATE: "vehicles:update",
  VEHICLES_ARCHIVE: "vehicles:archive",
  VEHICLES_UPSERT_DOC: "vehicles:upsertDoc",
  VEHICLES_CREATE_BLOCK: "vehicles:createBlock",
  VEHICLES_RELEASE_BLOCK: "vehicles:releaseBlock",
  CUSTOMERS_LIST: "customers:list",
  CUSTOMERS_GET: "customers:get",
  CUSTOMERS_CREATE: "customers:create",
  CUSTOMERS_UPDATE: "customers:update",
  CUSTOMERS_ARCHIVE: "customers:archive",
  CUSTOMERS_ADD_RISK: "customers:addRisk",
  CUSTOMERS_RESOLVE_RISK: "customers:resolveRisk",
  CUSTOMERS_UPLOAD_DOC: "customers:uploadDoc",
  CUSTOMERS_UPDATE_DOC_META: "customers:updateDocMeta",
  CUSTOMERS_ARCHIVE_DOC: "customers:archiveDoc",
  CUSTOMERS_READ_DOC: "customers:readDoc",
  CUSTOMERS_CHECK_ELIGIBILITY: "customers:checkEligibility",
  PRICING_CALCULATE: "pricing:calculate",
  PRICING_LIST_RULES: "pricing:listRules",
  PRICING_CREATE_SEASONAL: "pricing:createSeasonal",
  PRICING_DELETE_SEASONAL: "pricing:deleteSeasonal",
  PRICING_UPSERT_CUSTOMER_RATE: "pricing:upsertCustomerRate",
  PLANNING_CALENDAR: "planning:calendar",
  PLANNING_CHECK_AVAILABILITY: "planning:checkAvailability",
  RESERVATIONS_LIST: "reservations:list",
  RESERVATIONS_CREATE: "reservations:create",
  RESERVATIONS_UPDATE_STATUS: "reservations:updateStatus",
  CONTRACTS_LIST: "contracts:list",
  CONTRACTS_GET: "contracts:get",
  CONTRACTS_CREATE: "contracts:create",
  CONTRACTS_ACTIVATE: "contracts:activate",
  CONTRACTS_EXTEND: "contracts:extend",
  CONTRACTS_COMPLETE: "contracts:complete",
  CONTRACTS_CANCEL: "contracts:cancel",
  INSPECTIONS_LIST: "inspections:list",
  INSPECTIONS_GET: "inspections:get",
  INSPECTIONS_CREATE: "inspections:create",
  INSPECTIONS_UPDATE: "inspections:update",
  INSPECTIONS_FINALIZE: "inspections:finalize",
  INSPECTIONS_GET_BY_CONTRACT: "inspections:getByContract",
  INSPECTIONS_UPLOAD_PHOTO: "inspections:uploadPhoto",
  INSPECTIONS_READ_PHOTO: "inspections:readPhoto",
  INSPECTIONS_DELETE_PHOTO: "inspections:deletePhoto",
  INSPECTIONS_GET_PDF_PAYLOAD: "inspections:getPdfPayload",
  DAMAGES_LIST: "damages:list",
  DAMAGES_ADD: "damages:add",
  DAMAGES_UPDATE_STATUS: "damages:updateStatus",
  FINANCE_LIST_PAYMENTS: "finance:listPayments",
  FINANCE_RECORD_PAYMENT: "finance:recordPayment",
  FINANCE_REVERSE_PAYMENT: "finance:reversePayment",
  FINANCE_GET_PAYMENT_RECEIPT: "finance:getPaymentReceipt",
  FINANCE_LIST_DEPOSITS: "finance:listDeposits",
  FINANCE_GET_DEPOSIT_DETAIL: "finance:getDepositDetail",
  FINANCE_SETTLE_DEPOSIT: "finance:settleDeposit",
  FINANCE_READ_DEPOSIT_DOC: "finance:readDepositDoc",
  FINANCE_LIST_FINES: "finance:listFines",
  FINANCE_CREATE_FINE: "finance:createFine",
  FINANCE_CUSTOMER_ACCOUNTS: "finance:customerAccounts",
  FINANCE_CUSTOMER_LEDGER: "finance:customerLedger",
  FINANCE_CREATE_CUSTOMER_ADJUSTMENT: "finance:createCustomerAdjustment",
  FINANCE_LIST_SUPPLIERS: "finance:listSuppliers",
  FINANCE_CREATE_SUPPLIER: "finance:createSupplier",
  FINANCE_UPSERT_SUPPLIER: "finance:upsertSupplier",
  FINANCE_LIST_EXPENSES: "finance:listExpenses",
  FINANCE_RECORD_EXPENSE: "finance:recordExpense",
  FINANCE_REVERSE_EXPENSE: "finance:reverseExpense",
  FINANCE_READ_EXPENSE_DOC: "finance:readExpenseDoc",
  FINANCE_CASH_SESSION_CURRENT: "finance:cashSessionCurrent",
  FINANCE_CASH_SESSION_LIST: "finance:cashSessionList",
  FINANCE_CASH_SESSION_DETAIL: "finance:cashSessionDetail",
  FINANCE_CASH_SESSION_OPEN: "finance:cashSessionOpen",
  FINANCE_CASH_SESSION_CLOSE: "finance:cashSessionClose",
  FINANCE_CASH_RECORD_ADJUSTMENT: "finance:cashRecordAdjustment",
  FINANCE_DASHBOARD_REPORTS: "finance:dashboardReports",
  FINANCE_VEHICLE_PROFITABILITY: "finance:vehicleProfitability",
  FINANCE_VEHICLE_SUMMARY: "finance:vehicleSummary",
  FINANCE_EXPORT_CSV: "finance:exportCsv",
  MAINTENANCE_LIST: "maintenance:list",
  MAINTENANCE_GET: "maintenance:get",
  MAINTENANCE_CREATE: "maintenance:create",
  MAINTENANCE_UPDATE: "maintenance:update",
  MAINTENANCE_READ_INVOICE: "maintenance:readInvoice",
  MAINTENANCE_TYPES_LIST: "maintenance:listTypes",
  MAINTENANCE_TYPES_UPSERT: "maintenance:upsertType",
  MAINTENANCE_VEHICLE_OVERVIEW: "maintenance:vehicleOverview",
  MAINTENANCE_SCHEDULE_UPSERT: "maintenance:upsertSchedule",
  INVENTORY_OVERVIEW: "inventory:overview",
  INVENTORY_LIST: "inventory:list",
  INVENTORY_GET: "inventory:get",
  INVENTORY_UPSERT_PART: "inventory:upsertPart",
  INVENTORY_ARCHIVE_PART: "inventory:archivePart",
  INVENTORY_MOVEMENTS_LIST: "inventory:listMovements",
  INVENTORY_RECORD_MOVEMENT: "inventory:recordMovement",
  INVENTORY_ADJUST_STOCK: "inventory:adjustStock",
  DOCUMENTS_GENERATE: "documents:generate",
  DOCUMENTS_LIST: "documents:list",
  DOCUMENTS_GET: "documents:get",
  DOCUMENTS_READ: "documents:read",
  DOCUMENTS_REPRINT: "documents:reprint",
  DOCUMENTS_LIST_PRINTERS: "documents:listPrinters",
  DOCUMENTS_PRINT: "documents:print",
  DOCUMENTS_TEMPLATES_GET: "documents:getTemplates",
  DOCUMENTS_TEMPLATES_UPDATE: "documents:updateTemplates",
  DOCUMENTS_LOGO_UPLOAD: "documents:uploadLogo",
  DOCUMENTS_LOGO_READ: "documents:readLogo",
  REPORTS_GENERATE: "reports:generate",
  REPORTS_EXPORT_FILE: "reports:exportFile",
  NOTIFICATIONS_LIST: "notifications:list",
  NOTIFICATIONS_MARK_READ: "notifications:markRead",
  NOTIFICATIONS_SYNC_ALERTS: "notifications:syncAlerts",
  NOTIFICATIONS_RESOLVE: "notifications:resolve",
  AUDIT_LIST: "audit:list",
  BACKUPS_LIST: "backups:list",
  BACKUPS_CREATE_MANUAL: "backups:createManual",
  BACKUPS_VERIFY: "backups:verify",
  BACKUPS_RESTORE: "backups:restore",
  BACKUPS_EXPORT: "backups:export",
  BACKUPS_IMPORT: "backups:import",
  BACKUPS_HEALTH: "backups:health",
  BACKUPS_RECOVERY_KEY: "backups:recoveryKey",
  BACKUPS_PICK_FILE: "backups:pickFile"
};

// electron/main/ipcRouter.ts
function createIpcHandlers(initialDb, sessionStore, vault, printAdapter = createNoopPrintAdapter(), runtimeContext) {
  let db = initialDb;
  const wrap = (fn) => {
    return async (rawPayload) => {
      try {
        const envelope = rawPayload && typeof rawPayload === "object" && ("data" in rawPayload || "token" in rawPayload) ? rawPayload : { data: rawPayload };
        const result = await fn(envelope);
        return { ok: true, data: result };
      } catch (err) {
        if (err instanceof import_zod2.ZodError) {
          return {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: err.issues[0]?.message || "Donn\xE9es invalides",
              details: err.issues
            }
          };
        }
        if (err instanceof AuthError) {
          return {
            ok: false,
            error: {
              code: err.code,
              message: err.message
            }
          };
        }
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Erreur interne du serveur"
          }
        };
      }
    };
  };
  const hasLivePerm = (userId, perm) => {
    const row = db.prepare("SELECT role_id FROM users WHERE id = ? AND is_active = 1").get(userId);
    if (!row) return false;
    return resolveEffectivePermissions(db, userId, row.role_id).includes(perm);
  };
  const requireAnyPermission = (userId, perms) => {
    if (!perms.some((p) => hasLivePerm(userId, p))) {
      throw new AuthError("FORBIDDEN", `Permission insuffisante (${perms.join(" | ")})`);
    }
  };
  return {
    [IPC_CHANNELS.AUTH_STATUS]: wrap(() => getAuthStatus(db, "desktop")),
    [IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN]: wrap((env) => {
      const parsed = BootstrapAdminSchema.parse(env.data);
      return bootstrapFirstAdmin(db, sessionStore, "desktop", parsed);
    }),
    [IPC_CHANNELS.AUTH_LOGIN]: wrap((env) => {
      const parsed = LoginSchema.parse(env.data);
      return loginUser(db, sessionStore, "desktop", parsed.username, parsed.password);
    }),
    [IPC_CHANNELS.AUTH_ME]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token, true);
      return {
        token: session2.token,
        user: session2.user,
        permissions: session2.permissions,
        isLocked: session2.isLocked,
        expiresAt: session2.expiresAt,
        runtimeMode: "desktop"
      };
    }),
    [IPC_CHANNELS.AUTH_LOCK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token, true);
      lockSession(db, sessionStore, session2.token);
      return { locked: true };
    }),
    [IPC_CHANNELS.AUTH_UNLOCK]: wrap((env) => {
      const parsed = UnlockSessionSchema.parse(env.data);
      if (!env.token) throw new AuthError("UNAUTHORIZED", "Jeton de session manquant");
      return unlockSession(db, sessionStore, env.token, parsed.password);
    }),
    [IPC_CHANNELS.AUTH_LOGOUT]: wrap((env) => {
      if (env.token) {
        logoutUser(db, sessionStore, env.token);
      }
      return { loggedOut: true };
    }),
    [IPC_CHANNELS.AUTH_CHANGE_PASSWORD]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      const parsed = ChangePasswordSchema.parse(env.data);
      changeOwnPassword(db, session2.userId, parsed.currentPassword, parsed.newPassword);
      return { changed: true };
    }),
    [IPC_CHANNELS.USERS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "users:manage");
      return listUsers(db);
    }),
    [IPC_CHANNELS.USERS_PERMISSIONS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "users:manage");
      return listAllPermissions(db);
    }),
    [IPC_CHANNELS.USERS_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "users:manage");
      const parsed = CreateUserSchema.parse(env.data);
      return createUser(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.USERS_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "users:manage");
      const parsed = UpdateUserSchema.parse(env.data);
      return updateUser(db, sessionStore, { id: session2.userId, username: session2.username }, parsed.userId, {
        fullName: parsed.fullName,
        roleCode: parsed.roleCode,
        isActive: parsed.isActive,
        unlockAccount: parsed.unlockAccount,
        resetPassword: parsed.resetPassword,
        permissionOverrides: parsed.permissionOverrides
      });
    }),
    [IPC_CHANNELS.SETTINGS_GET_ALL]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return getAllSettings(db);
    }),
    [IPC_CHANNELS.SETTINGS_UPDATE_BATCH]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "settings:manage");
      const parsed = UpdateSettingsBatchSchema.parse(env.data);
      return updateSettingsBatch(db, { id: session2.userId, username: session2.username }, parsed.updates);
    }),
    [IPC_CHANNELS.WILAYAS_LIST]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      const activeOnly = Boolean(env.data?.activeOnly);
      return listWilayas(db, activeOnly);
    }),
    [IPC_CHANNELS.WILAYAS_UPSERT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "settings:manage");
      const parsed = UpsertWilayaSchema.parse(env.data);
      return upsertWilaya(db, { id: session2.userId, username: session2.username }, {
        code: parsed.code,
        nameFr: parsed.nameFr,
        nameAr: parsed.nameAr,
        isNewlyCreated2026: parsed.isNewlyCreated2026,
        parentWilayaCode: parsed.parentWilayaCode ?? null,
        decreeReference: parsed.decreeReference ?? null,
        effectiveYear: parsed.effectiveYear,
        isActive: parsed.isActive,
        notes: parsed.notes ?? null
      });
    }),
    [IPC_CHANNELS.AUDIT_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "audit:view");
      const opts = env.data ?? {};
      return listAuditLogs(db, opts);
    }),
    // Phase 2: Fleet Management
    [IPC_CHANNELS.VEHICLES_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:read");
      return listVehicles(db, env.data);
    }),
    [IPC_CHANNELS.VEHICLES_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:read");
      return getVehicleProfile(db, Number(env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.VEHICLES_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      const parsed = CreateVehicleSchema.parse(env.data);
      return createVehicle(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.VEHICLES_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      const parsed = UpdateVehicleSchema.parse(env.data);
      return updateVehicle(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.VEHICLES_ARCHIVE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      archiveVehicle(db, { id: session2.userId, username: session2.username }, Number(env.data?.id ?? env.data));
      return { archived: true };
    }),
    [IPC_CHANNELS.VEHICLES_UPSERT_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      const parsed = UpsertVehicleDocSchema.parse(env.data);
      return upsertVehicleDocument(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.VEHICLES_CREATE_BLOCK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      const parsed = CreateBlockedPeriodSchema.parse(env.data);
      return createVehicleBlockedPeriod(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.VEHICLES_RELEASE_BLOCK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "vehicles:write");
      releaseVehicleBlockedPeriod(db, { id: session2.userId, username: session2.username }, Number(env.data?.blockId ?? env.data));
      return { released: true };
    }),
    // Phase 2: Customers & Risk
    [IPC_CHANNELS.CUSTOMERS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:read");
      return listCustomers(db, env.data);
    }),
    [IPC_CHANNELS.CUSTOMERS_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:read");
      return getCustomerProfile(db, Number(env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.CUSTOMERS_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      const parsed = CreateCustomerSchema.parse(env.data);
      return createCustomer(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CUSTOMERS_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      const parsed = UpdateCustomerSchema.parse(env.data);
      return updateCustomer(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CUSTOMERS_ARCHIVE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      archiveCustomer(db, { id: session2.userId, username: session2.username }, Number(env.data?.id ?? env.data));
      return { archived: true };
    }),
    [IPC_CHANNELS.CUSTOMERS_ADD_RISK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      const parsed = CreateRiskRecordSchema.parse(env.data);
      return addCustomerRiskRecord(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CUSTOMERS_RESOLVE_RISK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:override_blacklist");
      const parsed = ResolveRiskRecordSchema.parse(env.data);
      return resolveCustomerRiskRecord(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = UploadCustomerDocSchema.parse(env.data);
      return uploadCustomerDocument(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.CUSTOMERS_UPDATE_DOC_META]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      const parsed = UpdateCustomerDocMetaSchema.parse(env.data);
      return updateCustomerDocumentMeta(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CUSTOMERS_ARCHIVE_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:write");
      const parsed = ArchiveCustomerDocSchema.parse(env.data);
      return archiveCustomerDocument(db, { id: session2.userId, username: session2.username }, parsed.docId, parsed.reason);
    }),
    [IPC_CHANNELS.CUSTOMERS_READ_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:read");
      if (!vault) throw new Error("Vault non configur\xE9");
      return readCustomerDocument(db, vault.vaultRootDir, vault.vaultKey, Number(env.data?.docId ?? env.data));
    }),
    [IPC_CHANNELS.CUSTOMERS_CHECK_ELIGIBILITY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "customers:read");
      return checkCustomerEligibility(db, Number(env.data.customerId), String(env.data.rentalEndDate));
    }),
    // Phase 2: Pricing Engine
    [IPC_CHANNELS.PRICING_CALCULATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      const parsed = CalculatePriceSchema.parse(env.data);
      return calculateRentalPrice(db, parsed);
    }),
    [IPC_CHANNELS.PRICING_LIST_RULES]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return listPricingRules(db);
    }),
    [IPC_CHANNELS.PRICING_CREATE_SEASONAL]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "settings:manage");
      const parsed = CreateSeasonalRateSchema.parse(env.data);
      return createSeasonalRate(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.PRICING_DELETE_SEASONAL]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "settings:manage");
      deleteSeasonalRate(db, { id: session2.userId, username: session2.username }, Number(env.data?.id ?? env.data));
      return { deleted: true };
    }),
    [IPC_CHANNELS.PRICING_UPSERT_CUSTOMER_RATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "settings:manage");
      const parsed = UpsertCustomerCustomRateSchema.parse(env.data);
      return upsertCustomerCustomRate(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    // Phase 2: Planning & Reservations
    [IPC_CHANNELS.PLANNING_CALENDAR]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return getPlanningCalendar(db, String(env.data.startDate), String(env.data.endDate));
    }),
    [IPC_CHANNELS.PLANNING_CHECK_AVAILABILITY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return checkVehicleAvailability(db, env.data);
    }),
    [IPC_CHANNELS.RESERVATIONS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return listReservations(db, env.data?.status);
    }),
    [IPC_CHANNELS.RESERVATIONS_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:write");
      const parsed = CreateReservationSchema.parse(env.data);
      return createReservation(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.RESERVATIONS_UPDATE_STATUS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:write");
      const parsed = UpdateReservationStatusSchema.parse(env.data);
      return updateReservationStatus(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    // Phase 2: Rental Contracts & Extensions
    [IPC_CHANNELS.CONTRACTS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return listContracts(db, env.data);
    }),
    [IPC_CHANNELS.CONTRACTS_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:read");
      return getContractDetail(db, Number(env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.CONTRACTS_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:write");
      const parsed = CreateContractPhase2Schema.parse(env.data);
      return createContract(
        db,
        { id: session2.userId, username: session2.username },
        {
          canOverrideBlacklist: hasLivePerm(session2.userId, "customers:override_blacklist"),
          canApproveDiscount: hasLivePerm(session2.userId, "finance:approve_adjustment")
        },
        parsed
      );
    }),
    [IPC_CHANNELS.CONTRACTS_ACTIVATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:write");
      return activateContract(
        db,
        { id: session2.userId, username: session2.username },
        Number(env.data.contractId),
        env.data.departureOdometerKm != null ? Number(env.data.departureOdometerKm) : void 0
      );
    }),
    [IPC_CHANNELS.CONTRACTS_EXTEND]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:extend");
      const parsed = ExtendContractSchema.parse(env.data);
      return extendContract(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.CONTRACTS_COMPLETE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:write");
      const parsed = CompleteContractSchema.parse(env.data);
      return completeContract(
        db,
        { id: session2.userId, username: session2.username },
        hasLivePerm(session2.userId, "finance:approve_adjustment"),
        parsed
      );
    }),
    [IPC_CHANNELS.CONTRACTS_CANCEL]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "contracts:cancel");
      return cancelContract(
        db,
        { id: session2.userId, username: session2.username },
        Number(env.data.contractId),
        String(env.data.reason || "Annulation contrat")
      );
    }),
    // Phase 4 Step 1: Vehicle Inspections & Damage Management
    [IPC_CHANNELS.INSPECTIONS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inspections:view",
        "inspections:create",
        "inspections:update",
        "inspections:finalize",
        "inspections:manage_damage",
        "inspections:write",
        "contracts:read"
      ]);
      return listInspections(db, env.data);
    }),
    [IPC_CHANNELS.INSPECTIONS_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inspections:view",
        "inspections:create",
        "inspections:update",
        "inspections:finalize",
        "inspections:manage_damage",
        "inspections:write",
        "contracts:read"
      ]);
      return getInspectionDetail(db, Number(env.data?.inspectionId ?? env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.INSPECTIONS_GET_BY_CONTRACT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inspections:view",
        "inspections:create",
        "inspections:write",
        "contracts:read"
      ]);
      return getContractInspections(db, Number(env.data?.contractId ?? env.data));
    }),
    [IPC_CHANNELS.INSPECTIONS_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:create", "inspections:write"]);
      const parsed = CreateInspectionSchema.parse(env.data);
      if (parsed.finalizeNow) {
        requireAnyPermission(session2.userId, ["inspections:finalize", "inspections:write"]);
      }
      return createInspection(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.INSPECTIONS_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:update", "inspections:write"]);
      const parsed = UpdateInspectionDraftSchema.parse(env.data);
      return updateInspectionDraft(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.INSPECTIONS_FINALIZE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:finalize", "inspections:write"]);
      return finalizeInspection(
        db,
        { id: session2.userId, username: session2.username },
        Number(env.data?.inspectionId ?? env.data)
      );
    }),
    [IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:create", "inspections:update", "inspections:write"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = UploadInspectionPhotoSchema.parse(env.data);
      return uploadInspectionPhoto(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.INSPECTIONS_READ_PHOTO]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:view", "inspections:write", "contracts:read"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readInspectionPhoto(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.photoId ?? env.data)
      );
    }),
    [IPC_CHANNELS.INSPECTIONS_DELETE_PHOTO]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:update", "inspections:write"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return deleteInspectionPhoto(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        Number(env.data?.photoId ?? env.data)
      );
    }),
    [IPC_CHANNELS.INSPECTIONS_GET_PDF_PAYLOAD]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inspections:view", "inspections:write", "contracts:read", "documents:generate"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return getInspectionPdfPayload(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.inspectionId ?? env.data)
      );
    }),
    [IPC_CHANNELS.DAMAGES_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inspections:view",
        "inspections:manage_damage",
        "inspections:write",
        "vehicles:read"
      ]);
      return listVehicleDamages(db, env.data);
    }),
    [IPC_CHANNELS.DAMAGES_ADD]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inspections:create",
        "inspections:update",
        "inspections:manage_damage",
        "inspections:write"
      ]);
      const parsed = AddVehicleDamageSchema.parse(env.data);
      return addVehicleDamage(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.DAMAGES_UPDATE_STATUS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "inspections:manage_damage");
      const parsed = UpdateDamageStatusSchema.parse(env.data);
      return updateDamageStatus(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    // Phase 3: Financial Management
    [IPC_CHANNELS.FINANCE_LIST_PAYMENTS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:record_payment"]);
      return listPayments(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_RECORD_PAYMENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:record_payment");
      const parsed = RecordPaymentSchema.parse(env.data);
      return recordPayment(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_REVERSE_PAYMENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:approve_adjustment");
      const parsed = ReversePaymentSchema.parse(env.data);
      return reversePayment(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_GET_PAYMENT_RECEIPT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "finance:read",
        "finance:record_payment",
        "contracts:read",
        "documents:generate"
      ]);
      return getPaymentReceipt(db, Number(env.data?.paymentId ?? env.data));
    }),
    [IPC_CHANNELS.FINANCE_LIST_DEPOSITS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_deposit"]);
      return listDeposits(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_GET_DEPOSIT_DETAIL]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_deposit", "contracts:read"]);
      return getDepositDetail(db, Number(env.data?.depositId ?? env.data));
    }),
    [IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:manage_deposit");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = SettleDepositSchema.parse(env.data);
      return settleDeposit(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.FINANCE_READ_DEPOSIT_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_deposit"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readDepositDocument(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.depositId ?? env.data)
      );
    }),
    [IPC_CHANNELS.FINANCE_LIST_FINES]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_deposit"]);
      return listTrafficFines(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_CREATE_FINE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:manage_deposit");
      const parsed = CreateTrafficFineSchema.parse(env.data);
      return createTrafficFine(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_CUSTOMER_ACCOUNTS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "reports:view", "finance:approve_adjustment"]);
      return listCustomerFinancialAccounts(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_CUSTOMER_LEDGER]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "finance:read",
        "reports:view",
        "finance:approve_adjustment",
        "customers:read"
      ]);
      return getCustomerFinancialLedger(db, Number(env.data?.customerId ?? env.data));
    }),
    [IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:approve_adjustment");
      const parsed = CreateCustomerAdjustmentSchema.parse(env.data);
      return createCustomerAdjustment(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_LIST_SUPPLIERS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "finance:read",
        "finance:manage_expenses",
        "inventory:view",
        "inventory:manage_parts",
        "inventory:manage_suppliers",
        "inventory:read",
        "inventory:write",
        "maintenance:view",
        "maintenance:create"
      ]);
      return listSuppliers(db, Boolean(env.data?.includeArchived));
    }),
    [IPC_CHANNELS.FINANCE_CREATE_SUPPLIER]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "finance:manage_expenses",
        "inventory:manage_suppliers",
        "inventory:write"
      ]);
      const parsed = CreateSupplierSchema.parse(env.data);
      return createSupplier(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "finance:manage_expenses",
        "inventory:manage_suppliers",
        "inventory:write"
      ]);
      const parsed = UpsertSupplierSchema.parse(env.data);
      return upsertSupplier(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_LIST_EXPENSES]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_expenses"]);
      return listExpenses(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_RECORD_EXPENSE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:manage_expenses");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = CreateExpenseSchema.parse(env.data);
      return recordExpense(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.FINANCE_REVERSE_EXPENSE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:approve_adjustment");
      const parsed = ReverseExpenseSchema.parse(env.data);
      return reverseExpense(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_READ_EXPENSE_DOC]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_expenses"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readExpenseDocument(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.expenseId ?? env.data)
      );
    }),
    [IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:cash_register"]);
      return getCurrentCashSession(db);
    }),
    [IPC_CHANNELS.FINANCE_CASH_SESSION_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:cash_register"]);
      return listCashSessions(db, env.data?.limit ? Number(env.data.limit) : 90);
    }),
    [IPC_CHANNELS.FINANCE_CASH_SESSION_DETAIL]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:cash_register"]);
      return getCashSessionDetail(db, Number(env.data?.sessionId ?? env.data));
    }),
    [IPC_CHANNELS.FINANCE_CASH_SESSION_OPEN]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:cash_register");
      const parsed = OpenCashSessionSchema.parse(env.data);
      return openCashSession(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:cash_register");
      const parsed = CloseCashSessionSchema.parse(env.data);
      return closeCashSession(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_CASH_RECORD_ADJUSTMENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "finance:approve_adjustment");
      const parsed = RecordCashAdjustmentSchema.parse(env.data);
      return recordCashAdjustment(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "reports:view"]);
      return getFinancialDashboardReports(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_VEHICLE_PROFITABILITY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "reports:view"]);
      return getVehicleProfitabilityReport(db, env.data);
    }),
    [IPC_CHANNELS.FINANCE_VEHICLE_SUMMARY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "finance:manage_expenses", "reports:view"]);
      return getVehicleFinanceSummary(db, Number(env.data?.vehicleId ?? env.data));
    }),
    [IPC_CHANNELS.FINANCE_EXPORT_CSV]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["finance:read", "reports:view"]);
      const report = getFinancialDashboardReports(db, env.data);
      const lang = env.data?.lang === "ar" ? "ar" : "fr";
      return {
        fileName: `rapport-financier-${report.dateFrom}_${report.dateTo}.csv`,
        csvContent: buildFinancialReportCsv(report, lang)
      };
    }),
    // Phase 4 Step 2: Maintenance Management & Operational Alerts
    [IPC_CHANNELS.MAINTENANCE_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:view",
        "maintenance:create",
        "maintenance:update",
        "maintenance:complete",
        "maintenance:write",
        "vehicles:read"
      ]);
      return listMaintenanceRecords(db, env.data);
    }),
    [IPC_CHANNELS.MAINTENANCE_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:view",
        "maintenance:create",
        "maintenance:update",
        "maintenance:complete",
        "maintenance:write",
        "vehicles:read"
      ]);
      return getMaintenanceRecordDetail(db, Number(env.data?.recordId ?? env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.MAINTENANCE_CREATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["maintenance:create", "maintenance:write"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = CreateMaintenanceRecordSchema.parse(env.data);
      if (parsed.status === "COMPLETED") {
        requireAnyPermission(session2.userId, ["maintenance:complete", "maintenance:write"]);
      }
      if (parsed.recordInFinance) {
        requirePermission(db, session2, "finance:manage_expenses");
      }
      return createMaintenanceRecord(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.MAINTENANCE_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["maintenance:update", "maintenance:complete", "maintenance:write"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = UpdateMaintenanceRecordSchema.parse(env.data);
      if (parsed.status === "COMPLETED") {
        requireAnyPermission(session2.userId, ["maintenance:complete", "maintenance:write"]);
      }
      if (parsed.recordInFinance) {
        requirePermission(db, session2, "finance:manage_expenses");
      }
      return updateMaintenanceRecord(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.MAINTENANCE_READ_INVOICE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:view",
        "maintenance:create",
        "maintenance:update",
        "maintenance:complete",
        "maintenance:write",
        "finance:read"
      ]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readMaintenanceInvoice(
        db,
        vault.vaultRootDir,
        vault.vaultKey,
        Number(env.data?.recordId ?? env.data)
      );
    }),
    [IPC_CHANNELS.MAINTENANCE_TYPES_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:view",
        "maintenance:create",
        "maintenance:manage_types",
        "maintenance:write",
        "vehicles:read"
      ]);
      return listMaintenanceTypes(db, env.data?.includeInactive !== false);
    }),
    [IPC_CHANNELS.MAINTENANCE_TYPES_UPSERT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "maintenance:manage_types");
      const parsed = UpsertMaintenanceTypeSchema.parse(env.data);
      return upsertMaintenanceType(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.MAINTENANCE_VEHICLE_OVERVIEW]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:view",
        "maintenance:create",
        "maintenance:update",
        "maintenance:complete",
        "maintenance:write",
        "vehicles:read"
      ]);
      return getVehicleMaintenanceOverview(db, Number(env.data?.vehicleId ?? env.data));
    }),
    [IPC_CHANNELS.MAINTENANCE_SCHEDULE_UPSERT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["maintenance:manage_types", "maintenance:update", "maintenance:write"]);
      const parsed = UpsertVehicleMaintenanceScheduleSchema.parse(env.data);
      return upsertVehicleMaintenanceSchedule(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.NOTIFICATIONS_LIST]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return listOperationalAlerts(db, env.data);
    }),
    [IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return syncOperationalAlerts(db, env.data?.referenceDate);
    }),
    [IPC_CHANNELS.NOTIFICATIONS_MARK_READ]: wrap((env) => {
      requireAuthenticatedSession(db, sessionStore, env.token);
      return markAlertRead(db, Number(env.data?.alertId ?? env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.NOTIFICATIONS_RESOLVE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "maintenance:update",
        "maintenance:complete",
        "maintenance:write",
        "vehicles:write",
        "inventory:manage_parts",
        "inventory:adjust_stock"
      ]);
      return resolveAlert(
        db,
        { id: session2.userId, username: session2.username },
        Number(env.data?.alertId ?? env.data?.id ?? env.data)
      );
    }),
    // Phase 4 Step 3: Spare Parts Inventory
    [IPC_CHANNELS.INVENTORY_OVERVIEW]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inventory:view",
        "inventory:manage_parts",
        "inventory:record_movements",
        "inventory:manage_suppliers",
        "inventory:adjust_stock",
        "inventory:read",
        "inventory:write",
        "maintenance:view",
        "maintenance:create"
      ]);
      return getInventoryOverview(db);
    }),
    [IPC_CHANNELS.INVENTORY_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inventory:view",
        "inventory:manage_parts",
        "inventory:record_movements",
        "inventory:manage_suppliers",
        "inventory:adjust_stock",
        "inventory:read",
        "inventory:write",
        "maintenance:view",
        "maintenance:create",
        "maintenance:update"
      ]);
      return listInventoryParts(db, env.data);
    }),
    [IPC_CHANNELS.INVENTORY_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inventory:view",
        "inventory:manage_parts",
        "inventory:record_movements",
        "inventory:adjust_stock",
        "inventory:read",
        "inventory:write"
      ]);
      return getInventoryPartDetail(db, Number(env.data?.partId ?? env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.INVENTORY_UPSERT_PART]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inventory:manage_parts", "inventory:write"]);
      const parsed = UpsertInventoryPartSchema.parse(env.data);
      return upsertInventoryPart(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.INVENTORY_ARCHIVE_PART]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inventory:manage_parts", "inventory:write"]);
      return archiveInventoryPart(
        db,
        { id: session2.userId, username: session2.username },
        Number(env.data?.partId ?? env.data?.id ?? env.data),
        env.data?.archived !== false
      );
    }),
    [IPC_CHANNELS.INVENTORY_MOVEMENTS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "inventory:view",
        "inventory:manage_parts",
        "inventory:record_movements",
        "inventory:adjust_stock",
        "inventory:read",
        "inventory:write"
      ]);
      return listInventoryMovements(db, env.data);
    }),
    [IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["inventory:record_movements", "inventory:write"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = RecordInventoryMovementSchema.parse(env.data);
      if (parsed.movementType === "PURCHASE" && parsed.recordInFinance) {
        requirePermission(db, session2, "finance:manage_expenses");
      }
      return recordInventoryMovement(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.INVENTORY_ADJUST_STOCK]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "inventory:adjust_stock");
      const parsed = AdjustInventoryStockSchema.parse(env.data);
      return adjustInventoryStock(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    // Phase 5: Documents, PDF Generation, Templates, Printing & Reports
    [IPC_CHANNELS.DOCUMENTS_GENERATE]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "documents:generate");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = GenerateDocumentSchema.parse(env.data);
      return generateAndArchiveDocument(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.DOCUMENTS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:generate"]);
      const parsed = env.data ? ListDocumentsSchema.parse(env.data) : void 0;
      return listDocuments(db, parsed);
    }),
    [IPC_CHANNELS.DOCUMENTS_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:generate"]);
      return getDocumentById(db, Number(env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.DOCUMENTS_READ]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:generate"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readArchivedDocumentPdf(db, vault.vaultRootDir, vault.vaultKey, Number(env.data?.id ?? env.data));
    }),
    [IPC_CHANNELS.DOCUMENTS_REPRINT]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:reprint", "documents:generate"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = ReprintDocumentSchema.parse(env.data);
      return reprintArchivedDocument(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.DOCUMENTS_LIST_PRINTERS]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:generate", "documents:manage_templates"]);
      return printAdapter.listPrinters();
    }),
    [IPC_CHANNELS.DOCUMENTS_PRINT]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:reprint", "documents:generate"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = PrintDocumentSchema.parse(env.data);
      const pdf = readArchivedDocumentPdf(db, vault.vaultRootDir, vault.vaultKey, parsed.documentId);
      const printRes = await printAdapter.printPdf({
        pdfBytes: Buffer.from(pdf.base64Data, "base64"),
        documentNumber: pdf.document.documentNumber,
        format: pdf.document.format,
        printerName: parsed.printerName ?? null,
        silent: parsed.silent,
        copies: parsed.copies
      });
      const updatedDoc = recordDocumentPrintEvent(
        db,
        { id: session2.userId, username: session2.username },
        parsed.documentId,
        { printerName: parsed.printerName, copies: parsed.copies, silent: parsed.silent }
      );
      return { ...printRes, document: updatedDoc };
    }),
    [IPC_CHANNELS.DOCUMENTS_TEMPLATES_GET]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, [
        "documents:view",
        "documents:generate",
        "documents:manage_templates",
        "settings:manage"
      ]);
      return getDocumentTemplateConfig(db);
    }),
    [IPC_CHANNELS.DOCUMENTS_TEMPLATES_UPDATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:manage_templates", "settings:manage"]);
      const parsed = UpdateDocumentTemplatesSchema.parse(env.data);
      return updateDocumentTemplateConfig(db, { id: session2.userId, username: session2.username }, parsed);
    }),
    [IPC_CHANNELS.DOCUMENTS_LOGO_UPLOAD]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:manage_templates", "settings:manage"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = UploadAgencyLogoSchema.parse(env.data);
      return uploadAgencyLogo(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        parsed
      );
    }),
    [IPC_CHANNELS.DOCUMENTS_LOGO_READ]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["documents:view", "documents:generate", "documents:manage_templates", "settings:manage"]);
      if (!vault) throw new Error("Vault non configur\xE9");
      return readAgencyLogo(db, vault.vaultRootDir, vault.vaultKey);
    }),
    [IPC_CHANNELS.REPORTS_GENERATE]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requireAnyPermission(session2.userId, ["reports:view", "reports:export"]);
      const parsed = ReportFilterSchema.parse(env.data);
      return generateReportDataset(db, parsed);
    }),
    [IPC_CHANNELS.REPORTS_EXPORT_FILE]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "reports:export");
      const parsed = ExportReportSchema.parse(env.data);
      const dataset = generateReportDataset(db, { ...parsed.filter, language: parsed.language });
      if (parsed.exportFormat === "CSV") {
        const csv = buildReportCsv(dataset, parsed.language);
        return {
          exportFormat: "CSV",
          fileName: `${dataset.reportCode}_${parsed.language}.csv`,
          mimeType: "text/csv;charset=utf-8",
          base64Data: Buffer.from(csv, "utf8").toString("base64")
        };
      }
      if (parsed.exportFormat === "XLSX") {
        const buf = await buildReportXlsx(dataset, parsed.language);
        return {
          exportFormat: "XLSX",
          fileName: `${dataset.reportCode}_${parsed.language}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64Data: buf.toString("base64")
        };
      }
      if (!vault) throw new Error("Vault non configur\xE9");
      const docKind = parsed.filter.category === "FINANCIAL" ? "FINANCIAL_SUMMARY" : "CUSTOM_REPORT";
      const generated = await generateAndArchiveDocument(
        db,
        { id: session2.userId, username: session2.username },
        vault.vaultRootDir,
        vault.vaultKey,
        {
          documentKind: docKind,
          format: parsed.pdfFormat ?? "A4_PDF",
          language: parsed.language,
          numeralSystem: parsed.numeralSystem,
          dateFrom: parsed.filter.dateFrom ?? null,
          dateTo: parsed.filter.dateTo ?? null,
          customerId: parsed.filter.customerId ?? null,
          vehicleId: parsed.filter.vehicleId ?? null,
          reportFilter: parsed.filter
        }
      );
      return {
        exportFormat: "PDF",
        fileName: generated.document.originalFileName,
        mimeType: "application/pdf",
        base64Data: generated.pdfBase64,
        document: generated.document
      };
    }),
    // Phase 6: Database Health, Encrypted Backups, Recovery Key & Atomic Restore
    [IPC_CHANNELS.BACKUPS_HEALTH]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "db:health");
      if (!vault) throw new Error("Vault non configur\xE9");
      return checkDatabaseHealth(db, {
        dbPath: runtimeContext?.dbPath ?? db.name,
        migrationsDir: runtimeContext?.migrationsDir,
        vaultRootDir: vault.vaultRootDir,
        vaultProtectionMode: vault.protectionMode ?? "local_file_0600",
        deepIntegrity: env.data?.deepIntegrity !== false
      });
    }),
    [IPC_CHANNELS.BACKUPS_LIST]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      return listBackups(db, env.data?.limit ? Number(env.data.limit) : 100);
    }),
    [IPC_CHANNELS.BACKUPS_CREATE_MANUAL]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = CreateBackupSchema.parse(env.data ?? {});
      const backupDir = runtimeContext?.backupDir ?? import_node_path15.default.join(import_node_path15.default.dirname(vault.vaultRootDir), "backups");
      return createBackup(db, {
        backupDir,
        vaultRootDir: vault.vaultRootDir,
        vaultKey: vault.vaultKey,
        appVersion: runtimeContext?.appVersion ?? "1.0.0",
        backupType: parsed.backupType,
        encryptionMode: parsed.encryptionMode,
        passphrase: parsed.passphrase,
        destinationPath: parsed.destinationPath ?? null,
        notes: parsed.notes ?? null,
        actor: { id: session2.userId, username: session2.username }
      });
    }),
    [IPC_CHANNELS.BACKUPS_VERIFY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = VerifyBackupSchema.parse(env.data ?? {});
      let filePath = parsed.filePath;
      let tempPath = null;
      try {
        if (parsed.backupRecordId) {
          const rec = getBackupRecordById(db, parsed.backupRecordId);
          filePath = rec.destinationPath;
        } else if (parsed.base64Archive) {
          tempPath = import_node_path15.default.join(import_node_os4.default.tmpdir(), `agl-verify-ipc-${Date.now()}.agbkp`);
          import_node_fs14.default.writeFileSync(tempPath, Buffer.from(parsed.base64Archive, "base64"), { mode: 384 });
          filePath = tempPath;
        }
        if (!filePath) {
          throw new AuthError("VALIDATION_ERROR", "Identifiant ou fichier de sauvegarde requis");
        }
        return verifyBackupArchive({
          filePath,
          passphrase: parsed.passphrase,
          recoveryKey: parsed.recoveryKey,
          vaultKey: vault.vaultKey,
          db,
          backupRecordId: parsed.backupRecordId,
          actor: { id: session2.userId, username: session2.username }
        });
      } finally {
        if (tempPath && import_node_fs14.default.existsSync(tempPath)) {
          import_node_fs14.default.rmSync(tempPath, { force: true });
        }
      }
    }),
    [IPC_CHANNELS.BACKUPS_EXPORT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      const parsed = ExportBackupSchema.parse(env.data ?? {});
      return exportBackupFile(db, {
        backupRecordId: parsed.backupRecordId,
        destinationPath: parsed.destinationPath,
        actor: { id: session2.userId, username: session2.username }
      });
    }),
    [IPC_CHANNELS.BACKUPS_IMPORT]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = ImportBackupSchema.parse(env.data ?? {});
      const backupDir = runtimeContext?.backupDir ?? import_node_path15.default.join(import_node_path15.default.dirname(vault.vaultRootDir), "backups");
      return importBackupExternal(db, {
        backupDir,
        vaultKey: vault.vaultKey,
        sourcePath: parsed.sourcePath,
        fileName: parsed.fileName,
        base64Archive: parsed.base64Archive,
        passphrase: parsed.passphrase,
        recoveryKey: parsed.recoveryKey,
        actor: { id: session2.userId, username: session2.username }
      });
    }),
    [IPC_CHANNELS.BACKUPS_RECOVERY_KEY]: wrap((env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      if (!vault) throw new Error("Vault non configur\xE9");
      const parsed = ShowRecoveryKeySchema.parse(env.data ?? {});
      const adminRow = db.prepare(
        "SELECT password_hash, is_active FROM users WHERE id = ?"
      ).get(session2.userId);
      if (!adminRow || adminRow.is_active !== 1 || !verifyPassword(parsed.adminPassword, adminRow.password_hash)) {
        writeAuditLog(db, {
          userId: session2.userId,
          usernameSnapshot: session2.username,
          operation: "SENSITIVE_ADMIN_AUTH_FAILED",
          entityType: "users",
          entityId: session2.userId
        });
        throw new AuthError("UNAUTHORIZED", "Mot de passe administrateur incorrect");
      }
      writeAuditLog(db, {
        userId: session2.userId,
        usernameSnapshot: session2.username,
        operation: "VAULT_RECOVERY_KEY_VIEWED",
        entityType: "backup_records",
        entityId: null,
        newValue: { fingerprint: getVaultKeyFingerprint(vault.vaultKey) }
      });
      return {
        recoveryKey: formatVaultRecoveryKey(vault.vaultKey),
        fingerprint: getVaultKeyFingerprint(vault.vaultKey),
        protectionMode: vault.protectionMode ?? "local_file_0600"
      };
    }),
    [IPC_CHANNELS.BACKUPS_RESTORE]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:restore");
      if (!vault) throw new Error("Vault non configur\xE9");
      if (!runtimeContext?.migrationsDir) {
        throw new Error("Contexte migrations manquant pour la restauration");
      }
      const parsed = RestoreBackupSchema.parse(env.data ?? {});
      const adminRow = db.prepare(
        "SELECT password_hash, is_active FROM users WHERE id = ?"
      ).get(session2.userId);
      if (!adminRow || adminRow.is_active !== 1 || !verifyPassword(parsed.adminPassword, adminRow.password_hash)) {
        writeAuditLog(db, {
          userId: session2.userId,
          usernameSnapshot: session2.username,
          operation: "RESTORE_AUTH_FAILED",
          entityType: "backup_records",
          entityId: parsed.backupRecordId ?? null
        });
        throw new AuthError("UNAUTHORIZED", "Mot de passe administrateur incorrect");
      }
      const backupDir = runtimeContext.backupDir ?? import_node_path15.default.join(import_node_path15.default.dirname(vault.vaultRootDir), "backups");
      return restoreFromBackup(
        {
          getDb: () => db,
          setDb: (nextDb) => {
            db = nextDb;
            runtimeContext.onDatabaseReplaced?.(nextDb);
          },
          dbPath: runtimeContext.dbPath ?? db.name,
          migrationsDir: runtimeContext.migrationsDir,
          vaultRootDir: vault.vaultRootDir,
          vaultKey: vault.vaultKey,
          vaultProtectionMode: vault.protectionMode ?? "local_file_0600",
          backupDir,
          appVersion: runtimeContext.appVersion ?? "1.0.0"
        },
        {
          backupRecordId: parsed.backupRecordId,
          filePath: parsed.filePath,
          base64Archive: parsed.base64Archive,
          fileName: parsed.fileName,
          passphrase: parsed.passphrase,
          recoveryKey: parsed.recoveryKey,
          actor: { id: session2.userId, username: session2.username }
        }
      );
    }),
    [IPC_CHANNELS.BACKUPS_PICK_FILE]: wrap(async (env) => {
      const session2 = requireAuthenticatedSession(db, sessionStore, env.token);
      requirePermission(db, session2, "backups:manage");
      if (!runtimeContext?.pickBackupPath) {
        return { canceled: true, filePath: null };
      }
      const mode = env.data?.mode === "save" ? "save" : "open";
      const defaultFileName = typeof env.data?.defaultFileName === "string" ? env.data.defaultFileName : void 0;
      return runtimeContext.pickBackupPath({ mode, defaultFileName });
    })
  };
}
var REGISTERED_PHASE1_IPC_CHANNELS = [
  IPC_CHANNELS.AUTH_STATUS,
  IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN,
  IPC_CHANNELS.AUTH_LOGIN,
  IPC_CHANNELS.AUTH_ME,
  IPC_CHANNELS.AUTH_LOCK,
  IPC_CHANNELS.AUTH_UNLOCK,
  IPC_CHANNELS.AUTH_LOGOUT,
  IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
  IPC_CHANNELS.USERS_LIST,
  IPC_CHANNELS.USERS_PERMISSIONS,
  IPC_CHANNELS.USERS_CREATE,
  IPC_CHANNELS.USERS_UPDATE,
  IPC_CHANNELS.SETTINGS_GET_ALL,
  IPC_CHANNELS.SETTINGS_UPDATE_BATCH,
  IPC_CHANNELS.WILAYAS_LIST,
  IPC_CHANNELS.WILAYAS_UPSERT,
  IPC_CHANNELS.AUDIT_LIST
];

// electron/main/appKernel.ts
function startDesktopKernel(config) {
  const dbPath = resolveDatabasePath({
    scope: "desktop_production",
    productionDbPath: config.productionDbPath
  });
  const migrationsDir = import_node_path16.default.resolve(config.migrationsDir);
  const backupDir = import_node_path16.default.resolve(
    config.backupDir ?? import_node_path16.default.join(import_node_path16.default.dirname(import_node_path16.default.dirname(dbPath)), "backups")
  );
  const appVersion = config.appVersion ?? "1.0.0";
  let currentDb = openSqliteConnection(dbPath);
  runMigrations(currentDb, migrationsDir, {
    onBeforeApply: (pendingFiles) => {
      createPreMigrationSnapshot(currentDb, {
        dbPath,
        vaultRootDir: config.vaultRootDir,
        backupDir,
        pendingFiles
      });
    }
  });
  const vaultInfo = loadOrCreateVaultKey(config.vaultRootDir, config.safeStorage);
  const sessionStore = new SessionStore("desktop");
  let scheduler = null;
  const kernelObj = {
    get db() {
      return currentDb;
    },
    dbPath,
    vaultKey: vaultInfo.key,
    vaultProtectionMode: vaultInfo.protectionMode,
    backupDir,
    sessionStore,
    handlers: {},
    shutdown: () => {
      scheduler?.stop();
      scheduler = null;
      closeSqliteSafely(currentDb);
    }
  };
  kernelObj.handlers = createIpcHandlers(
    currentDb,
    sessionStore,
    {
      vaultRootDir: config.vaultRootDir,
      vaultKey: vaultInfo.key,
      protectionMode: vaultInfo.protectionMode
    },
    config.printAdapter,
    {
      dbPath,
      migrationsDir,
      backupDir,
      appVersion,
      onDatabaseReplaced: (nextDb) => {
        currentDb = nextDb;
      },
      pickBackupPath: config.pickBackupPath
    }
  );
  if (config.enableAutoBackupScheduler) {
    scheduler = startBackupScheduler({
      getDb: () => currentDb,
      backupDir,
      vaultRootDir: config.vaultRootDir,
      vaultKey: vaultInfo.key,
      appVersion
    });
  }
  return kernelObj;
}

// electron/main/windowConfig.ts
var import_node_path17 = __toESM(require("node:path"), 1);
function buildSecureWindowOptions(preloadPath, options) {
  return {
    width: 1400,
    height: 860,
    minWidth: 1200,
    minHeight: 720,
    title: "Gestion Agence de Location \u2014 \u062A\u0633\u064A\u064A\u0631 \u0648\u0643\u0627\u0644\u0629 \u0643\u0631\u0627\u0621 \u0627\u0644\u0633\u064A\u0627\u0631\u0627\u062A",
    show: false,
    autoHideMenuBar: true,
    ...options?.iconPath ? { icon: import_node_path17.default.resolve(options.iconPath) } : {},
    webPreferences: {
      preload: import_node_path17.default.resolve(preloadPath),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: Boolean(options?.isDev)
    }
  };
}
function isAllowedRendererNavigation(targetUrl, isDev, devServerOrigin = "http://localhost:3000") {
  try {
    const parsed = new URL(targetUrl);
    if (isDev && parsed.origin === devServerOrigin) {
      return true;
    }
    return parsed.protocol === "file:";
  } catch {
    return false;
  }
}
function buildDesktopCspHeader(isDev, devServerOrigin = "http://localhost:3000") {
  const wsOrigin = isDev && devServerOrigin ? devServerOrigin.replace(/^http/i, "ws") : "";
  const connectSources = isDev && devServerOrigin ? `'self' ${devServerOrigin} ${wsOrigin}` : `'self'`;
  const scriptSources = isDev ? `'self' 'unsafe-inline'` : `'self'`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSources}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSources}`,
    `frame-src 'self' blob:`,
    `object-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `base-uri 'self'`,
    `form-action 'self'`
  ].join("; ");
}

// electron/main/index.ts
var kernel = null;
var mainWindow = null;
function resolveMigrationsDir() {
  const candidates = [
    import_node_path18.default.resolve(__dirname, "../../electron/database/migrations"),
    import_node_path18.default.resolve(__dirname, "../database/migrations"),
    import_node_path18.default.resolve(import_electron.app.getAppPath(), "electron/database/migrations")
  ];
  for (const dir of candidates) {
    if (import_node_fs15.default.existsSync(dir)) return dir;
  }
  return candidates[0];
}
function resolveWindowIconPath() {
  const candidates = [
    import_node_path18.default.resolve(__dirname, "../../build/icon.png"),
    import_node_path18.default.resolve(import_electron.app.getAppPath(), "build/icon.png")
  ];
  return candidates.find((p) => import_node_fs15.default.existsSync(p));
}
async function createMainWindow() {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : "";
  const preloadPath = import_node_path18.default.join(__dirname, "../preload/index.js");
  const win = new import_electron.BrowserWindow(
    buildSecureWindowOptions(preloadPath, {
      isDev,
      iconPath: resolveWindowIconPath()
    })
  );
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedRendererNavigation(targetUrl, isDev, devOrigin)) {
      event.preventDefault();
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(import_node_path18.default.resolve(__dirname, "../../dist/index.html"));
  }
}
import_electron.app.whenReady().then(async () => {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : "";
  import_electron.session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  import_electron.session.defaultSession.setPermissionCheckHandler(() => false);
  import_electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = buildDesktopCspHeader(isDev, devOrigin);
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });
  const userDataDir = import_electron.app.getPath("userData");
  const migrationsDir = resolveMigrationsDir();
  kernel = startDesktopKernel({
    productionDbPath: import_node_path18.default.join(userDataDir, "data", "agency_erp.db"),
    migrationsDir,
    vaultRootDir: import_node_path18.default.join(userDataDir, "secure_vault"),
    backupDir: import_node_path18.default.join(userDataDir, "backups"),
    appVersion: import_electron.app.getVersion(),
    safeStorage: import_electron.safeStorage,
    enableAutoBackupScheduler: true,
    printAdapter: createElectronPrintAdapter({ BrowserWindow: import_electron.BrowserWindow }),
    pickBackupPath: async ({ mode, defaultFileName }) => {
      const parentWin = mainWindow ?? import_electron.BrowserWindow.getFocusedWindow() ?? void 0;
      if (mode === "save") {
        const res2 = await import_electron.dialog.showSaveDialog(parentWin, {
          title: "Exporter la sauvegarde chiffr\xE9e",
          defaultPath: defaultFileName || "AGL-BACKUP.agbkp",
          filters: [{ name: "Sauvegarde Agence Chiffr\xE9e", extensions: ["agbkp"] }]
        });
        return { canceled: res2.canceled, filePath: res2.filePath || null };
      }
      const res = await import_electron.dialog.showOpenDialog(parentWin, {
        title: "S\xE9lectionner un fichier de sauvegarde chiffr\xE9 (.agbkp)",
        properties: ["openFile"],
        filters: [{ name: "Sauvegarde Agence Chiffr\xE9e", extensions: ["agbkp"] }]
      });
      return { canceled: res.canceled, filePath: res.filePaths[0] || null };
    }
  });
  for (const [channel, handler] of Object.entries(kernel.handlers)) {
    import_electron.ipcMain.handle(channel, async (_event, payload) => handler(payload));
  }
  await createMainWindow();
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron.app.quit();
  }
});
import_electron.app.on("before-quit", () => {
  kernel?.shutdown();
  kernel = null;
});
//# sourceMappingURL=index.js.map
