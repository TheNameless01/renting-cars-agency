import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import type {
  BackupEncryptionMode,
  BackupRecord,
  BackupVerificationResult,
  DatabaseHealthReport,
  VaultRecoveryInfo,
} from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, isDesktopRuntime } from '../../lib/apiClient.ts';

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

export function BackupsPage() {
  const { hasPermission } = useAuth();
  const { t, lang } = useI18n();
  const { showSuccess, showError } = useToast();

  const canManageBackups = hasPermission('backups:manage');
  const canRestore = hasPermission('backups:restore');
  const canCheckHealth = hasPermission('db:health');

  const [health, setHealth] = useState<DatabaseHealthReport | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Create Backup form state
  const [encryptionMode, setEncryptionMode] = useState<BackupEncryptionMode>('VAULT_RECOVERY_KEY');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [notes, setNotes] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);

  // Vault Recovery Key modal & state
  const [showRecoveryAuthModal, setShowRecoveryAuthModal] = useState(false);
  const [recoveryAdminPassword, setRecoveryAdminPassword] = useState('');
  const [recoveryInfo, setRecoveryInfo] = useState<VaultRecoveryInfo | null>(null);
  const [loadingRecovery, setLoadingRecovery] = useState(false);

  // Verify Result modal / Passphrase prompt
  const [verifyTargetRecord, setVerifyTargetRecord] = useState<BackupRecord | null>(null);
  const [verifySecret, setVerifySecret] = useState('');
  const [verifyResult, setVerifyResult] = useState<BackupVerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Import External Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importSourcePath, setImportSourcePath] = useState('');
  const [importBase64, setImportBase64] = useState('');
  const [importSecret, setImportSecret] = useState('');
  const [importing, setImporting] = useState(false);

  // Atomic Restore Modal
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restoreAdminPassword, setRestoreAdminPassword] = useState('');
  const [restoreDecryptSecret, setRestoreDecryptSecret] = useState('');
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadData = useCallback(async () => {
    if (!canManageBackups && !canCheckHealth) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [h, list] = await Promise.all([
        canCheckHealth ? erpClient.getDatabaseHealth(true) : Promise.resolve(null),
        canManageBackups ? erpClient.listBackups(100) : Promise.resolve([]),
      ]);
      setHealth(h);
      setBackups(list);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [canManageBackups, canCheckHealth, showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRunHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const report = await erpClient.getDatabaseHealth(true);
      setHealth(report);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleCreateBackup = async (customPath?: string | null) => {
    if (encryptionMode === 'PASSPHRASE') {
      if (passphrase.length < 8 || passphrase !== passphraseConfirm) {
        showError(t.backups.passphraseMismatch);
        return;
      }
    }
    setCreatingBackup(true);
    try {
      const res = await erpClient.createBackup({
        backupType: 'MANUAL',
        encryptionMode,
        passphrase: encryptionMode === 'PASSPHRASE' ? passphrase : undefined,
        destinationPath: customPath ?? null,
        notes: notes.trim() || null,
      });
      setVerifyResult(res.verification);
      setPassphrase('');
      setPassphraseConfirm('');
      setNotes('');
      showSuccess(t.backups.verifySuccess);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRevealRecoveryKey = async () => {
    setLoadingRecovery(true);
    try {
      const info = await erpClient.getVaultRecoveryKey(recoveryAdminPassword);
      setRecoveryInfo(info);
      setRecoveryAdminPassword('');
      setShowRecoveryAuthModal(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoadingRecovery(false);
    }
  };

  const handleCopyRecoveryKey = async () => {
    if (!recoveryInfo) return;
    try {
      await navigator.clipboard.writeText(recoveryInfo.recoveryKey);
      showSuccess(t.backups.copiedNotice);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleVerifyRecord = async (record: BackupRecord, secret?: string) => {
    if (record.encryptionMode === 'PASSPHRASE' && !secret) {
      setVerifyTargetRecord(record);
      setVerifySecret('');
      return;
    }
    setVerifying(true);
    try {
      const res = await erpClient.verifyBackup({
        backupRecordId: record.id,
        passphrase: record.encryptionMode === 'PASSPHRASE' ? secret : undefined,
      });
      setVerifyTargetRecord(null);
      setVerifySecret('');
      setVerifyResult(res);
      if (res.valid) {
        showSuccess(t.backups.verifySuccess);
      } else {
        showError(res.errorMessage || t.backups.failedBadge);
      }
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setVerifying(false);
    }
  };

  const handleExportRecord = async (record: BackupRecord) => {
    try {
      let destinationPath: string | undefined;
      if (isDesktopRuntime()) {
        const picked = await erpClient.pickBackupPath({
          mode: 'save',
          defaultFileName: record.fileName || `backup-${record.id}.agbkp`,
        });
        if (picked.canceled || !picked.filePath) return;
        destinationPath = picked.filePath;
      }

      const exported = await erpClient.exportBackup({
        backupRecordId: record.id,
        destinationPath,
      });

      if (exported.base64Archive) {
        const bin = Uint8Array.from(atob(exported.base64Archive), (c) => c.charCodeAt(0));
        const blob = new Blob([bin], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exported.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }

      showSuccess(t.backups.exportSuccess);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handlePickImportFileDesktop = async () => {
    const picked = await erpClient.pickBackupPath({ mode: 'open' });
    if (!picked.canceled && picked.filePath) {
      setImportSourcePath(picked.filePath);
      setImportBase64('');
      setImportFileName(picked.filePath.split(/[\\/]/).pop() || picked.filePath);
    }
  };

  const handleImportFileBrowser = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setImportFileName(file.name);
    setImportBase64(b64);
    setImportSourcePath('');
  };

  const handleImportSubmit = async () => {
    setImporting(true);
    try {
      const secretTrimmed = importSecret.trim();
      const looksLikeRecoveryKey = /^AGL-RK1-/i.test(secretTrimmed);
      const res = await erpClient.importBackup({
        sourcePath: importSourcePath || undefined,
        fileName: importFileName || undefined,
        base64Archive: importBase64 || undefined,
        passphrase: secretTrimmed && !looksLikeRecoveryKey ? secretTrimmed : undefined,
        recoveryKey: looksLikeRecoveryKey ? secretTrimmed : undefined,
      });
      setShowImportModal(false);
      setImportFileName('');
      setImportSourcePath('');
      setImportBase64('');
      setImportSecret('');
      setVerifyResult(res.verification);
      showSuccess(t.backups.importSuccess);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setImporting(false);
    }
  };

  const handleRestoreSubmit = async () => {
    if (!restoreTarget || !restoreConfirmed) return;
    setRestoring(true);
    try {
      const secretTrimmed = restoreDecryptSecret.trim();
      const looksLikeRecoveryKey = /^AGL-RK1-/i.test(secretTrimmed);
      await erpClient.restoreBackup({
        backupRecordId: restoreTarget.id,
        adminPassword: restoreAdminPassword,
        passphrase:
          restoreTarget.encryptionMode === 'PASSPHRASE' || (secretTrimmed && !looksLikeRecoveryKey)
            ? secretTrimmed
            : undefined,
        recoveryKey: looksLikeRecoveryKey ? secretTrimmed : undefined,
      });
      setRestoreTarget(null);
      setRestoreAdminPassword('');
      setRestoreDecryptSecret('');
      setRestoreConfirmed(false);
      showSuccess(t.backups.restoreSuccess);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setRestoring(false);
    }
  };

  if (!canManageBackups && !canCheckHealth) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl p-8 text-center max-w-xl mx-auto mt-8">
        <ShieldAlert className="w-10 h-10 text-rose-600 dark:text-rose-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {t.backups.accessDeniedTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{t.backups.accessDeniedDesc}</p>
      </div>
    );
  }

  const statusBadge =
    health?.overallStatus === 'HEALTHY' ? (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {t.backups.statusHealthy}
      </span>
    ) : health?.overallStatus === 'WARNING' ? (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" />
        {t.backups.statusWarning}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
        <ShieldAlert className="w-3.5 h-3.5" />
        {t.backups.statusCritical}
      </span>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t.backups.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{t.backups.subtitle}</p>
        </div>
        {canManageBackups && (
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Upload className="w-4 h-4" />
            <span>{t.backups.importExternal}</span>
          </button>
        )}
      </div>

      {/* Section 1: Database Health & Integrity */}
      {canCheckHealth && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-blue-900 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.backups.healthTitle}
              </h3>
              {health && statusBadge}
            </div>
            <button
              type="button"
              disabled={checkingHealth || loading}
              onClick={() => void handleRunHealthCheck()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
              <span>{t.backups.runHealthCheck}</span>
            </button>
          </div>

          {health && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricTile
                  label={t.backups.sqliteMode}
                  value={`${health.journalMode.toUpperCase()} / ${health.synchronousMode}`}
                />
                <MetricTile label={t.backups.schemaVersion} value={`v${health.schemaVersion}`} />
                <MetricTile
                  label={t.backups.dbSize}
                  value={formatBytes(health.dbSizeBytes + health.walSizeBytes)}
                />
                <MetricTile label={t.backups.freeDisk} value={formatBytes(health.freeDiskBytes)} />
                <MetricTile
                  label={t.backups.vaultProtection}
                  value={
                    health.vaultProtectionMode === 'dpapi_safestorage'
                      ? t.backups.dpapiMode
                      : t.backups.localFileMode
                  }
                />
                <MetricTile
                  label={t.backups.referencedFiles}
                  value={`${health.vaultFileCount} / ${health.missingReferencedAttachments}`}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {health.checks.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-xs"
                  >
                    {c.status === 'OK' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : c.status === 'WARNING' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {lang === 'ar' ? c.messageAr : c.messageFr}
                      </div>
                      {c.details && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 break-all">
                          {c.details}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* Section 2: Create Backup + Vault Recovery Key */}
      {canManageBackups && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Create Manual Encrypted Backup */}
          <section className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-blue-900 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.backups.createCardTitle}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.backups.encryptionModeLabel}
                </label>
                <select
                  value={encryptionMode}
                  onChange={(e) => setEncryptionMode(e.target.value as BackupEncryptionMode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="VAULT_RECOVERY_KEY">{t.backups.modeVaultKey}</option>
                  <option value="PASSPHRASE">{t.backups.modePassphrase}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.backups.notesLabel}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                />
              </div>

              {encryptionMode === 'PASSPHRASE' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t.backups.passphraseLabel}
                    </label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t.backups.passphraseConfirmLabel}
                    </label>
                    <input
                      type="password"
                      value={passphraseConfirm}
                      onChange={(e) => setPassphraseConfirm(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              {isDesktopRuntime() && (
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={async () => {
                    const picked = await erpClient.pickBackupPath({
                      mode: 'save',
                      defaultFileName: `AGL-BACKUP-${new Date().toISOString().slice(0, 10)}.agbkp`,
                    });
                    if (!picked.canceled && picked.filePath) {
                      await handleCreateBackup(picked.filePath);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>{t.backups.exportAction}</span>
                </button>
              )}
              <button
                type="button"
                disabled={creatingBackup}
                onClick={() => void handleCreateBackup(null)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{creatingBackup ? t.backups.creating : t.backups.createAction}</span>
              </button>
            </div>
          </section>

          {/* Vault Emergency Recovery Key Card */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t.backups.recoveryCardTitle}
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t.backups.recoveryCardDesc}
              </p>
            </div>

            {recoveryInfo ? (
              <div className="space-y-2.5">
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
                  <div className="text-[11px] font-medium text-amber-800 dark:text-amber-300 mb-1">
                    {t.backups.fingerprintLabel}: {recoveryInfo.fingerprint}
                  </div>
                  <div
                    dir="ltr"
                    className="font-mono text-xs break-all select-all text-slate-900 dark:text-slate-100"
                  >
                    {recoveryInfo.recoveryKey}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyRecoveryKey()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t.backups.copyRecoveryKey}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecoveryInfo(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>{t.backups.hideRecoveryKey}</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRecoveryAdminPassword('');
                  setShowRecoveryAuthModal(true);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-950/60"
              >
                <Eye className="w-4 h-4" />
                <span>{t.backups.revealRecoveryKey}</span>
              </button>
            )}
          </section>
        </div>
      )}

      {/* Section 3: Backup History Table */}
      {canManageBackups && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {t.backups.historyTitle}
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{backups.length}</span>
          </div>

          {backups.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {t.backups.emptyHistory}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colDate}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colType}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colFile}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colSize}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colAttachments}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{t.backups.colStatus}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{t.backups.colActions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {backups.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px]" dir="ltr">
                        {rec.createdAt.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium">
                          {rec.backupType === 'AUTO'
                            ? t.backups.typeAuto
                            : rec.backupType === 'PRE_RESTORE'
                              ? t.backups.typePreRestore
                              : t.backups.typeManual}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate" dir="ltr">
                          {rec.fileName || rec.destinationPath}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate" dir="ltr">
                          {rec.encryptionMode === 'PASSPHRASE' ? 'PASSPHRASE' : 'VAULT_KEY'} · v{rec.schemaVersion ?? '009'} ·{' '}
                          {rec.checksumSha256.slice(0, 12)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatBytes(rec.fileSizeBytes)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{rec.attachmentCount ?? 0}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {rec.status === 'FAILED' || rec.verificationStatus === 'FAILED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-medium">
                            {t.backups.failedBadge}
                          </span>
                        ) : rec.verificationStatus === 'VERIFIED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-medium">
                            {t.backups.verifiedBadge}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-medium">
                            {t.backups.pendingBadge}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-end">
                        {rec.status === 'SUCCESS' && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={verifying}
                              onClick={() => void handleVerifyRecord(rec)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>{t.backups.verifyAction}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExportRecord(rec)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{t.backups.exportAction}</span>
                            </button>
                            {canRestore && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRestoreTarget(rec);
                                  setRestoreAdminPassword('');
                                  setRestoreDecryptSecret('');
                                  setRestoreConfirmed(false);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/60 font-medium"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>{t.backups.restoreAction}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal 1: Admin Password Check before revealing Vault Recovery Key */}
      <ModalDialog
        open={showRecoveryAuthModal}
        onClose={() => setShowRecoveryAuthModal(false)}
        title={t.backups.recoveryAuthTitle}
        subtitle={t.backups.recoveryAuthDesc}
        size="sm"
        onSubmit={(e) => {
          e.preventDefault();
          void handleRevealRecoveryKey();
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowRecoveryAuthModal(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!recoveryAdminPassword || loadingRecovery}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {t.backups.confirmRevealBtn}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t.backups.adminPasswordLabel}
          </label>
          <input
            type="password"
            required
            autoFocus
            value={recoveryAdminPassword}
            onChange={(e) => setRecoveryAdminPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Modal 2: Passphrase Prompt for Verifying Passphrase-Encrypted Archive */}
      <ModalDialog
        open={Boolean(verifyTargetRecord)}
        onClose={() => setVerifyTargetRecord(null)}
        title={t.backups.verifyAction}
        size="sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (verifyTargetRecord) void handleVerifyRecord(verifyTargetRecord, verifySecret);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setVerifyTargetRecord(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!verifySecret || verifying}
              className="px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
            >
              {t.backups.verifyAction}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t.backups.passphraseLabel}
          </label>
          <input
            type="password"
            required
            autoFocus
            value={verifySecret}
            onChange={(e) => setVerifySecret(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Modal 3: Verification Result Summary */}
      <ModalDialog
        open={Boolean(verifyResult)}
        onClose={() => setVerifyResult(null)}
        title={t.backups.verifyResultTitle}
        size="md"
        footer={
          <button
            type="button"
            onClick={() => setVerifyResult(null)}
            className="px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold"
          >
            {t.common.close}
          </button>
        }
      >
        {verifyResult && (
          <div className="space-y-3 text-xs">
            <div
              className={`p-3 rounded-lg border font-medium ${
                verifyResult.valid
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
              }`}
            >
              {verifyResult.valid ? t.backups.verifySuccess : verifyResult.errorMessage}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetricTile label={t.backups.colFile} value={verifyResult.fileName} />
              <MetricTile label={t.backups.schemaVersion} value={`v${verifyResult.schemaVersion}`} />
              <MetricTile
                label={t.backups.colAttachments}
                value={`${verifyResult.verifiedAttachmentCount} / ${verifyResult.attachmentCount}`}
              />
              <MetricTile
                label={t.backups.recordSummary}
                value={`${verifyResult.recordCounts.vehicles}V · ${verifyResult.recordCounts.customers}C · ${verifyResult.recordCounts.contracts}CT`}
              />
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Modal 4: Import External .agbkp Archive */}
      <ModalDialog
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={t.backups.importModalTitle}
        size="md"
        onSubmit={(e) => {
          e.preventDefault();
          void handleImportSubmit();
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={(!importSourcePath && !importBase64) || importing}
              className="px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
            >
              {t.backups.importAction}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t.backups.selectArchiveFile}
            </label>
            {isDesktopRuntime() ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handlePickImportFileDesktop()}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-medium"
                >
                  {t.backups.selectArchiveFile}
                </button>
                <span className="text-slate-600 dark:text-slate-400 truncate" dir="ltr">
                  {importFileName || '—'}
                </span>
              </div>
            ) : (
              <input
                type="file"
                accept=".agbkp"
                onChange={(e) => void handleImportFileBrowser(e)}
                className="block w-full text-xs"
              />
            )}
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.backups.decryptSecretLabel}
            </label>
            <input
              type="password"
              value={importSecret}
              onChange={(e) => setImportSecret(e.target.value)}
              placeholder="Passphrase ou AGL-RK1-..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
        </div>
      </ModalDialog>

      {/* Modal 5: Atomic Restore with Mandatory Admin Verification */}
      <ModalDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        title={t.backups.restoreModalTitle}
        size="md"
        onSubmit={(e) => {
          e.preventDefault();
          void handleRestoreSubmit();
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRestoreTarget(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!restoreConfirmed || !restoreAdminPassword || restoring}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {t.backups.confirmRestoreBtn}
            </button>
          </>
        }
      >
        {restoreTarget && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 leading-relaxed">
              {t.backups.restoreModalWarning}
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono" dir="ltr">
              {restoreTarget.fileName || restoreTarget.destinationPath}
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t.backups.adminPasswordLabel}
              </label>
              <input
                type="password"
                required
                value={restoreAdminPassword}
                onChange={(e) => setRestoreAdminPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t.backups.decryptSecretLabel}
              </label>
              <input
                type="password"
                value={restoreDecryptSecret}
                onChange={(e) => setRestoreDecryptSecret(e.target.value)}
                placeholder={
                  restoreTarget.encryptionMode === 'PASSPHRASE'
                    ? t.backups.passphraseLabel
                    : 'Optionnel en local (AGL-RK1-...)'
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={restoreConfirmed}
                onChange={(e) => setRestoreConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {t.backups.confirmRestoreCheckbox}
              </span>
            </label>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1 truncate" dir="ltr">
        {value}
      </div>
    </div>
  );
}
