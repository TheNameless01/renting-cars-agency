import { Building, Download, Eye, FileText, Plus, RotateCcw, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import type {
  CurrencyCode,
  ExpenseCategory,
  GeneratedDocument,
  PaymentMethod,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type ExpenseItemDto, type SupplierDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';

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

const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function ExpensesTab({ defaultVehicleId }: { defaultVehicleId?: number }) {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [expenses, setExpenses] = useState<ExpenseItemDto[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [scope, setScope] = useState<'ALL' | 'VEHICLE' | 'AGENCY'>(defaultVehicleId ? 'VEHICLE' : 'ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // New expense modal
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('MAINTENANCE');
  const [expVehicleId, setExpVehicleId] = useState(defaultVehicleId ? String(defaultVehicleId) : '');
  const [expSupplierId, setExpSupplierId] = useState('');
  const [expMethod, setExpMethod] = useState<PaymentMethod>('CASH');
  const [expRef, setExpRef] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expAmountMajor, setExpAmountMajor] = useState('');
  const [expCurrency, setExpCurrency] = useState<CurrencyCode>('DZD');
  const [expDesc, setExpDesc] = useState('');
  const [expReceiptFile, setExpReceiptFile] = useState<File | null>(null);

  // Suppliers modal + quick add
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supSpecialty, setSupSpecialty] = useState('');
  const [supNif, setSupNif] = useState('');
  const [supAddress, setSupAddress] = useState('');

  // Reverse confirmation
  const [reverseTarget, setReverseTarget] = useState<ExpenseItemDto | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [submittingReverse, setSubmittingReverse] = useState(false);

  // Encrypted receipt preview
  const [previewDoc, setPreviewDoc] = useState<{
    originalFileName: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<GeneratedDocument | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);

  const canManageExpenses = hasPermission('finance:manage_expenses');
  const canReverseExpenses = hasPermission('finance:approve_adjustment');
  const canGenerateDoc = hasPermission('documents:generate');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [expRows, supRows, vehRows] = await Promise.all([
        erpClient.listExpenses({
          scope,
          vehicleId: defaultVehicleId,
          category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search.trim() || undefined,
        }),
        erpClient.listSuppliers(),
        erpClient.listVehicles({ includeArchived: false }),
      ]);
      setExpenses(expRows);
      setSuppliers(supRows);
      setVehicles(vehRows);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, dateFrom, dateTo, defaultVehicleId, scope, search, showError, statusFilter, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openExpenseModal = () => {
    setExpCategory('MAINTENANCE');
    setExpVehicleId(defaultVehicleId ? String(defaultVehicleId) : '');
    setExpSupplierId('');
    setExpMethod('CASH');
    setExpRef('');
    setExpDate(new Date().toISOString().slice(0, 10));
    setExpAmountMajor('');
    setExpCurrency('DZD');
    setExpDesc('');
    setExpReceiptFile(null);
    setShowExpenseModal(true);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setExpReceiptFile(null);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(f.type)) {
      showError('Format non supporté (PDF, JPG, PNG, WebP)');
      e.target.value = '';
      setExpReceiptFile(null);
      return;
    }
    if (f.size > MAX_DOC_BYTES) {
      showError(t.dialogs.fileTooLarge);
      e.target.value = '';
      setExpReceiptFile(null);
      return;
    }
    setExpReceiptFile(f);
  };

  const handleSubmitExpense = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingExpense(true);
    try {
      let receiptDoc: {
        originalFileName: string;
        mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
        base64Data: string;
      } | null = null;

      if (expReceiptFile) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || '');
            resolve(res.includes(',') ? res.split(',')[1] : res);
          };
          reader.onerror = () => reject(new Error(t.common.error));
          reader.readAsDataURL(expReceiptFile);
        });
        receiptDoc = {
          originalFileName: expReceiptFile.name,
          mimeType: expReceiptFile.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
          base64Data,
        };
      }

      const created = await erpClient.recordExpense({
        category: expCategory,
        vehicleId: expVehicleId ? Number(expVehicleId) : null,
        supplierId: expSupplierId ? Number(expSupplierId) : null,
        amountMinor: toMinorUnits(Number(expAmountMajor || 0)),
        currency: expCurrency,
        expenseDate: expDate,
        paymentMethod: expMethod,
        paymentReference: expRef.trim() || null,
        description: expDesc.trim(),
        receiptDoc,
      });
      showSuccess(created.expenseNumber);
      setShowExpenseModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingExpense(false);
    }
  };

  const handleCreateSupplier = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingSupplier(true);
    try {
      const created = await erpClient.createSupplier({
        name: supName.trim(),
        phone: supPhone.trim() || null,
        specialty: supSpecialty.trim() || null,
        nifNumber: supNif.trim() || null,
        address: supAddress.trim() || null,
      });
      showSuccess(created.name);
      setShowNewSupplierModal(false);
      setSupName('');
      setSupPhone('');
      setSupSpecialty('');
      setSupNif('');
      setSupAddress('');
      const supRows = await erpClient.listSuppliers();
      setSuppliers(supRows);
      setExpSupplierId(String(created.id));
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingSupplier(false);
    }
  };

  const handleOpenReceipt = async (expenseId: number) => {
    try {
      const doc = await erpClient.readExpenseDoc(expenseId);
      setPreviewDoc(doc);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleGenerateExpensePdf = async (expenseId: number) => {
    setGeneratingPdf(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'EXPENSE_RECEIPT',
        expenseId,
        format: 'A4_PDF',
        language: lang,
        numeralSystem: numerals,
      });
      setGeneratedDoc(res.document);
      setGeneratedPdfBase64(res.pdfBase64);
      setDocPreviewOpen(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleConfirmReverse = async () => {
    if (!reverseTarget || reverseReason.trim().length < 3) return;
    setSubmittingReverse(true);
    try {
      await erpClient.reverseExpense(reverseTarget.id, reverseReason.trim());
      showSuccess(t.finance.expenses.statusReversed);
      setReverseTarget(null);
      setReverseReason('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmittingReverse(false);
    }
  };

  const totalPosted = expenses
    .filter((e) => e.status === 'POSTED' && e.currency === 'DZD')
    .reduce((acc, e) => acc + e.amountMinor, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.contracts.searchPlaceholder}
              className="w-full ps-8 pe-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
          {!defaultVehicleId && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'ALL' | 'VEHICLE' | 'AGENCY')}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ALL">{t.finance.expenses.scopeAll}</option>
              <option value="VEHICLE">{t.finance.expenses.scopeVehicle}</option>
              <option value="AGENCY">{t.finance.expenses.scopeAgency}</option>
            </select>
          )}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.contracts.filterAll}</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t.finance.expenseCategories[cat]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="ALL">{t.contracts.filterAll}</option>
            <option value="POSTED">{t.finance.expenses.statusPosted}</option>
            <option value="REVERSED">{t.finance.expenses.statusReversed}</option>
          </select>
          <input
            type="date"
            dir="ltr"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
          />
          <input
            type="date"
            dir="ltr"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono-tabular"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!defaultVehicleId && (
            <button
              type="button"
              onClick={() => setShowSuppliersModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Building className="w-3.5 h-3.5" />
              <span>
                {t.finance.expenses.suppliersBtn} ({formatDigits(suppliers.length, numerals)})
              </span>
            </button>
          )}
          {canManageExpenses && (
            <button
              type="button"
              onClick={openExpenseModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.finance.expenses.newExpense}</span>
            </button>
          )}
        </div>
      </div>

      {/* Subtotal Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {t.finance.reports.totalExpenses} ({formatDigits(expenses.filter((e) => e.status === 'POSTED').length, numerals)})
        </span>
        <span className="text-base font-bold font-mono-tabular text-rose-700 dark:text-rose-400">
          {formatCurrencyMinor(totalPosted, 'DZD', lang, numerals)}
        </span>
      </div>

      {/* Expenses Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">N° / {t.finance.expenses.expenseDate}</th>
                <th className="px-4 py-3 text-start">{t.finance.expenses.category}</th>
                <th className="px-4 py-3 text-start">{t.finance.expenses.scopeLabel}</th>
                <th className="px-4 py-3 text-start">{t.finance.expenses.description}</th>
                <th className="px-4 py-3 text-start">{t.finance.expenses.paymentMethod}</th>
                <th className="px-4 py-3 text-end">{t.finance.expenses.amount}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {t.finance.expenses.emptyExpenses}
                  </td>
                </tr>
              ) : (
                expenses.map((ex) => (
                  <tr key={ex.id} className={ex.status === 'REVERSED' ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 font-mono-tabular">
                      <div className="font-semibold">{formatDigits(ex.expenseNumber, numerals)}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatDigits(ex.expenseDate, numerals)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <div>{t.finance.expenseCategories[ex.category]}</div>
                      {ex.status === 'REVERSED' && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 text-[10px]">
                          {t.finance.expenses.statusReversed}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {ex.vehicleId && ex.vehicleLabel ? (
                        <Link
                          to={`/vehicles/${ex.vehicleId}`}
                          className="text-blue-700 dark:text-blue-400 hover:underline font-medium"
                        >
                          {ex.vehicleLabel}
                        </Link>
                      ) : (
                        <span className="text-slate-500">{t.finance.expenses.agencyGeneral}</span>
                      )}
                      {ex.supplierName && (
                        <div className="text-[11px] text-slate-500">{ex.supplierName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{ex.description}</div>
                      {ex.reversalReason && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                          {ex.reversalReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{t.finance.methods[ex.paymentMethod]}</div>
                      {ex.paymentReference && (
                        <div className="font-mono-tabular text-[11px] text-slate-500">
                          {ex.paymentReference}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end font-mono-tabular font-semibold text-rose-700 dark:text-rose-400">
                      {formatCurrencyMinor(ex.amountMinor, ex.currency, lang, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        {canGenerateDoc && (
                          <button
                            type="button"
                            disabled={generatingPdf}
                            onClick={() => void handleGenerateExpensePdf(ex.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <FileText className="w-3 h-3 text-blue-700 dark:text-blue-400" />
                            <span>{t.documents.triggers.expenseReceiptPdf}</span>
                          </button>
                        )}
                        {ex.hasReceiptDoc && (
                          <button
                            type="button"
                            onClick={() => void handleOpenReceipt(ex.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Eye className="w-3 h-3" />
                            <span>{t.finance.expenses.viewReceipt}</span>
                          </button>
                        )}
                        {canReverseExpenses && ex.status === 'POSTED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReverseTarget(ex);
                              setReverseReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{t.finance.expenses.reverseExpense}</span>
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

      {/* Record Expense Modal */}
      <ModalDialog
        open={showExpenseModal}
        onClose={() => {
          if (!submittingExpense) setShowExpenseModal(false);
        }}
        title={t.finance.expenses.newExpense}
        size="lg"
        disableClose={submittingExpense}
        onSubmit={handleSubmitExpense}
        footer={
          <>
            <button
              type="button"
              disabled={submittingExpense}
              onClick={() => setShowExpenseModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingExpense}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingExpense ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.expenses.category} *</label>
            <select
              data-autofocus
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t.finance.expenseCategories[cat]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.vehicleOptional}
            </label>
            <select
              value={expVehicleId}
              disabled={Boolean(defaultVehicleId)}
              onChange={(e) => setExpVehicleId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-70"
            >
              <option value="">{t.finance.expenses.agencyGeneral}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} ({v.matricule})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.supplierOptional}
            </label>
            <div className="flex gap-1.5">
              <select
                value={expSupplierId}
                onChange={(e) => setExpSupplierId(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                <option value="">{t.finance.expenses.noSupplier}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewSupplierModal(true)}
                title={t.finance.expenses.newSupplierBtn}
                className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.expenseDate} *
            </label>
            <input
              type="date"
              required
              dir="ltr"
              value={expDate}
              onChange={(e) => setExpDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.amount} ({expCurrency}) *
            </label>
            <input
              type="number"
              required
              min={0.01}
              step="0.01"
              dir="ltr"
              value={expAmountMajor}
              onChange={(e) => setExpAmountMajor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.paymentMethod}
            </label>
            <select
              value={expMethod}
              onChange={(e) => setExpMethod(e.target.value as PaymentMethod)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER'] as const).map((m) => (
                <option key={m} value={m}>
                  {t.finance.methods[m]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.paymentRef}
            </label>
            <input
              dir="ltr"
              value={expRef}
              onChange={(e) => setExpRef(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t.finance.expenses.receiptFile}
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
              <Upload className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">
                {expReceiptFile ? expReceiptFile.name : t.customers.vault.selectFile}
              </span>
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.expenses.description} *
          </label>
          <textarea
            rows={2}
            required
            minLength={3}
            value={expDesc}
            onChange={(e) => setExpDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Suppliers Directory Modal */}
      <ModalDialog
        open={showSuppliersModal}
        onClose={() => setShowSuppliersModal(false)}
        title={t.finance.expenses.suppliersBtn}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowSuppliersModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.close}
            </button>
            {canManageExpenses && (
              <button
                type="button"
                onClick={() => setShowNewSupplierModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.finance.expenses.newSupplierBtn}</span>
              </button>
            )}
          </>
        }
      >
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-start">{t.finance.expenses.supplierName}</th>
                <th className="px-3 py-2.5 text-start">{t.finance.expenses.supplierSpecialty}</th>
                <th className="px-3 py-2.5 text-start">{t.customers.phone}</th>
                <th className="px-3 py-2.5 text-start">{t.finance.expenses.supplierNif}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    {t.finance.expenses.emptySuppliers}
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2.5 font-semibold">{s.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{s.specialty || '—'}</td>
                    <td className="px-3 py-2.5 font-mono-tabular">{s.phone || '—'}</td>
                    <td className="px-3 py-2.5 font-mono-tabular">{s.nifNumber || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ModalDialog>

      {/* Nested Quick-Create Supplier Modal */}
      <ModalDialog
        open={showNewSupplierModal}
        onClose={() => {
          if (!submittingSupplier) setShowNewSupplierModal(false);
        }}
        title={t.finance.expenses.newSupplierBtn}
        size="sm"
        disableClose={submittingSupplier}
        onSubmit={handleCreateSupplier}
        footer={
          <>
            <button
              type="button"
              disabled={submittingSupplier}
              onClick={() => setShowNewSupplierModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submittingSupplier}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {submittingSupplier ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.expenses.supplierName} *</label>
          <input
            required
            data-autofocus
            value={supName}
            onChange={(e) => setSupName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.phone}</label>
            <input
              dir="ltr"
              value={supPhone}
              onChange={(e) => setSupPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.finance.expenses.supplierNif}</label>
            <input
              dir="ltr"
              value={supNif}
              onChange={(e) => setSupNif(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.finance.expenses.supplierSpecialty}</label>
          <input
            value={supSpecialty}
            onChange={(e) => setSupSpecialty(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.customers.address}</label>
          <input
            value={supAddress}
            onChange={(e) => setSupAddress(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Decrypted Expense Receipt Preview */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.originalFileName ?? t.finance.expenses.receiptFile}
        size="lg"
        footer={
          previewDoc && (
            <>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                {t.common.close}
              </button>
              <a
                href={`data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`}
                download={previewDoc.originalFileName}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.dialogs.downloadDoc}</span>
              </a>
            </>
          )
        }
      >
        {previewDoc &&
          (previewDoc.mimeType === 'application/pdf' ? (
            <iframe
              title={previewDoc.originalFileName}
              src={`data:application/pdf;base64,${previewDoc.base64Data}`}
              className="w-full h-[65vh] rounded-lg border border-slate-200 dark:border-slate-800"
            />
          ) : (
            <img
              src={`data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`}
              alt={previewDoc.originalFileName}
              className="max-h-[65vh] mx-auto rounded-lg object-contain"
            />
          ))}
      </ModalDialog>

      {/* Reverse Expense Confirmation */}
      <ConfirmDialog
        open={Boolean(reverseTarget)}
        onClose={() => {
          if (!submittingReverse) setReverseTarget(null);
        }}
        onConfirm={handleConfirmReverse}
        tone="danger"
        loading={submittingReverse}
        title={t.finance.expenses.reverseTitle}
        description={
          reverseTarget
            ? `${reverseTarget.expenseNumber} · ${reverseTarget.description} · ${formatCurrencyMinor(
                reverseTarget.amountMinor,
                reverseTarget.currency,
                lang,
                numerals
              )}`
            : ''
        }
        warningText={t.finance.expenses.reverseWarn}
        confirmLabel={t.finance.expenses.reverseExpense}
      >
        <div>
          <label className="block text-xs font-medium mb-1">
            {t.finance.expenses.reverseReason} *
          </label>
          <textarea
            rows={2}
            required
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ConfirmDialog>

      <DocumentPreviewModal
        open={docPreviewOpen}
        onClose={() => setDocPreviewOpen(false)}
        initialDocument={generatedDoc}
        initialPdfBase64={generatedPdfBase64}
      />
    </div>
  );
}
