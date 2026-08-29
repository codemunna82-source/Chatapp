import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { useCreateTeamMember, useUpdateTeamMember, useDisableTeamMember } from '../../queries/useTeam';
import { useWhatsAppNumbers } from '../../queries/useWhatsAppNumbers';
import { getApiErrorMessage } from '../../api/client';
import { ALL_PERMISSIONS } from '../../api/types';
import type { Permission, TeamMember, UserRole } from '../../api/types';

interface TeamMemberFormSheetProps {
  visible: boolean;
  member: TeamMember | null; // null = invite mode
  onClose: () => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Quick spans, because a fixed-term contractor or a trial account is
 *  almost always one of these — typing a date by hand for the common case
 *  is the slow path, not the shortcut. */
const PRESET_DAYS = [30, 60, 90, 365] as const;

function toIsoDay(d: Date): string {
  // Built from LOCAL parts, not toISOString(): that converts to UTC first,
  // so an evening in +05:30 would come back as the next day and quietly
  // grant a day more (or less) access than the admin picked.
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDay(d);
}

function defaultValidUntil(): string {
  return daysFromNow(365);
}

/** Parses the YYYY-MM-DD field back into a Date for the calendar, falling
 *  back to today when the field is mid-edit and not yet a valid date. */
function parseIsoDay(value: string): Date {
  if (!ISO_DATE.test(value)) return new Date();
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y!, m! - 1, d!);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

interface FormBodyProps {
  member: TeamMember | null;
  onClose: () => void;
}

/** Mounted only while the sheet is visible — fields start fresh from `member` via lazy initial state, no effect-driven reset needed (same pattern as ContactFormSheet). */
function TeamMemberFormBody({ member, onClose }: FormBodyProps) {
  const { colors, spacing, radius, typography } = useTheme();
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  // undefined = no number assigned, i.e. use whatever the workspace
  // defaults to. Distinct from a chosen number, and it is what every
  // member created before this field existed still has.
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState<string | undefined>(
    member?.whatsappPhoneNumberId,
  );
  const numbersQuery = useWhatsAppNumbers();
  const numbers = numbersQuery.data ?? [];

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
          // Explicit null, not undefined: on a PATCH the two mean different
          // things, and undefined would make "unassign" impossible to send.
          whatsappPhoneNumberId: whatsappPhoneNumberId ?? null,
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
          whatsappPhoneNumberId,
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
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        Access expires
      </Text>
      <View style={[styles.presetRow, { marginBottom: spacing.sm }]}>
        {PRESET_DAYS.map((days) => {
          const value = daysFromNow(days);
          const active = validUntil === value;
          return (
            <Pressable
              key={days}
              onPress={() => {
                setValidUntil(value);
                setDateError(null);
              }}
              style={[
                styles.presetChip,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  borderRadius: radius.md,
                  marginRight: spacing.xs,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[typography.caption, { color: active ? colors.textOnPrimary : colors.textPrimary }]}>
                {days === 365 ? '1 year' : `${days} days`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => setCalendarOpen(true)}
        style={[
          styles.dateField,
          {
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            borderColor: dateError ? colors.danger : 'transparent',
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Access expires ${validUntil}. Tap to pick a date.`}
      >
        <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>{validUntil}</Text>
        <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
      </Pressable>
      {dateError ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>{dateError}</Text>
      ) : null}
      <Text style={[typography.caption, { color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.md }]}>
        Access is refused from this date. The chips set a span from today; tap the date for anything else.
      </Text>

      {calendarOpen ? (
        <DateTimePicker
          value={parseIsoDay(validUntil)}
          mode="date"
          // Yesterday cannot be an expiry — it would create a member who is
          // already locked out, which is a mistake rather than an intent.
          minimumDate={new Date()}
          onChange={(event, date) => {
            // On Android the picker is a dialog that closes itself; keeping
            // it mounted after a dismiss would re-open it on the next
            // render.
            setCalendarOpen(false);
            if (event.type === 'set' && date) {
              setValidUntil(toIsoDay(date));
              setDateError(null);
            }
          }}
        />
      ) : null}

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

      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Sends from</Text>
      {numbersQuery.isLoading ? (
        <Text style={[typography.caption, { color: colors.textTertiary, marginBottom: spacing.md }]}>
          Loading WhatsApp numbers…
        </Text>
      ) : numbers.length === 0 ? (
        <Text style={[typography.caption, { color: colors.textTertiary, marginBottom: spacing.md }]}>
          No WhatsApp number is connected to this workspace yet, so there is nothing to assign.
        </Text>
      ) : (
        <>
          <View style={{ marginBottom: spacing.xs }}>
            {/* "Workspace default" is a real option, not just the absence of
                a choice — an admin needs a way back after assigning one. */}
            <Pressable
              onPress={() => setWhatsappPhoneNumberId(undefined)}
              style={[styles.numberRow, { paddingVertical: spacing.xs }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: whatsappPhoneNumberId === undefined }}
            >
              <Ionicons
                name={whatsappPhoneNumberId === undefined ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={whatsappPhoneNumberId === undefined ? colors.primary : colors.textSecondary}
              />
              <Text style={[typography.body, { color: colors.textPrimary, marginLeft: spacing.sm }]}>
                Workspace default
              </Text>
            </Pressable>
            {numbers.map((n) => {
              const selected = whatsappPhoneNumberId === n.id;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => setWhatsappPhoneNumberId(n.id)}
                  style={[styles.numberRow, { paddingVertical: spacing.xs }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                  <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                    <Text style={[typography.body, { color: colors.textPrimary }]}>{n.displayPhoneNumber}</Text>
                    {n.status !== 'CONNECTED' ? (
                      <Text style={[typography.caption, { color: colors.textTertiary }]}>{n.status.toLowerCase()}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={[typography.caption, { color: colors.textTertiary, marginBottom: spacing.md }]}>
            New chats this member starts go out from this number. Chats already open keep the number they
            were started with.
          </Text>
        </>
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
  roleChip: { paddingHorizontal: 14, borderRadius: 18, minHeight: touchTarget.compact, alignItems: 'center', justifyContent: 'center' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap' },
  presetChip: { paddingHorizontal: 12, minHeight: touchTarget.compact, alignItems: 'center', justifyContent: 'center' },
  dateField: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.min, borderWidth: 1 },
  permissionRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
  numberRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
});
