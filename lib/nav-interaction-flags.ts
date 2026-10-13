/**
 * Per-store switch for how a link BEHAVES, and the one place the variable is
 * read or its value interpreted.
 *
 * `NEXT_PUBLIC_NAV_MOUSEDOWN` — start an in-app navigation on `mousedown`
 * rather than on `click`. Off, `InstantLink` installs no mouse-down handler.
 *
 * DEFAULT OFF. Only an explicit on value (`true` / `1` / `on` / `yes`)
 * turns it on. Unset, empty, and unrecognised values stay off.
 *
 * Read as a literal `process.env.NEXT_PUBLIC_*` member expression so Next
 * inlines it into the client bundle. Read per call so tests can stubEnv.
 */

const ON_VALUES: ReadonlySet<string> = new Set(["true", "1", "on", "yes"]);

export function isFlagOptedIn(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

export function navMouseDownEnabled(): boolean {
  return isFlagOptedIn(process.env.NEXT_PUBLIC_NAV_MOUSEDOWN);
}
