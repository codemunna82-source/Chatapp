/**
 * Whether a request's session has been superseded by a newer sign-in.
 *
 * An account is usable on one device at a time. Each sign-in mints a
 * refresh-token family, that family is carried in the access token, and
 * it survives rotation — so comparing families compares SESSIONS rather
 * than individual tokens, and a device stays signed in across refreshes
 * until someone signs in elsewhere.
 *
 * Its own function because the rule is applied in two places — every
 * request, and every refresh — and the two drifting apart would mean a
 * device refused on its requests that could still mint fresh tokens.
 *
 * @param activeFamily the family the account currently belongs to; absent
 *   means no sign-in has claimed it since this rule existed.
 * @param tokenFamily  the family carried by the presented token; absent
 *   means the token predates the claim.
 */
export function isSessionReplaced(
  activeFamily: string | undefined | null,
  tokenFamily: string | undefined | null,
): boolean {
  // Nobody has signed in since the field existed. Allowing everything
  // here is what keeps the deploy that shipped this from signing out
  // every user at once — which would be a fault of the change, not a
  // feature of it.
  if (!activeFamily) return false;
  return tokenFamily !== activeFamily;
}
