import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { getApiErrorMessage } from '../../api/client';
import {
  useQuickReplies,
  useCreateQuickReply,
  useDeleteQuickReply,
} from '../../queries/useQuickReplies';
import type { QuickReply } from '../../api/types';

interface QuickReplySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the chosen reply — the composer decides whether to insert
   *  it into the input or send it outright. */
  onPick: (reply: QuickReply) => void;
}

/**
 * The saved-replies library: pick one to drop into the composer, or add and
 * remove them here.
 *
 * Editing lives in the same sheet as picking rather than in Settings.
 * Saved replies are written the moment you notice you have typed the same
 * thing twice, which is while you are in a chat — a library you have to
 * leave the conversation to curate is a library nobody fills in.
 */
export function QuickReplySheet({ visible, onClose, onPick }: QuickReplySheetProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const query = useQuickReplies();
  const createReply = useCreateQuickReply();
  const deleteReply = useDeleteQuickReply();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const error = createReply.error ? getApiErrorMessage(createReply.error, 'Could not save that reply.') : null;

  const resetForm = () => {
    setAdding(false);
    setTitle('');
    setBody('');
    createReply.reset();
  };

  const handleSave = () => {
    createReply.mutate({ title: title.trim(), body: body.trim() }, { onSuccess: resetForm });
  };

  const handleDelete = (reply: QuickReply) => {
    Alert.alert('Delete saved reply?', `"${reply.title}" will be removed for everyone in this workspace.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteReply.mutate(reply.id) },
    ]);
  };

  const replies = query.data ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={[typography.heading, { color: colors.textPrimary }]}>Saved replies</Text>
            <Pressable
              onPress={() => (adding ? resetForm() : setAdding(true))}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel={adding ? 'Cancel new reply' : 'Add a saved reply'}
            >
              {({ pressed }) => (
                <Ionicons
                  name={adding ? 'close' : 'add'}
                  size={24}
                  color={colors.primary}
                  style={{ opacity: pressed ? 0.5 : 1 }}
                />
              )}
            </Pressable>
          </View>

          {adding ? (
            <View>
              {error ? <InlineBanner message={error} /> : null}
              <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Price list" />
              <TextField
                label="Message"
                value={body}
                onChangeText={setBody}
                placeholder="Our current pricing is…"
                multiline
              />
              <Button
                label="Save reply"
                onPress={handleSave}
                loading={createReply.isPending}
                disabled={!title.trim() || !body.trim()}
              />
            </View>
          ) : query.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : replies.length === 0 ? (
            <EmptyState
              icon="flash-outline"
              title="No saved replies yet"
              subtitle="Tap + to save an answer you send often — it'll be here for everyone on the team."
            />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
              {replies.map((reply) => (
                <View key={reply.id} style={[styles.row, { borderBottomColor: colors.divider }]}>
                  <Pressable
                    onPress={() => onPick(reply)}
                    style={styles.rowMain}
                    accessibilityRole="button"
                    accessibilityLabel={`Use saved reply ${reply.title}`}
                  >
                    {({ pressed }) => (
                      <View style={{ opacity: pressed ? 0.6 : 1 }}>
                        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{reply.title}</Text>
                        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={2}>
                          {reply.body}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(reply)}
                    style={styles.rowDelete}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete saved reply ${reply.title}`}
                  >
                    {({ pressed }) => (
                      <Ionicons name="trash-outline" size={18} color={colors.danger} style={{ opacity: pressed ? 0.5 : 1 }} />
                    )}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxHeight: '80%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerButton: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: touchTarget.min },
  rowMain: { flex: 1, paddingVertical: 10, paddingRight: 8, justifyContent: 'center' },
  rowDelete: { width: touchTarget.compact, height: touchTarget.compact, alignItems: 'center', justifyContent: 'center' },
});
