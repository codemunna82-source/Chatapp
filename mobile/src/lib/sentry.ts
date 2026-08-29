import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { sentryDsn, sentryTracesSampleRate } from '../utils/env';

/**
 * Whether crash reporting is switched on.
 *
 * Off unless EXPO_PUBLIC_SENTRY_DSN is baked into the build, so a local
 * checkout and any build made without it report nothing and reach no third
 * party.
 */
export function isSentryEnabled(): boolean {
  return sentryDsn.length > 0;
}

/**
 * Anything that looks like a phone number, replaced with its last two
 * digits.
 *
 * Every contact in this app IS a phone number, and they turn up inside
 * error messages ("no conversation for +919876543210"), URLs and
 * navigation params. Keeping a short suffix leaves a report correlatable
 * with a customer complaint without storing the identifier itself.
 */
const PHONE_PATTERN = /\+?\d[\d\s()-]{7,}\d/g;

export function scrubText(input: string): string {
  return input.replace(PHONE_PATTERN, (match) => `[phone…${match.replace(/\D/g, '').slice(-2)}]`);
}

/**
 * The three values the release name is built from. Read from expoConfig
 * rather than hardcoded, so bumping the version in app.config.ts cannot
 * leave this behind.
 */
const appVersion = Constants.expoConfig?.version ?? 'unknown';
const androidPackage = Constants.expoConfig?.android?.package ?? 'com.voxo.app';
const androidVersionCode = String(Constants.expoConfig?.android?.versionCode ?? '0');

/**
 * Records which screen the user is on, so a crash report says where it
 * happened. Registered with the NavigationContainer in RootNavigator.
 */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: false,
});

/**
 * Starts crash reporting.
 *
 * Called from index.ts before the root component is registered, so a crash
 * during the very first render is still captured.
 */
export function initSentry(): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: __DEV__ ? 'development' : 'production',
    // Ties a crash to the exact APK, and — the part that is easy to get
    // silently wrong — MUST match the release name sentry-cli uploads the
    // source maps under, or the maps arrive in Sentry and are never
    // applied to anything. sentry.gradle.kts builds it as
    // `${applicationId}@${versionName}+${versionCode}` (see its
    // defaultReleaseName), so this reproduces that exactly rather than
    // inventing its own scheme.
    release: `${androidPackage}@${appVersion}+${androidVersionCode}`,
    dist: androidVersionCode,
    tracesSampleRate: sentryTracesSampleRate,

    // The most important line in this file. Turning it on attaches request
    // bodies and user identifiers — which in this app means the text of
    // customers' WhatsApp messages and their phone numbers, sent to a
    // third party and retained there.
    sendDefaultPii: false,

    // Both would capture an open conversation verbatim. A crash report is
    // not worth a picture of someone's inbox.
    attachScreenshot: false,
    attachViewHierarchy: false,

    integrations: [navigationIntegration],

    beforeSend(event) {
      if (event.message) event.message = scrubText(event.message);
      for (const value of event.exception?.values ?? []) {
        if (value.value) value.value = scrubText(value.value);
      }
      delete event.request?.data;
      if (event.request?.url) event.request.url = scrubText(event.request.url);
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // Console breadcrumbs on a chat screen routinely contain message
      // text, and there is no way to tell which ones do — so none are kept.
      if (breadcrumb.category === 'console') return null;
      if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
      if (typeof breadcrumb.data?.url === 'string') breadcrumb.data.url = scrubText(breadcrumb.data.url);
      return breadcrumb;
    },
  });
}

/**
 * Identifies the session by ids only.
 *
 * No email, no display name, no phone: enough to tell that one crash hit
 * forty users rather than one person forty times, and nothing more.
 */
export function setSentryUser(user: { id: string; tenantId: string; role: string } | null): void {
  if (!isSentryEnabled()) return;
  Sentry.setUser(user ? { id: user.id } : null);
  Sentry.setTag('tenantId', user?.tenantId ?? '');
  Sentry.setTag('role', user?.role ?? '');
}

/**
 * Reports an error the app caught and handled — a send that failed, an
 * upload that broke — which would otherwise never reach Sentry, because it
 * never becomes an unhandled crash.
 */
export function captureHandledError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(err, { extra: context });
}

export { Sentry };
