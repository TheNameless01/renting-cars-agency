import {
  BarChart3,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Info,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AppLanguage,
  Customer,
  DocumentKind,
  ExpenseCategory,
  GeneratedDocument,
  ReportCategory,
  ReportDataset,
  ReportExportFormat,
  ReportFilter,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';
import {
  formatCurrencyMinor,
  formatDateTimeAlgiers,
  formatDigits,
} from '../../lib/formatters.ts';
import { downloadBase64File } from '../../lib/pdfExport.ts';

const REPORT_CATEGORIES: ReportCategory[] = ['FINANCIAL', 'FLEET', 'OPERATIONAL', 'CUSTOM'];

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'MAINTENANCE',
  'REPAIRS',
  'SPARE_PARTS',
  'INSURANCE',
  'VIGNETTE',
  'TECHNICAL_INSPECTION',
  'CLEANING',
  'ADMINISTRATIVE',
  'OTHER',
];

const CUSTOM_SECTION_OPTIONS = [
  { key: 'finance', labelKey: 'sectionFinance' },
  { key: 'fleet', labelKey: 'sectionFleet' },
  { key: 'contracts', labelKey: 'sectionContracts' },
  { key: 'maintenance', labelKey: 'sectionMaintenance' },
  { key: 'documents', labelKey: 'sectionDocuments' },
] as const;

const ALL_DOC_KINDS: DocumentKind[] = [
  'RENTAL_CONTRACT',
  'CONTRACT_AMENDMENT',
  'DEPARTURE_INSPECTION',
  'RETURN_INSPECTION',
  'DAMAGE_REPORT',
  'PAYMENT_RECEIPT',
  'DEPOSIT_RECEIPT',
  'DEPOSIT_SETTLEMENT',
  'INVOICE',
  'EXPENSE_RECEIPT',
  'MAINTENANCE_REPORT',
  'VEHICLE_HISTORY',
  'CUSTOMER_STATEMENT',
  'CASH_REGISTER_CLOSING',
  'FINANCIAL_SUMMARY',
  'CUSTOM_REPORT',
];

