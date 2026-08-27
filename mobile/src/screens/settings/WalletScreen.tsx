import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { InlineBanner } from '../../components/InlineBanner';
import { useWallet, useWalletTransactions, flattenWalletTransactions } from '../../queries/useWallet';
import { useTheme } from '../../theme/ThemeProvider';
import { getApiErrorMessage } from '../../api/client';
import type { WalletTransaction } from '../../api/types';

function TransactionRow({ item }: { item: WalletTransaction }) {
  const { colors, spacing, typography } = useTheme();
  const isCredit = item.type === 'CREDIT';
  return (
    <View style={[styles.row, { padding: spacing.md, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.reason}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{new Date(item.createdAt).toLocaleString()}</Text>
      </View>
      <Text style={[typography.bodyMedium, { color: isCredit ? colors.success : colors.danger }]}>
        {isCredit ? '+' : '-'}
        {item.amount}
      </Text>
    </View>
  );
}

export function WalletScreen() {
  const { colors, spacing, typography } = useTheme();
  const wallet = useWallet();
  const transactions = useWalletTransactions();
  const items = flattenWalletTransactions(transactions.data);

  if (wallet.isLoading) return <LoadingIndicator fullscreen />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {wallet.isError ? (
        <View style={{ padding: spacing.md }}>
          <InlineBanner message={getApiErrorMessage(wallet.error, 'Could not load wallet.')} />
        </View>
      ) : (
        <View style={[styles.balanceCard, { padding: spacing.lg }]}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Balance</Text>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {wallet.data?.currency} {wallet.data?.balance.toFixed(2)}
          </Text>
        </View>
      )}

      <Text style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.md, marginBottom: spacing.xs }]}>
        Recent transactions
      </Text>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow item={item} />}
        onEndReached={() => {
          if (transactions.hasNextPage && !transactions.isFetchingNextPage) {
            transactions.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        ListEmptyComponent={
          !transactions.isLoading ? (
            <Text style={[typography.body, { color: colors.textSecondary, padding: spacing.md }]}>No transactions yet.</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
