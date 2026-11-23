import {
  Archive,
  ArrowLeft,
  BookOpen,
  Building2,
  Download,
  Eye,
  FileLock2,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Upload,
  User,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toMinorUnits } from '../../../shared/constants/algeria.ts';
import type {
  CustomerDocument,
  CustomerType,
  GeneratedDocument,
  RiskLevel,
  RiskReason,
  Vehicle,
} from '../../../shared/types/domain.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DocumentPreviewModal } from '../../components/DocumentPreviewModal.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type CustomerProfileDto, type WilayaDto } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from '../../lib/formatters.ts';
import { CustomerLedgerModal } from '../finance/CustomerLedgerModal.tsx';

type CustomerTab = 'overview' | 'documents' | 'risk' | 'rates' | 'rentals';

const MAX_DOC_BYTES = 5 * 1024 * 1024;

function getCustomerDocExpiryState(
  expirationDate: string | null,
  reminderDays: number
): 'expired' | 'soon' | 'valid' | 'none' {
  if (!expirationDate) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  const exp = expirationDate.slice(0, 10);
  if (exp < today) return 'expired';
  const warnLimit = new Date(Date.now() + Math.max(0, reminderDays) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (exp <= warnLimit) return 'soon';
  return 'valid';
}

export function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [profile, setProfile] = useState<CustomerProfileDto | null>(null);
  const [wilayas, setWilayas] = useState<WilayaDto[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CustomerTab>('overview');

  // Edit customer modal (full fields including company fiscal fields)
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editType, setEditType] = useState<CustomerType>('INDIVIDUAL');
  const [editFullName, setEditFullName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSecondaryPhone, setEditSecondaryPhone] = useState('');
  const [editWilaya, setEditWilaya] = useState('');
  const [editCommune, setEditCommune] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCni, setEditCni] = useState('');
  const [editPassport, setEditPassport] = useState('');
  const [editLicence, setEditLicence] = useState('');
  const [editLicenceIssue, setEditLicenceIssue] = useState('');
  const [editLicenceExpiry, setEditLicenceExpiry] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editLegalRep, setEditLegalRep] = useState('');
  const [editRc, setEditRc] = useState('');
  const [editNif, setEditNif] = useState('');
  const [editNis, setEditNis] = useState('');
  const [editArt, setEditArt] = useState('');
  const [editBonDeCommande, setEditBonDeCommande] = useState('');

  // Document vault upload/replace/meta/archive & preview modal
  const [showArchivedDocs, setShowArchivedDocs] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [replacingDoc, setReplacingDoc] = useState<CustomerDocument | null>(null);
  const [docCategory, setDocCategory] = useState<CustomerDocument['docCategory']>('CNI');
  const [docNumber, setDocNumber] = useState('');
  const [docIssueDate, setDocIssueDate] = useState('');
  const [docExpiryDate, setDocExpiryDate] = useState('');
  const [docReminderDays, setDocReminderDays] = useState('30');
  const [docNotes, setDocNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const [editingDocMeta, setEditingDocMeta] = useState<CustomerDocument | null>(null);
  const [metaDocNumber, setMetaDocNumber] = useState('');
  const [metaIssueDate, setMetaIssueDate] = useState('');
  const [metaExpiryDate, setMetaExpiryDate] = useState('');
  const [metaReminderDays, setMetaReminderDays] = useState('30');
  const [metaNotes, setMetaNotes] = useState('');
  const [savingDocMeta, setSavingDocMeta] = useState(false);

  const [archivingDocTarget, setArchivingDocTarget] = useState<CustomerDocument | null>(null);
  const [archivingDocSubmitting, setArchivingDocSubmitting] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<{
    originalFileName: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);

  // Archive confirmation
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Risk incident form
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('MEDIUM');
  const [riskReason, setRiskReason] = useState<RiskReason>('LATE_RETURN');
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().slice(0, 10));
  const [riskDesc, setRiskDesc] = useState('');

  // Resolve risk modal
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolvingSubmitting, setResolvingSubmitting] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [nextRiskStatus, setNextRiskStatus] = useState<RiskLevel>('LOW');

  // Custom rate form
  const [rateVehicleId, setRateVehicleId] = useState('');
  const [rateCategory, setRateCategory] = useState('');
  const [rateDailyDzd, setRateDailyDzd] = useState('');
  const [rateWeeklyDzd, setRateWeeklyDzd] = useState('');
  const [rateMonthlyDzd, setRateMonthlyDzd] = useState('');
  const [rateDiscountPct, setRateDiscountPct] = useState('0');
  const [rateNotes, setRateNotes] = useState('');

  const canWrite = hasPermission('customers:write');
  const canOverrideBlacklist = hasPermission('customers:override_blacklist');
  const canManageSettings = hasPermission('settings:manage');
  const canGenerateDoc = hasPermission('documents:generate');
  const canViewFinanceLedger =
    hasPermission('finance:read') || hasPermission('finance:approve_adjustment');
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [generatingStatement, setGeneratingStatement] = useState(false);
  const [statementPreview, setStatementPreview] = useState<{
    document: GeneratedDocument;
    pdfBase64: string;
  } | null>(null);

  const syncEditFields = useCallback((prof: CustomerProfileDto) => {
    setEditType(prof.customer.customerType);
    setEditFullName(prof.customer.fullName);
    setEditDob(prof.customer.dateOfBirth ?? '');
    setEditPhone(prof.customer.phone);
    setEditSecondaryPhone(prof.customer.secondaryPhone ?? '');
    setEditWilaya(prof.customer.wilayaCode ?? '');
    setEditCommune(prof.customer.commune ?? '');
    setEditAddress(prof.customer.address ?? '');
    setEditCni(prof.customer.cniNumber ?? '');
    setEditPassport(prof.customer.passportNumber ?? '');
    setEditLicence(prof.customer.drivingLicenceNumber ?? '');
    setEditLicenceIssue(prof.customer.drivingLicenceIssueDate ?? '');
    setEditLicenceExpiry(prof.customer.drivingLicenceExpirationDate ?? '');
    setEditNotes(prof.customer.internalNotes ?? '');
    setEditCompanyName(prof.company?.companyName ?? '');
    setEditLegalRep(prof.company?.legalRepresentative ?? '');
    setEditRc(prof.company?.rcNumber ?? '');
    setEditNif(prof.company?.nifNumber ?? '');
    setEditNis(prof.company?.nisNumber ?? '');
    setEditArt(prof.company?.artNumber ?? '');
    setEditBonDeCommande(prof.company?.bonDeCommandeNumber ?? '');
  }, []);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [prof, wList, vList] = await Promise.all([
        erpClient.getCustomerProfile(Number(id)),
        erpClient.listWilayas(true),
        erpClient.listVehicles({ includeArchived: false }),
      ]);
      setProfile(prof);
      setWilayas(wList);
      setVehicles(vList);
      syncEditFields(prof);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [id, showError, syncEditFields, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openEditModal = () => {
    if (!profile) return;
    syncEditFields(profile);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingEdit(true);
    try {
      await erpClient.updateCustomer({
        id: profile.customer.id,
        customerType: editType,
        fullName: editFullName.trim(),
        dateOfBirth: editDob || null,
        phone: editPhone.trim(),
        secondaryPhone: editSecondaryPhone.trim() || null,
        wilayaCode: editWilaya || null,
        commune: editCommune.trim() || null,
        address: editAddress.trim() || null,
        cniNumber: editCni.trim() || null,
        passportNumber: editPassport.trim() || null,
        drivingLicenceNumber: editLicence.trim() || null,
        drivingLicenceIssueDate: editLicenceIssue || null,
        drivingLicenceExpirationDate: editLicenceExpiry || null,
        internalNotes: editNotes.trim() || null,
        company:
          editType === 'COMPANY'
            ? {
                companyName: editCompanyName.trim(),
                legalRepresentative: editLegalRep.trim(),
                rcNumber: editRc.trim() || null,
                nifNumber: editNif.trim() || null,
                nisNumber: editNis.trim() || null,
                artNumber: editArt.trim() || null,
                bonDeCommandeNumber: editBonDeCommande.trim() || null,
              }
            : null,
      });
      showSuccess(t.common.save);
      setShowEditModal(false);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleArchive = async () => {
    if (!profile) return;
    setArchiving(true);
    try {
      await erpClient.archiveCustomer(profile.customer.id);
      showSuccess(t.customers.archiveCustomer);
      setConfirmArchive(false);
      navigate('/customers');
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setArchiving(false);
    }
  };

  const handlePickUploadFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      showError('Format non supporté (PDF, JPG, PNG, WebP uniquement)');
      e.target.value = '';
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      showError(t.dialogs.fileTooLarge);
      e.target.value = '';
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const openUploadDocModal = (docToReplace: CustomerDocument | null = null) => {
    setReplacingDoc(docToReplace);
    setDocCategory(docToReplace ? docToReplace.docCategory : 'CNI');
    setDocNumber(docToReplace?.documentNumber ?? '');
    setDocIssueDate(docToReplace?.issueDate ?? '');
    setDocExpiryDate(docToReplace?.expirationDate ?? '');
    setDocReminderDays(String(docToReplace?.reminderDays ?? 30));
    setDocNotes(docToReplace?.notes ?? '');
    setSelectedFile(null);
    setShowUploadModal(true);
  };

  const openEditDocMetaModal = (doc: CustomerDocument) => {
    setEditingDocMeta(doc);
    setMetaDocNumber(doc.documentNumber ?? '');
    setMetaIssueDate(doc.issueDate ?? '');
    setMetaExpiryDate(doc.expirationDate ?? '');
    setMetaReminderDays(String(doc.reminderDays ?? 30));
    setMetaNotes(doc.notes ?? '');
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedFile) return;

    setUploadingDoc(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const resultStr = String(reader.result || '');
          resolve(resultStr.includes(',') ? resultStr.split(',')[1] : resultStr);
        };
        reader.onerror = () => reject(new Error(t.common.error));
        reader.readAsDataURL(selectedFile);
      });

      await erpClient.uploadCustomerDoc({
        customerId: profile.customer.id,
        docCategory,
        originalFileName: selectedFile.name,
        mimeType: selectedFile.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
        base64Data,
        documentNumber: docNumber.trim() || null,
        issueDate: docIssueDate || null,
        expirationDate: docExpiryDate || null,
        reminderDays: Math.max(0, Math.min(365, Number(docReminderDays) || 30)),
        notes: docNotes.trim() || null,
        replaceDocId: replacingDoc?.id ?? null,
      });
      showSuccess(selectedFile.name);
      setShowUploadModal(false);
      setReplacingDoc(null);
      setSelectedFile(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleSaveDocMeta = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingDocMeta) return;
    setSavingDocMeta(true);
    try {
      await erpClient.updateCustomerDocMeta({
        docId: editingDocMeta.id,
        documentNumber: metaDocNumber.trim() || null,
        issueDate: metaIssueDate || null,
        expirationDate: metaExpiryDate || null,
        reminderDays: Math.max(0, Math.min(365, Number(metaReminderDays) || 30)),
        notes: metaNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setEditingDocMeta(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSavingDocMeta(false);
    }
  };

  const handleConfirmArchiveDoc = async () => {
    if (!archivingDocTarget) return;
    setArchivingDocSubmitting(true);
    try {
      await erpClient.archiveCustomerDoc(archivingDocTarget.id);
      showSuccess(t.customerDocs.archiveAction);
      setArchivingDocTarget(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setArchivingDocSubmitting(false);
    }
  };

  const handleGenerateStatement = async () => {
    if (!profile) return;
    setGeneratingStatement(true);
    try {
      const res = await erpClient.generateDocument({
        documentKind: 'CUSTOMER_STATEMENT',
        customerId: profile.customer.id,
        language: lang,
        numeralSystem: numerals,
      });
      setStatementPreview({ document: res.document, pdfBase64: res.pdfBase64 });
      showSuccess(res.document.documentNumber);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setGeneratingStatement(false);
    }
  };

  const handleOpenPreview = async (docId: number) => {
    try {
      const decrypted = await erpClient.readCustomerDoc(docId);
      setPreviewDoc(decrypted);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleDownloadPreviewDoc = () => {
    if (!previewDoc) return;
    const link = document.createElement('a');
    link.href = `data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`;
    link.download = previewDoc.originalFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddRisk = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      await erpClient.addCustomerRisk({
        customerId: profile.customer.id,
        riskLevel,
        reason: riskReason,
        description: riskDesc.trim(),
        incidentDate,
      });
      showSuccess(t.common.save);
      setRiskDesc('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleResolveRisk = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolvingId) return;
    setResolvingSubmitting(true);
    try {
      await erpClient.resolveCustomerRisk({
        riskRecordId: resolvingId,
        resolutionNotes: resolutionNotes.trim(),
        nextCustomerRiskStatus: nextRiskStatus,
      });
      showSuccess(t.common.save);
      setResolvingId(null);
      setResolutionNotes('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setResolvingSubmitting(false);
    }
  };

  const handleSaveCustomRate = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      await erpClient.upsertCustomerCustomRate({
        customerId: profile.customer.id,
        vehicleId: rateVehicleId ? Number(rateVehicleId) : null,
        vehicleCategory: rateCategory.trim() || null,
        dailyRateMinor: rateDailyDzd ? toMinorUnits(Number(rateDailyDzd)) : null,
        weeklyRateMinor: rateWeeklyDzd ? toMinorUnits(Number(rateWeeklyDzd)) : null,
        monthlyRateMinor: rateMonthlyDzd ? toMinorUnits(Number(rateMonthlyDzd)) : null,
        defaultDiscountPercent: Number(rateDiscountPct || 0),
        notes: rateNotes.trim() || null,
      });
      showSuccess(t.common.save);
      setRateVehicleId('');
      setRateCategory('');
      setRateDailyDzd('');
      setRateWeeklyDzd('');
      setRateMonthlyDzd('');
      setRateDiscountPct('0');
      setRateNotes('');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  if (loading || !profile) {
    return <div className="py-12 text-center text-sm text-slate-500">{t.common.loading}</div>;
  }

  const { customer, company, documents, riskRecords, customRates, rentalHistory, stats } = profile;

  const tabs: Array<{ key: CustomerTab; label: string }> = [
    { key: 'overview', label: t.customers.tabs.overview },
    { key: 'documents', label: t.customers.tabs.documents },
    { key: 'risk', label: t.customers.tabs.risk },
    { key: 'rates', label: t.customers.tabs.rates },
    { key: 'rentals', label: t.customers.tabs.rentals },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/customers"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          </Link>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {company ? `${company.companyName} · ${customer.fullName}` : customer.fullName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {customer.customerType === 'COMPANY' ? t.customers.company : t.customers.individual} ·{' '}
              <span className="font-mono-tabular">{formatDigits(customer.phone, numerals)}</span> ·{' '}
              <span
                className={
                  customer.riskStatus === 'BLACKLISTED'
                    ? 'text-rose-600 dark:text-rose-400 font-bold'
                    : 'font-semibold'
                }
              >
                {t.customers.riskLevels[customer.riskStatus]}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canGenerateDoc && (
            <button
              type="button"
              disabled={generatingStatement}
              onClick={() => void handleGenerateStatement()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{generatingStatement ? t.common.loading : t.documents.triggers.customerStatementPdf}</span>
            </button>
          )}
          {canViewFinanceLedger && (
            <button
              type="button"
              onClick={() => setShowLedgerModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>{t.finance.accounts.openLedger}</span>
            </button>
          )}
          {canWrite && !customer.isArchived && (
            <>
              <button
                type="button"
                onClick={openEditModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t.customers.editCustomer}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{t.customers.archiveCustomer}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.customers.totalRentals}</div>
          <div className="text-xl font-semibold font-mono-tabular mt-1">
            {formatDigits(stats.totalRentals, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.customers.totalCharged}</div>
          <div className="text-lg font-semibold font-mono-tabular mt-1">
            {formatCurrencyMinor(stats.totalChargedMinor, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.customers.totalPaid}</div>
          <div className="text-lg font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400 mt-1">
            {formatCurrencyMinor(stats.netPaidMinor, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.customers.outstanding}</div>
          <div className="text-lg font-semibold font-mono-tabular text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrencyMinor(stats.outstandingBalanceMinor, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.accounts.overdueDebt}</div>
          <div className="text-lg font-semibold font-mono-tabular text-rose-700 dark:text-rose-400 mt-1">
            {formatCurrencyMinor(stats.overdueDebtMinor, 'DZD', lang, numerals)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t.finance.accounts.heldDepositsLiability}</div>
          <div className="text-lg font-semibold font-mono-tabular mt-1">
            {formatCurrencyMinor(stats.heldDepositsMinor, 'DZD', lang, numerals)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 ${
              activeTab === tab.key
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t.customers.phone}</div>
              <div className="font-mono-tabular mt-0.5">{formatDigits(customer.phone, numerals)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.customers.secondaryPhone}</div>
              <div className="font-mono-tabular mt-0.5">
                {customer.secondaryPhone ? formatDigits(customer.secondaryPhone, numerals) : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.customers.dateOfBirth}</div>
              <div className="font-mono-tabular mt-0.5">{customer.dateOfBirth || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t.customers.wilaya} / {t.customers.commune}
              </div>
              <div className="mt-0.5">
                {customer.wilayaCode || '—'} {customer.commune ? `· ${customer.commune}` : ''}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-500">{t.customers.address}</div>
              <div className="mt-0.5">{customer.address || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.customers.cniNumber}</div>
              <div className="font-mono-tabular mt-0.5">{customer.cniNumber || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.customers.passportNumber}</div>
              <div className="font-mono-tabular mt-0.5">{customer.passportNumber || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.customers.licenceNumber}</div>
              <div className="font-mono-tabular mt-0.5">
                {customer.drivingLicenceNumber || '—'}
                {customer.drivingLicenceExpirationDate
                  ? ` (exp: ${customer.drivingLicenceExpirationDate})`
                  : ''}
              </div>
            </div>
            <div className="sm:col-span-2 md:col-span-3">
              <div className="text-xs text-slate-500">{t.customers.internalNotes}</div>
              <div className="mt-0.5 text-slate-700 dark:text-slate-300">
                {customer.internalNotes || '—'}
              </div>
            </div>
          </div>

          {company && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">{t.customers.companyName}</div>
                <div className="font-semibold mt-0.5">{company.companyName}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t.customers.legalRepresentative}</div>
                <div className="mt-0.5">{company.legalRepresentative}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">RC / NIF / NIS / ART</div>
                <div className="font-mono-tabular text-xs mt-0.5">
                  {company.rcNumber || '—'} · {company.nifNumber || '—'} · {company.nisNumber || '—'} ·{' '}
                  {company.artNumber || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t.customers.bonDeCommande}</div>
                <div className="font-mono-tabular text-xs mt-0.5">
                  {company.bonDeCommandeNumber || '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (() => {
        const visibleDocs = showArchivedDocs ? documents : documents.filter((d) => !d.isArchived);
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchivedDocs}
                  onChange={(e) => setShowArchivedDocs(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700"
                />
                <span>{t.customerDocs.showArchived}</span>
              </label>

              {canWrite && (
                <button
                  type="button"
                  onClick={() => openUploadDocModal(null)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 dark:hover:bg-blue-600"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.customers.vault.uploadDoc}</span>
                </button>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.customers.vault.docCategory}</th>
                      <th className="px-4 py-3 text-start">{t.customerDocs.documentNumber}</th>
                      <th className="px-4 py-3 text-start">{t.customerDocs.issueDate} / {t.customerDocs.expirationDate}</th>
                      <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                      <th className="px-4 py-3 text-start">Fichier</th>
                      <th className="px-4 py-3 text-end">{t.users.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {visibleDocs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          <FileLock2 className="w-5 h-5 mx-auto mb-1 opacity-50" />
                          {t.customers.vault.empty}
                        </td>
                      </tr>
                    ) : (
                      visibleDocs.map((doc) => {
                        const expiryState = getCustomerDocExpiryState(doc.expirationDate, doc.reminderDays);
                        return (
                          <tr
                            key={doc.id}
                            className={doc.isArchived ? 'opacity-65 bg-slate-50/70 dark:bg-slate-950/40' : ''}
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium">
                                {t.customers.vault.categories[doc.docCategory]}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px]">
                                {doc.isArchived && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                                    {t.customerDocs.archivedBadge}
                                  </span>
                                )}
                                {doc.replacedByDocId && (
                                  <span className="text-slate-500 font-mono-tabular">
                                    {t.customerDocs.replacedBy} #{doc.replacedByDocId}
                                  </span>
                                )}
                                {doc.replacesDocId && (
                                  <span className="text-blue-700 dark:text-blue-400 font-mono-tabular">
                                    {t.customerDocs.replacesDoc} #{doc.replacesDocId}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-xs">
                              {doc.documentNumber || '—'}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-xs">
                              <div>{doc.issueDate ? formatDigits(doc.issueDate, numerals) : '—'}</div>
                              <div className="text-slate-500">
                                → {doc.expirationDate ? formatDigits(doc.expirationDate, numerals) : '—'}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {expiryState === 'expired' ? (
                                <span className="inline-flex px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-semibold">
                                  {t.customerDocs.statusExpired}
                                </span>
                              ) : expiryState === 'soon' ? (
                                <span className="inline-flex px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold">
                                  {t.customerDocs.statusExpiringSoon}
                                </span>
                              ) : expiryState === 'valid' ? (
                                <span className="inline-flex px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold">
                                  {t.customerDocs.statusValid}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-[220px]">
                              <div className="font-mono-tabular truncate">{doc.originalFileName}</div>
                              {doc.notes && (
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">{doc.notes}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-end">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleOpenPreview(doc.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>{t.customers.vault.previewDoc}</span>
                                </button>
                                {canWrite && !doc.isArchived && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditDocMetaModal(doc)}
                                      title={t.customerDocs.editMetaAction}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      <Pencil className="w-3 h-3" />
                                      <span>{t.customerDocs.editMetaAction}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openUploadDocModal(doc)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>{t.customerDocs.replaceAction}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setArchivingDocTarget(doc)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                    >
                                      <Archive className="w-3 h-3" />
                                      <span>{t.customerDocs.archiveAction}</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === 'risk' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.customers.risk.incidentDate}</th>
                    <th className="px-4 py-3 text-start">{t.customers.risk.severity}</th>
                    <th className="px-4 py-3 text-start">{t.customers.risk.reason}</th>
                    <th className="px-4 py-3 text-start">{t.customers.risk.description}</th>
                    <th className="px-4 py-3 text-end">{t.users.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {riskRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        <ShieldAlert className="w-5 h-5 mx-auto mb-1 opacity-50" />
                        {t.customers.risk.empty}
                      </td>
                    </tr>
                  ) : (
                    riskRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td className="px-4 py-3 font-mono-tabular text-xs">{rec.incidentDate}</td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {t.customers.riskLevels[rec.riskLevel]} ·{' '}
                          {rec.isResolved ? t.customers.risk.resolvedBadge : t.customers.risk.openBadge}
                        </td>
                        <td className="px-4 py-3 text-xs">{t.customers.riskReasons[rec.reason]}</td>
                        <td className="px-4 py-3 text-xs">
                          <div>{rec.description}</div>
                          {rec.resolutionNotes && (
                            <div className="text-emerald-700 dark:text-emerald-400 mt-1">
                              → {rec.resolutionNotes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end">
                          {!rec.isResolved && canOverrideBlacklist && (
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingId(rec.id);
                                setResolutionNotes('');
                                setNextRiskStatus('LOW');
                              }}
                              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {t.customers.risk.resolve}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!canOverrideBlacklist && (
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                {t.customers.risk.adminOnlyResolve}
              </div>
            )}
          </div>

          {canWrite && (
            <form
              onSubmit={handleAddRisk}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
            >
              <h3 className="text-sm font-semibold">{t.customers.risk.addIncident}</h3>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.risk.severity}</label>
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="LOW">{t.customers.riskLevels.LOW}</option>
                  <option value="MEDIUM">{t.customers.riskLevels.MEDIUM}</option>
                  <option value="HIGH">{t.customers.riskLevels.HIGH}</option>
                  <option value="BLACKLISTED">{t.customers.riskLevels.BLACKLISTED}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.risk.reason}</label>
                <select
                  value={riskReason}
                  onChange={(e) => setRiskReason(e.target.value as RiskReason)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="UNPAID_DEBT">{t.customers.riskReasons.UNPAID_DEBT}</option>
                  <option value="TRAFFIC_FINE">{t.customers.riskReasons.TRAFFIC_FINE}</option>
                  <option value="RADAR_FINE">{t.customers.riskReasons.RADAR_FINE}</option>
                  <option value="VEHICLE_DAMAGE">{t.customers.riskReasons.VEHICLE_DAMAGE}</option>
                  <option value="LATE_RETURN">{t.customers.riskReasons.LATE_RETURN}</option>
                  <option value="CONTRACT_VIOLATION">{t.customers.riskReasons.CONTRACT_VIOLATION}</option>
                  <option value="OTHER">{t.customers.riskReasons.OTHER}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.risk.incidentDate}</label>
                <input
                  type="date"
                  required
                  dir="ltr"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.risk.description} *</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={riskDesc}
                  onChange={(e) => setRiskDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-medium"
              >
                {t.common.save}
              </button>
            </form>
          )}
        </div>
      )}

      {activeTab === 'rates' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-start">
                      {t.vehicles.category} / {t.nav.vehicles}
                    </th>
                    <th className="px-4 py-3 text-start">{t.vehicles.dailyRate}</th>
                    <th className="px-4 py-3 text-start">{t.vehicles.weeklyRate}</th>
                    <th className="px-4 py-3 text-start">{t.customers.customRates.defaultDiscount}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {customRates.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        {t.customers.customRates.empty}
                      </td>
                    </tr>
                  ) : (
                    customRates.map((cr) => (
                      <tr key={cr.id}>
                        <td className="px-4 py-3 text-xs">
                          {cr.vehicleId
                            ? `#${cr.vehicleId}`
                            : cr.vehicleCategory || t.contracts.pricingSection.allCategories}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          {cr.dailyRateMinor != null
                            ? formatCurrencyMinor(cr.dailyRateMinor, 'DZD', lang, numerals)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          {cr.weeklyRateMinor != null
                            ? formatCurrencyMinor(cr.weeklyRateMinor, 'DZD', lang, numerals)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs">
                          {formatDigits(cr.defaultDiscountPercent, numerals)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canManageSettings && (
            <form
              onSubmit={handleSaveCustomRate}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
            >
              <h3 className="text-sm font-semibold">{t.customers.customRates.addRate}</h3>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.customRates.specificVehicle}</label>
                <select
                  value={rateVehicleId}
                  onChange={(e) => setRateVehicleId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="">{t.contracts.pricingSection.allCategories}</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.matricule})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.customRates.vehicleCategory}</label>
                <input
                  value={rateCategory}
                  onChange={(e) => setRateCategory(e.target.value)}
                  placeholder="Citadine, Berline..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.vehicles.dailyRate}</label>
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={rateDailyDzd}
                  onChange={(e) => setRateDailyDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.vehicles.weeklyRate}</label>
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={rateWeeklyDzd}
                  onChange={(e) => setRateWeeklyDzd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.customRates.defaultDiscount}</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  dir="ltr"
                  value={rateDiscountPct}
                  onChange={(e) => setRateDiscountPct(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-xs font-medium"
              >
                {t.common.save}
              </button>
            </form>
          )}
        </div>
      )}

      {activeTab === 'rentals' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start">{t.contracts.contractNumber}</th>
                  <th className="px-4 py-3 text-start">{t.nav.vehicles}</th>
                  <th className="px-4 py-3 text-start">{t.planning.viewWeek}</th>
                  <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                  <th className="px-4 py-3 text-end">{t.contracts.totalContract}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rentalHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      —
                    </td>
                  </tr>
                ) : (
                  rentalHistory.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-mono-tabular font-medium">
                        <Link to={`/contracts/${r.id}`} className="text-blue-700 dark:text-blue-400 hover:underline">
                          {r.contractNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{r.vehicleLabel}</td>
                      <td className="px-4 py-3 font-mono-tabular text-xs">
                        {formatDateTimeAlgiers(r.startDate, lang, numerals)} →{' '}
                        {formatDateTimeAlgiers(r.actualReturnDate ?? r.expectedReturnDate, lang, numerals)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">{t.contracts.statuses[r.status]}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular font-medium">
                        {formatCurrencyMinor(r.totalContractAmountMinor, r.currency, lang, numerals)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Edit Customer Modal */}
      <ModalDialog
        open={showEditModal}
        onClose={() => {
          if (!savingEdit) setShowEditModal(false);
        }}
        title={t.customers.editCustomer}
        subtitle={company ? `${company.companyName} · ${customer.fullName}` : customer.fullName}
        size="xl"
        disableClose={savingEdit}
        onSubmit={handleSaveEdit}
        subHeader={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditType('INDIVIDUAL')}
              aria-pressed={editType === 'INDIVIDUAL'}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                editType === 'INDIVIDUAL'
                  ? 'border-blue-900 bg-blue-900 text-white dark:border-blue-600 dark:bg-blue-700'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{t.customers.individual}</span>
            </button>
            <button
              type="button"
              onClick={() => setEditType('COMPANY')}
              aria-pressed={editType === 'COMPANY'}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                editType === 'COMPANY'
                  ? 'border-blue-900 bg-blue-900 text-white dark:border-blue-600 dark:bg-blue-700'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{t.customers.company}</span>
            </button>
          </div>
        }
        footer={
          <>
            <button
              type="button"
              disabled={savingEdit}
              onClick={() => setShowEditModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingEdit ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        {editType === 'COMPANY' && (
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.customers.companySection}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.companyName} *</label>
                <input
                  required
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.legalRepresentative} *</label>
                <input
                  required
                  value={editLegalRep}
                  onChange={(e) => setEditLegalRep(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.rcNumber}</label>
                <input
                  dir="ltr"
                  value={editRc}
                  onChange={(e) => setEditRc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.nifNumber}</label>
                <input
                  dir="ltr"
                  value={editNif}
                  onChange={(e) => setEditNif(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.nisNumber}</label>
                <input
                  dir="ltr"
                  value={editNis}
                  onChange={(e) => setEditNis(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.artNumber}</label>
                <input
                  dir="ltr"
                  value={editArt}
                  onChange={(e) => setEditArt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{t.customers.bonDeCommande}</label>
                <input
                  dir="ltr"
                  value={editBonDeCommande}
                  onChange={(e) => setEditBonDeCommande(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customers.fullName} *</label>
            <input
              required
              data-autofocus
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.dateOfBirth}</label>
            <input
              type="date"
              dir="ltr"
              value={editDob}
              onChange={(e) => setEditDob(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.phone} *</label>
            <input
              required
              dir="ltr"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.secondaryPhone}</label>
            <input
              dir="ltr"
              value={editSecondaryPhone}
              onChange={(e) => setEditSecondaryPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.wilaya}</label>
            <select
              value={editWilaya}
              onChange={(e) => setEditWilaya(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="">—</option>
              {wilayas.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} — {lang === 'ar' ? w.nameAr : w.nameFr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.commune}</label>
            <input
              value={editCommune}
              onChange={(e) => setEditCommune(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customers.address}</label>
            <input
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.cniNumber}</label>
            <input
              dir="ltr"
              value={editCni}
              onChange={(e) => setEditCni(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.passportNumber}</label>
            <input
              dir="ltr"
              value={editPassport}
              onChange={(e) => setEditPassport(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceNumber}</label>
            <input
              dir="ltr"
              value={editLicence}
              onChange={(e) => setEditLicence(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceIssueDate}</label>
            <input
              type="date"
              dir="ltr"
              value={editLicenceIssue}
              onChange={(e) => setEditLicenceIssue(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceExpiryDate}</label>
            <input
              type="date"
              dir="ltr"
              value={editLicenceExpiry}
              onChange={(e) => setEditLicenceExpiry(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.customers.internalNotes}</label>
          <textarea
            rows={2}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Encrypted Document Upload / Non-destructive Replace Modal */}
      <ModalDialog
        open={showUploadModal}
        onClose={() => {
          if (!uploadingDoc) {
            setShowUploadModal(false);
            setReplacingDoc(null);
          }
        }}
        title={replacingDoc ? t.customerDocs.replaceAction : t.dialogs.uploadEncryptedTitle}
        subtitle={replacingDoc ? t.customerDocs.replacingNotice : t.dialogs.uploadEncryptedHint}
        size="lg"
        disableClose={uploadingDoc}
        onSubmit={handleUploadSubmit}
        footer={
          <>
            <button
              type="button"
              disabled={uploadingDoc}
              onClick={() => {
                setShowUploadModal(false);
                setReplacingDoc(null);
              }}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={uploadingDoc || !selectedFile}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {uploadingDoc ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        {replacingDoc && (
          <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-900 dark:text-blue-200">
            {t.customerDocs.replacesDoc} #{replacingDoc.id} ({replacingDoc.originalFileName})
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.vault.docCategory}</label>
            <select
              data-autofocus
              disabled={Boolean(replacingDoc)}
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value as CustomerDocument['docCategory'])}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
            >
              <option value="CNI">{t.customers.vault.categories.CNI}</option>
              <option value="PASSPORT">{t.customers.vault.categories.PASSPORT}</option>
              <option value="DRIVING_LICENCE">{t.customers.vault.categories.DRIVING_LICENCE}</option>
              <option value="COMPANY_RC">{t.customers.vault.categories.COMPANY_RC}</option>
              <option value="COMPANY_NIF">{t.customers.vault.categories.COMPANY_NIF}</option>
              <option value="BON_COMMANDE">{t.customers.vault.categories.BON_COMMANDE}</option>
              <option value="OTHER">{t.customers.vault.categories.OTHER}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.documentNumber}</label>
            <input
              dir="ltr"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.issueDate}</label>
            <input
              type="date"
              dir="ltr"
              value={docIssueDate}
              onChange={(e) => setDocIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.expirationDate}</label>
            <input
              type="date"
              dir="ltr"
              value={docExpiryDate}
              onChange={(e) => setDocExpiryDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.reminderDays}</label>
            <input
              type="number"
              min={0}
              max={365}
              dir="ltr"
              value={docReminderDays}
              onChange={(e) => setDocReminderDays(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.notes}</label>
            <input
              value={docNotes}
              onChange={(e) => setDocNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <label className="flex flex-col items-center justify-center gap-2 w-full px-4 py-6 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs font-medium text-center">
          <Upload className="w-5 h-5 text-slate-400" />
          <span>{t.customers.vault.selectFile}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handlePickUploadFile}
            disabled={uploadingDoc}
            className="sr-only"
          />
        </label>

        {selectedFile && (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between gap-2">
            <span className="truncate font-mono-tabular font-medium">{selectedFile.name}</span>
            <span className="font-mono-tabular text-slate-500 shrink-0">
              {(selectedFile.size / 1024).toFixed(0)} KB
            </span>
          </div>
        )}
      </ModalDialog>

      {/* Edit Customer Document Metadata Modal */}
      <ModalDialog
        open={Boolean(editingDocMeta)}
        onClose={() => {
          if (!savingDocMeta) setEditingDocMeta(null);
        }}
        title={t.customerDocs.editMetaAction}
        subtitle={editingDocMeta?.originalFileName}
        size="md"
        disableClose={savingDocMeta}
        onSubmit={handleSaveDocMeta}
        footer={
          <>
            <button
              type="button"
              disabled={savingDocMeta}
              onClick={() => setEditingDocMeta(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={savingDocMeta}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {savingDocMeta ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customerDocs.documentNumber}</label>
            <input
              data-autofocus
              dir="ltr"
              value={metaDocNumber}
              onChange={(e) => setMetaDocNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.issueDate}</label>
            <input
              type="date"
              dir="ltr"
              value={metaIssueDate}
              onChange={(e) => setMetaIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customerDocs.expirationDate}</label>
            <input
              type="date"
              dir="ltr"
              value={metaExpiryDate}
              onChange={(e) => setMetaExpiryDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customerDocs.reminderDays}</label>
            <input
              type="number"
              min={0}
              max={365}
              dir="ltr"
              value={metaReminderDays}
              onChange={(e) => setMetaReminderDays(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customerDocs.notes}</label>
            <textarea
              rows={2}
              value={metaNotes}
              onChange={(e) => setMetaNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>
      </ModalDialog>

      {/* Resolve Risk Modal */}
      <ModalDialog
        open={resolvingId != null}
        onClose={() => {
          if (!resolvingSubmitting) setResolvingId(null);
        }}
        title={t.customers.risk.resolve}
        size="sm"
        disableClose={resolvingSubmitting}
        onSubmit={handleResolveRisk}
        footer={
          <>
            <button
              type="button"
              disabled={resolvingSubmitting}
              onClick={() => setResolvingId(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={resolvingSubmitting}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
            >
              {resolvingSubmitting ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.customers.risk.nextRiskStatus}</label>
          <select
            data-autofocus
            value={nextRiskStatus}
            onChange={(e) => setNextRiskStatus(e.target.value as RiskLevel)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="LOW">{t.customers.riskLevels.LOW}</option>
            <option value="MEDIUM">{t.customers.riskLevels.MEDIUM}</option>
            <option value="HIGH">{t.customers.riskLevels.HIGH}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.customers.risk.resolutionNotes} *</label>
          <textarea
            rows={3}
            required
            minLength={3}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>

      {/* Decrypted Document Preview Modal */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.originalFileName ?? ''}
        subtitle={previewDoc?.mimeType}
        size="xl"
        closeOnBackdrop
        footer={
          previewDoc ? (
            <>
              <button
                type="button"
                onClick={handleDownloadPreviewDoc}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.dialogs.downloadDoc}</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
              >
                {t.common.close}
              </button>
            </>
          ) : undefined
        }
      >
        {previewDoc && (
          <div className="flex justify-center items-center bg-slate-100 dark:bg-slate-950 rounded-lg p-3 min-h-[300px]">
            {previewDoc.mimeType === 'application/pdf' ? (
              <iframe
                title={previewDoc.originalFileName}
                src={`data:application/pdf;base64,${previewDoc.base64Data}`}
                className="w-full h-[65dvh] rounded border border-slate-200 dark:border-slate-800 bg-white"
              />
            ) : (
              <img
                alt={previewDoc.originalFileName}
                src={`data:${previewDoc.mimeType};base64,${previewDoc.base64Data}`}
                className="max-h-[65dvh] max-w-full object-contain rounded"
              />
            )}
          </div>
        )}
      </ModalDialog>

      {/* Archive Customer Confirmation */}
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={handleArchive}
        tone="danger"
        loading={archiving}
        title={t.dialogs.archiveCustomerTitle}
        description={t.dialogs.archiveCustomerDesc}
        confirmLabel={t.customers.archiveCustomer}
      />

      {/* Archive Customer Document Confirmation */}
      <ConfirmDialog
        open={Boolean(archivingDocTarget)}
        onClose={() => {
          if (!archivingDocSubmitting) setArchivingDocTarget(null);
        }}
        onConfirm={handleConfirmArchiveDoc}
        tone="warning"
        loading={archivingDocSubmitting}
        title={t.customerDocs.archiveConfirmTitle}
        description={t.customerDocs.archiveConfirmDesc}
        confirmLabel={t.customerDocs.archiveAction}
      />

      <CustomerLedgerModal
        customerId={showLedgerModal ? customer.id : null}
        onClose={() => setShowLedgerModal(false)}
        onUpdated={loadData}
      />

      <DocumentPreviewModal
        open={Boolean(statementPreview)}
        onClose={() => setStatementPreview(null)}
        initialDocument={statementPreview?.document ?? null}
        initialPdfBase64={statementPreview?.pdfBase64 ?? null}
      />
    </div>
  );
}
