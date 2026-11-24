import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { AppLanguage, AppTheme, NumeralSystem } from '../shared/types/domain.ts';
import { ToastProvider } from './components/Toast.tsx';
import { AuthScreen } from './features/auth/AuthScreen.tsx';
import { LockOverlay } from './features/auth/LockOverlay.tsx';
import { BackupsPage } from './features/backups/BackupsPage.tsx';
import { ContractDetailPage } from './features/contracts/ContractDetailPage.tsx';
import { ContractsPage } from './features/contracts/ContractsPage.tsx';
import { NewContractWizardPage } from './features/contracts/NewContractWizardPage.tsx';
import { CustomerProfilePage } from './features/customers/CustomerProfilePage.tsx';
import { CustomersPage } from './features/customers/CustomersPage.tsx';
import { DocumentsPage } from './features/documents/DocumentsPage.tsx';
import { FinancePage } from './features/finance/FinancePage.tsx';
import { Phase1HomePage } from './features/home/Phase1HomePage.tsx';
import { InspectionsPage } from './features/inspections/InspectionsPage.tsx';
import { InventoryPage } from './features/inventory/InventoryPage.tsx';
import { MaintenancePage } from './features/maintenance/MaintenancePage.tsx';
import { PlanningPage } from './features/planning/PlanningPage.tsx';
import { ReportsPage } from './features/reports/ReportsPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { UsersPage } from './features/users/UsersPage.tsx';
import { VehicleProfilePage } from './features/vehicles/VehicleProfilePage.tsx';
import { VehiclesPage } from './features/vehicles/VehiclesPage.tsx';
import { AuthProvider, useAuth } from './hooks/useAuth.tsx';
import { I18nProvider, useI18n } from './hooks/useI18n.tsx';
import { ThemeProvider, useTheme } from './hooks/useTheme.tsx';
import { ErpLayout } from './layouts/ErpLayout.tsx';
import { erpClient } from './lib/apiClient.ts';

function AppContent() {
  const { loading, session, isLocked } = useAuth();
  const { t, setLang, setNumerals } = useI18n();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!session) return;
    erpClient
      .getAllSettings()
      .then((s) => {
        if (s['app.default_language'] === 'fr' || s['app.default_language'] === 'ar') {
          setLang(s['app.default_language'] as AppLanguage);
        }
        if (s['app.default_theme'] === 'light' || s['app.default_theme'] === 'dark') {
          setTheme(s['app.default_theme'] as AppTheme);
        }
        if (s['app.numeral_system'] === 'latin' || s['app.numeral_system'] === 'arabic') {
          setNumerals(s['app.numeral_system'] as NumeralSystem);
        }
      })
      .catch(() => {
        // Non-blocking fallback to current local preference
      });
  }, [session, setLang, setTheme, setNumerals]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-600 dark:text-slate-400">
        {t.common.loading}
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      <ErpLayout>
        <Routes>
          <Route path="/" element={<Phase1HomePage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/:id" element={<VehicleProfilePage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerProfilePage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/contracts/new" element={<NewContractWizardPage />} />
          <Route path="/contracts/:id" element={<ContractDetailPage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/backups" element={<BackupsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErpLayout>
      {isLocked && <LockOverlay />}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
