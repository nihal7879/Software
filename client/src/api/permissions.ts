import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useAuth } from '../auth/AuthContext';

/**
 * What the super admin has granted the Institute Admin.
 *
 * Changing a student's hours moves what their family owes, so it sits with the
 * super admin unless the switch in Settings hands it over. The super admin
 * always may; the admin only while the switch is on. This only decides whether
 * the buttons are shown — the server refuses the request either way.
 */
export type PermissionKey =
  | 'hours_add'        // put hours on a statement
  | 'hours_deduct'     // take hours off
  | 'hours_edit'       // correct an entry already there
  | 'hours_delete'     // remove an entry from the statement
  | 'ledger_adjust';   // the credited / pending / discount figures

export function usePermissions() {
  const { user } = useAuth();
  const canAsk = user?.role === 'admin' || user?.role === 'superadmin';
  return useQuery({
    queryKey: ['permissions'],
    enabled: canAsk,
    queryFn: () => api.get('/settings/permissions').then((r) => r.data.permissions as Record<PermissionKey, boolean>),
  });
}

/** May this user do it right now? The super admin always can. */
export function useMay(key: PermissionKey) {
  const { user } = useAuth();
  const perms = usePermissions();
  if (user?.role === 'superadmin') return true;
  return !!perms.data?.[key];
}
