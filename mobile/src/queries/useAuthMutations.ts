import { useMutation } from '@tanstack/react-query';
import * as authApi from '../api/endpoints/auth';
import { uploadOwnAvatar, type PickedAvatarFile } from '../api/endpoints/users';
import { useAuthStore } from '../store/authStore';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (vars: { identifier: string; password: string }) =>
      authApi.login(vars.identifier, vars.password),
    onSuccess: (tokens) => setSession(tokens),
  });
}

export function useLogout() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  return useMutation({
    mutationFn: async () => {
      // Detaching this device from the workspace is clearSession's job
      // now — it is the one place every sign-out passes through, and
      // doing it only here left an expired session or a revoked account
      // still receiving the workspace's notifications.
      if (refreshToken) {
        // Best-effort — logout must succeed locally even if this request
        // fails (no connection, token already expired server-side, etc.).
        await authApi.logout(refreshToken).catch(() => {});
      }
    },
    onSettled: async () => {
      // Clearing the cache is clearSession's job now, for the same reason
      // detaching the device is: this button is one of four ways a
      // session ends, and it was the only one doing it.
      await clearSession();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(vars.currentPassword, vars.newPassword),
  });
}

export function useUploadOwnAvatar() {
  const updateUser = useAuthStore((s) => s.updateUser);
  return useMutation({
    mutationFn: (file: PickedAvatarFile) => uploadOwnAvatar(file),
    onSuccess: (user) => updateUser({ avatarUpdatedAt: user.avatarUpdatedAt, displayName: user.displayName }),
  });
}
