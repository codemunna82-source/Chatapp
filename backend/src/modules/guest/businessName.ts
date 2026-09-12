import { Tenant } from '../tenants/tenant.model';
import { findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';

/**
 * The name the customer sees in the web chat window.
 *
 * This has one job, and it is the reason the module exists separately:
 * the window used to show `Tenant.name`, which is the workspace's
 * INTERNAL label. A fresh install's is literally "Demo Tenant" — so a
 * customer who tapped an invitation from a real business landed on a page
 * headed by a stranger's placeholder. For a page whose entire purpose is
 * persuading someone it is safe to keep talking, that is fatal.
 *
 * Split out of guest.service.ts because two paths render this name — the
 * header on session load and the push notification title — and they must
 * never disagree. A customer whose notification says one name and whose
 * window says another has been given a reason to doubt both.
 */

/**
 * Names that mean "nobody has set this yet".
 *
 * Matched case-insensitively and only in full: a workspace genuinely
 * called "Demo Kitchens" must keep its name. These are the strings the
 * seed writes (see scripts/seed.ts and SEED_TENANT_NAME), never anything
 * a person typed on purpose.
 */
const PLACEHOLDER_NAMES = new Set(['demo tenant', 'demo workspace', 'voxo demo business', 'my workspace']);

function usable(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** Where the name shown to the customer came from, for the admin screen. */
export type BusinessNameSource = 'settings' | 'whatsapp' | 'workspace' | 'fallback';

export interface BusinessNameCandidates {
  /** What the admin typed in settings. Wins outright — it is an explicit instruction. */
  displayName?: string | null;
  /** Meta's approved display name for the number the customer messaged. */
  verifiedName?: string | null;
  /** The workspace's internal label, used only if nothing better exists. */
  tenantName?: string | null;
}

/**
 * Picks the name, in the order that is most likely to be the one the
 * customer recognises.
 *
 * 1. What the admin set in settings. An explicit answer beats a derived
 *    one, always — that field exists precisely to override the rest.
 * 2. The display name Meta holds for the number they messaged. This is
 *    the name they saw above the chat in WhatsApp seconds earlier, which
 *    makes it the strongest possible continuity signal.
 * 3. The workspace's own name, if it is not a seeded placeholder.
 * 4. "Support" — honest and neutral. Better than a placeholder that names
 *    a business the customer has never heard of.
 */
export function resolveBusinessName(candidates: BusinessNameCandidates): {
  name: string;
  source: BusinessNameSource;
} {
  const fromSettings = usable(candidates.displayName);
  if (fromSettings) return { name: fromSettings, source: 'settings' };

  const fromMeta = usable(candidates.verifiedName);
  if (fromMeta) return { name: fromMeta, source: 'whatsapp' };

  const fromWorkspace = usable(candidates.tenantName);
  if (fromWorkspace) return { name: fromWorkspace, source: 'workspace' };

  return { name: 'Support', source: 'fallback' };
}

/**
 * The same decision, made from ids rather than values.
 *
 * Every caller that renders the name to a customer goes through this, so
 * none of them has to remember which fields to select or in what order to
 * prefer them. Two documents, read in parallel; no Graph call, because a
 * push notification must not wait on Meta.
 */
export async function resolveBusinessNameForConversation(
  tenantId: string,
  whatsappPhoneNumberId?: string | null,
): Promise<{ name: string; source: BusinessNameSource }> {
  const [tenant, phoneNumber] = await Promise.all([
    Tenant.findById(tenantId).select('name displayName').lean(),
    whatsappPhoneNumberId
      ? findPhoneNumberByIdAndTenant(String(whatsappPhoneNumberId), tenantId)
      : Promise.resolve(null),
  ]);

  return resolveBusinessName({
    displayName: tenant?.displayName,
    verifiedName: phoneNumber?.verifiedName,
    tenantName: tenant?.name,
  });
}