export function ReportsPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();

  const canViewReports = hasPermission('reports:view') || hasPermission('reports:export');
  const canExport = hasPermission('reports:export');

  const [category, setCategory] = useState<ReportCategory>('FINANCIAL');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [documentKind, setDocumentKind] = useState<string>('');
  const [expenseCategory, setExpenseCategory] = useState<string>('');
  const [contractStatus, setContractStatus] = useState<string>('');
  const [reportLang, setReportLang] = useState<AppLanguage>(lang);
  const [customSections, setCustomSections] = useState<string[]>([
    'finance',
    'fleet',
    'contracts',
    'maintenance',
    'documents',
  ]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dataset, setDataset] = useState<ReportDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<{
    open: boolean;
    document?: GeneratedDocument | null;
    pdfBase64?: string | null;
  }>({ open: false });

  useEffect(() => {
    let active = true;
    Promise.allSettled([erpClient.listCustomers(), erpClient.listVehicles()]).then(([cRes, vRes]) => {
      if (!active) return;
      if (cRes.status === 'fulfilled') setCustomers(cRes.value);
      if (vRes.status === 'fulfilled') setVehicles(vRes.value);
    });
    return () => {
      active = false;
    };
  }, []);

  const buildFilter = useCallback(
    (overrideCat?: ReportCategory): ReportFilter => ({
      category: overrideCat ?? category,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      customerId: customerId ? Number(customerId) : null,
      vehicleId: vehicleId ? Number(vehicleId) : null,
      documentKind: (documentKind || null) as DocumentKind | null,
      expenseCategory: expenseCategory || null,
      status: contractStatus || null,
      includeSections: (overrideCat ?? category) === 'CUSTOM' ? customSections : undefined,
      language: reportLang,
    }),
    [
      category,
      dateFrom,
      dateTo,
      customerId,
      vehicleId,
      documentKind,
      expenseCategory,
      contractStatus,
      customSections,
      reportLang,
    ]
  );

  const loadReport = useCallback(
    async (overrideCat?: ReportCategory) => {
      if (!canViewReports) return;
      setLoading(true);
      try {
        const res = await erpClient.generateReport(buildFilter(overrideCat));
        setDataset(res);
      } catch (err) {
        showError(err instanceof Error ? err.message : t.common.error);
      } finally {
        setLoading(false);
      }
    },
    [canViewReports, buildFilter, showError, t.common.error]
  );

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleResetFilters = () => {
    const d = new Date();
    setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setDateTo(new Date().toISOString().slice(0, 10));
    setCustomerId('');
    setVehicleId('');
    setDocumentKind('');
    setExpenseCategory('');
    setContractStatus('');
  };

  const handleToggleSection = (sec: string) => {
    setCustomSections((prev) =>
      prev.includes(sec) ? (prev.length > 1 ? prev.filter((s) => s !== sec) : prev) : [...prev, sec]
    );
  };

  const handleExport = async (
    exportFormat: ReportExportFormat,
    pdfFormat?: 'A4_PDF' | 'A4_LANDSCAPE_PDF'
  ) => {
    if (!canExport) return;
    const tag = pdfFormat ?? exportFormat;
    setExporting(tag);
    try {
      const res = await erpClient.exportReportFile({
        filter: buildFilter(),
        exportFormat,
        pdfFormat,
        language: reportLang,
        numeralSystem: numerals,
      });
      if (exportFormat === 'PDF' && res.document) {
        setPreviewDoc({
          open: true,
          document: res.document,
          pdfBase64: res.base64Data,
        });
      } else {
        downloadBase64File(res.fileName, res.mimeType, res.base64Data);
        showSuccess(res.fileName);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setExporting(null);
    }
  };

  const renderCellValue = (
    val: string | number | boolean | null | undefined,
    colType: 'text' | 'number' | 'currency_minor' | 'date' | 'percent'
  ) => {
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val === 'boolean') return val ? t.common.yes : t.common.no;
    if (colType === 'currency_minor' && typeof val === 'number') {
      return formatCurrencyMinor(val, 'DZD', reportLang, numerals);
    }
    if (colType === 'percent' && typeof val === 'number') {
      return `${formatDigits(val.toFixed(1), numerals)}%`;
    }
    if (colType === 'number' && typeof val === 'number') {
      return formatDigits(val.toLocaleString(), numerals);
    }
    if (colType === 'date' && typeof val === 'string') {
      return val.length > 10
        ? formatDateTimeAlgiers(val, reportLang, numerals)
        : formatDigits(val, numerals);
    }
    return formatDigits(String(val), numerals);
  };

  if (!canViewReports) {
    return (
      <div className="p-6 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ShieldAlert className="w-5 h-5" />
          <span>{t.finance.noAccessTitle}</span>
        </div>
        <p className="text-xs">{t.reports.adminOnlyExportNotice}</p>
        {hasPermission('finance:read') && (
          <Link
            to="/finance"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900 text-white text-xs font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t.reports.openFinanceDashboard}</span>
          </Link>
        )}
      </div>
    );
  }

  const disclosures =
    dataset && (reportLang === 'ar' ? dataset.accountingDisclosuresAr : dataset.accountingDisclosuresFr);

  return (
    <div className="space-y-5">
      {/* Header & Category Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {t.reports.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.reports.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPermission('finance:read') && (
            <Link
              to="/finance"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t.reports.openFinanceDashboard}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Category Switcher + Exports Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {REPORT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                category === cat
                  ? 'bg-blue-900 dark:bg-blue-700 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{t.reports.tabs[cat]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() => void handleExport('CSV')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{exporting === 'CSV' ? t.common.loading : t.reports.exportCsv}</span>
          </button>

          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() => void handleExport('XLSX')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{exporting === 'XLSX' ? t.common.loading : t.reports.exportXlsx}</span>
          </button>

          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() => void handleExport('PDF', 'A4_PDF')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{exporting === 'A4_PDF' ? t.common.loading : t.reports.exportPdfPortrait}</span>
          </button>

          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() => void handleExport('PDF', 'A4_LANDSCAPE_PDF')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>
              {exporting === 'A4_LANDSCAPE_PDF' ? t.common.loading : t.reports.exportPdfLandscape}
            </span>
          </button>
        </div>
      </div>

      {/* Filters Card */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="block text-xs space-y-1">
            <span className="text-slate-500 dark:text-slate-400">{t.reports.filters.dateFrom}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-slate-500 dark:text-slate-400">{t.reports.filters.dateTo}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-slate-500 dark:text-slate-400">{t.reports.filters.customer}</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            >
              <option value="">{t.reports.filters.allCustomers}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-slate-500 dark:text-slate-400">{t.reports.filters.vehicle}</span>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            >
              <option value="">{t.reports.filters.allVehicles}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>
          </label>

          {category === 'FINANCIAL' ? (
            <label className="block text-xs space-y-1">
              <span className="text-slate-500 dark:text-slate-400">
                {t.reports.filters.expenseCategory}
              </span>
              <select
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="">{t.reports.filters.allExpenseCategories}</option>
                {EXPENSE_CATEGORIES.map((ec) => (
                  <option key={ec} value={ec}>
                    {t.finance.expenseCategories[ec]}
                  </option>
                ))}
              </select>
            </label>
          ) : category === 'CUSTOM' ? (
            <label className="block text-xs space-y-1">
              <span className="text-slate-500 dark:text-slate-400">
                {t.reports.filters.documentKind}
              </span>
              <select
                value={documentKind}
                onChange={(e) => setDocumentKind(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="">{t.reports.filters.allDocKinds}</option>
                {ALL_DOC_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.documents.kinds[k]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-xs space-y-1">
              <span className="text-slate-500 dark:text-slate-400">
                {t.reports.filters.contractStatus}
              </span>
              <select
                value={contractStatus}
                onChange={(e) => setContractStatus(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="">{t.reports.filters.allContractStatuses}</option>
                {(['DRAFT', 'CONFIRMED', 'ACTIVE', 'EXTENDED', 'COMPLETED', 'CANCELLED'] as const).map(
                  (st) => (
                    <option key={st} value={st}>
                      {t.contracts.statuses[st]}
                    </option>
                  )
                )}
              </select>
            </label>
          )}

          <div className="flex items-end gap-2">
            <label className="flex-1 block text-xs space-y-1">
              <span className="text-slate-500 dark:text-slate-400">
                {t.reports.filters.reportLanguage}
              </span>
              <select
                value={reportLang}
                onChange={(e) => setReportLang(e.target.value as AppLanguage)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="fr">FR</option>
                <option value="ar">AR</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadReport()}
              title={t.reports.filters.applyFilters}
              className="p-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              title={t.reports.filters.resetFilters}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        {category === 'CUSTOM' && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-4">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {t.reports.filters.customSectionsLabel} :
            </span>
            {CUSTOM_SECTION_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={customSections.includes(opt.key)}
                  onChange={() => handleToggleSection(opt.key)}
                />
                <span>{t.reports.filters[opt.labelKey]}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Explicit Accounting & Methodology Disclosures */}
      {disclosures && disclosures.length > 0 && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 dark:text-blue-200">
            <Info className="w-4 h-4 shrink-0" />
            <span>{t.reports.disclosuresTitle}</span>
          </div>
          <ul className="list-disc ps-5 space-y-1 text-xs text-blue-900/90 dark:text-blue-200/90">
            {disclosures.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPIs Grid */}
      {dataset && dataset.kpis.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {dataset.kpis.map((kpi) => {
            const toneClass =
              kpi.tone === 'positive'
                ? 'text-emerald-700 dark:text-emerald-400'
                : kpi.tone === 'warning'
                  ? 'text-amber-700 dark:text-amber-400'
                  : kpi.tone === 'danger'
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-900 dark:text-slate-100';
            return (
              <div
                key={kpi.key}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1"
              >
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {reportLang === 'ar' ? kpi.labelAr : kpi.labelFr}
                </div>
                <div className={`text-lg font-bold tabular-nums ${toneClass}`}>
                  {formatDigits(kpi.valueDisplay, numerals)}
                </div>
                {(kpi.noteFr || kpi.noteAr) && (
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {reportLang === 'ar' ? kpi.noteAr : kpi.noteFr}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Report Data Sections */}
      {dataset &&
        dataset.sections.map((section) => (
          <div
            key={section.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {reportLang === 'ar' ? section.titleAr : section.titleFr}
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">
                {formatDigits(section.rows.length, numerals)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 text-slate-600 dark:text-slate-400">
                  <tr>
                    {section.columns.map((col) => (
                      <th
                        key={col.key}
                        className={`py-2.5 px-3 font-semibold ${
                          col.type === 'number' ||
                          col.type === 'currency_minor' ||
                          col.type === 'percent'
                            ? 'text-end'
                            : 'text-start'
                        }`}
                      >
                        {reportLang === 'ar' ? col.labelAr : col.labelFr}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {section.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={section.columns.length}
                        className="py-6 px-3 text-center text-slate-500 dark:text-slate-400"
                      >
                        {t.reports.emptyRows}
                      </td>
                    </tr>
                  ) : (
                    section.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        {section.columns.map((col) => (
                          <td
                            key={col.key}
                            className={`py-2.5 px-3 ${
                              col.type === 'number' ||
                              col.type === 'currency_minor' ||
                              col.type === 'percent'
                                ? 'text-end tabular-nums font-medium'
                                : 'text-start'
                            }`}
                          >
                            {renderCellValue(row[col.key], col.type)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
                {section.totalsRow && (
                  <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 font-semibold">
                    <tr>
                      {section.columns.map((col) => (
                        <td
                          key={col.key}
                          className={`py-2.5 px-3 ${
                            col.type === 'number' ||
                            col.type === 'currency_minor' ||
                            col.type === 'percent'
                              ? 'text-end tabular-nums'
                              : 'text-start'
                          }`}
                        >
                          {renderCellValue(section.totalsRow?.[col.key], col.type)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        ))}

      <DocumentPreviewModal
        open={previewDoc.open}
        onClose={() => setPreviewDoc({ open: false })}
        initialDocument={previewDoc.document}
        initialPdfBase64={previewDoc.pdfBase64}
      />
    </div>
  );
}
