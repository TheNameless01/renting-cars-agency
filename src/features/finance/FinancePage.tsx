import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import { CashRegisterTab } from './CashRegisterTab.tsx';
import { CustomerAccountsTab } from './CustomerAccountsTab.tsx';
import { DepositsTab } from './DepositsTab.tsx';
import { ExpensesTab } from './ExpensesTab.tsx';
import { FinanceDashboardTab } from './FinanceDashboardTab.tsx';
import { PaymentsTab } from './PaymentsTab.tsx';

export type FinanceTabKey =
  | 'overview'
  | 'cash'
  | 'payments'
  | 'deposits'
  | 'accounts'
  | 'expenses'
  | 'reports';

export function FinancePage({ defaultTab }: { defaultTab?: FinanceTabKey }) {
  const { t } = useI18n();
  const { hasPermission } = useAuth();

  const availableTabs = useMemo(() => {
    const list: Array<{ key: FinanceTabKey; label: string }> = [];
    if (hasPermission('finance:read') || hasPermission('reports:view')) {
      list.push({ key: 'overview', label: t.finance.tabs.overview });
    }
    if (hasPermission('finance:cash_register') || hasPermission('finance:read')) {
      list.push({ key: 'cash', label: t.finance.tabs.cashRegister });
    }
    if (hasPermission('finance:record_payment') || hasPermission('finance:read')) {
      list.push({ key: 'payments', label: t.finance.tabs.payments });
    }
    if (hasPermission('finance:manage_deposit') || hasPermission('finance:read')) {
      list.push({ key: 'deposits', label: t.finance.tabs.deposits });
    }
    if (hasPermission('finance:read') || hasPermission('finance:approve_adjustment')) {
      list.push({ key: 'accounts', label: t.finance.tabs.customerAccounts });
    }
    if (hasPermission('finance:manage_expenses') || hasPermission('finance:read')) {
      list.push({ key: 'expenses', label: t.finance.tabs.expenses });
    }
    if (hasPermission('reports:view') || hasPermission('finance:read')) {
      list.push({ key: 'reports', label: t.finance.tabs.reports });
    }
    return list;
  }, [hasPermission, t]);

  const resolvedDefault: FinanceTabKey | null = useMemo(() => {
    if (defaultTab && availableTabs.some((tab) => tab.key === defaultTab)) {
      return defaultTab;
    }
    return availableTabs[0]?.key ?? null;
  }, [availableTabs, defaultTab]);

  const [activeTab, setActiveTab] = useState<FinanceTabKey | null>(resolvedDefault);

  useEffect(() => {
    if (resolvedDefault && (!activeTab || !availableTabs.some((tItem) => tItem.key === activeTab))) {
      setActiveTab(resolvedDefault);
    }
  }, [activeTab, availableTabs, resolvedDefault]);

  if (availableTabs.length === 0 || !activeTab) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
        <ShieldAlert className="w-7 h-7 mx-auto mb-2 text-amber-600 dark:text-amber-400" />
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t.finance.noAccessTitle}
        </h2>
        <p className="text-xs text-slate-500 mt-1">{t.finance.noAccessDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {activeTab === 'reports' ? t.nav.reports : t.finance.title}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.finance.subtitle}</p>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(activeTab === 'overview' || activeTab === 'reports') && <FinanceDashboardTab />}
      {activeTab === 'cash' && <CashRegisterTab />}
      {activeTab === 'payments' && <PaymentsTab />}
      {activeTab === 'deposits' && <DepositsTab />}
      {activeTab === 'accounts' && <CustomerAccountsTab />}
      {activeTab === 'expenses' && <ExpensesTab />}
    </div>
  );
}
