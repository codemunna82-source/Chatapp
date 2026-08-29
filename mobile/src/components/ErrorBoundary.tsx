import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { lightColors, darkColors } from '../theme/colors';
import { touchTarget } from '../theme/spacing';
import { captureHandledError } from '../lib/sentry';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** OS color scheme at mount — this renders outside ThemeProvider, so it can't use the hook. */
  scheme?: 'light' | 'dark';
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/lifecycle exceptions anywhere below it and shows a real
 * recovery screen instead of the white void a release build leaves behind
 * (there is no dev error overlay in a production APK).
 *
 * Deliberately a class component: componentDidCatch/getDerivedStateFromError
 * have no hook equivalent — this is the one case React still requires a
 * class for. Its own styling avoids useTheme() on purpose, since a crash in
 * the theme layer must not take the fallback UI down with it.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // React swallows the error once a boundary handles it, so without this
    // the most serious class of failure in the app — one that blanked a
    // screen for a real user — never leaves their device. The component
    // stack is what makes it actionable; the message itself is scrubbed of
    // phone numbers on the way out (see lib/sentry.ts).
    captureHandledError(error, { componentStack: info.componentStack });
  }

  handleReset = () => {
    // Remounts the subtree. Recovers from a transient render error (a bad
    // payload, a momentarily-missing field); a deterministic crash will
    // simply land back here rather than looping invisibly.
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const colors = this.props.scheme === 'dark' ? darkColors : lightColors;

    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <Ionicons name="warning-outline" size={44} color={colors.danger} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Something went wrong</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          The app hit an unexpected error. You can try again — your messages and account are unaffected.
        </Text>

        {/* The message is kept visible rather than swallowed: without it a
            release-build crash is undiagnosable from a user report. */}
        <ScrollView style={[styles.detail, { backgroundColor: colors.surfaceAlt }]} contentContainerStyle={styles.detailContent}>
          <Text style={[styles.detailText, { color: colors.textTertiary }]}>{error.message || String(error)}</Text>
        </ScrollView>

        <Pressable
          onPress={this.handleReset}
          style={[styles.button, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          {({ pressed }) => (
            <Text style={[styles.buttonLabel, { color: colors.textOnPrimary, opacity: pressed ? 0.7 : 1 }]}>Try again</Text>
          )}
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginTop: 16 },
  body: { fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  detail: { alignSelf: 'stretch', maxHeight: 120, borderRadius: 12, marginTop: 20 },
  detailContent: { padding: 12 },
  detailText: { fontSize: 12.5, lineHeight: 18 },
  button: {
    marginTop: 20,
    minHeight: touchTarget.min,
    paddingHorizontal: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
});
