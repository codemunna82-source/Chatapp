import { sign } from 'jsonwebtoken';
import axios, { AxiosError } from 'axios';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import type { PushGateway, PushPayload, SendResult } from './types';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Google issues one-hour tokens; refreshing a minute early avoids racing
 *  the expiry on a slow request. */
const TOKEN_TTL_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;

function parseServiceAccount(): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      logger.error('FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key');
      return null;
    }
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      // Hosting dashboards store the JSON as a single line, which turns the
      // key's real newlines into the two characters \ and n. Left as-is the
      // PEM is unparseable and every send fails with an opaque crypto error.
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch (err) {
    logger.error({ err }, 'FCM_SERVICE_ACCOUNT_JSON is not valid JSON — push notifications are disabled');
    return null;
  }
}

const serviceAccount = parseServiceAccount();

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Mints a Google OAuth2 access token from the service account key.
 *
 * Hand-rolled rather than pulling in google-auth-library: the whole flow is
 * one signed JWT and one POST, and jsonwebtoken is already a dependency.
 */
async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = sign(
    {
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    },
    account.private_key,
    { algorithm: 'RS256' },
  );

  const res = await axios.post<{ access_token: string; expires_in: number }>(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
  );

  cachedToken = {
    value: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
  };
  return cachedToken.value;
}

/** FCM error codes that mean the token will never work again, as opposed to
 *  a transient failure worth keeping the token for. */
const PERMANENTLY_DEAD = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

function errorCodeOf(err: unknown): string | undefined {
  const details = (err as AxiosError<{ error?: { details?: { errorCode?: string }[]; status?: string } }>)?.response
    ?.data?.error;
  return details?.details?.find((d) => d.errorCode)?.errorCode ?? details?.status;
}

export const fcmGateway: PushGateway = {
  isConfigured(): boolean {
    return serviceAccount !== null;
  },

  async send(tokens: string[], payload: PushPayload): Promise<SendResult> {
    const result: SendResult = { invalidTokens: [], successCount: 0, failureCount: 0 };
    if (!serviceAccount || tokens.length === 0) return result;

    const accessToken = await getAccessToken(serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    // The v1 API sends to one token per request — there is no multicast
    // endpoint. Fired concurrently rather than in sequence so a workspace
    // with a dozen devices doesn't wait a dozen round trips.
    const sends = tokens.map(async (token) => {
      try {
        await axios.post(
          url,
          {
            message: {
              token,
              notification: { title: payload.title, body: payload.body },
              data: payload.data,
              android: {
                priority: 'high',
                collapseKey: payload.collapseKey,
                notification: {
                  channelId: payload.channelId,
                  tag: payload.collapseKey,
                  // Tells Android to open the app rather than needing the
                  // payload to name an activity.
                  clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                },
              },
            },
          },
          { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10_000 },
        );
        result.successCount += 1;
      } catch (err) {
        result.failureCount += 1;
        const code = errorCodeOf(err);
        if (code && PERMANENTLY_DEAD.has(code)) {
          result.invalidTokens.push(token);
        } else {
          logger.warn({ code }, 'FCM send failed for one device');
        }
      }
    });

    await Promise.all(sends);
    return result;
  },
};
