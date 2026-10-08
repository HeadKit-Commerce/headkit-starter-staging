import { readFileSync } from "node:fs";
import { test, expect, request } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Store V1 -> V2 route/parity gate (MIG-03 / MIG-04).
 *
 * STOP — DO NOT RUN THIS SPEC AGAINST A LIVE CUSTOMER STOREFRONT UNTIL THE
 * REQUEST GUARD LANDS (`260825-store-parity-no-request-guard`). This spec was
 * cleared for a remote host on the premise that it is GET-only. That premise is
 * FALSE for its browser passes, so the clearance was never valid. What is safe
 * today is a rehearsal or preview host that is not a real merchant's store. The
 * full account is under "NON-LOCAL HOST" below; read it before pointing this at
 * anything a customer sells from.
 *
 * STORE-AGNOSTIC BY CONSTRUCTION, AND THAT IS THE POINT. This file names no
 * store. Which store a run asserts is decided entirely by its three REQUIRED
 * environment variables below — the origin under test, the url inventory swept
 * against it, and the search-engine posture that origin is claimed to have.
 * None of the three is defaulted, because every default here would silently
 * decide something the run is supposed to state. One gate serves every store,
 * so a fix to it is a fix for all of them rather than for one of several
 * divergent forks.
 *
 * RED UNTIL THE PHASE'S STOREFRONT WORK LANDS AND THE STORE IS DEPLOYED. This
 * spec is authored as the phase acceptance target, not as a description of
 * today. It asserts what V2 must serve at every url the live V1 store serves;
 * until the nested `/shop/[...slug]` PDP, the rebuilt sitemap, host-aware
 * robots, `/wholesale` and the first production deployment are all in place on
 * the target host, entries of it WILL fail. That is the intended state.
 *
 * FIXTURE PREREQUISITE, AND THIS SPEC DOES NOT MOCK. Its only inputs are the
 * per-store url inventory named by `PARITY_URL_INVENTORY` (see the `.md`
 * provenance document sitting beside that fixture for how it was captured and
 * why it cannot be recaptured) and a base url. Everything else is read over the
 * wire from the host under test. An empty, missing, unparseable or
 * self-inconsistent fixture makes this spec FAIL LOUDLY — it never reports a
 * passing zero-case run, because a green run must mean the sweep actually
 * happened.
 *
 * NON-LOCAL HOST — EXPLICIT OPERATOR WAIVER, NOT AN OVERSIGHT. Every other
 * spec in this suite, and `playwright.config.ts:6-7` itself, states LOCAL-ONLY
 * as a hard rule. This spec deliberately runs against a REMOTE host, because
 * the property it exists to prove — that a real deployment on a real domain
 * serves every url the customer's live store serves — cannot be observed
 * against localhost. The waiver is bounded: `E2E_BASE_URL` is REQUIRED and has
 * no default here (unset fails loudly rather than quietly sweeping localhost),
 * and no customer hostname appears anywhere in this file. Do not "fix" this
 * file back to local-only; read the `.md` provenance document beside the
 * store's inventory fixture, § "The waiver", first.
 *
 * THE WAIVER IS NOT BOUNDED BY A GET-ONLY GUARANTEE. IT DOES NOT HAVE ONE.
 * This spec installs NO request guard of any kind. Unlike `e2e/port-verify/`,
 * nothing here intercepts, aborts or records what the page issues — there is no
 * `context.route`, no `installGetOnlyGuard`, no blocked-host list. The
 * `request.newContext()` calls below do issue GET only, but the browser passes
 * (`page.goto`) load the full storefront with JavaScript enabled, and the
 * storefront's own root layout issues at least one NON-GET per page load:
 * `app/layout.tsx` renders `<LazyCartDrawer />`, which is
 * `dynamic(..., { ssr: false })` and therefore loads at HYDRATION rather than on
 * interaction; `cart-drawer.tsx` calls `getCartAction()` from an on-mount
 * `useEffect`; and `getCartAction` lives in a `"use server"` module, so a client
 * caller dispatches it as an HTTP POST to the current route carrying the
 * `Next-Action` header. Nothing aborts that request and nothing records it.
 *
 * It does not MUTATE today only because `getCartAction` returns null when there
 * is no cart-token cookie (`lib/cart-actions.ts`) and a fresh Playwright context
 * has none. That is the behaviour of one function's body, NOT a control: nothing
 * enforces it, nothing tests it, and it says nothing about the next on-mount
 * server action, analytics beacon or error reporter added to the layout. Closing
 * this needs a real guard, which is `260825-store-parity-no-request-guard`.
 *
 * THE TRANSACTING SPECS MUST NEVER JOIN A RUN AGAINST THIS HOST. A migrating
 * store's Stripe account is LIVE, not test, and its WooCommerce database is the
 * live order book. The safe invocation NAMES THIS ONE FILE:
 *
 *     bunx playwright test e2e/store-parity.spec.ts --project=chromium
 *
 * `playwright.config.ts:31-39` also offers `E2E_TEST_IGNORE` as a denylist, and
 * it should be set as defence in depth — but it is a DENYLIST, so it fails open
 * on any spec added after it was written. Naming the single file is therefore
 * the primary control, not the denylist.
 *
 * A LOCAL FULL-SUITE RUN NEEDS THAT DENYLIST TOO. This spec refuses to self-skip
 * when its three required env vars are unset, so `bun run test:e2e` in
 * `apps/starter` is red by one failure on a clean tree unless it is invoked as
 * `E2E_TEST_IGNORE=store-parity.spec.ts bun run test:e2e` — the same exclusion
 * ci.yml sets. That is the cost of the no-self-skip design, not a defect in it:
 * a parity gate that skipped itself would report green without having swept
 * anything, which is the failure it exists to catch.
 *
 * The specs that must never run against a live merchant, in two groups:
 *   - place a real order or submit card details:
 *       checkout-purchase.spec.ts, checkout-pickup.spec.ts, free-order.spec.ts
 *   - reach checkout or otherwise mutate store/customer state:
 *       checkout-auth.spec.ts, checkout-attribution.spec.ts, coupon.spec.ts,
 *       gift-card.spec.ts, guest-order.spec.ts, refund-visibility.spec.ts,
 *       cart-ops.spec.ts, cart-real-key.spec.ts, wishlist.spec.ts,
 *       provisioning/signup-to-store.spec.ts
 *
 * 15.1-VALIDATION.md binding:
 *   - MIG-03 "every url returns 200 at its declared final url"
 *       -> the per-entry sweep cases below
 *   - MIG-03 "25 PDPs prerendered; no page contains the placeholder"
 *       -> "no response body carries the build-time placeholder slug"
 *          and "distinct product paths served equals the catalogue size"
 *   - MIG-03 "temp host is not indexable and publishes no sitemap"
 *       -> "robots posture matches the declared host role"
 *   - MIG-03 "the DOMAIN serves the intended deployment, not merely that some
 *      deployment is READY"
 *       -> "one deployment identifier is served across the sweep"
 *   - MIG-04 "post-flip: the same parity spec passes against the live host"
 *       -> the same cases, run with PARITY_TEMP_HOST=false
 *   - MIG-04 "zero 404s on /api/checkout/confirm"
 *       -> "the legacy checkout-confirmation path does not answer not-found"
 *
 * Environment — ALL THREE REQUIRED, NONE DEFAULTED:
 *   E2E_BASE_URL         the origin under test
 *   PARITY_URL_INVENTORY the store's url inventory fixture (path to the json).
 *                        No default at all: a default asserts against whichever
 *                        store's inventory was there first.
 *   PARITY_TEMP_HOST     "true"|"false" — whether this run targets a
 *                        temporary host. Both branches ASSERT; neither skips.
 */

