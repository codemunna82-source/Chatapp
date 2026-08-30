import type { AxiosRequestConfig } from 'axios';
import { metaRequest, authConfig } from './metaClient';
import { env } from '../../config/env';

/**
 * The Graph calls that turn an Embedded Signup result into stored,
 * usable credentials. Everything here runs server-side only — the auth
 * code the WebView returns is worthless to an attacker without the app
 * secret, which never leaves this process.
 */

interface TokenExchangeResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Exchanges the short-lived code Embedded Signup returns for a business
 * access token.
 *
 * Note there is no redirect_uri here. Embedded Signup with
 * `response_type: 'code'` and `override_default_response_type: true` hands
 * the code back through the JS SDK rather than a browser redirect, and
 * sending a redirect_uri Meta never issued the code against makes the
 * exchange fail with a mismatch error.
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const config: AxiosRequestConfig = {
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      code,
    },
  };
  const res = await metaRequest<TokenExchangeResponse>((client) => client.get('/oauth/access_token', config));
  return res.access_token;
}

interface DebugTokenResponse {
  data?: {
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
    scopes?: string[];
  };
}

/**
 * Finds which WhatsApp Business Account the freshly-issued token actually
 * grants access to.
 *
 * Read from the token itself rather than taken from the client: the
 * WebView could claim any WABA id, and trusting one would let a user
 * attach someone else's business to their account. `granular_scopes` names
 * the exact target ids the user granted for
 * `whatsapp_business_management`, so this is the authoritative answer.
 *
 * The appsecret-style `input_token`/`access_token` split matters — the
 * second must be an app token, not the user's, or Meta refuses to
 * introspect.
 */
export async function findWabaIdForToken(userAccessToken: string): Promise<string | null> {
  const config: AxiosRequestConfig = {
    params: {
      input_token: userAccessToken,
      access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    },
  };
  const res = await metaRequest<DebugTokenResponse>((client) => client.get('/debug_token', config));

  const scopes = res.data?.granular_scopes ?? [];
  const management = scopes.find((s) => s.scope === 'whatsapp_business_management');
  const messaging = scopes.find((s) => s.scope === 'whatsapp_business_messaging');
  return management?.target_ids?.[0] ?? messaging?.target_ids?.[0] ?? null;
}

export interface WabaPhoneNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  qualityRating?: string;
}

interface WabaPhoneNumbersResponse {
  data: Array<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
  }>;
}

/** Every number on a WABA. Embedded Signup usually yields one, but a
 *  business onboarding an existing account can have several. */
export async function listWabaPhoneNumbers(
  accessToken: string,
  wabaId: string,
): Promise<WabaPhoneNumber[]> {
  const config: AxiosRequestConfig = {
    ...authConfig(accessToken),
    params: { fields: 'display_phone_number,verified_name,quality_rating' },
  };
  const res = await metaRequest<WabaPhoneNumbersResponse>((client) =>
    client.get(`/${wabaId}/phone_numbers`, config),
  );
  return res.data.map((n) => ({
    phoneNumberId: n.id,
    displayPhoneNumber: n.display_phone_number ?? n.id,
    verifiedName: n.verified_name,
    qualityRating: n.quality_rating,
  }));
}

/**
 * Registers a number for Cloud API use.
 *
 * Without this the number is onboarded but cannot send: Meta returns a
 * "not registered" error on the first message. The PIN is the number's
 * two-step verification code, so it must be the same value on every
 * re-register — hence an env var rather than something generated here.
 */
export async function registerPhoneNumber(accessToken: string, phoneNumberId: string): Promise<void> {
  await metaRequest<{ success?: boolean }>((client) =>
    client.post(
      `/${phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin: env.META_REGISTER_PIN },
      authConfig(accessToken),
    ),
  );
}

/**
 * Subscribes our app to the WABA's webhooks.
 *
 * This is the step that makes incoming messages arrive at all. Onboarding
 * without it produces an account that can send and appears healthy, and
 * silently never receives a reply — the failure is invisible until a
 * customer answers and nothing happens.
 */
export async function subscribeAppToWaba(accessToken: string, wabaId: string): Promise<void> {
  await metaRequest<{ success?: boolean }>((client) =>
    client.post(`/${wabaId}/subscribed_apps`, {}, authConfig(accessToken)),
  );
}
