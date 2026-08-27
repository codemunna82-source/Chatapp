import React from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useTemplates } from '../../queries/useTemplates';
import type { MessageTemplate } from '../../api/types';

interface TemplatePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (template: MessageTemplate) => void;
}

/**
 * Outside the 24h customer-service window, Meta only allows sending a
 * pre-approved template (spec §18) — this lists GET /api/templates and
 * lets the agent tap one to send. No invented "quick replies" bypass.
 */
export function TemplatePickerSheet({ visible, onClose, onPick }: TemplatePickerSheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const templatesQuery = useTemplates();
  const templates = templatesQuery.data ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Choose a template</Text>

          {templatesQuery.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : templatesQuery.isError ? (
            <Text style={[typography.body, { color: colors.danger }]}>Couldn&apos;t load templates.</Text>
          ) : templates.length === 0 ? (
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              No approved templates yet. Create one in WhatsApp Manager first.
            </Text>
          ) : (
            <FlatList
              data={templates}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, { paddingVertical: spacing.sm, borderBottomColor: colors.border }]}
                  onPress={() => onPick(item)}
                >
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{item.name}</Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    {item.language} · {item.category}
                  </Text>
                </Pressable>
              )}
            />
          )}

          <Pressable style={[styles.cancel, { paddingVertical: spacing.sm }]} onPress={onClose}>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxHeight: '70%' },
  list: { flexGrow: 0 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  centered: { alignItems: 'center', padding: 16 },
  cancel: { alignItems: 'center' },
});