/**
 * The slug both catalogue `generateStaticParams` implementations fall back to
 * when the catalog API is unreachable AT BUILD TIME
 * (`app/products/[...slug]/page.tsx`, `app/shop/[...slug]/page.tsx`, and four
 * sibling routes). It is the reason a green build can ship an empty catalogue
 * while every route still answers 200 — which is exactly the failure a status
 * sweep cannot see. Declared once, here, and asserted absent from every body.
 */
export const BUILD_TIME_PLACEHOLDER_SLUG = "__hk_static_placeholder";

/**
 * No default, and deliberately not even a fallback to a file in `fixtures/`.
 * Several stores' inventories live side by side there, so ANY default here
 * would let a run sweep one store's host against another store's inventory and
 * report a parity verdict for neither. Unset fails in the before-all hook,
 * naming this variable.
 */
const FIXTURE_PATH = (process.env.PARITY_URL_INVENTORY ?? "").trim();

/**
 * No default. `playwright.config.ts` defaults `baseURL` to localhost, which is
 * right for every other spec and wrong for this one: a run with the variable
 * unset would sweep the local dev server and report a parity result for a host
 * nobody meant to test.
 */
const BASE_URL = (process.env.E2E_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Parsed strictly. An unrecognised or absent value resolves to `null`, which
 * the before-all hook FAILS on — a run must state which posture it expects,
 * because defaulting the flag would silently pick one of the two assertions.
 */
const TEMP_HOST: boolean | null = (() => {
  const raw = (process.env.PARITY_TEMP_HOST ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
})();

/**
 * The before-all hook aborts on the FIRST missing variable, so a run that set
 * none of the three would otherwise learn about them one re-run at a time.
 * Every abort message below carries this suffix, which names all of them at
 * once. It is wording, not control flow: each variable still has its own
 * assertion and its own explanation of why it is not defaulted.
 */
const MISSING_REQUIRED_ENV: readonly string[] = [
  ...(FIXTURE_PATH === "" ? ["PARITY_URL_INVENTORY"] : []),
  ...(BASE_URL === "" ? ["E2E_BASE_URL"] : []),
  ...(TEMP_HOST === null ? ["PARITY_TEMP_HOST"] : []),
];

const MISSING_REQUIRED_SUFFIX =
  MISSING_REQUIRED_ENV.length > 1
    ? ` This run is missing ${MISSING_REQUIRED_ENV.length} of the 3 required variables: ${MISSING_REQUIRED_ENV.join(", ")}.`
    : "";

/** How many urls are fetched at once. The source capture used 2 req/s; four
 * concurrent GETs against a CDN-fronted deployment is polite and keeps a
 * fifty-url sweep inside a couple of minutes. */
const SWEEP_CONCURRENCY = 4;

/** The whole sweep happens in one hook, so it gets its own budget. */
const SWEEP_TIMEOUT_MS = 5 * 60 * 1000;

/** Minimum number of urls the served-deployment assertion samples. */
const DEPLOYMENT_SAMPLE_SIZE = 10;

/** Legacy V1 3DS return path — V2 answers it as a migration safety net. */
const LEGACY_CONFIRM_PATH = "/api/checkout/confirm";

const CAPTURE_HINT = `capture the inventory first (see the \`.md\` provenance document beside the store's inventory fixture) — this spec does NOT mock and has no fallback data`;

// ---------------------------------------------------------------------------
// Fixture contract
// ---------------------------------------------------------------------------

const KINDS = [
  "product",
  "category",
  "listing",
  "editorial",
  "functional",
] as const;
type EntryKind = (typeof KINDS)[number];

interface Expectations {
  min_product_detail_markers?: number;
  canonical_expected?: boolean;
  min_product_cards?: number;
  baseline_zero_cards?: boolean;
  baseline_note?: string;
  min_body_text_length?: number;
  status_only?: boolean;
}

interface InventoryEntry {
  path: string;
  kind: EntryKind;
  expected_final_path: string;
  expected_status: number;
  expectations: Expectations;
  excluded?: boolean;
  excluded_reason?: string;
  redirect_reason?: string;
}

interface Inventory {
  schema_version: string;
  captured_at: string;
  source_host: string;
  source_entry_count: number;
  expected_product_count: number;
  entries: InventoryEntry[];
}

type LoadResult = { ok: true; data: Inventory } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read and validate the fixture. NEVER throws: a throw at module scope aborts
 * collection with a Playwright-internal message instead of one that tells the
 * reader which file is wrong and what to do about it.
 */
function loadInventory(path: string): LoadResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const name = error instanceof Error ? error.message : "unknown read error";
    return { ok: false, reason: `could not be read (${name})` };
  }

  if (text.trim() === "") return { ok: false, reason: "is empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const name = error instanceof Error ? error.message : "unknown parse error";
    return { ok: false, reason: `is not parseable JSON (${name})` };
  }

  if (!isRecord(parsed)) return { ok: false, reason: "is not a JSON object" };

  for (const key of ["schema_version", "captured_at", "source_host"] as const) {
    if (typeof parsed[key] !== "string" || parsed[key] === "") {
      return {
        ok: false,
        reason: `is missing the top-level string \`${key}\``,
      };
    }
  }
  for (const key of ["source_entry_count", "expected_product_count"] as const) {
    if (typeof parsed[key] !== "number" || (parsed[key] as number) <= 0) {
      return {
        ok: false,
        reason: `is missing a positive top-level number \`${key}\``,
      };
    }
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    return { ok: false, reason: "declares no entries" };
  }

  const entries: InventoryEntry[] = [];
  for (let i = 0; i < parsed.entries.length; i++) {
    const raw: unknown = parsed.entries[i];
    if (!isRecord(raw)) {
      return { ok: false, reason: `entry ${i} is not an object` };
    }
    const { path: p, kind, expected_final_path, expected_status } = raw;
    if (typeof p !== "string" || !p.startsWith("/")) {
      return { ok: false, reason: `entry ${i} has no site-relative \`path\`` };
    }
    if (typeof kind !== "string" || !KINDS.includes(kind as EntryKind)) {
      return {
        ok: false,
        reason: `entry ${i} (${p}) has kind "${String(kind)}", which is not one of ${KINDS.join("|")}`,
      };
    }
    if (
      typeof expected_final_path !== "string" ||
      !expected_final_path.startsWith("/")
    ) {
      return {
        ok: false,
        reason: `entry ${i} (${p}) has no site-relative \`expected_final_path\``,
      };
    }
    if (typeof expected_status !== "number") {
      return {
        ok: false,
        reason: `entry ${i} (${p}) has no numeric \`expected_status\``,
      };
    }
    if (!isRecord(raw.expectations)) {
      return {
        ok: false,
        reason: `entry ${i} (${p}) has no \`expectations\` object`,
      };
    }

    const excluded = raw.excluded === true;
    if (excluded && typeof raw.excluded_reason !== "string") {
      return {
        ok: false,
        reason: `entry ${i} (${p}) is excluded but carries no \`excluded_reason\` — an entry may not leave the gate without saying why`,
      };
    }

    // A DECLARED redirect with no reason invalidates the WHOLE fixture. It is
    // not skipped: skipping one entry is how an inventory shrinks quietly,
    // which is the failure mode this gate exists to make impossible.
    if (
      !excluded &&
      expected_final_path !== p &&
      (typeof raw.redirect_reason !== "string" ||
        raw.redirect_reason.trim() === "")
    ) {
      return {
        ok: false,
        reason: `entry ${i} (${p}) declares a redirect to ${expected_final_path} with no \`redirect_reason\` — a redirect into a different page is a silent search loss and must be justified in the data, not assumed`,
      };
    }

    const entry: InventoryEntry = {
      path: p,
      kind: kind as EntryKind,
      expected_final_path,
      expected_status,
      expectations: raw.expectations as Expectations,
      excluded,
    };
    if (typeof raw.excluded_reason === "string") {
      entry.excluded_reason = raw.excluded_reason;
    }
    if (typeof raw.redirect_reason === "string") {
      entry.redirect_reason = raw.redirect_reason;
    }
    entries.push(entry);
  }

  const data: Inventory = {
    schema_version: parsed.schema_version as string,
    captured_at: parsed.captured_at as string,
    source_host: parsed.source_host as string,
    source_entry_count: parsed.source_entry_count as number,
    expected_product_count: parsed.expected_product_count as number,
    entries,
  };

  // Self-consistency: the catalogue number the gate asserts against must be the
  // number of product entries it can actually check. If those two drift, the
  // product-count case would compare a live catalogue against a figure nothing
  // in the fixture backs.
  const productEntries = entries.filter(
    (e) => e.kind === "product" && e.excluded !== true,
  ).length;
  if (productEntries !== data.expected_product_count) {
    return {
      ok: false,
      reason: `declares expected_product_count=${data.expected_product_count} but carries ${productEntries} non-excluded product entries — the fixture disagrees with itself`,
    };
  }
  if (entries.length !== data.source_entry_count) {
    return {
      ok: false,
      reason: `carries ${entries.length} entries but records source_entry_count=${data.source_entry_count} — the inventory has shrunk since capture`,
    };
  }

  return { ok: true, data };
}

