import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as authApi from '../api/endpoints/auth';
import { uploadOwnAvatar, type PickedAvatarFile } from '../api/endpoints/users';
import { useAuthStore } from '../store/authStore';
import { unregisterForPushNotifications } from '../notifications/pushRegistration';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (vars: { email: string; password: string }) => authApi.login(vars.email, vars.password),
    onSuccess: (tokens) => setSession(tokens),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  return useMutation({
    mutationFn: async () => {
      // Before the session is torn down, while the access token this call
      // needs is still valid.
      await unregisterForPushNotifications();
      if (refreshToken) {
        // Best-effort — logout must succeed locally even if this request
        // fails (no connection, token already expired server-side, etc.).
        await authApi.logout(refreshToken).catch(() => {});
      }
    },
    onSettled: async () => {
      await clearSession();
      queryClient.clear(); // drop every cached query — nothing from the old session should leak into the next login
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
