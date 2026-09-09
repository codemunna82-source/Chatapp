import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { useTheme } from '../../theme/ThemeProvider';
import { useWhatsAppNumbers, useRegisterWhatsAppNumber } from '../../queries/useWhatsAppNumbers';
import { getApiErrorMessage } from '../../api/client';
import type { WhatsAppNumber } from '../../api/types';

/** Stable identity, so `?? NO_NUMBERS` does not hand useMemo a fresh
 *  array on every render and defeat the memo entirely. */
const NO_NUMBERS: WhatsAppNumber[] = [];

/** A seeded placeholder rather than a real Meta number. Sends against one
 *  of these always fail, so the screen calls it out explicitly instead of
 *  letting it sit in the list looking configured. */
function isPlaceholder(n: WhatsAppNumber): boolean {
  return !/^\d+$/.test(n.phoneNumberId);
}

/**
 * The quality rating, said in words.
 *
 * Meta lowers the sending limit before it restricts a number, so a drop is
 * the last moment there is still something to do about it — and "YELLOW"
 * on its own tells an operator none of that. Shown on every number rather
 * than only when bad: a rating that appears only in trouble is one nobody
 * learns to read.
 */
function NumberHealthNote({ health }: { health: NonNullable<WhatsAppNumber['health']> }) {
  const { colors, typography, spacing } = useTheme();
  const tint =
    health.level === 'critical'
      ? colors.danger
      : health.level === 'warn'
        ? colors.warning
        : health.level === 'ok'
          ? colors.success
          : colors.textSecondary;

  return (
    <View style={{ marginTop: spacing.xs }}>
      <View style={styles.healthLine}>
        <Ionicons
          name={
            health.level === 'critical'
              ? 'warning'
              : health.level === 'warn'
                ? 'alert-circle-outline'
                : health.level === 'ok'
                  ? 'shield-checkmark-outline'
                  : 'help-circle-outline'
          }
          size={14}
          color={tint}
        />
        <Text style={[typography.caption, { color: tint, marginLeft: 4, fontWeight: '600' }]}>
          {health.headline}
        </Text>
      </View>
      {/* Only where it changes what to do — a healthy number needs no
          paragraph, but a falling one needs the reason and the remedy. */}
      {health.level === 'warn' || health.level === 'critical' ? (
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {health.detail}
        </Text>
      ) : null}
      {health.stale ? (
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          Not checked recently — reopen this screen to refresh.
        </Text>
      ) : null}
    </View>
  );
}

function NumberRow({ item }: { item: WhatsAppNumber }) {
  const { colors, spacing, typography, radius } = useTheme();
  const placeholder = isPlaceholder(item);
  return (
    <View
      style={[
        styles.row,
        { padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, marginBottom: spacing.sm },
      ]}
    >
      <Ionicons
        name={placeholder ? 'alert-circle-outline' : 'checkmark-circle-outline'}
        size={22}
        color={placeholder ? colors.warning : colors.success}
      />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.displayPhoneNumber}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} selectable>
          {item.phoneNumberId}
        </Text>
        {placeholder ? (
          <Text style={[typography.caption, { color: colors.warning }]}>
            Demo placeholder — messages sent from this will not reach WhatsApp.
          </Text>
        ) : null}
        {!placeholder && item.health ? <NumberHealthNote health={item.health} /> : null}
      </View>
    </View>
  );
}

/**
 * Registers the workspace's real WhatsApp number.
 *
 * A fresh deployment is seeded with a demo number that is not a Meta id at
 * all, so every send fails until this is done — and before this screen the
 * only fix was editing the database by hand.
 */
export function WhatsAppNumbersScreen() {
  const { colors, spacing, typography } = useTheme();
  const numbersQuery = useWhatsAppNumbers();
  const register = useRegisterWhatsAppNumber();

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [search, setSearch] = useState('');

  const allNumbers = numbersQuery.data ?? NO_NUMBERS;
  // Client-side: a workspace's numbers are a small, complete list already
  // in memory, so filtering here is instant and needs no round trip. It is
  // the scrolling that breaks down at scale, not the data volume.
  const numbers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allNumbers;
    return allNumbers.filter(
      (n) => n.displayPhoneNumber.toLowerCase().includes(q) || n.phoneNumberId.includes(q),
    );
  }, [allNumbers, search]);
  const error = register.error ? getApiErrorMessage(register.error, 'Could not register this number.') : null;

  const handleRegister = () => {
    register.mutate(
      { phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim() || undefined },
      {
        onSuccess: () => {
          setPhoneNumberId('');
          setWabaId('');
        },
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        Connected numbers{allNumbers.length > 0 ? ` (${allNumbers.length})` : ''}
      </Text>

      {/* Appears once the list is long enough to be worth searching —
          below that it is just a field in the way. */}
      {allNumbers.length > 8 ? (
        <TextField
          label="Search numbers"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />
      ) : null}

      {numbersQuery.isLoading ? (
        <LoadingIndicator />
      ) : numbers.length === 0 ? (
        <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.md }]}>
          {search.trim() ? 'No number matches that search.' : 'No WhatsApp number is connected yet.'}
        </Text>
      ) : (
        numbers.map((n) => <NumberRow key={n.id} item={n} />)
      )}

      <Text style={[typography.label, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>
        Add a number
      </Text>
      <Text style={[typography.caption, { color: colors.textTertiary, marginBottom: spacing.md }]}>
        Meta dashboard → WhatsApp → API Setup. Copy the numeric “Phone number ID” — not the phone number
        itself. It is checked with Meta before it is saved, so a wrong id fails here rather than silently on
        every message.
      </Text>

      {error ? <InlineBanner message={error} /> : null}
      {register.isSuccess && !error ? (
        <InlineBanner message="Number registered and verified with Meta." tone="success" />
      ) : null}

      <TextField
        label="Phone number ID"
        value={phoneNumberId}
        onChangeText={setPhoneNumberId}
        keyboardType="number-pad"
        autoCapitalize="none"
      />
      <TextField
        label="WhatsApp Business Account ID (optional)"
        value={wabaId}
        onChangeText={setWabaId}
        keyboardType="number-pad"
        autoCapitalize="none"
      />
      <Text style={[typography.caption, { color: colors.textTertiary, marginBottom: spacing.md }]}>
        The WABA ID is only needed for syncing message templates. Sending works without it.
      </Text>

      <Button
        label="Verify and save"
        onPress={handleRegister}
        loading={register.isPending}
        disabled={phoneNumberId.trim().length < 5}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  healthLine: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
