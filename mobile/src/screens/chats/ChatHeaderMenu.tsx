import React from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';

/**
 * The chat header's overflow menu.
 *
 * It exists because the header ran out of room. Search, the private-chat
 * link, video and call were four icons side by side, and with the back
 * arrow and the customer's photo they left about ninety pixels for the
 * name — so a contact called "Chandan Kumar" appeared as "C…". The one
 * thing a chat header has to get right is whose chat it is.
 *
 * So the two that are reached for on every chat stay out — call, and
 * video where it can work — and the two that are occasional move in here.
 * That is the shape every messenger settles on, and it is not fashion:
 * the visible slots belong to what is used constantly, and a menu is
 * cheap for what is not.
 *
 * Anchored under the top-right corner rather than centred, so it reads as
 * belonging to the button that opened it.
 */
export function ChatHeaderMenu({
  visible,
  onClose,
  onSearch,
  onGuestLink,
  /** A live private-chat link changes what the link row offers. */
  guestActive,
  /** Absent when this conversation has no contact to look at. */
  onContactPhoto,
  contactPhotoLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onSearch: () => void;
  onGuestLink: () => void;
  guestActive: boolean;
  onContactPhoto?: () => void;
  contactPhotoLabel?: string;
}) {
  const { colors, spacing, radius, typography } = useTheme();

  const rows: {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = [
    { key: 'search', label: 'Search in this chat', icon: 'search', onPress: onSearch },
    {
      key: 'link',
      label: guestActive ? 'Replace private chat link' : 'Send a private chat link',
      icon: guestActive ? 'link' : 'link-outline',
      onPress: onGuestLink,
    },
  ];
  if (onContactPhoto) {
    rows.push({
      key: 'photo',
      label: contactPhotoLabel ?? 'Set photo',
      icon: 'image-outline',
      onPress: onContactPhoto,
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The scrim closes it. A menu that can only be dismissed by its own
          button is a menu people back out of with the system gesture,
          which on Android leaves the screen instead. */}
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radius.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={() => {
                onClose();
                row.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              style={({ pressed }) => [
                styles.row,
                {
                  paddingHorizontal: spacing.md,
                  backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                },
              ]}
            >
              <Ionicons name={row.icon} size={19} color={colors.textSecondary} />
              <Text style={[typography.body, { color: colors.textPrimary, marginLeft: spacing.md }]}>
                {row.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  // Under the top-right corner, clear of the status bar and the header
  // itself — the button it belongs to is up there.
  sheet: {
    position: 'absolute',
    top: 56,
    right: 8,
    minWidth: 236,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
});
