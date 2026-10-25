import type { StockAlert } from "@/lib/stock-hold";

/**
 * A line the shopper removed themselves (drawer, quote, WebMCP) must not be
 * announced as sold out when checkout's cart then drops that key.
 *
 * The mark lives only in this tab, and only briefly: long enough for the cart
 * update to land, short enough that a later real sell-out of the same line
 * still speaks.
 */
const MARK_TTL_MS = 20_000;
const marks = new Map<string, number>();

export function markShopperRemovedLine(key: string): void {
  if (!key) return;
  marks.set(key, Date.now() + MARK_TTL_MS);
}

/** True once, when this key was marked and the mark has not expired. */
export function consumeShopperRemovedLine(key: string): boolean {
  const until = marks.get(key);
  if (until == null) return false;
  marks.delete(key);
  return until > Date.now();
}

const SEEN_LINES_KEY = "hk-checkout-seen-lines";
const SEEN_TTL_MS = 20_000;

type SeenLines = {
  sessionId: string | null;
  lines: Map<string, string>;
  at: number;
};

let seen: SeenLines | null = null;
let forgetTimer: ReturnType<typeof setTimeout> | null = null;

function sessionMatches(
  stored: string | null,
  current: string | null,
): boolean {
  if (!stored || !current) return true;
  return stored === current;
}

function cancelForget(): void {
  if (forgetTimer == null) return;
  clearTimeout(forgetTimer);
  forgetTimer = null;
}

function readStoredLines(sessionId: string | null): SeenLines | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SEEN_LINES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      sessionId?: unknown;
      at?: unknown;
      lines?: unknown;
    };
    if (
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at >= SEEN_TTL_MS ||
      !Array.isArray(parsed.lines)
    ) {
      return null;
    }
    const storedSession =
      typeof parsed.sessionId === "string" ? parsed.sessionId : null;
    if (!sessionMatches(storedSession, sessionId)) return null;
    const lines = new Map<string, string>();
    for (const entry of parsed.lines) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const key = entry[0];
      const name = entry[1];
      if (typeof key === "string" && typeof name === "string") {
        lines.set(key, name);
      }
    }
    return { sessionId: storedSession, lines, at: parsed.at };
  } catch {
    return null;
  }
}

function writeStoredLines(next: SeenLines): void {
  if (!next.sessionId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      SEEN_LINES_KEY,
      JSON.stringify({
        sessionId: next.sessionId,
        at: next.at,
        lines: [...next.lines],
      }),
    );
  } catch {
    /* private mode */
  }
}

/**
 * The lines on the checkout the shopper is looking at. A Suspense remount
 * (the shipping step's server action) drops the component's own memory, so
 * this is what the next mount compares against. Forgotten shortly after
 * checkout unmounts, so a later visit does not reuse them.
 */
export function rememberCheckoutLines(
  sessionId: string | null,
  lines: ReadonlyMap<string, string>,
): void {
  cancelForget();
  seen = { sessionId, lines: new Map(lines), at: Date.now() };
  writeStoredLines(seen);
}

/**
 * Lines from this checkout visit. In memory they survive a refresh that
 * mints a new Checkout Session id; after a reload only the same session's
 * stored lines count. The forget timer is what ends the visit.
 */
export function previousCheckoutLines(
  sessionId: string | null,
): Map<string, string> | null {
  cancelForget();
  if (seen && Date.now() - seen.at < SEEN_TTL_MS) {
    return seen.lines;
  }
  const stored = readStoredLines(sessionId);
  if (!stored) return null;
  seen = stored;
  return stored.lines;
}

/** Drop the in-memory lines after checkout leaves the screen. */
export function scheduleForgetCheckoutLines(): void {
  cancelForget();
  forgetTimer = setTimeout(() => {
    seen = null;
    forgetTimer = null;
  }, SEEN_TTL_MS);
}

/**
 * Alerts for lines that were on the previous cart and are not on this one,
 * skipping a line the shopper removed and a name already on screen.
 */
export function unseenRemovedLines(
  previous: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
  existing: readonly StockAlert[],
): StockAlert[] {
  if (!previous) return [];
  const names = new Set(
    existing.flatMap((alert) => (alert.kind === "removed" ? [alert.name] : [])),
  );
  const fresh: StockAlert[] = [];
  for (const [key, name] of previous) {
    if (!name || next.has(key)) continue;
    if (consumeShopperRemovedLine(key)) continue;
    if (names.has(name)) continue;
    names.add(name);
    fresh.push({ kind: "removed", name });
  }
  return fresh;
}

/** Test isolation. Module state otherwise survives between cases. */
export function resetShopperCartEdits(): void {
  marks.clear();
  seen = null;
  cancelForget();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(SEEN_LINES_KEY);
  }
}
