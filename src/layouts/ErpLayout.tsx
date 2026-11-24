import {
  BarChart3,
  CalendarDays,
  Car,
  ClipboardCheck,
  FileText,
  HardDrive,
  KeyRound,
  Languages,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../hooks/useI18n.tsx';
import { useTheme } from '../hooks/useTheme.tsx';
import type { PermissionCode } from '../../shared/types/domain.ts';
import { ChangePasswordModal } from '../features/auth/ChangePasswordModal.tsx';

interface NavEntry {
  to: string;
  labelKey: keyof ReturnType<typeof useI18n>['t']['nav'];
  icon: typeof LayoutDashboard;
  enabled: boolean;
  adminOnly?: boolean;
  anyPermissions?: PermissionCode[];
}

const NAV_ENTRIES: NavEntry[] = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard, enabled: true },
  { to: '/vehicles', labelKey: 'vehicles', icon: Car, enabled: true },
  { to: '/planning', labelKey: 'planning', icon: CalendarDays, enabled: true },
  { to: '/customers', labelKey: 'customers', icon: Users, enabled: true },
  { to: '/contracts', labelKey: 'contracts', icon: FileText, enabled: true },
  {
    to: '/inspections',
    labelKey: 'inspections',
    icon: ClipboardCheck,
    enabled: true,
    anyPermissions: ['inspections:view', 'inspections:create', 'inspections:write', 'contracts:read'],
  },
  {
    to: '/finance',
    labelKey: 'finance',
    icon: Wallet,
    enabled: true,
    anyPermissions: [
      'finance:read',
      'finance:record_payment',
      'finance:cash_register',
      'finance:manage_deposit',
      'finance:manage_expenses',
      'finance:approve_adjustment',
    ],
  },
  {
    to: '/maintenance',
    labelKey: 'maintenance',
    icon: Wrench,
    enabled: true,
    anyPermissions: [
      'maintenance:view',
      'maintenance:create',
      'maintenance:update',
      'maintenance:complete',
      'maintenance:manage_types',
      'maintenance:write',
    ],
  },
  {
    to: '/inventory',
    labelKey: 'inventory',
    icon: Package,
    enabled: true,
    anyPermissions: [
      'inventory:view',
      'inventory:manage_parts',
      'inventory:record_movements',
      'inventory:manage_suppliers',
      'inventory:adjust_stock',
      'inventory:read',
      'inventory:write',
    ],
  },
  {
    to: '/documents',
    labelKey: 'documents',
    icon: FileText,
    enabled: true,
    anyPermissions: [
      'documents:view',
      'documents:generate',
      'documents:reprint',
      'documents:manage_templates',
    ],
  },
  {
    to: '/reports',
    labelKey: 'reports',
    icon: BarChart3,
    enabled: true,
    anyPermissions: ['reports:view', 'reports:export', 'finance:read'],
  },
  {
    to: '/backups',
    labelKey: 'backups',
    icon: HardDrive,
    enabled: true,
    anyPermissions: ['backups:manage', 'db:health'],
  },
  { to: '/users', labelKey: 'users', icon: ShieldCheck, enabled: true, adminOnly: true },
  { to: '/settings', labelKey: 'settings', icon: Settings, enabled: true },
];

export function ErpLayout({ children }: { children: ReactNode }) {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { session, runtimeMode, lock, logout, hasPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const location = useLocation();

  const currentNav = NAV_ENTRIES.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );
  const pageTitle = currentNav ? t.nav[currentNav.labelKey] : t.appName;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Collapsible Sidebar (uses border-e so it mirrors cleanly in RTL) */}
      <aside
        className={`${
          collapsed ? 'w-16' : 'w-64'
        } shrink-0 flex flex-col border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-150`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
                {t.appName}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {runtimeMode === 'desktop' ? t.desktopBadge : 'Preview DB'}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rtl:rotate-180"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ENTRIES.filter((item) => {
            if (item.anyPermissions && !item.anyPermissions.some((p) => hasPermission(p))) {
              return false;
            }
            return true;
          }).map((item) => {
            const Icon = item.icon;
            const label = t.nav[item.labelKey];

            if (!item.enabled) {
              return (
                <div
                  key={item.to}
                  title={`${label} — ${t.nav.phaseScheduled}`}
                  className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-slate-400 dark:text-slate-600 cursor-not-allowed select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </div>
                  {!collapsed && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-600 shrink-0">
                      {t.nav.phaseScheduled}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-900 text-white dark:bg-blue-700'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`
                }
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </div>
              </NavLink>
            );
          })}
        </nav>

        {!collapsed && session && (
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
              {session.user.fullName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span>{session.user.username}</span>
              <span aria-hidden="true">·</span>
              <span>{session.user.roleCode}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {runtimeMode === 'preview' && (
          <div className="px-6 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-4">
            <span className="font-medium">{t.previewBannerTitle}</span>
            <span className="text-amber-700 dark:text-amber-300 truncate">{t.previewBannerDesc}</span>
          </div>
        )}

        <header className="h-16 shrink-0 flex items-center justify-between gap-6 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
            {pageTitle}
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? t.topbar.switchToArabic : t.topbar.switchToFrench}</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              <span>{theme === 'light' ? t.topbar.darkTheme : t.topbar.lightTheme}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t.topbar.changePassword}</span>
            </button>

            <button
              type="button"
              onClick={() => void lock()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{t.topbar.lockSession}</span>
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-slate-200 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 rtl:rotate-180" />
              <span>{t.topbar.logout}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}
