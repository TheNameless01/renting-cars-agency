import { Building2, Plus, Search, User, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerType, RiskLevel } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient, type CustomerListItemDto, type WilayaDto } from '../../lib/apiClient.ts';
import { formatDigits } from '../../lib/formatters.ts';

function riskTextClass(risk: RiskLevel): string {
  switch (risk) {
    case 'LOW':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'MEDIUM':
      return 'text-amber-700 dark:text-amber-400';
    case 'HIGH':
      return 'text-orange-700 dark:text-orange-400';
    case 'BLACKLISTED':
      return 'text-rose-700 dark:text-rose-400 font-bold';
  }
}

export function CustomersPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [customers, setCustomers] = useState<CustomerListItemDto[]>([]);
  const [wilayas, setWilayas] = useState<WilayaDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [customerType, setCustomerType] = useState<CustomerType>('INDIVIDUAL');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [address, setAddress] = useState('');
  const [wilayaCode, setWilayaCode] = useState('16');
  const [commune, setCommune] = useState('');
  const [cniNumber, setCniNumber] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceIssueDate, setLicenceIssueDate] = useState('');
  const [licenceExpiryDate, setLicenceExpiryDate] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  // Company fields
  const [companyName, setCompanyName] = useState('');
  const [legalRepresentative, setLegalRepresentative] = useState('');
  const [rcNumber, setRcNumber] = useState('');
  const [nifNumber, setNifNumber] = useState('');
  const [nisNumber, setNisNumber] = useState('');
  const [artNumber, setArtNumber] = useState('');
  const [bonDeCommandeNumber, setBonDeCommandeNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canWrite = hasPermission('customers:write');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, wilayaList] = await Promise.all([
        erpClient.listCustomers({
          search: search || undefined,
          customerType: typeFilter,
          riskStatus: riskFilter,
          includeArchived,
        }),
        erpClient.listWilayas(true),
      ]);
      setCustomers(list);
      setWilayas(wilayaList);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, riskFilter, includeArchived, showError, t.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = () => {
    setCustomerType('INDIVIDUAL');
    setFullName('');
    setDateOfBirth('');
    setPhone('');
    setSecondaryPhone('');
    setAddress('');
    setWilayaCode('16');
    setCommune('');
    setCniNumber('');
    setPassportNumber('');
    setLicenceNumber('');
    setLicenceIssueDate('');
    setLicenceExpiryDate('');
    setInternalNotes('');
    setCompanyName('');
    setLegalRepresentative('');
    setRcNumber('');
    setNifNumber('');
    setNisNumber('');
    setArtNumber('');
    setBonDeCommandeNumber('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await erpClient.createCustomer({
        customerType,
        fullName: fullName.trim(),
        dateOfBirth: dateOfBirth || null,
        phone: phone.trim(),
        secondaryPhone: secondaryPhone.trim() || null,
        address: address.trim() || null,
        wilayaCode: wilayaCode || null,
        commune: commune.trim() || null,
        cniNumber: cniNumber.trim() || null,
        passportNumber: passportNumber.trim() || null,
        drivingLicenceNumber: licenceNumber.trim() || null,
        drivingLicenceIssueDate: licenceIssueDate || null,
        drivingLicenceExpirationDate: licenceExpiryDate || null,
        internalNotes: internalNotes.trim() || null,
        company:
          customerType === 'COMPANY'
            ? {
                companyName: companyName.trim(),
                legalRepresentative: legalRepresentative.trim(),
                rcNumber: rcNumber.trim() || null,
                nifNumber: nifNumber.trim() || null,
                nisNumber: nisNumber.trim() || null,
                artNumber: artNumber.trim() || null,
                bonDeCommandeNumber: bonDeCommandeNumber.trim() || null,
              }
            : null,
      });
      showSuccess(fullName.trim());
      setShowCreateModal(false);
      resetForm();
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.customers.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.customers.subtitle}</p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{t.customers.newCustomer}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.customers.searchPlaceholder}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        >
          <option value="ALL">{t.customers.filterAllTypes}</option>
          <option value="INDIVIDUAL">{t.customers.individual}</option>
          <option value="COMPANY">{t.customers.company}</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
        >
          <option value="ALL">{t.customers.filterAllRisks}</option>
          <option value="LOW">{t.customers.riskLevels.LOW}</option>
          <option value="MEDIUM">{t.customers.riskLevels.MEDIUM}</option>
          <option value="HIGH">{t.customers.riskLevels.HIGH}</option>
          <option value="BLACKLISTED">{t.customers.riskLevels.BLACKLISTED}</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span>{t.vehicles.showArchived}</span>
        </label>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">{t.customers.fullName}</th>
                <th className="px-4 py-3 text-start">{t.customers.customerType}</th>
                <th className="px-4 py-3 text-start">{t.customers.phone}</th>
                <th className="px-4 py-3 text-start">{t.customers.licenceNumber}</th>
                <th className="px-4 py-3 text-start">{t.customers.riskLevel}</th>
                <th className="px-4 py-3 text-start">{t.customers.totalRentals}</th>
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
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <div>{t.customers.empty}</div>
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr
                    key={c.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${c.isArchived ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.wilayaCode ? `Wilaya ${formatDigits(c.wilayaCode, numerals)}` : ''}
                        {c.commune ? ` · ${c.commune}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        {c.customerType === 'COMPANY' ? (
                          <Building2 className="w-3.5 h-3.5" />
                        ) : (
                          <User className="w-3.5 h-3.5" />
                        )}
                        {c.customerType === 'COMPANY' ? t.customers.company : t.customers.individual}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">{formatDigits(c.phone, numerals)}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {c.drivingLicenceNumber ? formatDigits(c.drivingLicenceNumber, numerals) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={riskTextClass(c.riskStatus)}>
                        {t.customers.riskLevels[c.riskStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs">
                      {formatDigits(c.totalRentals, numerals)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        to={`/customers/${c.id}`}
                        className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {t.common.view}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <ModalDialog
        open={showCreateModal}
        onClose={() => {
          if (!submitting) setShowCreateModal(false);
        }}
        title={t.customers.newCustomer}
        size="xl"
        disableClose={submitting}
        onSubmit={handleCreate}
        subHeader={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCustomerType('INDIVIDUAL')}
              aria-pressed={customerType === 'INDIVIDUAL'}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                customerType === 'INDIVIDUAL'
                  ? 'border-blue-900 bg-blue-900 text-white dark:border-blue-600 dark:bg-blue-700'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{t.customers.individual}</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomerType('COMPANY')}
              aria-pressed={customerType === 'COMPANY'}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                customerType === 'COMPANY'
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
              disabled={submitting}
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {submitting ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        {customerType === 'COMPANY' && (
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.customers.companySection}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.companyName} *</label>
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.legalRepresentative} *</label>
                <input
                  required
                  value={legalRepresentative}
                  onChange={(e) => setLegalRepresentative(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.rcNumber}</label>
                <input
                  dir="ltr"
                  value={rcNumber}
                  onChange={(e) => setRcNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.nifNumber}</label>
                <input
                  dir="ltr"
                  value={nifNumber}
                  onChange={(e) => setNifNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.nisNumber}</label>
                <input
                  dir="ltr"
                  value={nisNumber}
                  onChange={(e) => setNisNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t.customers.artNumber}</label>
                <input
                  dir="ltr"
                  value={artNumber}
                  onChange={(e) => setArtNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{t.customers.bonDeCommande}</label>
                <input
                  dir="ltr"
                  value={bonDeCommandeNumber}
                  onChange={(e) => setBonDeCommandeNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-tabular"
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customers.fullName} *</label>
            <input
              required
              data-autofocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.dateOfBirth}</label>
            <input
              type="date"
              dir="ltr"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.phone} *</label>
            <input
              required
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0550123456"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.secondaryPhone}</label>
            <input
              dir="ltr"
              value={secondaryPhone}
              onChange={(e) => setSecondaryPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.wilaya}</label>
            <select
              value={wilayaCode}
              onChange={(e) => setWilayaCode(e.target.value)}
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
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t.customers.address}</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.cniNumber}</label>
            <input
              dir="ltr"
              value={cniNumber}
              onChange={(e) => setCniNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.passportNumber}</label>
            <input
              dir="ltr"
              value={passportNumber}
              onChange={(e) => setPassportNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceNumber}</label>
            <input
              dir="ltr"
              value={licenceNumber}
              onChange={(e) => setLicenceNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceIssueDate}</label>
            <input
              type="date"
              dir="ltr"
              value={licenceIssueDate}
              onChange={(e) => setLicenceIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t.customers.licenceExpiryDate}</label>
            <input
              type="date"
              dir="ltr"
              value={licenceExpiryDate}
              onChange={(e) => setLicenceExpiryDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">{t.customers.internalNotes}</label>
          <textarea
            rows={2}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>
    </div>
  );
}