const loaded = loadInventory(FIXTURE_PATH);
const inventory: Inventory | null = loaded.ok ? loaded.data : null;
const allEntries: InventoryEntry[] = inventory?.entries ?? [];
const activeEntries = allEntries.filter((e) => e.excluded !== true);
const excludedEntries = allEntries.filter((e) => e.excluded === true);
const expectedProductCount = inventory?.expected_product_count ?? 0;

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

interface Swept {
  entry: InventoryEntry;
  /** -1 means the request never produced a response. */
  status: number;
  finalPath: string;
  body: string;
  contentType: string;
  transportError: string | null;
  /**
   * Status of the FIRST hop, captured only when the url actually redirected —
   * `null` on every entry served directly.
   *
   * The followed request reports the status of the DESTINATION, so a redirect
   * reads as `200` no matter which redirect it was. That erases the only
   * distinction that matters to a migration: `308`/`301` consolidates the old
   * url's ranking onto the new one, `307`/`302` tells a crawler to keep the
   * old url and hands the move no ranking at all. Both look identical here
   * without this field.
   */
  firstHopStatus: number | null;
}

/**
 * A trailing slash is not a different page, so `/about/` and `/about` compare
 * equal. Anything beyond that — a different segment, a different namespace — is
 * a different page and must fail.
 */
