import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { useCreateTeamMember, useUpdateTeamMember, useDisableTeamMember } from '../../queries/useTeam';
import { getApiErrorMessage } from '../../api/client';
import { ALL_PERMISSIONS } from '../../api/types';
import type { Permission, TeamMember, UserRole } from '../../api/types';

interface TeamMemberFormSheetProps {
  visible: boolean;
  member: TeamMember | null; // null = invite mode
  onClose: () => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultValidUntil(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

interface FormBodyProps {
  member: TeamMember | null;
  onClose: () => void;
}

/** Mounted only while the sheet is visible — fields start fresh from `member` via lazy initial state, no effect-driven reset needed (same pattern as ContactFormSheet). */
function TeamMemberFormBody({ member, onClose }: FormBodyProps) {
  const { colors, spacing, typography } = useTheme();
  const isEdit = Boolean(member);
  const createMember = useCreateTeamMember();
  const updateMember = useUpdateTeamMember();
  const disableMember = useDisableTeamMember();

  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [role, setRole] = useState<UserRole>(member?.role ?? 'SUB_USER');
  const [permissions, setPermissions] = useState<Permission[]>(member?.permissions ?? []);
  const [validUntil, setValidUntil] = useState(member ? member.validUntil.slice(0, 10) : defaultValidUntil());
  const [dateError, setDateError] = useState<string | null>(null);

  const mutation = isEdit ? updateMember : createMember;
  const error = mutation.error ? getApiErrorMessage(mutation.error, 'Could not save this team member.') : null;

  const togglePermission = (p: Permission) => {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleSave = () => {
    if (!ISO_DATE.test(validUntil)) {
      setDateError('Use YYYY-MM-DD');
      return;
    }
    setDateError(null);
    const validUntilIso = new Date(`${validUntil}T00:00:00.000Z`).toISOString();

    if (isEdit && member) {
      updateMember.mutate(
        {
          id: member.id,
          role,
          permissions: role === 'MASTER_ADMIN' ? [] : permissions,
          validUntil: validUntilIso,
          displayName: displayName.trim() || undefined,
        },
        { onSuccess: onClose },
      );
    } else {
      createMember.mutate(
        {
          email: email.trim(),
          password,
          role,
          permissions: role === 'MASTER_ADMIN' ? [] : permissions,
          validUntil: validUntilIso,
          displayName: displayName.trim() || undefined,
        },
        { onSuccess: onClose },
      );
    }
  };

  const handleToggleDisabled = () => {
    if (!member) return;
    if (member.status === 'DISABLED') {
      updateMember.mutate({ id: member.id, status: 'ACTIVE' }, { onSuccess: onClose });
    } else {
      disableMember.mutate(member.id, { onSuccess: onClose });
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>
        {isEdit ? 'Edit team member' : 'Invite team member'}
      </Text>

      {error ? <InlineBanner message={error} /> : null}

      {isEdit ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Email</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{member?.email}</Text>
        </View>
      ) : (
        <>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextField label="Temporary password" value={password} onChangeText={setPassword} secureTextEntry />
        </>
      )}

      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <TextField
        label="Access expires (YYYY-MM-DD)"
        value={validUntil}
        onChangeText={setValidUntil}
        autoCapitalize="none"
        error={dateError ?? undefined}
      />

      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Role</Text>
      <View style={[styles.roleRow, { marginBottom: spacing.md }]}>
        {(['SUB_USER', 'MASTER_ADMIN'] as UserRole[]).map((r) => {
          const active = role === r;
          return (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[
                styles.roleChip,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  marginRight: spacing.sm,
                },
              ]}
            >
              <Text style={[typography.caption, { color: active ? colors.textOnPrimary : colors.textPrimary }]}>
                {r === 'MASTER_ADMIN' ? 'Master Admin' : 'Team member'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {role === 'SUB_USER' ? (
        <>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Permissions</Text>
          <View style={{ marginBottom: spacing.md }}>
            {ALL_PERMISSIONS.map((p) => {
              const checked = permissions.includes(p);
              return (
                <Pressable
                  key={p}
                  onPress={() => togglePermission(p)}
                  style={[styles.permissionRow, { paddingVertical: spacing.xs }]}
                >
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={checked ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[typography.body, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
          Master Admins have full access within this tenant — individual permissions don&apos;t apply.
        </Text>
      )}

      <View style={styles.actions}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Save"
            onPress={handleSave}
            loading={mutation.isPending}
            disabled={!isEdit && (!email.trim() || password.length < 8)}
          />
        </View>
      </View>

      {isEdit && member ? (
        <Button
          label={member.status === 'DISABLED' ? 'Re-enable member' : 'Disable member'}
          variant="danger"
          onPress={handleToggleDisabled}
          loading={disableMember.isPending || updateMember.isPending}
        />
      ) : null}
    </ScrollView>
  );
}

/** One sheet for both inviting and editing a team member — email/password are only set on invite; changing an email later isn't supported by the backend (spec §8/§27). */
export function TeamMemberFormSheet({ visible, member, onClose }: TeamMemberFormSheetProps) {
  const { colors, spacing, radius } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Plain RN Modal doesn't auto-resize for the keyboard the way the
          main screen does — this form is long (email/password/name/date/
          role/permissions), so without this, several fields end up hidden
          behind the keyboard on a shorter device. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
            onPress={(e) => e.stopPropagation()}
          >
            {visible ? <TeamMemberFormBody member={member} onClose={onClose} /> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '88%' },
  actions: { flexDirection: 'row', marginTop: 8, marginBottom: 12 },
  roleRow: { flexDirection: 'row' },
  roleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  permissionRow: { flexDirection: 'row', alignItems: 'center' },
});
