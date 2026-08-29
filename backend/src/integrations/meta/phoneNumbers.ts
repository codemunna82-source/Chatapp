import type { AxiosRequestConfig } from 'axios';
import { metaRequest, authConfig } from './metaClient';
import type { PhoneNumberProfile } from './types';

interface MetaPhoneNumberResponse {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

/**
 * Reads one phone number's profile straight from Meta.
 *
 * Used to verify a phone_number_id an admin pasted before storing it. That
 * verification is the whole point: an unverified id is stored happily and
 * then fails on every single send with a generic Graph error, hours or
 * days later and far from the typo that caused it. Calling Meta once at
 * registration turns that into an immediate, specific failure — and proves
 * the configured access token can actually reach the number, which is the
 * other half of what makes sending work.
 */
export async function fetchPhoneNumberProfile(
  accessToken: string,
  phoneNumberId: string,
): Promise<PhoneNumberProfile> {
  // Annotated rather than inline, same as templates.ts: axios infers the
  // params object's literal type into the config generic otherwise, and it
  // stops matching AxiosRequestConfig.
  const config: AxiosRequestConfig = {
    ...authConfig(accessToken),
    params: { fields: 'display_phone_number,verified_name,quality_rating' },
  };
  const res = await metaRequest<MetaPhoneNumberResponse>((client) => client.get(`/${phoneNumberId}`, config));

  return {
    phoneNumberId: res.id,
    // Meta omits display_phone_number on a number that is not yet
    // registered. Falling back to the id keeps the record valid (the field
    // is required) and visibly wrong in the UI, rather than crashing here.
    displayPhoneNumber: res.display_phone_number ?? phoneNumberId,
    verifiedName: res.verified_name,
    qualityRating: res.quality_rating,
  };
}