function normalisePath(pathname: string): string {
  const stripped = pathname.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

function finalPathOf(url: string): string {
  try {
    return normalisePath(new URL(url).pathname);
  } catch {
    return url;
  }
}

async function fetchEntry(
  api: APIRequestContext,
  entry: InventoryEntry,
): Promise<Swept> {
  try {
    const res = await api.get(`${BASE_URL}${entry.path}`, {
      headers: { "user-agent": "HeadKit-Migration-Parity-Gate/1.0" },
      failOnStatusCode: false,
    });
    const finalPath = finalPathOf(res.url());

    // Only re-request when the url moved. A directly-served url has no first
    // hop to classify, and probing all fifty would double the sweep to learn
    // nothing about forty-nine of them.
    const firstHopStatus =
      finalPath === normalisePath(entry.path)
        ? null
        : await firstHopStatusOf(api, entry.path);

    return {
      entry,
      status: res.status(),
      finalPath,
      body: await res.text(),
      contentType: res.headers()["content-type"] ?? "",
      transportError: null,
      firstHopStatus,
    };
  } catch (error) {
    // One unreachable url must not abort the other forty-nine. It is recorded
    // as a failure of that entry, never as an absent result.
    return {
      entry,
      status: -1,
      finalPath: "",
      body: "",
      contentType: "",
      transportError: error instanceof Error ? error.message : "unknown error",
      firstHopStatus: null,
    };
  }
}

/**
 * Re-request without following, to read the status the server answered the
 * ORIGINAL url with. Returns `null` if the unfollowed request itself fails,
 * which the permanence assertion treats as unproven rather than as passing.
 */
async function firstHopStatusOf(
  api: APIRequestContext,
  path: string,
): Promise<number | null> {
  try {
    const res = await api.get(`${BASE_URL}${path}`, {
      headers: { "user-agent": "HeadKit-Migration-Parity-Gate/1.0" },
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    return res.status();
  } catch {
    return null;
  }
}

/** The redirect statuses that pass ranking to the destination. */
const PERMANENT_REDIRECT_STATUSES = new Set([301, 308]);

/**
 * Re-read a value from a rendered page until it satisfies the floor, across
 * both a re-read and a re-navigation, then return whatever it last was.
 *
 * Two separate delays sit between `page.goto` resolving and the page holding
 * the content this gate measures, and neither is a defect in the store:
 *
 *   Streaming. Under Cache Components the cached shell is flushed first and
 *   the dynamic part arrives after, so a DOM read taken the instant `goto`
 *   resolves samples a page that is genuinely still filling in. Re-reading the
 *   same navigation is enough for this one.
 *
 *   Cold ISR. A path whose cache entry has expired is regenerated on the
 *   request that missed; the miss can answer from the stale/empty entry while
 *   the regeneration runs. Re-reading cannot fix that — only a second request
 *   sees the regenerated page — which is why this re-navigates rather than
 *   only polling.
 *
 * This is not a way to make a red case green. The floor is unchanged and a
 * page that never reaches it still fails, reporting the last value actually
 * observed. What changes is that failure now means "this page does not have
 * the content", not "this page had not finished arriving" — the second is what
 * three entries of this gate were reporting, and it is why the gate read 94
 * cold and 102 warm against an unchanged host.
 *
 * Cost is paid only by cases that miss the floor: one that meets it on the
 * first read returns immediately.
 */
const SETTLE_ATTEMPTS = 3;
const SETTLE_POLL_MS = 500;
const SETTLE_BUDGET_MS = 8000;

async function settledRead<T>(
  page: Page,
  url: string,
  read: () => Promise<T>,
  meets: (value: T) => boolean,
): Promise<T> {
  let latest = await read();

  for (let attempt = 1; ; attempt += 1) {
    const deadline = Date.now() + SETTLE_BUDGET_MS;
    while (!meets(latest) && Date.now() < deadline) {
      await page.waitForTimeout(SETTLE_POLL_MS);
      latest = await read();
    }
    if (meets(latest) || attempt >= SETTLE_ATTEMPTS) return latest;

    // Re-request: the only thing that clears a cold regeneration.
    await page.goto(url);
    latest = await read();
  }
}

let sweepPromise: Promise<Map<string, Swept>> | null = null;

async function runSweep(): Promise<Map<string, Swept>> {
  const api = await request.newContext();
  const results = new Map<string, Swept>();
  try {
    const queue = [...activeEntries];
    const workers = Array.from(
      { length: Math.min(SWEEP_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const entry = queue.shift();
          if (!entry) return;
          results.set(entry.path, await fetchEntry(api, entry));
        }
      },
    );
    await Promise.all(workers);
  } finally {
    await api.dispose();
  }
  return results;
}

function sweep(): Promise<Map<string, Swept>> {
  sweepPromise ??= runSweep();
  return sweepPromise;
}

function swept(results: Map<string, Swept>, entry: InventoryEntry): Swept {
  const hit = results.get(entry.path);
  if (hit) return hit;
  return {
    entry,
    status: -1,
    finalPath: "",
    body: "",
    contentType: "",
    transportError: "entry was never swept",
    firstHopStatus: null,
  };
}

/** Distinct same-origin product-detail links, under either url shape. */
function countProductCardLinks(hrefs: readonly string[]): number {
  const paths = new Set<string>();
  for (const href of hrefs) {
    let pathname: string;
    try {
      const url = new URL(href, BASE_URL || "http://placeholder.invalid");
      if (BASE_URL !== "" && url.origin !== new URL(BASE_URL).origin) continue;
      pathname = url.pathname;
    } catch {
      continue;
    }
    const segments = pathname.split("/").filter(Boolean);
    const first = segments[0];
    // Either PDP shape: the nested `/shop/{cat}[/{sub}]/{slug}` (what the
    // source capture counted, and what V2's ProductCard now emits via
    // `productPath` in lib/canonical-path.ts) or the flat `/products/{slug}`,
    // which 308s onto it and stays canonical on a store using WooCommerce's
    // default `/product/` permalink base. Both are product-detail links, and
    // this count is deliberately shape-agnostic — which URL shape wins is
    // asserted by `app/canonical-url-shape.test.tsx` and
    // `e2e/canonical-url-308.spec.ts`, not by a card count.
    if (first === "products" && segments.length >= 2) paths.add(pathname);
    if (first === "shop" && segments.length >= 3) paths.add(pathname);
  }
  return paths.size;
}

/** Diagnostic prefix shared by every message, so a failure names its own run. */
function ctx(): string {
  return `[base=${BASE_URL || "<unset>"} fixture=${FIXTURE_PATH}]`;
}

/**
 * Every reported line carries the inventory's OWN source host, so a run's
 * output says which store's inventory produced it. Read from the fixture rather
 * than from a constant: a hard-coded store name is exactly the coupling this
 * file no longer has, and a run whose fixture failed to load falls back to the
 * generic prefix rather than claiming a store it never read.
 */
const REPORT_PREFIX = `parity:${inventory?.source_host ?? "unknown-source"}`;

// Reporting is the point of several of these cases (the skipped count, the
// distinct deployment identifiers). `no-console` is a lint warning in this
// workspace; suppressed deliberately and only here.
const report = (line: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[${REPORT_PREFIX}] ${line}`);
};

// ---------------------------------------------------------------------------

test.describe("Store V1->V2 route parity gate (MIG-03/MIG-04)", () => {
  // This file shares one sweep across all its cases, so its tests must run in
  // one worker rather than under the config's fullyParallel. `default` (rather
  // than `serial`) is deliberate: under `serial` the first failing entry would
  // SKIP the remaining forty-nine, and a parity gate that reports one failure
  // and forty-nine skips is useless for deciding whether to flip a domain.
  test.describe.configure({ mode: "default" });

  test.beforeAll(async () => {
    test.setTimeout(SWEEP_TIMEOUT_MS);

    // Fail loudly BEFORE anything is swept. A green run must mean the sweep
    // ran against a host somebody chose, over data that actually loaded.
    // This one comes first: with the variable unset there is no path to report,
    // so the fixture-load abort below could only say the empty path could not
    // be read, which names nothing a reader can act on.
    expect(
      FIXTURE_PATH,
      `PARITY_URL_INVENTORY is unset. This spec has NO default inventory by design: a default would silently assert this host against whichever store's inventory happened to sit beside the spec, and report a parity verdict for neither store. Set PARITY_URL_INVENTORY to the url inventory captured for the store under test.${MISSING_REQUIRED_SUFFIX}`,
    ).not.toBe("");
    expect(
      loaded.ok,
      `${ctx()} inventory fixture ${FIXTURE_PATH} ${loaded.ok ? "" : loaded.reason} — ${CAPTURE_HINT}`,
    ).toBe(true);
    expect(
      BASE_URL,
      `E2E_BASE_URL is unset. This spec has NO default host by design: defaulting to localhost would report a store parity result for the local dev server. Set E2E_BASE_URL to the origin under test.${MISSING_REQUIRED_SUFFIX}`,
    ).not.toBe("");
    expect(
      TEMP_HOST,
      `PARITY_TEMP_HOST is unset or unrecognised. Set it to "true" (a temporary host: must be non-indexable and advertise no sitemap) or "false" (the live host: must be indexable and advertise a sitemap). It is not defaulted, because defaulting it would silently choose which SEO posture this run asserts.${MISSING_REQUIRED_SUFFIX}`,
    ).not.toBeNull();
    expect(
      activeEntries.length,
      `${ctx()} the inventory has no runnable entries — ${CAPTURE_HINT}`,
    ).toBeGreaterThan(0);
    expect(
      expectedProductCount,
      `${ctx()} the inventory declares no expected product count — ${CAPTURE_HINT}`,
    ).toBeGreaterThan(0);

    report(
      `sweeping ${activeEntries.length} url(s) against ${BASE_URL}; skipped ${excludedEntries.length} excluded entr(ies); catalogue size ${expectedProductCount}; captured ${inventory?.captured_at ?? "?"} from ${inventory?.source_host ?? "?"}`,
    );
    for (const e of excludedEntries) {
      report(`skipped ${e.path}: ${e.excluded_reason ?? "no reason recorded"}`);
    }

    await sweep();
  });

  // A fixture that fails to load leaves zero parameterised cases behind, and a
  // before-all hook with no tests to guard NEVER RUNS — the exact zero-case
  // green this gate must not be able to produce. This case exists so that the
  // hook always has something to fail.
  test("the inventory fixture loads, is non-empty and is self-consistent", () => {
    expect(
      loaded.ok,
      `${ctx()} inventory fixture ${FIXTURE_PATH} ${loaded.ok ? "" : loaded.reason} — ${CAPTURE_HINT}`,
    ).toBe(true);
    expect(
      activeEntries.length,
      `${ctx()} zero runnable entries — a parity gate over an empty inventory would report success without checking anything`,
    ).toBeGreaterThan(0);
  });

  test("inventory accounting: every captured entry is either swept or explicitly excluded", async () => {
    const results = await sweep();
    expect(
      activeEntries.length + excludedEntries.length,
      `${ctx()} the runnable and excluded entries do not add up to the fixture's ${allEntries.length} entries`,
    ).toBe(allEntries.length);
    expect(
      results.size,
      `${ctx()} the sweep produced ${results.size} result(s) for ${activeEntries.length} runnable entr(ies) — urls went missing between the fixture and the wire`,
    ).toBe(activeEntries.length);
  });

  // -------------------------------------------------------------------------
  // The sweep: status AND final path, per url.
  // -------------------------------------------------------------------------

  for (const entry of activeEntries) {
    test(`${entry.kind} ${entry.path} -> ${entry.expected_status} at ${entry.expected_final_path}`, async () => {
      const res = swept(await sweep(), entry);

      expect(
        res.transportError,
        `${ctx()} ${entry.path} produced no response at all (${res.transportError ?? ""}) — the host did not answer`,
      ).toBeNull();

      expect(
        res.status,
        `${ctx()} ${entry.path} returned ${res.status}, expected ${entry.expected_status} — a url the live store serves is not served here (MIG-03)`,
      ).toBe(entry.expected_status);

      // THE assertion of this gate. A status-only check passes a permanent
      // redirect that lands on a different page, and a 308 is cached by
      // clients indefinitely, so it is the one act in this migration a
      // rollback cannot undo (RESEARCH C-6/C-7).
      expect(
        res.finalPath,
        `${ctx()} ${entry.path} finished at ${res.finalPath} with status ${res.status}, but the inventory declares ${entry.expected_final_path}. A redirect into a DIFFERENT page passes a status check and is a silent search loss (MIG-03). If this move is intended, declare it in the fixture with a redirect_reason.`,
      ).toBe(normalisePath(entry.expected_final_path));
    });
  }

  // -------------------------------------------------------------------------
  // Declared moves must be PERMANENT moves.
  // -------------------------------------------------------------------------

  // `redirect_reason` is the fixture's sanctioned way to say "this url moved on
  // purpose", and the assertion above stops asserting the destination once it
  // is present. That makes it the one field in the fixture that can turn a
  // failure into a pass by being written down — so on its own it is a way to
  // launder a bad redirect through the gate.
  //
  // What separates an intended move from a search loss is not the prose in the
  // reason, it is the STATUS. `308`/`301` consolidates the indexed url's
  // ranking onto the destination; `307`/`302` says the move is temporary, so a
  // crawler keeps indexing the old url and the destination inherits nothing.
  // The followed request cannot tell them apart — both end at the destination
  // with a `200`.
  //
  // Every one of these urls is indexed on the live store today, which is why a
  // declared move has to prove its permanence rather than assert it in a
  // comment. Two files here documented themselves as "permanent redirect"
  // while calling `redirect()`, which is Next's TEMPORARY one.
  for (const entry of activeEntries.filter(
    (e) => normalisePath(e.expected_final_path) !== normalisePath(e.path),
  )) {
    test(`declared move ${entry.path} -> ${entry.expected_final_path} is a permanent redirect`, async () => {
      const res = swept(await sweep(), entry);

      expect(
        res.firstHopStatus,
        `${ctx()} ${entry.path} declares a move to ${entry.expected_final_path} but its first hop could not be read, so its permanence is unproven. Unproven is not permitted to pass: a declared move whose status nobody measured is exactly the case this assertion exists for.`,
      ).not.toBeNull();

      expect(
        PERMANENT_REDIRECT_STATUSES.has(res.firstHopStatus ?? -1),
        `${ctx()} ${entry.path} answers ${res.firstHopStatus} and lands on ${res.finalPath}, which is a TEMPORARY redirect. The move is declared in the fixture (${entry.redirect_reason ?? "no reason recorded"}), and a declared move must be permanent (301/308) or the indexed url keeps its ranking and the destination inherits none of it. In Next, \`redirect()\` emits 307 — \`permanentRedirect()\` is the one that means what this declaration says.`,
      ).toBe(true);
    });
  }

  // -------------------------------------------------------------------------
  // The catalogue: the two cases a status sweep cannot make.
  // -------------------------------------------------------------------------

  test(`no response body carries the build-time placeholder slug (${BUILD_TIME_PLACEHOLDER_SLUG})`, async () => {
    const results = await sweep();
    const offenders: string[] = [];
    for (const [path, res] of results) {
      if (res.body.includes(BUILD_TIME_PLACEHOLDER_SLUG)) offenders.push(path);
    }
    expect(
      offenders,
      `${ctx()} ${offenders.length} response(s) carry the build-time placeholder slug: ${offenders.join(", ")}. Both catalogue generateStaticParams implementations swallow an SDK failure at build into that single placeholder, so a build whose catalogue backend was unreachable DEPLOYS GREEN and answers 200 on every route with no products behind it. This is the failure a status sweep cannot see (CONTEXT trap 10).`,
    ).toEqual([]);
  });

  test("distinct product paths served equals the catalogue size the inventory declares", async () => {
    const results = await sweep();
    const productEntries = activeEntries.filter((e) => e.kind === "product");
    const served = new Set<string>();
    const missing: string[] = [];

    for (const entry of productEntries) {
      const res = swept(results, entry);
      const ok =
        res.status === entry.expected_status &&
        res.finalPath === normalisePath(entry.expected_final_path) &&
        !res.body.includes(BUILD_TIME_PLACEHOLDER_SLUG);
      if (ok) served.add(entry.expected_final_path);
      else
        missing.push(
          `${entry.path} (status ${res.status}, landed ${res.finalPath || "nowhere"})`,
        );
    }

    expect(
      served.size,
      `${ctx()} ${served.size} of ${expectedProductCount} product detail pages are actually served. Missing: ${missing.join("; ") || "none"}. A shortfall here with every status green means the catalogue did not survive the build (MIG-03).`,
    ).toBe(expectedProductCount);
  });

  for (const entry of activeEntries.filter((e) => e.kind === "product")) {
    test(`product markers + self-referential canonical: ${entry.path}`, async () => {
      const res = swept(await sweep(), entry);
      const min = entry.expectations.min_product_detail_markers ?? 0;

      const markers = {
        product_json_ld: /"@type"\s*:\s*"Product"/.test(res.body),
        offer_json_ld: /"@type"\s*:\s*"(?:Aggregate)?Offer"/.test(res.body),
        add_to_cart: /add to cart/i.test(res.body),
      };
      const present = Object.entries(markers)
        .filter(([, v]) => v)
        .map(([k]) => k);

      expect(
        present.length,
        `${ctx()} ${entry.path} rendered ${present.length} product-detail marker(s) [${present.join(", ") || "none"}], expected at least ${min}. The route answered ${res.status}, so this is a page that exists but is not a product page.`,
      ).toBeGreaterThanOrEqual(min);

      if (entry.expectations.canonical_expected === true) {
        const canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(
          res.body,
        );
        expect(
          canonical,
          `${ctx()} ${entry.path} emitted no canonical link. Every one of these urls is indexed today; shipping them without a canonical invites duplicate-content collapse against the flat /products/ shape.`,
        ).not.toBeNull();

        const href = canonical
          ? /href=["']([^"']+)["']/i.exec(canonical[0])?.[1]
          : undefined;
        expect(
          href,
          `${ctx()} ${entry.path} has a canonical link with no href`,
        ).toBeTruthy();

        // Path only. WordPress SEO plugins mint the canonical against the
        // WORDPRESS origin, which in a headless store is a different host by
        // design — comparing origins would fail every product in every store
        // for a reason that is not a defect. The path is the part that says
        // which PAGE is canonical, and it is the part D-15-04 is about.
        expect(
          finalPathOf(new URL(href ?? "", BASE_URL).toString()),
          `${ctx()} ${entry.path} declares its canonical as ${href}, whose path is not this page. A canonical pointing at the flat /products/ shape hands the indexed nested url's ranking away (D-15-04).`,
        ).toBe(normalisePath(entry.expected_final_path));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Rendered content presence: the cases that need a real render.
  // -------------------------------------------------------------------------

  for (const entry of activeEntries.filter(
    (e) => e.kind === "category" || e.kind === "listing",
  )) {
    const min = entry.expectations.min_product_cards ?? 0;
    const baselineZero = entry.expectations.baseline_zero_cards === true;

    test(`${entry.kind} ${entry.path} renders at least ${min} product card(s)${baselineZero ? " (V1 baseline: zero)" : ""}`, async ({
      page,
    }) => {
      const url = `${BASE_URL}${entry.path}`;
      const response = await page.goto(url);
      expect(
        response?.status(),
        `${ctx()} ${entry.path} did not render (status ${response?.status() ?? "none"})`,
      ).toBe(entry.expected_status);

      const readCards = async () => {
        const hrefs = await page
          .locator("a[href]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("href") ?? "").filter(Boolean),
          );
        return countProductCardLinks(hrefs);
      };
      const cards = await settledRead(page, url, readCards, (n) => n >= min);

      expect(
        cards,
        `${ctx()} ${entry.path} rendered ${cards} product card(s), fewer than the ${min} the live store shows. Every route can answer 200 over an empty catalogue, so a card count is what distinguishes a working listing from a shell (MIG-03).`,
      ).toBeGreaterThanOrEqual(min);

      if (baselineZero) {
        // `>= 0` cannot fail, so this case would otherwise measure nothing.
        // The source host serves this page with zero product cards and V2 is
        // NOT asked to improve on that — but the page must still render.
        const text = await settledRead(
          page,
          url,
          async () => (await page.locator("body").innerText()).trim(),
          (t) => t.length >= 200,
        );
        expect(
          text.length,
          `${ctx()} ${entry.path} rendered ${text.length} characters of text. Its product-card floor is 0 because the source host shows zero cards here too (recorded V1 baseline, not a V2 defect), so this is what stops the case from asserting nothing at all.`,
        ).toBeGreaterThanOrEqual(200);
        report(
          `${entry.path}: ${cards} card(s) — floor is 0 by V1 baseline, body text ${text.length} chars`,
        );
      }
    });
  }

  for (const entry of activeEntries.filter((e) => e.kind === "editorial")) {
    const min = entry.expectations.min_body_text_length ?? 0;

    test(`editorial ${entry.path} renders at least ${min} characters of body text`, async ({
      page,
    }) => {
      const url = `${BASE_URL}${entry.path}`;
      const response = await page.goto(url);
      expect(
        response?.status(),
        `${ctx()} ${entry.path} did not render (status ${response?.status() ?? "none"})`,
      ).toBe(entry.expected_status);

      const text = await settledRead(
        page,
        url,
        async () => (await page.locator("body").innerText()).trim(),
        (t) => t.length >= min,
      );
      expect(
        text.length,
        `${ctx()} ${entry.path} rendered ${text.length} characters of body text, under the ${min}-character floor. This page is content the live store serves; an empty shell answers 200 just as happily.`,
      ).toBeGreaterThanOrEqual(min);
    });
  }

  // -------------------------------------------------------------------------
  // Host posture and identity.
  // -------------------------------------------------------------------------

  test("robots posture matches the declared host role", async () => {
    const api = await request.newContext();
    try {
      const res = await api.get(`${BASE_URL}/robots.txt`, {
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `${ctx()} /robots.txt returned ${res.status()} — the indexing posture of this host cannot be established, so it must not be treated as established`,
      ).toBe(200);

      const body = await res.text();
      const blanketDisallow = /(^|\n)\s*disallow:\s*\/\s*(\r?\n|$)/i.test(body);
      const advertisesSitemap = /(^|\n)\s*sitemap:/i.test(body);

      if (TEMP_HOST === true) {
        expect(
          blanketDisallow,
          `${ctx()} this run is flagged as a TEMPORARY host but /robots.txt does not disallow everything. Both SEO gates default OPEN when branding env is unset (branding.ts DEFAULT_BUNDLE ships enableSitemap/allowIndexing true). A thrown dashboard read is fail-closed in robots.ts; the host predicate closes a rehearsal host either way, so an untouched rehearsal host is fully crawlable with the customer's real catalogue. The page-level signal is the X-Robots-Tag header (lib/host-robots.ts), asserted by the next case — it is a SEPARATE comparison against the same isIndexableHost predicate, not the same call, so this case proves only robots.txt. robots.txt was:\n${body}`,
        ).toBe(true);
        expect(
          advertisesSitemap,
          `${ctx()} this run is flagged as a TEMPORARY host but /robots.txt advertises a sitemap — publishing a sitemap of the customer's real catalogue from a rehearsal origin is the search-visible half of the same defect. robots.txt was:\n${body}`,
        ).toBe(false);
      } else {
        expect(
          blanketDisallow,
          `${ctx()} this run is flagged as the LIVE host but /robots.txt disallows everything — the store has been de-indexed. robots.txt was:\n${body}`,
        ).toBe(false);
        expect(
          advertisesSitemap,
          `${ctx()} this run is flagged as the LIVE host but /robots.txt advertises no sitemap — the rehearsal posture was carried into production. robots.txt was:\n${body}`,
        ).toBe(true);
      }
    } finally {
      await api.dispose();
    }
  });

  test("the page-level X-Robots-Tag matches the declared host role", async () => {
    // The page half of the pair, and the ONLY place it can be observed: it is
    // a response header set in `proxy.ts` from the request host, so no unit
    // test and no page-source check can see it. It must agree with robots.txt
    // above — a `Disallow: /` beside pages a crawler may index is exactly the
    // desynchronisation ENG-868 exists to remove.
    //
    // SCOPE: this asserts the header on ONE document request against the host
    // under test. It says nothing about which origin the store declares (that
    // is `/api/posts-base-path`'s `siteUrl`), and nothing about the store's own
    // `allowIndexing` switch, which rides the `robots` meta instead.
    const api = await request.newContext();
    try {
      const res = await api.get(`${BASE_URL}/`, { failOnStatusCode: false });
      expect(
        res.status(),
        `${ctx()} the home page returned ${res.status()} — the indexing posture of this host cannot be established from it`,
      ).toBeLessThan(400);

      const tag = res.headers()["x-robots-tag"] ?? "";
      const noindex = /\bnoindex\b/i.test(tag);

      if (TEMP_HOST === true) {
        expect(
          noindex,
          `${ctx()} this run is flagged as a TEMPORARY host but the home page carries no noindex X-Robots-Tag (header was ${JSON.stringify(tag)}). This host serves the customer's REAL catalogue; left indexable it competes with their live site in search and the damage outlives the rehearsal. Check that the store's declared origin (/api/posts-base-path -> siteUrl) is not this host.`,
        ).toBe(true);
      } else {
        expect(
          noindex,
          `${ctx()} this run is flagged as the LIVE host but the home page carries a noindex X-Robots-Tag (header was ${JSON.stringify(tag)}) — the store is being de-indexed on its own domain. The gate compares the request host against the store's declared origin, so either the domain record or NEXT_PUBLIC_FRONTEND_URL disagrees with the host actually served.`,
        ).toBe(false);
      }
    } finally {
      await api.dispose();
    }
  });

  test("one deployment identifier is served across the sweep", async () => {
    const results = await sweep();
    const sample = activeEntries
      .map((e) => swept(results, e))
      .filter((r) => r.status === 200 && r.contentType.includes("text/html"))
      .slice(0, DEPLOYMENT_SAMPLE_SIZE);

    expect(
      sample.length,
      `${ctx()} only ${sample.length} html response(s) were available to sample, fewer than the ${DEPLOYMENT_SAMPLE_SIZE} this assertion needs. A sample too small to disagree with itself is not evidence.`,
    ).toBeGreaterThanOrEqual(DEPLOYMENT_SAMPLE_SIZE);

    const found = new Map<string, string[]>();
    for (const res of sample) {
      for (const match of res.body.matchAll(/[?&]dpl=([A-Za-z0-9_-]+)/g)) {
        const id = match[1];
        if (!id) continue;
        const paths = found.get(id) ?? [];
        paths.push(res.entry.path);
        found.set(id, paths);
      }
    }

    const ids = [...found.keys()];

    // Absence is a FAILURE, not a pass. `state: READY` on a deployment id does
    // not mean the DOMAIN serves it (CONTEXT trap 13), and a check that cannot
    // observe the served id cannot make that distinction — so it must say so
    // rather than report success over an empty set.
    expect(
      ids.length,
      `${ctx()} no deployment identifier was observable on any of the ${sample.length} sampled responses. The served-deployment assertion cannot be made, and MUST NOT be weakened to a skip: enable Vercel Skew Protection (or set \`deploymentId\` in next.config.ts) so assets carry ?dpl=, then re-run. Until then, nothing here distinguishes "the domain serves the deployment you built" from "some deployment is READY".`,
    ).toBeGreaterThan(0);

    expect(
      ids.length,
      `${ctx()} the domain served ${ids.length} different deployments during one sweep: ${ids.map((id) => `${id} (${(found.get(id) ?? []).join(", ")})`).join(" | ")}. A parity result assembled from more than one deployment describes no deployment.`,
    ).toBe(1);

    report(`served deployment identifier: ${ids[0] ?? "none"}`);
  });

  test("the legacy checkout-confirmation path does not answer not-found", async () => {
    const api = await request.newContext();
    try {
      const res = await api.get(`${BASE_URL}${LEGACY_CONFIRM_PATH}`, {
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `${ctx()} ${LEGACY_CONFIRM_PATH} returned ${res.status()} (landed at ${finalPathOf(res.url())}). V1 created the WooCommerce order inside this route AFTER Stripe succeeded, and Stripe's return_url is a per-request parameter — so a shopper still at their bank for 3D Secure when the domain flips is returned here, on the V2 origin, possibly hours later. A not-found means: card charged, no order, no record that the shopper existed (CONTEXT trap 14 / MIG-04).`,
      ).not.toBe(404);
    } finally {
      await api.dispose();
    }
  });
});
