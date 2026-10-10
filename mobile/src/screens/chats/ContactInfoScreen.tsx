import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../../navigation/types';
import { Screen } from '../../components/Screen';
import { ThemeProvider, useTheme, useResolvedScheme } from '../../theme/ThemeProvider';
import { chatLightColors, chatDarkColors, chatHeaderBackground, chatHeaderForeground } from '../../theme/chatTheme';
import { useConversation } from '../../queries/useConversations';
import { contactDisplayName } from '../../utils/formatPhone';
import { PrivacyBanner, ContactSummaryCard } from './ContactCard';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ContactInfo'>;

function ContactInfoBody({ conversationId }: { conversationId: string }) {
  const { spacing } = useTheme();
  const conversationQuery = useConversation(conversationId);
  const name = contactDisplayName(conversationQuery.data?.contact);
  return (
    <ScrollView contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}>
      <PrivacyBanner name={name} />
      <ContactSummaryCard conversationId={conversationId} />
    </ScrollView>
  );
}

export function ContactInfoScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const scheme = useResolvedScheme();
  const chatColors = scheme === 'dark' ? chatDarkColors : chatLightColors;

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Contact info',
      headerStyle: { backgroundColor: chatHeaderBackground[scheme] },
      headerTintColor: chatHeaderForeground[scheme],
      headerTitleStyle: { color: chatHeaderForeground[scheme] },
    });
  }, [navigation, scheme]);

  return (
    <ThemeProvider colors={chatColors}>
      <Screen padded={false}>
        <View style={[styles.flex, { backgroundColor: chatColors.background }]}>
          <ContactInfoBody conversationId={conversationId} />
        </View>
      </Screen>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
});
