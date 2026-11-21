import { Plus, ShieldAlert, Unlock, UserCog } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PermissionCode, RoleCode } from '../../../shared/types/domain.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { useToast } from '../../components/Toast.tsx';
import { useAuth } from '../../hooks/useAuth.tsx';
import { useI18n } from '../../hooks/useI18n.tsx';
import {
  erpClient,
  type PermissionCatalogItem,
  type UserWithPermissionsDto,
} from '../../lib/apiClient.ts';
import { formatDateTimeAlgiers } from '../../lib/formatters.ts';

export function UsersPage() {
  const { hasPermission, session } = useAuth();
  const { t, lang, numerals } = useI18n();
  const { showSuccess, showError } = useToast();

  const [users, setUsers] = useState<UserWithPermissionsDto[]>([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState<PermissionCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithPermissionsDto | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<RoleCode>('AGENT');

  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState<RoleCode>('AGENT');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editResetPassword, setEditResetPassword] = useState('');
  const [editOverrides, setEditOverrides] = useState<Record<string, boolean | null>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setServerError(null);
    try {
      const [userList, perms] = await Promise.all([
        erpClient.listUsers(),
        erpClient.listPermissions(),
      ]);
      setUsers(userList);
      setPermissionsCatalog(perms);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [t.common.error]);

  useEffect(() => {
    if (hasPermission('users:manage')) {
      void loadData();
    } else {
      setLoading(false);
    }
  }, [hasPermission, loadData]);

  if (!hasPermission('users:manage')) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl p-8 max-w-xl">
        <div className="flex items-center gap-3 text-rose-700 dark:text-rose-400 mb-3">
          <ShieldAlert className="w-5 h-5" />
          <h2 className="text-base font-semibold">{t.users.accessDeniedTitle}</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {t.users.accessDeniedDesc}
        </p>
      </div>
    );
  }

  const openEdit = (u: UserWithPermissionsDto) => {
    setEditingUser(u);
    setEditFullName(u.fullName);
    setEditRole(u.roleCode);
    setEditIsActive(u.isActive);
    setEditResetPassword('');
    const ovMap: Record<string, boolean | null> = {};
    for (const ov of u.permissionOverrides) {
      ovMap[ov.code] = ov.granted;
    }
    setEditOverrides(ovMap);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await erpClient.createUser({
        username: newUsername,
        fullName: newFullName,
        password: newPassword,
        roleCode: newRole,
      });
      showSuccess(`${newUsername} — ${t.users.createAction}`);
      setShowCreateModal(false);
      setNewUsername('');
      setNewFullName('');
      setNewPassword('');
      setNewRole('AGENT');
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const overridesPayload = permissionsCatalog.map((perm) => ({
        code: perm.code,
        granted: editOverrides[perm.code] ?? null,
      }));
      await erpClient.updateUser({
        userId: editingUser.id,
        fullName: editFullName,
        roleCode: editRole,
        isActive: editIsActive,
        resetPassword: editResetPassword.trim() ? editResetPassword.trim() : undefined,
        permissionOverrides: overridesPayload,
      });
      showSuccess(t.settings.savedSuccess);
      setEditingUser(null);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  const handleUnlockAccount = async (userId: number) => {
    try {
      await erpClient.updateUser({ userId, unlockAccount: true });
      showSuccess(t.users.unlockUser);
      await loadData();
    } catch (err) {
      showError(err instanceof Error ? err.message : t.common.error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t.users.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.users.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{t.users.createUser}</span>
        </button>
      </div>

      {serverError && (
        <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
          {serverError}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">{t.users.username}</th>
                <th className="py-3 px-4 text-start font-medium">{t.users.fullName}</th>
                <th className="py-3 px-4 text-start font-medium">{t.users.role}</th>
                <th className="py-3 px-4 text-start font-medium">{t.users.status}</th>
                <th className="py-3 px-4 text-start font-medium">{t.users.lastLogin}</th>
                <th className="py-3 px-4 text-end font-medium">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    {t.common.loading}
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isLocked = Boolean(u.lockedUntil && Date.parse(u.lockedUntil) > Date.now());
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono-tabular font-medium">{u.username}</td>
                      <td className="py-3 px-4">{u.fullName}</td>
                      <td className="py-3 px-4 text-xs">
                        {u.roleCode === 'ADMIN' ? t.users.roleAdmin : t.users.roleAgent}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {isLocked ? (
                          <span className="text-amber-700 dark:text-amber-400 font-medium">
                            {t.users.locked}
                          </span>
                        ) : u.isActive ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            {t.users.active}
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-400 font-medium">
                            {t.users.inactive}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono-tabular text-slate-600 dark:text-slate-400">
                        {u.lastLoginAt
                          ? formatDateTimeAlgiers(u.lastLoginAt, lang, numerals)
                          : t.users.neverLogged}
                      </td>
                      <td className="py-3 px-4 text-end">
                        <div className="inline-flex items-center gap-2">
                          {isLocked && (
                            <button
                              type="button"
                              onClick={() => void handleUnlockAccount(u.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>{t.users.unlockUser}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <UserCog className="w-3.5 h-3.5" />
                            <span>{t.users.editUser}</span>
                          </button>
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

      {/* Create User Modal */}
      <ModalDialog
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t.users.createUser}
        size="sm"
        onSubmit={handleCreate}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.auth.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
            >
              {t.users.createAction}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium mb-1">{t.users.username}</label>
          <input
            type="text"
            required
            data-autofocus
            dir="ltr"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.users.fullName}</label>
          <input
            type="text"
            required
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.auth.password}</label>
          <input
            type="password"
            required
            minLength={8}
            dir="ltr"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
          <p className="text-[11px] text-slate-500 mt-1">{t.auth.minPasswordHint}</p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.users.role}</label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as RoleCode)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          >
            <option value="AGENT">{t.users.roleAgent}</option>
            <option value="ADMIN">{t.users.roleAdmin}</option>
          </select>
        </div>
      </ModalDialog>

      {/* Edit User & Permission Overrides Drawer */}
      <ModalDialog
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        variant="drawer"
        size="lg"
        title={editingUser ? `${t.users.editUser}: ${editingUser.username}` : ''}
        subtitle={editingUser?.fullName}
        onSubmit={handleUpdate}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t.auth.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-medium"
            >
              {t.users.saveChanges}
            </button>
          </>
        }
      >
        {editingUser && (
          <>
            <div>
              <label className="block text-xs font-medium mb-1">{t.users.fullName}</label>
              <input
                type="text"
                required
                data-autofocus
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">{t.users.role}</label>
                <select
                  value={editRole}
                  disabled={editingUser.id === session?.user.id}
                  onChange={(e) => setEditRole(e.target.value as RoleCode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-50"
                >
                  <option value="AGENT">{t.users.roleAgent}</option>
                  <option value="ADMIN">{t.users.roleAdmin}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">{t.users.status}</label>
                <select
                  value={editIsActive ? '1' : '0'}
                  disabled={editingUser.id === session?.user.id}
                  onChange={(e) => setEditIsActive(e.target.value === '1')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-50"
                >
                  <option value="1">{t.users.active}</option>
                  <option value="0">{t.users.inactive}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                {t.users.resetPasswordOptional}
              </label>
              <input
                type="password"
                minLength={8}
                dir="ltr"
                value={editResetPassword}
                onChange={(e) => setEditResetPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            <div className="pt-2">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                {t.users.permissionOverrides}
              </h4>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 max-h-80 overflow-y-auto">
                {permissionsCatalog.map((perm) => {
                  const currentVal = editOverrides[perm.code] ?? null;
                  return (
                    <div key={perm.code} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {lang === 'ar' ? perm.descriptionAr : perm.descriptionFr}
                        </div>
                        <div className="font-mono-tabular text-[11px] text-slate-500">{perm.code}</div>
                      </div>
                      <select
                        value={currentVal === null ? 'inherit' : currentVal ? 'grant' : 'revoke'}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditOverrides((prev) => ({
                            ...prev,
                            [perm.code as PermissionCode]:
                              v === 'inherit' ? null : v === 'grant',
                          }));
                        }}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs shrink-0"
                      >
                        <option value="inherit">{t.users.inheritRole}</option>
                        <option value="grant">{t.users.forceGrant}</option>
                        <option value="revoke">{t.users.forceRevoke}</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </ModalDialog>
    </div>
  );
}
