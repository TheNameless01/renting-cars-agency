import {
  CopyPlus,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Image as ImageIcon,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AppLanguage,
  CashRegisterSession,
  Customer,
  DocumentFormat,
  DocumentKind,
  DocumentTemplateConfig,
  GeneratedDocument,
  NumeralSystem,
  SystemPrinterInfo,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type ContractListItemDto,
  type DepositListItemDto,
  type ExpenseItemDto,
  type InspectionListItemDto,
  type MaintenanceRecordListItemDto,
  type PaymentItemDto,
} from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { downloadBase64File } from '../../lib/pdfExport.ts';

type DocumentsTab = 'archive' | 'generate' | 'templates';

const ALL_DOCUMENT_KINDS: DocumentKind[] = [
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

const ALL_FORMATS: DocumentFormat[] = [
  'A4_PDF',
  'A4_LANDSCAPE_PDF',
  'THERMAL_80MM',
  'THERMAL_58MM',
];

export function DocumentsPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = (searchParams.get('tab') as DocumentsTab) || 'archive';
  const [tab, setTab] = useState<DocumentsTab>(
    ['archive', 'generate', 'templates'].includes(initialTab) ? initialTab : 'archive'
  );

  const canGenerate = hasPermission('documents:generate');
  const canReprint = hasPermission('documents:reprint');
  const canManageTemplates =
    hasPermission('documents:manage_templates') || hasPermission('settings:manage');

  // Archive State
  const [docs, setDocs] = useState<GeneratedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<string>('');
  const [filterFormat, setFilterFormat] = useState<string>('');
  const [filterOrigin, setFilterOrigin] = useState<'all' | 'original' | 'copy'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Preview Modal State
  const [previewState, setPreviewState] = useState<{
    open: boolean;
    documentId?: number | null;
    initialDocument?: GeneratedDocument | null;
    initialPdfBase64?: string | null;
  }>({ open: false });

  // Generator State
  const [genKind, setGenKind] = useState<DocumentKind>('RENTAL_CONTRACT');
  const [genFormat, setGenFormat] = useState<DocumentFormat>('A4_PDF');
  const [genLang, setGenLang] = useState<AppLanguage>(lang);
  const [genNumerals, setGenNumerals] = useState<NumeralSystem>(numerals);
  const [genNotes, setGenNotes] = useState('');
  const [genTaxRate, setGenTaxRate] = useState('');
  const [genDateFrom, setGenDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [genDateTo, setGenDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [generating, setGenerating] = useState(false);

  // Reference lists for Generator
  const [contracts, setContracts] = useState<ContractListItemDto[]>([]);
  const [payments, setPayments] = useState<PaymentItemDto[]>([]);
  const [deposits, setDeposits] = useState<DepositListItemDto[]>([]);
  const [inspections, setInspections] = useState<InspectionListItemDto[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItemDto[]>([]);
  const [maintenanceList, setMaintenanceList] = useState<MaintenanceRecordListItemDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashSessions, setCashSessions] = useState<CashRegisterSession[]>([]);

  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>('');
  const [selectedDepositId, setSelectedDepositId] = useState<string>('');
  const [selectedInspectionId, setSelectedInspectionId] = useState<string>('');
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>('');
  const [selectedMaintenanceId, setSelectedMaintenanceId] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedCashSessionId, setSelectedCashSessionId] = useState<string>('');

  // Templates & Printers State
  const [tplConfig, setTplConfig] = useState<DocumentTemplateConfig | null>(null);
  const [logoPreview, setLogoPreview] = useState<{ mimeType: string; base64Data: string } | null>(null);
  const [printers, setPrinters] = useState<SystemPrinterInfo[]>([]);
  const [savingTpl, setSavingTpl] = useState(false);

  const switchTab = (next: DocumentsTab) => {
    setTab(next);
    setSearchParams(next === 'archive' ? {} : { tab: next });
  };

  const loadArchive = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const list = await erpClient.listDocuments({
        search: search.trim() || undefined,
        documentKind: (filterKind || undefined) as DocumentKind | undefined,
        format: (filterFormat || undefined) as DocumentFormat | undefined,
        isCopy:
          filterOrigin === 'original' ? false : filterOrigin === 'copy' ? true : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: 200,
      });
      setDocs(list);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoadingDocs(false);
    }
  }, [search, filterKind, filterFormat, filterOrigin, dateFrom, dateTo, showError, t.common.error]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  useEffect(() => {
    if (tab !== 'generate') return;
    let active = true;
    const loadSources = async () => {
      try {
        const [
          ctRes,
          payRes,
          depRes,
          insRes,
          expRes,
          mntRes,
          vehRes,
          custRes,
          cashRes,
        ] = await Promise.allSettled([
          erpClient.listContracts(),
          erpClient.listPayments(),
          erpClient.listDeposits(),
          erpClient.listInspections(),
          erpClient.listExpenses(),
          erpClient.listMaintenance(),
          erpClient.listVehicles(),
          erpClient.listCustomers(),
          erpClient.listCashSessions(60),
        ]);
        if (!active) return;
        if (ctRes.status === 'fulfilled') {
          setContracts(ctRes.value);
          if (!selectedContractId && ctRes.value[0]) setSelectedContractId(String(ctRes.value[0].id));
        }
        if (payRes.status === 'fulfilled') {
          setPayments(payRes.value);
          if (!selectedPaymentId && payRes.value[0]) setSelectedPaymentId(String(payRes.value[0].id));
        }
        if (depRes.status === 'fulfilled') {
          setDeposits(depRes.value);
          if (!selectedDepositId && depRes.value[0]) setSelectedDepositId(String(depRes.value[0].id));
        }
        if (insRes.status === 'fulfilled') {
          setInspections(insRes.value);
          if (!selectedInspectionId && insRes.value[0]) setSelectedInspectionId(String(insRes.value[0].id));
        }
        if (expRes.status === 'fulfilled') {
          setExpenses(expRes.value);
          if (!selectedExpenseId && expRes.value[0]) setSelectedExpenseId(String(expRes.value[0].id));
        }
        if (mntRes.status === 'fulfilled') {
          setMaintenanceList(mntRes.value);
          if (!selectedMaintenanceId && mntRes.value[0]) setSelectedMaintenanceId(String(mntRes.value[0].id));
        }
        if (vehRes.status === 'fulfilled') {
          setVehicles(vehRes.value);
          if (!selectedVehicleId && vehRes.value[0]) setSelectedVehicleId(String(vehRes.value[0].id));
        }
        if (custRes.status === 'fulfilled') {
          setCustomers(custRes.value);
          if (!selectedCustomerId && custRes.value[0]) setSelectedCustomerId(String(custRes.value[0].id));
        }
        if (cashRes.status === 'fulfilled') {
          setCashSessions(cashRes.value);
          if (!selectedCashSessionId && cashRes.value[0]) setSelectedCashSessionId(String(cashRes.value[0].id));
        }
      } catch {
        // Non-blocking partial loads
      }
    };
    void loadSources();
    return () => {
      active = false;
    };
  }, [
    tab,
    selectedContractId,
    selectedPaymentId,
    selectedDepositId,
    selectedInspectionId,
    selectedExpenseId,
    selectedMaintenanceId,
    selectedVehicleId,
    selectedCustomerId,
    selectedCashSessionId,
  ]);

  useEffect(() => {
    if (tab !== 'templates') return;
    let active = true;
    const loadTpl = async () => {
      try {
        const [cfg, logo, printerList] = await Promise.all([
          erpClient.getDocumentTemplates(),
          erpClient.readAgencyLogo().catch(() => null),
          erpClient.listPrinters().catch(() => [] as SystemPrinterInfo[]),
        ]);
        if (!active) return;
        setTplConfig(cfg);
        setLogoPreview(logo);
        setPrinters(printerList);
      } catch (err) {
        if (!active) return;
        showError(err instanceof Error ? err.message : t.common.error);
      }
    };
    void loadTpl();
    return () => {
      active = false;
    };
  }, [tab, showError, t.common.error]);

  const filteredInspections = useMemo(() => {
    if (genKind === 'DEPARTURE_INSPECTION') {
      return inspections.filter((i) => i.stage === 'DEPARTURE');
    }
    if (genKind === 'RETURN_INSPECTION') {
      return inspections.filter((i) => i.stage === 'RETURN');
    }
    return inspections;
  }, [inspections, genKind]);

  const handleQuickDownload = async (docId: number) => {
    try {
      const res = await erpClient.readDocumentPdf(docId);
      downloadBase64File(res.originalFileName, res.mimeType, res.base64Data);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleQuickReprint = async (doc: GeneratedDocument) => {
    try {
      const res = await erpClient.reprintDocument({
        sourceDocumentId: doc.sourceDocumentId ?? doc.id,
        format: doc.format,
        language: doc.language,
      });
      showSuccess(t.documents.preview.copyCreatedSuccess);
      await loadArchive();
      setPreviewState({
        open: true,
        initialDocument: res.document,
        initialPdfBase64: res.pdfBase64,
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const payload: Parameters<typeof erpClient.generateDocument>[0] = {
        documentKind: genKind,
        format: genFormat,
        language: genLang,
        numeralSystem: genNumerals,
        notes: genNotes.trim() || null,
      };

      if (
        genKind === 'RENTAL_CONTRACT' ||
        genKind === 'CONTRACT_AMENDMENT' ||
        genKind === 'INVOICE'
      ) {
        payload.contractId = selectedContractId ? Number(selectedContractId) : null;
        if (genKind === 'INVOICE' && genTaxRate.trim() !== '') {
          payload.taxRatePercent = Number(genTaxRate);
        }
      } else if (genKind === 'DEPARTURE_INSPECTION' || genKind === 'RETURN_INSPECTION') {
        payload.inspectionId = selectedInspectionId ? Number(selectedInspectionId) : null;
      } else if (genKind === 'DAMAGE_REPORT') {
        if (selectedInspectionId) payload.inspectionId = Number(selectedInspectionId);
        if (selectedContractId) payload.contractId = Number(selectedContractId);
      } else if (genKind === 'PAYMENT_RECEIPT') {
        payload.paymentId = selectedPaymentId ? Number(selectedPaymentId) : null;
      } else if (genKind === 'DEPOSIT_RECEIPT' || genKind === 'DEPOSIT_SETTLEMENT') {
        payload.depositId = selectedDepositId ? Number(selectedDepositId) : null;
      } else if (genKind === 'EXPENSE_RECEIPT') {
        payload.expenseId = selectedExpenseId ? Number(selectedExpenseId) : null;
      } else if (genKind === 'MAINTENANCE_REPORT') {
        payload.maintenanceRecordId = selectedMaintenanceId ? Number(selectedMaintenanceId) : null;
      } else if (genKind === 'VEHICLE_HISTORY') {
        payload.vehicleId = selectedVehicleId ? Number(selectedVehicleId) : null;
      } else if (genKind === 'CUSTOMER_STATEMENT') {
        payload.customerId = selectedCustomerId ? Number(selectedCustomerId) : null;
      } else if (genKind === 'CASH_REGISTER_CLOSING') {
        payload.cashSessionId = selectedCashSessionId ? Number(selectedCashSessionId) : null;
      } else if (genKind === 'FINANCIAL_SUMMARY' || genKind === 'CUSTOM_REPORT') {
        payload.dateFrom = genDateFrom || null;
        payload.dateTo = genDateTo || null;
        payload.reportFilter = {
          category: genKind === 'FINANCIAL_SUMMARY' ? 'FINANCIAL' : 'CUSTOM',
          dateFrom: genDateFrom || undefined,
          dateTo: genDateTo || undefined,
          language: genLang,
        };
      }

      const res = await erpClient.generateDocument(payload);
      await loadArchive();
      setPreviewState({
        open: true,
        initialDocument: res.document,
        initialPdfBase64: res.pdfBase64,
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGenerating(false);
    }
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showError(t.dialogs.fileTooLarge);
      return;
    }
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = String(reader.result || '');
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        const updated = await erpClient.uploadAgencyLogo({
          originalFileName: file.name,
          mimeType,
          base64Data,
        });
        setTplConfig(updated);
        setLogoPreview({ mimeType, base64Data });
        showSuccess(t.documents.templates.savedSuccess);
      } catch (err) {
        showError(err instanceof Error ? err.message : t.common.error);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveTemplates = async (e: FormEvent) => {
    e.preventDefault();
    if (!tplConfig) return;
    setSavingTpl(true);
    try {
      const saved = await erpClient.updateDocumentTemplates({
        defaultLanguage: tplConfig.defaultLanguage,
        defaultFormat: tplConfig.defaultFormat,
        thermalWidth: tplConfig.thermalWidth,
        defaultPrinterA4: tplConfig.defaultPrinterA4,
        defaultPrinterThermal: tplConfig.defaultPrinterThermal,
        showLogo: tplConfig.showLogo,
        showFiscalIds: tplConfig.showFiscalIds,
        showSignatureBoxes: tplConfig.showSignatureBoxes,
        invoiceFiscallyCompliant: tplConfig.invoiceFiscallyCompliant,
        invoiceTaxRatePercent: tplConfig.invoiceTaxRatePercent,
        footerFr: tplConfig.footerFr,
        footerAr: tplConfig.footerAr,
        signatureAgencyFr: tplConfig.signatureAgencyFr,
        signatureAgencyAr: tplConfig.signatureAgencyAr,
        signatureCustomerFr: tplConfig.signatureCustomerFr,
        signatureCustomerAr: tplConfig.signatureCustomerAr,
        contractTermsFr: tplConfig.contractTermsFr,
        contractTermsAr: tplConfig.contractTermsAr,
        invoiceDisclaimerFr: tplConfig.invoiceDisclaimerFr,
        invoiceDisclaimerAr: tplConfig.invoiceDisclaimerAr,
        prefixes: tplConfig.prefixes,
      });
      setTplConfig(saved);
      showSuccess(t.documents.templates.savedSuccess);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingTpl(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {t.documents.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.documents.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => switchTab('archive')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              tab === 'archive'
                ? 'bg-blue-900 dark:bg-blue-700 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t.documents.tabs.archive}</span>
          </button>

          {canGenerate && (
            <button
              type="button"
              onClick={() => switchTab('generate')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                tab === 'generate'
                  ? 'bg-blue-900 dark:bg-blue-700 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>{t.documents.tabs.generate}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => switchTab('templates')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              tab === 'templates'
                ? 'bg-blue-900 dark:bg-blue-700 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>{t.documents.tabs.templates}</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Archive */}
      {tab === 'archive' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.documents.filters.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>

            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            >
              <option value="">{t.documents.filters.allKinds}</option>
              {ALL_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.documents.kinds[k]}
                </option>
              ))}
            </select>

            <select
              value={filterFormat}
              onChange={(e) => setFilterFormat(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            >
              <option value="">{t.documents.filters.allFormats}</option>
              {ALL_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t.documents.formats[f]}
                </option>
              ))}
            </select>

            <select
              value={filterOrigin}
              onChange={(e) => setFilterOrigin(e.target.value as 'all' | 'original' | 'copy')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
            >
              <option value="all">{t.documents.filters.originAll}</option>
              <option value="original">{t.documents.filters.originOriginal}</option>
              <option value="copy">{t.documents.filters.originCopy}</option>
            </select>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <button
                type="button"
                onClick={() => void loadArchive()}
                title={t.settings.audit.refresh}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loadingDocs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.documentNumber}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.kind}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.format}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.context}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.origin}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t.documents.table.reprints}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t.documents.table.createdAt}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t.documents.table.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-slate-500 dark:text-slate-400">
                      {loadingDocs ? t.common.loading : t.documents.table.empty}
                    </td>
                  </tr>
                ) : (
                  docs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {formatDigits(doc.documentNumber, numerals)}
                      </td>
                      <td className="py-3 px-4">{t.documents.kinds[doc.documentKind]}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[11px]">
                          {t.documents.formats[doc.format]} · {doc.language.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {[doc.contractNumber, doc.customerName, doc.vehicleLabel]
                          .filter(Boolean)
                          .join(' · ') || doc.title}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${
                            doc.isCopy
                              ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                              : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {doc.isCopy
                            ? `${t.documents.table.copyTag}${doc.sourceDocumentNumber ? ` (${doc.sourceDocumentNumber})` : ''}`
                            : t.documents.table.originalTag}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end tabular-nums">
                        {formatDigits(doc.reprintCount, numerals)}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        <div>{formatDateTimeAlgiers(doc.createdAt, lang, numerals)}</div>
                        <div className="text-[11px]">{doc.generatedByUsername}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewState({ open: true, documentId: doc.id })}
                            title={t.documents.preview.title}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span><Printer className="w-3.5 h-3.5 inline" /></span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickDownload(doc.id)}
                            title={t.documents.preview.downloadPdf}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {canReprint && (
                            <button
                              type="button"
                              onClick={() => void handleQuickReprint(doc)}
                              title={t.documents.preview.reprintCopy}
                              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <CopyPlus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Generate Document */}
      {tab === 'generate' && canGenerate && (
        <form
          onSubmit={(e) => void handleGenerate(e)}
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5 max-w-4xl"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t.documents.generator.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t.documents.generator.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block text-xs space-y-1 md:col-span-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t.documents.generator.documentKind}
              </span>
              <select
                value={genKind}
                onChange={(e) => setGenKind(e.target.value as DocumentKind)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                {ALL_DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.documents.kinds[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t.documents.generator.format}
              </span>
              <select
                value={genFormat}
                onChange={(e) => setGenFormat(e.target.value as DocumentFormat)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                {ALL_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t.documents.formats[f]}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.language}
                </span>
                <select
                  value={genLang}
                  onChange={(e) => setGenLang(e.target.value as AppLanguage)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="fr">Français</option>
                  <option value="ar">العربية</option>
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.numerals}
                </span>
                <select
                  value={genNumerals}
                  onChange={(e) => setGenNumerals(e.target.value as NumeralSystem)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="latin">0-9</option>
                  <option value="arabic">٠-٩</option>
                </select>
              </label>
            </div>
          </div>

          {/* Dynamic Context Entity Pickers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            {(genKind === 'RENTAL_CONTRACT' ||
              genKind === 'CONTRACT_AMENDMENT' ||
              genKind === 'INVOICE' ||
              genKind === 'DAMAGE_REPORT') && (
              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectContract}
                </span>
                <select
                  value={selectedContractId}
                  onChange={(e) => setSelectedContractId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {contracts.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contractNumber} ({c.status}) — {formatCurrencyMinor(c.totalContractAmountMinor, c.currency, lang, numerals)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'INVOICE' && (
              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.taxRateOverride}
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={genTaxRate}
                  onChange={(e) => setGenTaxRate(e.target.value)}
                  placeholder="0 / 19"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
            )}

            {(genKind === 'DEPARTURE_INSPECTION' ||
              genKind === 'RETURN_INSPECTION' ||
              genKind === 'DAMAGE_REPORT') && (
              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectInspection}
                </span>
                <select
                  value={selectedInspectionId}
                  onChange={(e) => setSelectedInspectionId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="">—</option>
                  {filteredInspections.map((ins) => (
                    <option key={ins.id} value={ins.id}>
                      {ins.inspectionNumber} · {ins.contractNumber} · {ins.vehicleLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'PAYMENT_RECEIPT' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectPayment}
                </span>
                <select
                  value={selectedPaymentId}
                  onChange={(e) => setSelectedPaymentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {payments.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.receiptNumber} · {p.contractNumber} · {p.customerName} ·{' '}
                      {formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(genKind === 'DEPOSIT_RECEIPT' || genKind === 'DEPOSIT_SETTLEMENT') && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectDeposit}
                </span>
                <select
                  value={selectedDepositId}
                  onChange={(e) => setSelectedDepositId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {deposits.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {deposits.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.contractNumber} · {d.customerName} ·{' '}
                      {formatCurrencyMinor(d.amountMinor, d.currency, lang, numerals)} ({d.status})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'EXPENSE_RECEIPT' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectExpense}
                </span>
                <select
                  value={selectedExpenseId}
                  onChange={(e) => setSelectedExpenseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {expenses.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {expenses.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.expenseNumber} · {ex.description} ·{' '}
                      {formatCurrencyMinor(ex.amountMinor, ex.currency, lang, numerals)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'MAINTENANCE_REPORT' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectMaintenance}
                </span>
                <select
                  value={selectedMaintenanceId}
                  onChange={(e) => setSelectedMaintenanceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {maintenanceList.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {maintenanceList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.recordNumber} · {m.vehicleLabel} ({m.vehicleMatricule}) · {m.workDescription}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'VEHICLE_HISTORY' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectVehicle}
                </span>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.matricule})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'CUSTOMER_STATEMENT' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectCustomer}
                </span>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} · {c.phone}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {genKind === 'CASH_REGISTER_CLOSING' && (
              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t.documents.generator.selectCashSession}
                </span>
                <select
                  value={selectedCashSessionId}
                  onChange={(e) => setSelectedCashSessionId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {cashSessions.length === 0 && (
                    <option value="">{t.documents.generator.noEntityAvailable}</option>
                  )}
                  {cashSessions.map((cs) => (
                    <option key={cs.id} value={cs.id}>
                      #{cs.id} · {cs.sessionDate} ({cs.status})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(genKind === 'FINANCIAL_SUMMARY' || genKind === 'CUSTOM_REPORT') && (
              <>
                <label className="block text-xs space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {t.reports.filters.dateFrom}
                  </span>
                  <input
                    type="date"
                    value={genDateFrom}
                    onChange={(e) => setGenDateFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {t.reports.filters.dateTo}
                  </span>
                  <input
                    type="date"
                    value={genDateTo}
                    onChange={(e) => setGenDateTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  />
                </label>
              </>
            )}

            <label className="block text-xs space-y-1 md:col-span-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t.documents.generator.notes}
              </span>
              <input
                type="text"
                value={genNotes}
                onChange={(e) => setGenNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>{generating ? t.common.loading : t.documents.generator.generateAction}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: Templates & Print Configuration */}
      {tab === 'templates' && tplConfig && (
        <form onSubmit={(e) => void handleSaveTemplates(e)} className="space-y-5">
          {!canManageTemplates && (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{t.documents.templates.adminRestricted}</span>
            </div>
          )}

          {/* Branding & Logo */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.documents.templates.brandingTitle}
            </h3>

            <div className="flex flex-wrap items-center gap-5">
              <div className="w-28 h-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 flex items-center justify-center overflow-hidden">
                {logoPreview ? (
                  <img
                    src={`data:${logoPreview.mimeType};base64,${logoPreview.base64Data}`}
                    alt="Agency Logo"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <div className="text-center text-[11px] text-slate-400 px-2">
                    <ImageIcon className="w-5 h-5 mx-auto mb-1" />
                    {t.documents.templates.noLogo}
                  </div>
                )}
              </div>

              <div className="space-y-2 flex-1 min-w-[220px]">
                {canManageTemplates && (
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{t.documents.templates.uploadLogo}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                )}
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.documents.templates.logoHint}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canManageTemplates}
                  checked={tplConfig.showLogo}
                  onChange={(e) => setTplConfig({ ...tplConfig, showLogo: e.target.checked })}
                />
                <span>{t.documents.templates.showLogo}</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canManageTemplates}
                  checked={tplConfig.showFiscalIds}
                  onChange={(e) => setTplConfig({ ...tplConfig, showFiscalIds: e.target.checked })}
                />
                <span>{t.documents.templates.showFiscalIds}</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canManageTemplates}
                  checked={tplConfig.showSignatureBoxes}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, showSignatureBoxes: e.target.checked })
                  }
                />
                <span>{t.documents.templates.showSignatureBoxes}</span>
              </label>
            </div>
          </div>

          {/* Defaults & Printers */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.documents.templates.defaultsTitle}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.defaultLanguage}</span>
                <select
                  disabled={!canManageTemplates}
                  value={tplConfig.defaultLanguage}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, defaultLanguage: e.target.value as AppLanguage })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="fr">Français</option>
                  <option value="ar">العربية</option>
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.defaultFormat}</span>
                <select
                  disabled={!canManageTemplates}
                  value={tplConfig.defaultFormat}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, defaultFormat: e.target.value as DocumentFormat })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  {ALL_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t.documents.formats[f]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.thermalWidth}</span>
                <select
                  disabled={!canManageTemplates}
                  value={tplConfig.thermalWidth}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, thermalWidth: e.target.value as '80MM' | '58MM' })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="80MM">80 mm</option>
                  <option value="58MM">58 mm</option>
                </select>
              </label>

              <label className="block text-xs space-y-1 md:col-span-1">
                <span className="font-medium">{t.documents.templates.defaultPrinterA4}</span>
                {printers.length > 0 ? (
                  <select
                    disabled={!canManageTemplates}
                    value={tplConfig.defaultPrinterA4}
                    onChange={(e) =>
                      setTplConfig({ ...tplConfig, defaultPrinterA4: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  >
                    <option value="">{t.documents.templates.noPrinterDetected}</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled={!canManageTemplates}
                    value={tplConfig.defaultPrinterA4}
                    onChange={(e) =>
                      setTplConfig({ ...tplConfig, defaultPrinterA4: e.target.value })
                    }
                    placeholder={t.documents.templates.noPrinterDetected}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  />
                )}
              </label>

              <label className="block text-xs space-y-1 md:col-span-2">
                <span className="font-medium">{t.documents.templates.defaultPrinterThermal}</span>
                {printers.length > 0 ? (
                  <select
                    disabled={!canManageTemplates}
                    value={tplConfig.defaultPrinterThermal}
                    onChange={(e) =>
                      setTplConfig({ ...tplConfig, defaultPrinterThermal: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  >
                    <option value="">{t.documents.templates.noPrinterDetected}</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled={!canManageTemplates}
                    value={tplConfig.defaultPrinterThermal}
                    onChange={(e) =>
                      setTplConfig({ ...tplConfig, defaultPrinterThermal: e.target.value })
                    }
                    placeholder={t.documents.templates.noPrinterDetected}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                  />
                )}
              </label>
            </div>
          </div>

          {/* Fiscal Invoice, Disclaimers, Signatures & Terms */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.documents.templates.fiscalInvoiceTitle}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  disabled={!canManageTemplates}
                  checked={tplConfig.invoiceFiscallyCompliant}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, invoiceFiscallyCompliant: e.target.checked })
                  }
                />
                <span>{t.documents.templates.invoiceFiscallyCompliant}</span>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.invoiceTaxRate}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  disabled={!canManageTemplates}
                  value={tplConfig.invoiceTaxRatePercent}
                  onChange={(e) =>
                    setTplConfig({
                      ...tplConfig,
                      invoiceTaxRatePercent: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs tabular-nums"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.invoiceDisclaimerFr}</span>
                <textarea
                  rows={2}
                  disabled={!canManageTemplates}
                  value={tplConfig.invoiceDisclaimerFr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, invoiceDisclaimerFr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.invoiceDisclaimerAr}</span>
                <textarea
                  rows={2}
                  dir="rtl"
                  disabled={!canManageTemplates}
                  value={tplConfig.invoiceDisclaimerAr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, invoiceDisclaimerAr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.contractTermsFr}</span>
                <textarea
                  rows={3}
                  disabled={!canManageTemplates}
                  value={tplConfig.contractTermsFr}
                  onChange={(e) => setTplConfig({ ...tplConfig, contractTermsFr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.contractTermsAr}</span>
                <textarea
                  rows={3}
                  dir="rtl"
                  disabled={!canManageTemplates}
                  value={tplConfig.contractTermsAr}
                  onChange={(e) => setTplConfig({ ...tplConfig, contractTermsAr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.footerFr}</span>
                <input
                  type="text"
                  disabled={!canManageTemplates}
                  value={tplConfig.footerFr}
                  onChange={(e) => setTplConfig({ ...tplConfig, footerFr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.footerAr}</span>
                <input
                  type="text"
                  dir="rtl"
                  disabled={!canManageTemplates}
                  value={tplConfig.footerAr}
                  onChange={(e) => setTplConfig({ ...tplConfig, footerAr: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.signatureAgencyFr}</span>
                <input
                  type="text"
                  disabled={!canManageTemplates}
                  value={tplConfig.signatureAgencyFr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, signatureAgencyFr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.signatureAgencyAr}</span>
                <input
                  type="text"
                  dir="rtl"
                  disabled={!canManageTemplates}
                  value={tplConfig.signatureAgencyAr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, signatureAgencyAr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.signatureCustomerFr}</span>
                <input
                  type="text"
                  disabled={!canManageTemplates}
                  value={tplConfig.signatureCustomerFr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, signatureCustomerFr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">{t.documents.templates.signatureCustomerAr}</span>
                <input
                  type="text"
                  dir="rtl"
                  disabled={!canManageTemplates}
                  value={tplConfig.signatureCustomerAr}
                  onChange={(e) =>
                    setTplConfig({ ...tplConfig, signatureCustomerAr: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </label>
            </div>
          </div>

          {/* Prefixes */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.documents.templates.prefixesTitle}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {ALL_DOCUMENT_KINDS.map((k) => (
                <label key={k} className="block text-xs space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 truncate block">
                    {t.documents.kinds[k]}
                  </span>
                  <input
                    type="text"
                    maxLength={12}
                    disabled={!canManageTemplates}
                    value={tplConfig.prefixes[k] || ''}
                    onChange={(e) =>
                      setTplConfig({
                        ...tplConfig,
                        prefixes: { ...tplConfig.prefixes, [k]: e.target.value.toUpperCase() },
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs uppercase"
                  />
                </label>
              ))}
            </div>
          </div>

          {canManageTemplates && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingTpl}
                className="px-5 py-2.5 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50"
              >
                {savingTpl ? t.common.loading : t.documents.templates.saveTemplates}
              </button>
            </div>
          )}
        </form>
      )}

      <DocumentPreviewModal
        open={previewState.open}
        onClose={() => setPreviewState({ open: false })}
        documentId={previewState.documentId}
        initialDocument={previewState.initialDocument}
        initialPdfBase64={previewState.initialPdfBase64}
        onDocumentUpdated={() => {
          void loadArchive();
        }}
      />
    </div>
  );
}
