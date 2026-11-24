import { Edit3, FileText, HardDrive, Plus, RefreshCw, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { AppLanguage, AppTheme, AuditLogEntry, NumeralSystem } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { useTheme } from '../../hooks/useTheme.tsx';
import { erpClient, type WilayaDto } from '../../lib/apiClient.ts';
import { formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';

type SettingsTab = 'agency' | 'business' | 'app' | 'wilayas' | 'audit';

export function SettingsPage() {
  const { hasPermission, setAutoLockMinutes } = useAuth();
  const { t, lang, numerals, setLang, setNumerals } = useI18n();
  const { setTheme } = useTheme();
  const { showSuccess, showError } = useToast();

  const canManage = hasPermission('settings:manage');
  const canViewAudit = hasPermission('audit:view');
  const canManageBackups = hasPermission('backups:manage') || hasPermission('db:health');
  const canAccessDocTemplates =
    hasPermission('documents:manage_templates') ||
    hasPermission('documents:view') ||
    canManage;

  const [activeTab, setActiveTab] = useState<SettingsTab>('agency');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [wilayas, setWilayas] = useState<WilayaDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Wilaya filtering & edit modal
  const [wilayaSearch, setWilayaSearch] = useState('');
  const [wilayaFilter, setWilayaFilter] = useState<'all' | '2026' | 'historical'>('all');
  const [editingWilaya, setEditingWilaya] = useState<Omit<WilayaDto, 'updatedAt'> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([erpClient.getAllSettings(), erpClient.listWilayas(false)]);
      setSettings(s);
      setWilayas(w);
      if (canViewAudit) {
        const logs = await erpClient.listAuditLogs(100);
        setAuditLogs(logs);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [canViewAudit, showError, t.common.error]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const setField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveGroup = async (group: 'agency' | 'business' | 'app') => {
    if (!canManage) return;
    setSaving(true);
    try {
      const prefix = `${group}.`;
      const updates = Object.entries(settings)
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, value]) => ({ key, group, value }));
      const next = await erpClient.updateSettingsBatch(updates);
      setSettings(next);

      if (group === 'app') {
        if (next['app.default_language'] === 'fr' || next['app.default_language'] === 'ar') {
          setLang(next['app.default_language'] as AppLanguage);
        }
        if (next['app.default_theme'] === 'light' || next['app.default_theme'] === 'dark') {
          setTheme(next['app.default_theme'] as AppTheme);
        }
        if (next['app.numeral_system'] === 'latin' || next['app.numeral_system'] === 'arabic') {
          setNumerals(next['app.numeral_system'] as NumeralSystem);
        }
        const autoLockVal = Number(next['app.auto_lock_minutes'] ?? '15');
        if (Number.isFinite(autoLockVal) && autoLockVal >= 0) {
          setAutoLockMinutes(autoLockVal);
        }
      }

      showSuccess(t.settings.savedSuccess);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSaving(false);
    }
  };

  const filteredWilayas = useMemo(() => {
    const q = wilayaSearch.trim().toLowerCase();
    return wilayas.filter((w) => {
      if (wilayaFilter === '2026' && !w.isNewlyCreated2026) return false;
      if (wilayaFilter === 'historical' && w.isNewlyCreated2026) return false;
      if (!q) return true;
      return (
        w.code.toLowerCase().includes(q) ||
        w.nameFr.toLowerCase().includes(q) ||
        w.nameAr.includes(wilayaSearch.trim()) ||
        (w.parentWilayaCode ?? '').includes(q)
      );
    });
  }, [wilayas, wilayaSearch, wilayaFilter]);

  const handleSaveWilaya = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingWilaya) return;
    try {
      await erpClient.upsertWilaya(editingWilaya);
      showSuccess(t.settings.savedSuccess);
      setEditingWilaya(null);
      const refreshed = await erpClient.listWilayas(false);
      setWilayas(refreshed);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const refreshAudit = async () => {
    if (!canViewAudit) return;
    try {
      setAuditLogs(await erpClient.listAuditLogs(100));
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.settings.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.settings.subtitle}</p>
        </div>
        {canAccessDocTemplates && (
          <Link
            to="/documents?tab=templates"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
            <span>{t.documents.tabs.templates}</span>
          </Link>
        )}
      </div>

      {!canManage && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
          {t.settings.readOnlyNotice}
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-lg w-fit">
        {(
          [
            ['agency', t.settings.tabs.agency],
            ['business', t.settings.tabs.business],
            ['app', t.settings.tabs.app],
            ['wilayas', t.settings.tabs.wilayas],
            ...(canViewAudit ? [['audit', t.settings.tabs.audit]] : []),
          ] as Array<[SettingsTab, string]>
        ).map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tabId
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500">
          {t.common.loading}
        </div>
      ) : (
        <>
          {/* Tab 1: Agency & Fiscal */}
          {activeTab === 'agency' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField label={t.settings.fields.agencyName} value={settings['agency.name'] ?? ''} disabled={!canManage} onChange={(v) => setField('agency.name', v)} />
                <TextField label={t.settings.fields.commercialName} value={settings['agency.commercial_name'] ?? ''} disabled={!canManage} onChange={(v) => setField('agency.commercial_name', v)} />
                <TextField label={t.settings.fields.legalStatus} value={settings['agency.legal_status'] ?? 'Personne physique'} disabled={!canManage} onChange={(v) => setField('agency.legal_status', v)} />
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.wilaya}
                  </label>
                  <select
                    value={settings['agency.wilaya_code'] ?? '16'}
                    disabled={!canManage}
                    onChange={(e) => setField('agency.wilaya_code', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    {wilayas.filter((w) => w.isActive).map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} — {lang === 'ar' ? w.nameAr : w.nameFr}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField label={t.settings.fields.commune} value={settings['agency.commune'] ?? ''} disabled={!canManage} onChange={(v) => setField('agency.commune', v)} />
                <TextField label={t.settings.fields.address} value={settings['agency.address'] ?? ''} disabled={!canManage} onChange={(v) => setField('agency.address', v)} />
                <TextField label={t.settings.fields.phone} value={settings['agency.phone'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.phone', v)} />
                <TextField label={t.settings.fields.email} value={settings['agency.email'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.email', v)} />
                <TextField label={t.settings.fields.rc} value={settings['agency.rc'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.rc', v)} />
                <TextField label={t.settings.fields.nif} value={settings['agency.nif'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.nif', v)} />
                <TextField label={t.settings.fields.nis} value={settings['agency.nis'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.nis', v)} />
                <TextField label={t.settings.fields.art} value={settings['agency.art'] ?? ''} disabled={!canManage} dir="ltr" onChange={(v) => setField('agency.art', v)} />
              </div>

              {canManage && (
                <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveGroup('agency')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveSettings}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Business Rules */}
          {activeTab === 'business' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField label={t.settings.fields.defaultCurrency} value={settings['business.default_currency'] ?? 'DZD'} disabled onChange={() => {}} dir="ltr" />
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.allowEurDeposits}
                  </label>
                  <select
                    value={settings['business.allow_eur_deposits'] ?? 'false'}
                    disabled={!canManage}
                    onChange={(e) => setField('business.allow_eur_deposits', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="false">{t.common.no}</option>
                    <option value="true">{t.common.yes}</option>
                  </select>
                </div>
                <NumberField label={t.settings.fields.minLicenceYears} value={settings['business.min_licence_years'] ?? '2'} disabled={!canManage} onChange={(v) => setField('business.min_licence_years', v)} />
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.enforceMatriculeRegex}
                  </label>
                  <select
                    value={settings['business.enforce_matricule_regex'] ?? 'true'}
                    disabled={!canManage}
                    onChange={(e) => setField('business.enforce_matricule_regex', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="true">{t.common.yes}</option>
                    <option value="false">{t.common.no}</option>
                  </select>
                </div>
                <NumberField label={t.settings.fields.defaultDailyKm} value={settings['business.default_daily_mileage_km'] ?? '300'} disabled={!canManage} onChange={(v) => setField('business.default_daily_mileage_km', v)} />
                <NumberField
                  label={t.settings.fields.extraKmRateDzd}
                  value={String(fromMinorUnits(Number(settings['business.default_extra_km_rate_minor'] ?? 1500)))}
                  disabled={!canManage}
                  onChange={(v) => setField('business.default_extra_km_rate_minor', String(toMinorUnits(Number(v) || 0)))}
                />
                <NumberField
                  label={t.settings.fields.defaultDepositDzd}
                  value={String(fromMinorUnits(Number(settings['business.default_deposit_minor'] ?? 5000000)))}
                  disabled={!canManage}
                  onChange={(v) => setField('business.default_deposit_minor', String(toMinorUnits(Number(v) || 0)))}
                />
                <NumberField label={t.settings.fields.lateGraceMinutes} value={settings['business.late_grace_period_minutes'] ?? '60'} disabled={!canManage} onChange={(v) => setField('business.late_grace_period_minutes', v)} />
                <NumberField
                  label={t.settings.fields.lateHourlyFeeDzd}
                  value={String(fromMinorUnits(Number(settings['business.late_hourly_fee_minor'] ?? 50000)))}
                  disabled={!canManage}
                  onChange={(v) => setField('business.late_hourly_fee_minor', String(toMinorUnits(Number(v) || 0)))}
                />
                <NumberField
                  label={t.settings.fields.lateDailyFeeDzd}
                  value={String(fromMinorUnits(Number(settings['business.late_daily_fee_minor'] ?? 400000)))}
                  disabled={!canManage}
                  onChange={(v) => setField('business.late_daily_fee_minor', String(toMinorUnits(Number(v) || 0)))}
                />
                <NumberField label={t.settings.fields.maxAgentDiscount} value={settings['business.max_agent_discount_percent'] ?? '10'} disabled={!canManage} onChange={(v) => setField('business.max_agent_discount_percent', v)} />
                <NumberField label={t.settings.fields.adminDocReminderDays} value={settings['business.admin_doc_reminder_days'] ?? '30'} disabled={!canManage} onChange={(v) => setField('business.admin_doc_reminder_days', v)} />
              </div>

              {canManage && (
                <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveGroup('business')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveSettings}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Application & Backups */}
          {activeTab === 'app' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.defaultLanguage}
                  </label>
                  <select
                    value={settings['app.default_language'] ?? 'fr'}
                    disabled={!canManage}
                    onChange={(e) => setField('app.default_language', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="fr">Français (LTR)</option>
                    <option value="ar">العربية (RTL)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.defaultTheme}
                  </label>
                  <select
                    value={settings['app.default_theme'] ?? 'light'}
                    disabled={!canManage}
                    onChange={(e) => setField('app.default_theme', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="light">{t.topbar.lightTheme}</option>
                    <option value="dark">{t.topbar.darkTheme}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.numeralSystem}
                  </label>
                  <select
                    value={settings['app.numeral_system'] ?? 'latin'}
                    disabled={!canManage}
                    onChange={(e) => setField('app.numeral_system', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="latin">{t.settings.fields.numeralLatin}</option>
                    <option value="arabic">{t.settings.fields.numeralArabic}</option>
                  </select>
                </div>
                <NumberField label={t.settings.fields.autoLockMinutes} value={settings['app.auto_lock_minutes'] ?? '15'} disabled={!canManage} onChange={(v) => setField('app.auto_lock_minutes', v)} />
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.settings.fields.autoBackupEnabled}
                  </label>
                  <select
                    value={settings['app.auto_backup_enabled'] ?? 'true'}
                    disabled={!canManage}
                    onChange={(e) => setField('app.auto_backup_enabled', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
                  >
                    <option value="true">{t.common.yes}</option>
                    <option value="false">{t.common.no}</option>
                  </select>
                </div>
                <TextField label={t.settings.fields.autoBackupTime} value={settings['app.auto_backup_time'] ?? '22:00'} disabled={!canManage} dir="ltr" onChange={(v) => setField('app.auto_backup_time', v)} />
                <NumberField label={t.settings.fields.backupRetentionCount} value={settings['app.backup_retention_count'] ?? '14'} disabled={!canManage} onChange={(v) => setField('app.backup_retention_count', v)} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                {canManageBackups ? (
                  <Link
                    to="/backups"
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <HardDrive className="w-4 h-4" />
                    <span>{t.backups.openBackupsPage}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveGroup('app')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Save className="w-4 h-4" />
                    <span>{t.settings.saveSettings}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: Editable 69 Wilayas Reference */}
          {activeTab === 'wilayas' && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={wilayaSearch}
                    onChange={(e) => setWilayaSearch(e.target.value)}
                    placeholder={t.settings.wilayas.searchPlaceholder}
                    className="w-72 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
                    {(
                      [
                        ['all', t.settings.wilayas.filterAll],
                        ['2026', t.settings.wilayas.filter2026],
                        ['historical', t.settings.wilayas.filterHistorical],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setWilayaFilter(id)}
                        className={`px-2.5 py-1 rounded text-xs font-medium ${
                          wilayaFilter === id
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingWilaya({
                        code: '',
                        nameFr: '',
                        nameAr: '',
                        isNewlyCreated2026: false,
                        parentWilayaCode: null,
                        decreeReference: '',
                        effectiveYear: 2026,
                        isActive: true,
                        notes: '',
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t.settings.wilayas.addWilaya}</span>
                  </button>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[540px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.code}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.nameFr}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.nameAr}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.transition2026}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.parentWilaya}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.wilayas.decreeRef}</th>
                        {canManage && (
                          <th className="py-2.5 px-4 text-end font-medium">{t.users.actions}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {filteredWilayas.map((w) => (
                        <tr key={w.code} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 font-mono-tabular font-semibold">
                            {formatDigits(w.code, numerals)}
                          </td>
                          <td className="py-2.5 px-4 font-medium">{w.nameFr}</td>
                          <td className="py-2.5 px-4">{w.nameAr}</td>
                          <td className="py-2.5 px-4">
                            {w.isNewlyCreated2026 ? (
                              <span className="text-blue-800 dark:text-blue-400 font-medium">
                                {t.settings.wilayas.newlyCreatedLabel} ({formatDigits(w.effectiveYear, numerals)})
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                {t.settings.wilayas.historicalLabel} ({formatDigits(w.effectiveYear, numerals)})
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono-tabular text-slate-600 dark:text-slate-400">
                            {w.parentWilayaCode ? formatDigits(w.parentWilayaCode, numerals) : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                            {w.decreeReference || '—'}
                          </td>
                          {canManage && (
                            <td className="py-2.5 px-4 text-end">
                              <button
                                type="button"
                                onClick={() => setEditingWilaya({ ...w })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>{t.settings.wilayas.editWilaya}</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 5: Audit Logs */}
          {activeTab === 'audit' && canViewAudit && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void refreshAudit()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{t.settings.audit.refresh}</span>
                </button>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.audit.timestamp}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.audit.user}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.audit.operation}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.audit.entity}</th>
                        <th className="py-2.5 px-4 text-start font-medium">{t.settings.audit.details}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            {t.settings.audit.empty}
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td className="py-2.5 px-4 font-mono-tabular whitespace-nowrap">
                              {formatDateTimeAlgiers(log.createdAt, lang, numerals)}
                            </td>
                            <td className="py-2.5 px-4 font-medium">{log.usernameSnapshot}</td>
                            <td className="py-2.5 px-4 font-mono-tabular">{log.operation}</td>
                            <td className="py-2.5 px-4 font-mono-tabular">
                              {log.entityType}
                              {log.entityId ? `#${log.entityId}` : ''}
                            </td>
                            <td className="py-2.5 px-4 max-w-md truncate font-mono-tabular text-slate-600 dark:text-slate-400">
                              {log.newValueJson || log.reason || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit/Add Wilaya Modal */}
      <ModalDialog
        open={Boolean(editingWilaya)}
        onClose={() => setEditingWilaya(null)}
        title={
          editingWilaya
            ? editingWilaya.code
              ? `${t.settings.wilayas.editWilaya} — ${editingWilaya.code}`
              : t.settings.wilayas.addWilaya
            : ''
        }
        size="sm"
        onSubmit={handleSaveWilaya}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingWilaya(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.auth.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
            >
              {t.common.save}
            </button>
          </>
        }
      >
        {editingWilaya && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField
                label={t.settings.wilayas.code}
                value={editingWilaya.code}
                dir="ltr"
                onChange={(v) => setEditingWilaya({ ...editingWilaya, code: v })}
              />
              <NumberField
                label={t.settings.wilayas.effectiveYear}
                value={String(editingWilaya.effectiveYear)}
                onChange={(v) => setEditingWilaya({ ...editingWilaya, effectiveYear: Number(v) || 2026 })}
              />
            </div>
            <TextField
              label={t.settings.wilayas.nameFr}
              value={editingWilaya.nameFr}
              onChange={(v) => setEditingWilaya({ ...editingWilaya, nameFr: v })}
            />
            <TextField
              label={t.settings.wilayas.nameAr}
              value={editingWilaya.nameAr}
              dir="rtl"
              onChange={(v) => setEditingWilaya({ ...editingWilaya, nameAr: v })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField
                label={t.settings.wilayas.parentWilaya}
                value={editingWilaya.parentWilayaCode ?? ''}
                dir="ltr"
                onChange={(v) => setEditingWilaya({ ...editingWilaya, parentWilayaCode: v || null })}
              />
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.settings.wilayas.transition2026}
                </label>
                <select
                  value={editingWilaya.isNewlyCreated2026 ? '1' : '0'}
                  onChange={(e) =>
                    setEditingWilaya({ ...editingWilaya, isNewlyCreated2026: e.target.value === '1' })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="0">{t.settings.wilayas.historicalLabel}</option>
                  <option value="1">{t.settings.wilayas.newlyCreatedLabel}</option>
                </select>
              </div>
            </div>
            <TextField
              label={t.settings.wilayas.decreeRef}
              value={editingWilaya.decreeReference ?? ''}
              onChange={(v) => setEditingWilaya({ ...editingWilaya, decreeReference: v || null })}
            />
            <TextField
              label={t.settings.wilayas.notes}
              value={editingWilaya.notes ?? ''}
              onChange={(v) => setEditingWilaya({ ...editingWilaya, notes: v || null })}
            />
          </>
        )}
      </ModalDialog>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled = false,
  dir,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        disabled={disabled}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        disabled={disabled}
        dir="ltr"
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular disabled:opacity-60"
      />
    </div>
  );
}
