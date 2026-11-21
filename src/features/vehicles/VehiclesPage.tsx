import { Car, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fromMinorUnits, toMinorUnits } from '../../../shared/constants/algeria.ts';
import type { Vehicle, VehicleFuelType, VehicleStatus, VehicleTransmission } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { erpClient } from '../../lib/apiClient.ts';
import { formatCurrencyMinor, formatDigits } from '../../lib/formatters.ts';

const VEHICLE_CATEGORIES = ['Citadine', 'Berline', 'SUV / 4x4', 'Utilitaire', 'Compacte', 'Monospace'];

function statusTextClass(status: VehicleStatus): string {
  switch (status) {
    case 'AVAILABLE':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'RENTED':
      return 'text-blue-700 dark:text-blue-400';
    case 'RESERVED':
      return 'text-amber-700 dark:text-amber-400';
    case 'MAINTENANCE':
      return 'text-rose-700 dark:text-rose-400';
  }
}

export function VehiclesPage() {
  const { t, lang, numerals } = useI18n();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [internalCode, setInternalCode] = useState('');
  const [matricule, setMatricule] = useState('');
  const [vin, setVin] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [color, setColor] = useState('');
  const [category, setCategory] = useState('Citadine');
  const [fuelType, setFuelType] = useState<VehicleFuelType>('ESSENCE');
  const [transmission, setTransmission] = useState<VehicleTransmission>('MANUAL');
  const [seats, setSeats] = useState('5');
  const [currentOdometerKm, setCurrentOdometerKm] = useState('0');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [acquisitionCostDzd, setAcquisitionCostDzd] = useState('');
  const [dailyRateDzd, setDailyRateDzd] = useState('6000');
  const [weeklyRateDzd, setWeeklyRateDzd] = useState('38000');
  const [monthlyRateDzd, setMonthlyRateDzd] = useState('140000');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canWrite = hasPermission('vehicles:write');

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await erpClient.listVehicles({
        search: search || undefined,
        status: statusFilter,
        includeArchived,
      });
      setVehicles(list);
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, includeArchived, showError, t.common.error]);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  const resetForm = () => {
    setInternalCode('');
    setMatricule('');
    setVin('');
    setBrand('');
    setModel('');
    setYear(String(new Date().getFullYear()));
    setColor('');
    setCategory('Citadine');
    setFuelType('ESSENCE');
    setTransmission('MANUAL');
    setSeats('5');
    setCurrentOdometerKm('0');
    setAcquisitionDate('');
    setAcquisitionCostDzd('');
    setDailyRateDzd('6000');
    setWeeklyRateDzd('38000');
    setMonthlyRateDzd('140000');
    setNotes('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await erpClient.createVehicle({
        internalCode: internalCode.trim(),
        matricule: matricule.trim(),
        vin: vin.trim() || null,
        brand: brand.trim(),
        model: model.trim(),
        year: Number(year),
        color: color.trim(),
        category: category.trim(),
        fuelType,
        transmission,
        seats: Number(seats),
        currentOdometerKm: Number(currentOdometerKm),
        acquisitionDate: acquisitionDate || null,
        acquisitionCostMinor: acquisitionCostDzd ? toMinorUnits(Number(acquisitionCostDzd)) : null,
        defaultDailyRateMinor: toMinorUnits(Number(dailyRateDzd)),
        defaultWeeklyRateMinor: weeklyRateDzd ? toMinorUnits(Number(weeklyRateDzd)) : null,
        defaultMonthlyRateMinor: monthlyRateDzd ? toMinorUnits(Number(monthlyRateDzd)) : null,
        notes: notes.trim() || null,
      });
      showSuccess(`${brand} ${model} (${matricule})`);
      setShowCreateModal(false);
      resetForm();
      await loadVehicles();
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
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.vehicles.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.vehicles.subtitle}</p>
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
            <span>{t.vehicles.newVehicle}</span>
          </button>
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.vehicles.searchPlaceholder}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
        >
          <option value="ALL">{t.vehicles.filterAllStatuses}</option>
          <option value="AVAILABLE">{t.vehicles.statuses.AVAILABLE}</option>
          <option value="RENTED">{t.vehicles.statuses.RENTED}</option>
          <option value="RESERVED">{t.vehicles.statuses.RESERVED}</option>
          <option value="MAINTENANCE">{t.vehicles.statuses.MAINTENANCE}</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700"
          />
          <span>{t.vehicles.showArchived}</span>
        </label>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 text-start">{t.vehicles.internalCode}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.matricule}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.brand} / {t.vehicles.model}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.category}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.odometer}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.dailyRate}</th>
                <th className="px-4 py-3 text-start">{t.vehicles.statusLabel}</th>
                <th className="px-4 py-3 text-end">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    {t.common.loading}
                  </td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    <Car className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <div>{t.vehicles.empty}</div>
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => (
                  <tr
                    key={v.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${v.isArchived ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
                      {v.internalCode}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {formatDigits(v.matricule, numerals)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {v.brand} {v.model}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDigits(v.year, numerals)} · {v.color} · {t.vehicles.fuelTypes[v.fuelType]} ·{' '}
                        {t.vehicles.transmissions[v.transmission]}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{v.category}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700 dark:text-slate-300">
                      {formatDigits(v.currentOdometerKm.toLocaleString(), numerals)} km
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrencyMinor(v.defaultDailyRateMinor, 'DZD', lang, numerals)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${statusTextClass(v.status)}`}>
                        {t.vehicles.statuses[v.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        to={`/vehicles/${v.id}`}
                        className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
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

      {/* Create Vehicle Modal */}
      <ModalDialog
        open={showCreateModal}
        onClose={() => {
          if (!submitting) {
            setShowCreateModal(false);
          }
        }}
        title={t.vehicles.newVehicle}
        size="lg"
        disableClose={submitting}
        onSubmit={handleCreate}
        footer={
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-blue-900 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-50"
            >
              {submitting ? t.common.loading : t.common.save}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.internalCode} *
            </label>
            <input
              required
              data-autofocus
              value={internalCode}
              onChange={(e) => setInternalCode(e.target.value)}
              placeholder="V-001"
              dir="ltr"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.matricule} *
            </label>
            <input
              required
              value={matricule}
              onChange={(e) => setMatricule(e.target.value)}
              placeholder="00123-124-16"
              dir="ltr"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
            <p className="text-[11px] text-slate-500 mt-1">{t.vehicles.matriculeHint}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.brand} *
            </label>
            <input
              required
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Renault"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.model} *
            </label>
            <input
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Clio 5"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.year} *
            </label>
            <input
              type="number"
              required
              min={1980}
              max={2035}
              dir="ltr"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.color} *
            </label>
            <input
              required
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="Blanc"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.category} *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              {VEHICLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.vin}
            </label>
            <input
              value={vin}
              onChange={(e) => setVin(e.target.value)}
              dir="ltr"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.fuelType}
            </label>
            <select
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value as VehicleFuelType)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="ESSENCE">{t.vehicles.fuelTypes.ESSENCE}</option>
              <option value="DIESEL">{t.vehicles.fuelTypes.DIESEL}</option>
              <option value="GPL">{t.vehicles.fuelTypes.GPL}</option>
              <option value="OTHER">{t.vehicles.fuelTypes.OTHER}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.transmission}
            </label>
            <select
              value={transmission}
              onChange={(e) => setTransmission(e.target.value as VehicleTransmission)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            >
              <option value="MANUAL">{t.vehicles.transmissions.MANUAL}</option>
              <option value="AUTOMATIC">{t.vehicles.transmissions.AUTOMATIC}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.seats}
            </label>
            <input
              type="number"
              min={2}
              max={9}
              dir="ltr"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.odometer} *
            </label>
            <input
              type="number"
              min={0}
              required
              dir="ltr"
              value={currentOdometerKm}
              onChange={(e) => setCurrentOdometerKm(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.dailyRate} *
            </label>
            <input
              type="number"
              min={0}
              required
              dir="ltr"
              value={dailyRateDzd}
              onChange={(e) => setDailyRateDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.weeklyRate}
            </label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={weeklyRateDzd}
              onChange={(e) => setWeeklyRateDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.monthlyRate}
            </label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={monthlyRateDzd}
              onChange={(e) => setMonthlyRateDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.acquisitionDate}
            </label>
            <input
              type="date"
              dir="ltr"
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.vehicles.acquisitionCost}
            </label>
            <input
              type="number"
              min={0}
              dir="ltr"
              value={acquisitionCostDzd}
              onChange={(e) => setAcquisitionCostDzd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t.vehicles.notes}
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
      </ModalDialog>
    </div>
  );
}
