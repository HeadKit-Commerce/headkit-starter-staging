import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { TAG } from "./cache-tags";

/**
 * Regression guard for the WordPress side of the revalidation contract
 * (`docs/cache-revalidation-contract.md`): which cache tags each product EVENT
 * in `integrations/wordpress/theme/inc/headkit-webhook.php` sends.
 *
 * The defect this guards is BREADTH. Before captain decision D3 (2026-09-10)
 * every product hook — including the stock hook that fires on every order —
 * appended `headkit:products` and `headkit:route:shop`. `getCachedProduct`
 * (every PDP) and every `getCachedCatalogPage` entry subscribe to
 * `headkit:products`, and `/api/revalidate` expires immediately, so one order
 * expired ~5,000 entries on Bike Society and the catalogue caches were never
 * warm. The contract now splits events in two:
 *
 *   LISTING events (create / publish / unpublish / delete / term change) —
 *     the set of listed products changed: specific tags + the blanket tags.
 *   CONTENT events (stock / price / variation / plain update) —
 *     specific tags ONLY: the product, its category grids (with ancestors),
 *     its brand(s), and the route landings it belongs to.
 *
 * Like `wp-featured-brands-cap.test.ts`, this runs the theme's PHP out of the
 * vitest suite that gates every PR: `tests/revalidation-events-harness.php`
 * shims the WordPress / WooCommerce surface the hooks touch, loads the REAL
 * theme files, drives each hook the way WordPress does, and reports the
 * payloads the Action Scheduler queue would receive. It skips on a developer
 * machine without `php`, and FAILS in CI (where `ubuntu-latest` ships it).
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/revalidation-events-harness.php",
);

interface Payload {
  paths: string[];
  tags: string[];
  action: string;
  /** Harness-added: the unix time the send was scheduled for. */
  scheduled_at: number;
  /** Harness-added: `scheduled_at` minus the scenario's start time. */
  scheduled_in: number;
  /**
   * Harness-added: true when a LATER save withdrew this send before it could
   * fire (`as_unschedule_action`). Only the repair is ever withdrawn, and only
   * to be re-scheduled onto the newer save — see the reschedule describe block.
   */
  unscheduled: boolean;
  /** Harness-added: what the queue held for a withdrawn send at cancel time. */
  was_due_at?: number;
  /** Harness-added: whether the harness ran this action's callback. */
  delivered: boolean;
  /**
   * Harness-added: the unix time the callback ran. Since 0.4.66 this is the
   * instant the repair's spacing is measured from, so it is the field the
   * queue-drain property is asserted against — not `scheduled_at`.
   */
  delivered_at?: number;
}

interface HarnessConfig {
  /** `headkit_revalidation_delay()` with no filter applied. */
  delay: number;
  /** `HK_REST_MAX_AGE_CEILING`. */
  ceiling: number;
  /** `HK_REVALIDATE_DELAY_MARGIN`. */
  margin: number;
  /**
   * `headkit_revalidation_repair_delay()` with no filter applied.
   *
   * Since 0.4.66 this is an offset from the first send's COMPLETION, not from
   * the save, and its default is `HK_REVALIDATE_RENDER_CEILING` alone.
   */
  repair_delay: number;
  /** `HK_REVALIDATE_RENDER_CEILING`. */
  render_ceiling: number;
  /** `HK_REVALIDATE_REPAIR_SUFFIX` — what marks a send as the repair. */
  repair_suffix: string;
  /** Every `max_age` literal the harness read out of `inc/rest-api/`. */
  rest_max_ages: Record<string, number>;
  /** Call sites whose `max_age` or endpoint name could not be read statically. */
  rest_max_ages_unreadable: string[];
  /** Call site label => the stable endpoint name it publishes under. */
  rest_endpoints: Record<string, string>;
  /** `headkit_rest_cache_endpoints()` — the documented filter surface. */
  rest_endpoints_declared: string[];
  /** `HK_REST_DEFAULT_MAX_AGE`. */
  rest_default_max_age: number;
}

/** Facet-cache observations the harness records around each scenario. */
interface FiltersObservation {
  generation_before: number;
  generation_after: number;
  /** Whether the key a cached payload was stored under is still the lookup key. */
  key_changed: boolean;
  /** Whether a payload cached before the event is still reachable after it. */
  lookup_hits: boolean;
}

type HarnessResult = Record<string, Payload[]>;

interface HarnessOutput {
  events: HarnessResult;
  filters: Record<string, FiltersObservation>;
  /** Scenario name → outbound URLs, in send order. Absent on an older harness. */
  http?: Record<string, string[]>;
  /** Scenario name → raw request bodies, parallel to `http`. */
  httpBodies?: Record<string, string[]>;
  config: HarnessConfig;
}

const BLANKET = [TAG.products, TAG.route("shop")] as const;

/** Every tag the e-bike fixture's CONTENT events must reach — and no more. */
const EBIKE_CONTENT_TAGS = [
  TAG.product("e-bike"),
  TAG.catalogCat("electric-bikes"),
  TAG.catalogCat("bikes"), // ancestor grid: /collections/bikes lists it too
  TAG.brand("trek"),
  TAG.route("sale"),
  TAG.route("home"),
];

/** The e-bike fixture's LISTING events add the blanket + collection entity tags. */
const EBIKE_LISTING_TAGS = [
  ...EBIKE_CONTENT_TAGS,
  TAG.collection("electric-bikes"),
  TAG.collection("bikes"),
  ...BLANKET,
];

const EBIKE_PATHS = ["/products/e-bike", "/collections/bikes/electric-bikes"];

function hasPhp(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PHP_AVAILABLE = hasPhp();
const IS_CI = Boolean(process.env.CI);

const SUITE = "WordPress theme: product revalidation events";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

let result: HarnessResult;
let filters: Record<string, FiltersObservation>;
let config: HarnessConfig;
let http: Record<string, string[]> = {};
let httpBodies: Record<string, string[]> = {};

/**
 * Every send a scenario produced, first sends and repair sends alike.
 *
 * Since 2026-09-22 an event produces TWO sends: the first carries the whole
 * payload, and the stale-set repair carries its entity tags one render ceiling
 * later. Since 0.4.66 the repair is enqueued by the FIRST SEND'S COMPLETION
 * rather than at save time, so the harness runs the queue after each scenario
 * and a repair only appears here because a first send really executed.
 *
 * The two are told apart by the action label, which is the real mechanism — it
 * keeps Action Scheduler's (hook, args, group) dedupe from collapsing the repair
 * into the send it follows, and it is what stops a repair from enqueueing
 * another repair — so the tests below assert on the same field the theme relies
 * on.
 */
function sendsOf(name: string): Payload[] {
  const sends = result[name];
  expect(sends, `${name}: harness scenario missing`).toBeDefined();
  return sends!;
}

function isRepair(send: Payload): boolean {
  return send.action.endsWith(config.repair_suffix);
}

/** The FIRST sends of a scenario — what the tag-breadth contract is about. */
function firstSends(name: string): Payload[] {
  return sendsOf(name).filter((s) => !isRepair(s));
}

/**
 * The stale-set repair sends of a scenario that will actually FIRE.
 *
 * A repair withdrawn by a later save (2026-09-23) is excluded: it was queued
 * and then cancelled, so counting it as a send would report a correct
 * reschedule as two repairs. `withdrawnRepairs` is the other half of that fact.
 */
function repairSends(name: string): Payload[] {
  return sendsOf(name).filter((s) => isRepair(s) && !s.unscheduled);
}

/** Repairs a later save withdrew before they could fire. */
function withdrawnRepairs(name: string): Payload[] {
  return sendsOf(name).filter((s) => isRepair(s) && s.unscheduled);
}

function only(name: string): Payload {
  const sends = firstSends(name);
  expect(sends, `${name}: expected exactly one first send`).toHaveLength(1);
  return sends[0]!;
}

function onlyRepair(name: string): Payload {
  const sends = repairSends(name);
  expect(sends, `${name}: expected exactly one repair send`).toHaveLength(1);
  return sends[0]!;
}

function expectSameSet(actual: string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
    const stdout = execFileSync("php", [HARNESS], { encoding: "utf8" });
    const parsed = JSON.parse(stdout) as HarnessOutput;
    result = parsed.events;
    filters = parsed.filters;
    config = parsed.config;
    http = parsed.http ?? {};
    httpBodies = parsed.httpBodies ?? {};
  });

  describe("CONTENT events send the specific tags only", () => {
    it.each([
      "stock_change",
      "stock_change_variation",
      "price_change",
      "variation_update",
      "update",
    ])("%s", (scenario) => {
      const send = only(scenario);
      expectSameSet(send.tags, EBIKE_CONTENT_TAGS);
      for (const tag of BLANKET) {
        expect(send.tags, `${scenario} must not fire ${tag}`).not.toContain(
          tag,
        );
      }
      // Every path the theme sent before D3 is still sent.
      expectSameSet(send.paths, EBIKE_PATHS);
    });

    it("a variation's stock change purges the PARENT slug, never the variation", () => {
      expect(only("stock_change_variation").tags).toContain(
        TAG.product("e-bike"),
      );
    });

    it("carries the route landings the product belongs to (new / featured / home)", () => {
      const send = only("stock_change_new_featured");
      expectSameSet(send.tags, [
        TAG.product("abus-lock"),
        TAG.catalogCat("locks"),
        TAG.route("new"),
        TAG.route("featured"),
        TAG.route("home"),
      ]);
    });

    it("sends nothing for a draft product or a non-price prop update", () => {
      expect(result["stock_change_draft"]).toEqual([]);
      expect(result["non_price_props"]).toEqual([]);
    });

    it("labels the payload with the event", () => {
      expect(only("stock_change").action).toBe("stock_change");
      expect(only("price_change").action).toBe("price_change");
      expect(only("variation_update").action).toBe("variation_update");
      expect(only("update").action).toBe("update");
    });
  });

  describe("LISTING events add headkit:products + headkit:route:shop", () => {
    it.each([
      ["create", "create"],
      ["publish", "publish"],
      ["unpublish", "unpublish"],
      ["trash", "unpublish"],
      ["delete", "delete"],
    ])("%s", (scenario, action) => {
      const send = only(scenario);
      expectSameSet(send.tags, EBIKE_LISTING_TAGS);
      expectSameSet(send.paths, EBIKE_PATHS);
      expect(send.action).toBe(action);
    });

    it("the publish marker is consumed by the save that follows it", () => {
      const send = only("publish_marker_is_consumed");
      expect(send.action).toBe("update");
      expectSameSet(send.tags, EBIKE_CONTENT_TAGS);
    });

    it("a category change purges the OLD category grids and collection pages too", () => {
      const send = only("category_change_via_save");
      expect(send.action).toBe("terms");
      expectSameSet(send.tags, [
        TAG.product("e-bike"),
        TAG.catalogCat("locks"),
        TAG.collection("locks"),
        TAG.catalogCat("electric-bikes"),
        TAG.collection("electric-bikes"),
        TAG.catalogCat("bikes"),
        TAG.collection("bikes"),
        TAG.brand("trek"),
        TAG.route("sale"),
        TAG.route("home"),
        ...BLANKET,
      ]);
      expectSameSet(send.paths, [
        "/products/e-bike",
        "/collections/locks",
        "/collections/bikes/electric-bikes",
      ]);
    });

    it("a brand change through the WooCommerce CRUD (no save_post) still purges the old brand", () => {
      const send = only("brand_change_via_crud");
      expect(send.action).toBe("terms");
      expect(send.tags).toContain(TAG.brand("trek"));
      for (const tag of BLANKET) expect(send.tags).toContain(tag);
    });

    it("hiding a product from the catalogue is a listing event", () => {
      const send = only("exclude_from_catalog");
      expect(send.action).toBe("terms");
      for (const tag of BLANKET) expect(send.tags).toContain(tag);
    });
  });

  describe("the plural index tags are fired by TAXONOMY hooks only", () => {
    /*
     * Three comments in apps/starter said WordPress fires `headkit:collections`
     * on "any product or category change", and the flat-PDP-breadcrumb decision
     * (`apps/starter/AGENTS.md`) plus the open `260824-nested-pdp-catalogue-purge-tag`
     * both rested on that premise. It is not what the theme does: the product
     * builder sends the SINGULAR `headkit:collection:{slug}` and only on a
     * listing event, while `HK_TAG_COLLECTIONS` appears in
     * `headkit_resolve_endpoint_tags` alone, reachable only from
     * `created_term` / `edited_term` / `delete_term` on `product_cat`
     * (`product_brand` for `headkit:brands`). So an entry that subscribes to
     * TAG.collections is purged by a category term edit — never by a product
     * save, however often that save fires.
     */
    it("no product event fires headkit:collections or headkit:brands", () => {
      const productScenarios = Object.keys(result).filter(
        (name) =>
          !name.startsWith("category_term_") && name !== "brand_term_edit",
      );
      expect(productScenarios.length).toBeGreaterThan(20);
      for (const name of productScenarios) {
        for (const send of result[name] ?? []) {
          expect(
            send.tags,
            `${name} must not fire the collections index — that tag is on the home page, the sitemap, the nested /shop route and every category shell`,
          ).not.toContain(TAG.collections);
          expect(
            send.tags,
            `${name} must not fire the brands index`,
          ).not.toContain(TAG.brands);
        }
      }
    });

    it.each(["category_term_edit", "category_term_delete"])(
      "%s fires the collections index, the edited category and home",
      (scenario) => {
        const send = only(scenario);
        expectSameSet(send.tags, [
          TAG.collections,
          TAG.collection("electric-bikes"),
          TAG.route("home"),
        ]);
      },
    );

    it("a brand term edit fires the brands index, not the collections index", () => {
      const send = only("brand_term_edit");
      expectSameSet(send.tags, [
        TAG.brands,
        TAG.brand("trek"),
        TAG.route("home"),
      ]);
    });
  });

  describe("term-change detection", () => {
    it("an unchanged term set (replace or append) sends nothing", () => {
      expect(result["term_noop"]).toEqual([]);
      expect(result["term_append_noop"]).toEqual([]);
    });

    it("the featured star is a content event that reaches the Featured landing", () => {
      const on = only("featured_toggle_on");
      expect(on.action).toBe("update");
      expect(on.tags).toContain(TAG.route("featured"));
      expect(on.tags).toContain(TAG.route("home"));
      for (const tag of BLANKET) expect(on.tags).not.toContain(tag);

      const off = only("featured_toggle_off");
      expect(off.action).toBe("update");
      expect(off.tags).toContain(TAG.route("featured"));
      for (const tag of BLANKET) expect(off.tags).not.toContain(tag);
    });

    it("WooCommerce's outofstock visibility term is a stock side effect and sends nothing", () => {
      expect(result["outofstock_visibility"]).toEqual([]);
    });

    it("a flush with no marker, or on a draft, sends nothing", () => {
      expect(result["flush_without_marker"]).toEqual([]);
      expect(result["term_change_on_draft"]).toEqual([]);
    });
  });

  /*
   * The send is DELAYED, and the delay is derived rather than guessed.
   *
   * A purge fired at save time races the theme's own REST cache: the storefront
   * entries are deleted, a request seconds later re-renders, and that render
   * reads a `headkit/v2` response still inside its `s-maxage` window — so it
   * regenerates with PRE-EDIT data and pins it in a long-lived entry where
   * nothing expires it. Measured on the Bike Society rehearsal store on
   * 2026-09-21 (tigerheart-studios/bikesociety-v2#65): two PDP URLs for the same
   * renamed product, both regenerated AFTER an accepted purge, seven seconds
   * apart, one carrying the new name and one the old.
   *
   * The delay is the fix, and the number is only as trustworthy as its
   * derivation: the harness tokenises every `headkit_rest_cached_response()`
   * call in `inc/rest-api/` and reports the `max_age` each one publishes, so
   * raising one anywhere in the theme fails this suite until
   * `HK_REST_MAX_AGE_CEILING` is raised with it. That is what stops the delay
   * silently falling back inside a window it exists to clear.
   */
  describe("the send is delayed past every REST cache window", () => {
    it("every headkit/v2 max_age is statically readable", () => {
      // A call the scan cannot read is a window it cannot bound. Make the
      // max_age an integer literal, or raise the ceiling deliberately.
      expect(config.rest_max_ages_unreadable).toEqual([]);
      expect(Object.keys(config.rest_max_ages).length).toBeGreaterThan(5);
    });

    it("the ceiling is the largest max_age the theme actually publishes", () => {
      const largest = Math.max(...Object.values(config.rest_max_ages));
      expect(
        config.ceiling,
        `HK_REST_MAX_AGE_CEILING must equal the largest headkit/v2 max_age (${largest}s). ` +
          `Raising a max_age without raising the ceiling reinstates the purge/cache race.`,
      ).toBe(largest);
    });

    it("the delay exceeds that ceiling with a margin for clock skew", () => {
      expect(config.delay).toBeGreaterThan(config.ceiling);
      expect(config.delay).toBe(config.ceiling + config.margin);
      expect(config.margin).toBeGreaterThan(0);
    });

    it("a save schedules the send at now + delay, not now", () => {
      const send = only("stock_change");
      expect(send.scheduled_in).toBeGreaterThanOrEqual(config.delay);
      // The harness clock can tick between the scenario start and the theme's
      // own time() call; nothing larger than that is tolerated.
      expect(send.scheduled_in).toBeLessThanOrEqual(config.delay + 2);
    });

    it("every scheduled send carries the same delay", () => {
      for (const [name, sends] of Object.entries(result)) {
        if (name.startsWith("filtered_delay_")) continue;
        if (name.startsWith("repair_")) continue;
        for (const send of sends) {
          expect(
            send.scheduled_in,
            `${name} must not be sent inside a REST cache window`,
          ).toBeGreaterThan(config.ceiling);
        }
      }
    });

    it("rapid identical saves still collapse to ONE scheduled send", () => {
      // A longer window means MORE saves collapse. It must not mean a queue of
      // delayed duplicates.
      const sends = firstSends("rapid_identical_saves");
      expect(
        sends,
        "three identical saves must schedule one send",
      ).toHaveLength(1);
      expect(sends[0]!.scheduled_in).toBeGreaterThanOrEqual(config.delay);
    });

    it("the headkit_revalidation_delay filter changes the delay", () => {
      const send = only("filtered_delay_custom");
      expect(send.scheduled_in).toBeGreaterThanOrEqual(45);
      expect(send.scheduled_in).toBeLessThanOrEqual(47);
    });

    it("a filtered delay of 0 restores the immediate send", () => {
      const send = only("filtered_delay_zero");
      expect(send.scheduled_in).toBeGreaterThanOrEqual(0);
      expect(send.scheduled_in).toBeLessThanOrEqual(2);
    });

    it("every call site publishes under a stable, tunable endpoint name", () => {
      // The name is the key of the per-endpoint tuning filter. A call site
      // without one is a lifetime no store can change without a theme release,
      // which on a managed host is hours while the defect is live.
      const scanned = Object.keys(config.rest_max_ages).filter(
        (label) => !label.endsWith(":HK_REST_DEFAULT_MAX_AGE"),
      );
      for (const label of scanned) {
        expect(
          config.rest_endpoints[label],
          `${label}: no endpoint name`,
        ).toBeTruthy();
      }
      // `headkit_rest_cache_endpoints()` is what a store reads to find the hook
      // names; a name only at a call site is not documentation.
      const used = [...new Set(Object.values(config.rest_endpoints))].sort();
      expect(used).toEqual([...config.rest_endpoints_declared].sort());
    });

    it("the default lifetime is 10s and every endpoint publishes it", () => {
      // The payoff: with the largest lifetime at 10s the delay is 30s, so an
      // editor sees their change in about half a minute instead of six minutes.
      expect(config.rest_default_max_age).toBe(10);
      for (const [label, maxAge] of Object.entries(config.rest_max_ages)) {
        expect(maxAge, `${label}: not the 10s default`).toBe(10);
      }
      expect(config.ceiling).toBe(10);
      expect(config.delay).toBe(30);
    });
  });

  /**
   * The SECOND, stale-set repair send (2026-09-22, issue #65 repair half).
   *
   * The first send's delay narrows the race between a purge and the caches
   * upstream of a render. It cannot close it, because the surviving race is
   * against our OWN render duration: a render that starts before the purge and
   * finishes after it writes pre-edit data into an entry the framework then
   * accepts as fresh, and under `cacheLife("max")` nothing expires it. Measured
   * 2026-09-22 — two renders of one product five seconds apart, off the same
   * purge, against an origin that already held the new value, disagreeing about
   * the product's name.
   *
   * The remedy is the delayed double delete: purge again after the slowest fill
   * the first purge could have started. Three ways it could be a silent no-op,
   * and one assertion here for each:
   *
   *   1. Action Scheduler dedupes on (hook, args, group) and `action` is part of
   *      `args`, so an identical payload is collapsed into the first send with
   *      nothing logged. The label suffix is what prevents it.
   *   2. Re-sending the WIDE tags would multiply every save by the size of the
   *      catalogue against a 1.8 req/s origin bucket. Entity tags only.
   *   3. A spacing computed at save time is lost to any queue backlog: both
   *      actions become due before the runner's pass starts and it drains them
   *      together. Since 0.4.66 the repair is enqueued from the first send's own
   *      completion, so the spacing is relative to an event that has already
   *      happened. Measured on the rehearsal clone 2026-09-23: scheduled +20s /
   *      +140s, delivered 6s apart.
   */
  describe("a second, delayed purge repairs the stale set", () => {
    it("a product save schedules two sends, not one", () => {
      expect(sendsOf("stock_change")).toHaveLength(2);
      expect(firstSends("stock_change")).toHaveLength(1);
      expect(repairSends("stock_change")).toHaveLength(1);
    });

    it("the repair carries the entity tags and nothing else", () => {
      // The first send reaches six tags; five of them are grids, landings and a
      // brand, which between them reach thousands of entries on a real store.
      expectSameSet(only("stock_change").tags, EBIKE_CONTENT_TAGS);
      expectSameSet(onlyRepair("stock_change").tags, [TAG.product("e-bike")]);
    });

    it("a LISTING event's repair is still just the entity tag", () => {
      // `create` adds the blanket tags and both collection tags. None of them
      // may ride the second send — this is the assertion that keeps the cost at
      // ~4 extra origin reads per save instead of thousands.
      expectSameSet(only("create").tags, EBIKE_LISTING_TAGS);
      expectSameSet(onlyRepair("create").tags, [TAG.product("e-bike")]);
    });

    it("collection tags are NOT entity tags, and nor is a brand ON A PRODUCT SAVE", () => {
      // A collection tag looks like an entity tag and is not: it names the
      // product-SET domain, rides every product save, and reaches whole grids.
      //
      // A brand tag has two reaches depending on the payload that carries it
      // (see `headkit_entity_reach_tags()`), and on a PRODUCT payload it is the
      // wider one: `headkit_product_brand_tags()` merges it into every stock
      // movement, and it reaches that brand's whole `/brand/{slug}` grid, which
      // pages through the brand's entire catalogue. It must not ride the second
      // send. (It used to reach every PDP in the brand too, because
      // `getCachedProductBrand` carried it; that read now subscribes to the
      // brand TERM tag instead — see `lib/product-brand.ts`.)
      const repaired = onlyRepair("create").tags;
      expect(repaired).not.toContain(TAG.collection("electric-bikes"));
      expect(repaired).not.toContain(TAG.collection("bikes"));
      expect(repaired).not.toContain(TAG.brand("trek"));
      expect(repaired).not.toContain(TAG.catalogCat("bikes"));
      expect(repaired).not.toContain(TAG.route("home"));
      expect(repaired).not.toContain(TAG.products);

      // Same on a CONTENT event, which is the one that fires on every order.
      expect(onlyRepair("stock_change").tags).not.toContain(TAG.brand("trek"));
    });

    /**
     * `/brand/{slug}` could not be repaired at all before 2026-09-23.
     *
     * `headkit:brand:{slug}` is narrow in the storefront — the first send
     * DELETES the brand page — but it was not entity-reach in the theme, so no
     * repair ever carried it. Measured on a brand-term save:
     * `/brand/specialized` re-rendered for 9.25 s, still served the pre-edit
     * description, and nothing existed to correct it (report §1.5).
     */
    it("a BRAND TERM save repairs the brand's own page", () => {
      const repaired = onlyRepair("brand_term_edit").tags;
      expectSameSet(repaired, [TAG.brand("trek")]);
    });

    it("the brand-term repair carries none of the wide tags beside it", () => {
      // The first send also fires the plural index and the home landing. Both
      // are family-reach and neither may be re-fired.
      const first = only("brand_term_edit").tags;
      expect(first).toContain(TAG.brands);
      expect(first).toContain(TAG.route("home"));

      const repaired = onlyRepair("brand_term_edit").tags;
      expect(repaired).not.toContain(TAG.brands);
      expect(repaired).not.toContain(TAG.route("home"));
    });

    it("the repair sends no paths", () => {
      // `revalidatePath()` takes no lifetime and is an unconditional delete, and
      // a product's path and its product tag are built from the same object in
      // the same function — so the entity tag already covers the page the path
      // names, and re-sending it would be a second delete of the same entries.
      expect(only("stock_change").paths).toEqual(EBIKE_PATHS);
      expect(onlyRepair("stock_change").paths).toEqual([]);
    });

    it("the repair is scheduled one render ceiling after the first send COMPLETED", () => {
      // 0.4.66. The offset used to be `first delay + render ceiling` from the
      // SAVE. It is now the render ceiling from the moment the first send's POST
      // returned, which is the only formulation a queue backlog cannot collapse.
      expect(config.repair_delay).toBe(config.render_ceiling);

      const first = only("stock_change");
      const repair = onlyRepair("stock_change");
      expect(first.delivered, "the first send must have run").toBe(true);
      expect(repair.scheduled_at - first.delivered_at!).toBe(
        config.repair_delay,
      );
    });

    /**
     * THE PROPERTY THE 0.4.66 CHANGE EXISTS FOR (measured 2026-09-23,
     * `data/260923-verify-delay-20-live/report.md` §6).
     *
     * On the Bike Society rehearsal clone the theme scheduled both sends exactly
     * right — save+20s and save+140s, verified two ways against
     * `post_modified_gmt` — and Action Scheduler's runner idled for ~2 minutes
     * and then drained both due actions in one pass. They were DELIVERED 6s
     * apart instead of 120s apart, and the repair re-purged a tag nothing had
     * re-rendered yet: one outbound request against a 1.8 req/s origin, buying
     * nothing. (The proof it was the runner: an unrelated WooCommerce action
     * scheduled by the same save was late to the same instant.)
     *
     * Two absolute timestamps cannot survive that, because a backlog makes both
     * due before the pass starts. A spacing measured from an event that has
     * ALREADY HAPPENED can. So the invariant is not "the repair is 140s after
     * the save" — it is this, and it must hold for every send in the file.
     */
    it("every repair is exactly the ceiling behind the send that enqueued it", () => {
      let checked = 0;
      for (const name of Object.keys(result)) {
        // The two scenarios that filter the delay are asserted on their own
        // terms below; every other repair must sit at the stock offset.
        if (name === "repair_filtered_custom") continue;
        const repairs = repairSends(name);
        if (repairs.length === 0) continue;
        const delivered = firstSends(name).filter((s) => s.delivered);
        expect(
          delivered.length,
          `${name}: expected a delivered first send`,
        ).toBeGreaterThan(0);
        // The repair follows the LATEST completion — that is the reschedule.
        const latest = Math.max(...delivered.map((s) => s.delivered_at!));
        for (const repair of repairs) {
          expect(
            repair.scheduled_at - latest,
            `${name}: the repair must be one render ceiling behind the completion`,
          ).toBe(config.repair_delay);
        }
        checked++;
      }
      expect(checked, "no scenario exercised the invariant").toBeGreaterThan(
        10,
      );
    });

    /**
     * A REPAIR MUST NEVER BEGET A REPAIR.
     *
     * The repair re-enters the same `headkit_revalidate_send` hook and the same
     * callback as the send it follows. An unguarded completion path would
     * therefore schedule a repair for the repair, and one for that, without
     * bound — every one of them a no-op purge against a 1.8 req/s origin. The
     * label suffix is what the theme reads to stop it
     * (`headkit_revalidate_action_is_repair()`).
     *
     * The harness runs the repair for real here, so the assertion is about a
     * repair that DEMONSTRABLY EXECUTED rather than one that sat in a queue.
     * `harness_run()` also delivers a second pass on every other scenario in the
     * file, so a regression would fail dozens of counts at once.
     */
    it("a repair send enqueues nothing", () => {
      const name = "repair_send_begets_no_repair";
      expect(sendsOf(name)).toHaveLength(2);
      const repair = onlyRepair(name);
      expect(repair.delivered, "the repair must have actually run").toBe(true);
      expect(
        sendsOf(name).filter((s) =>
          s.action.endsWith(`${config.repair_suffix}${config.repair_suffix}`),
        ),
        "a repair of a repair was scheduled",
      ).toHaveLength(0);
    });

    /**
     * WHAT "COMPLETION" WAS DEFINED AS: the POST was dispatched and the HTTP
     * layer returned — success or failure alike.
     *
     * The alternative (2xx only) is superficially tidier: nothing refilled, so
     * there is nothing to repair. It is wrong here for two reasons the theme's
     * own shape supplies.
     *
     *   1. There is no retry to hand the failure to. `headkit_revalidate_post()`
     *      logs a non-2xx and returns; Action Scheduler re-runs a callback that
     *      THROWS, not one that returns after a 500. Gating on 2xx would delete
     *      the only second attempt the entity tags ever get, so a transient 500
     *      or a 15s timeout would silently lose the repair — a regression
     *      against 0.4.65, where the repair was queued at save time and fired
     *      regardless.
     *   2. A `WP_Error` timeout is not evidence that nothing happened. The route
     *      may have purged and merely answered slowly, in which case the stale
     *      set exists and the repair is precisely what is needed.
     *
     * The one thing that does suppress it is a send that was never DISPATCHED.
     */
    it("a non-2xx first send still gets its repair", () => {
      expect(repairSends("repair_after_failed_send")).toHaveLength(1);
      expect(firstSends("repair_after_failed_send")).toHaveLength(1);
    });

    it("a transport-error first send still gets its repair", () => {
      expect(repairSends("repair_after_transport_error_send")).toHaveLength(1);
      expect(firstSends("repair_after_transport_error_send")).toHaveLength(1);
    });

    it("a send that was never dispatched gets no repair", () => {
      // Revalidation unconfigured (no secret): `headkit_revalidate_post()`
      // returns without sending, and a repair could only reach the same early
      // return — so it would be pure cost against the origin.
      const name = "repair_skipped_when_unconfigured";
      expect(firstSends(name)).toHaveLength(1);
      expect(firstSends(name)[0]!.delivered).toBe(true);
      expect(repairSends(name)).toHaveLength(0);
    });

    it("the repair always lands AFTER the send it repairs", () => {
      // The one property that makes it a repair rather than a second purge.
      for (const name of Object.keys(result)) {
        for (const repair of repairSends(name)) {
          for (const first of firstSends(name)) {
            expect(
              repair.scheduled_in,
              `${name}: the repair must follow the send it repairs`,
            ).toBeGreaterThan(first.scheduled_in);
          }
        }
      }
    });

    /**
     * The repair's dedupe collapse (2026-09-23,
     * `data/260923-cache-delay-and-step4/report.md` §2.4a / §7C).
     *
     * The repair's payload is byte-identical across repeated saves of one
     * product with one event kind, and `as_schedule_single_action()` does not
     * dedupe — the collapse comes from the theme's own
     * `as_next_scheduled_action()` check. Until 0.4.65 that check made the
     * scheduler BAIL, so a later send inherited a repair already most of the way
     * through its window: measured in production the day 0.4.64 shipped, ~37 s
     * of cover instead of 120 s.
     *
     * Since 0.4.66 the trigger is a send COMPLETION rather than a save, which
     * changes where each half of the property is enforced. A burst of identical
     * saves now collapses upstream — one first send, one completion, one repair
     * (`rapid_identical_saves` below) — and this check handles what a burst
     * cannot reach: two DISTINCT sends completing while an earlier repair is
     * still pending, which is the editor who saves, waits past the first send,
     * does not see the change, and saves again. Both halves are still asserted,
     * because either alone is a different bug.
     */
    it("a second COMPLETION moves the pending repair instead of leaving it", () => {
      const name = "repair_reschedules_onto_latest_save";
      const withdrawn = withdrawnRepairs(name);
      expect(
        withdrawn,
        `${name}: the older repair must be withdrawn`,
      ).toHaveLength(1);

      // Exactly one repair is left standing — the dedupe still holds.
      const live = onlyRepair(name);

      // And it fires LATER than the withdrawn one was due, which is the whole
      // point: the cover follows the newest send rather than the oldest.
      expect(live.scheduled_at).toBeGreaterThan(withdrawn[0]!.was_due_at!);
      expect(live.scheduled_in).toBeGreaterThanOrEqual(config.repair_delay);
    });

    it("the render ceiling clears the slowest render actually measured", () => {
      // Provenance for 120: cold facet render 3.3-5.3s, foreground PDP
      // re-render ~5.8s, worst observed 13.85s. Too short and the repair fires
      // before the slow render finished, so the stale set survives and the whole
      // mechanism is a no-op; too long only delays convergence.
      expect(config.render_ceiling).toBeGreaterThan(13.85);
      expect(config.render_ceiling).toBe(120);
    });

    it("a filtered FIRST delay no longer moves the repair a second time", () => {
      // THE 0.4.66 INVERSION. While both sends were absolute timestamps, the
      // repair had to be derived as `first + ceiling` or a store tuning the
      // first delay would strand it in front of the purge it repairs. Now it is
      // scheduled from that purge's own completion, so inheriting the first
      // delay again would push it to 45 + 120 behind a send that already moved.
      const name = "repair_independent_of_first_delay";
      const first = only(name);
      const repair = onlyRepair(name);
      expect(first.scheduled_in).toBeGreaterThanOrEqual(45);
      expect(first.scheduled_in).toBeLessThanOrEqual(47);
      // Still one render ceiling behind the completion, wherever that landed.
      expect(repair.scheduled_at - first.delivered_at!).toBe(
        config.render_ceiling,
      );
    });

    it("the headkit_revalidation_repair_delay filter still tunes the repair alone", () => {
      // A store keeps its lever. What changed is the unit: the filtered value is
      // now seconds after the first send completed, not seconds after the save.
      const first = only("repair_filtered_custom");
      const repair = onlyRepair("repair_filtered_custom");
      expect(repair.scheduled_at - first.delivered_at!).toBe(90);
      // ...and the first send is untouched by it.
      expect(first.scheduled_in).toBeGreaterThanOrEqual(config.delay);
      expect(first.scheduled_in).toBeLessThanOrEqual(config.delay + 2);
    });

    it("a repair filtered to zero or below is not scheduled at all", () => {
      // The equivalent of the pre-0.4.66 "at or below the first delay disables
      // it" rule: offset zero is now where the send being repaired sits, so a
      // purge at or before it cannot observe the fill that send triggers and
      // costs origin reads for nothing.
      for (const name of [
        "repair_disabled_by_filter",
        "repair_disabled_by_negative_filter",
      ]) {
        expect(
          repairSends(name),
          `${name}: repair must be disabled`,
        ).toHaveLength(0);
        expect(firstSends(name)).toHaveLength(1);
      }
    });

    it("an event with no entity tags schedules no repair", () => {
      // A menu edit, a branding change, a category term edit: there is no
      // entity page to repair, so a second send would be pure cost.
      //
      // `brand_term_edit` left this list on 2026-09-23 — it DOES name an entity
      // page (`/brand/{slug}`), which the first send deletes and nothing used to
      // repair. The category term edits stay: `headkit:collection:{slug}` names
      // the product-SET domain and reaches whole grids, so it is not repairable
      // at the cost the repair is budgeted for.
      for (const name of [
        "menu_save",
        "branding_change",
        "category_term_edit",
        "category_term_delete",
      ]) {
        expect(
          repairSends(name),
          `${name}: has no entity tag and must schedule no repair`,
        ).toHaveLength(0);
        expect(firstSends(name).length).toBeGreaterThan(0);
      }
    });

    it("an event that sends nothing schedules no repair either", () => {
      for (const name of [
        "stock_change_draft",
        "non_price_props",
        "term_noop",
        "term_change_on_draft",
      ]) {
        expect(result[name]).toEqual([]);
      }
    });

    it("CMS content pages and posts are repaired too", () => {
      expectSameSet(onlyRepair("page_save").tags, [TAG.page("shipping")]);
      expectSameSet(onlyRepair("post_save").tags, [TAG.post("launch")]);
      // A news save emits a second, index-only payload; it carries no entity tag
      // and gets no repair, so the scenario is 2 first sends + 1 repair.
      expect(firstSends("post_save")).toHaveLength(2);
      expect(repairSends("post_save")).toHaveLength(1);
    });

    it("the two sends are not dedupable, even when the payloads match", () => {
      // THE CASE THE ACTION LABEL EXISTS FOR. A faq CPT save emits
      // `headkit:page:faq` and no path, so the repair payload is identical to
      // the first in every field Action Scheduler keys on EXCEPT the label.
      // Without the suffix the two collapse and the repair silently never
      // happens — on this event only, which is the shape that survives review.
      const first = only("faq_save");
      const repair = onlyRepair("faq_save");
      expect(repair.tags).toEqual(first.tags);
      expect(repair.paths).toEqual(first.paths);
      expect(repair.action).not.toBe(first.action);
      expect(repair.action).toBe(`${first.action}${config.repair_suffix}`);
      // Both were really scheduled — the assertion above would pass vacuously
      // against a collapsed queue.
      expect(sendsOf("faq_save")).toHaveLength(2);
    });

    it("rapid identical saves collapse the repair too", () => {
      // The repair INHERITS the first send's coalescing rather than defeating
      // it: three identical saves are one send and one repair, not three of
      // each. This is what keeps a bulk edit or an importer run inside the
      // origin's 1.8 req/s budget. Since 0.4.66 it is also structural rather
      // than incidental — one first send can only complete once.
      expect(repairSends("rapid_identical_saves")).toHaveLength(1);
      expect(sendsOf("rapid_identical_saves")).toHaveLength(2);
      // Saves inside one second are a no-op, not a withdraw-and-requeue cycle:
      // the pending repair already covers them, so the 2026-09-23 reschedule
      // costs this path nothing.
      expect(withdrawnRepairs("rapid_identical_saves")).toHaveLength(0);
    });
  });

  /*
   * PART 2 of the same defect: a cache INSIDE WordPress that no `Cache-Control`
   * value can reach. `headkit-product-filters.php` caches the facet payload in
   * a transient, and until 0.4.63 nothing ever deleted it — so a product save
   * left the facet sidebar stale in WordPress for up to its full TTL, under
   * whatever the header said.
   *
   * The key is namespaced by a generation (the key space is an md5 over request
   * arguments, so there is no name to delete, and a wp_options sweep would find
   * nothing at all on a store with an external object cache). "Flushed" is
   * therefore asserted as a real lookup: the harness caches a payload before
   * each scenario and checks whether the endpoint would still find it after.
   */
  describe("the facet transient is invalidated by the same events", () => {
    function observe(name: string): FiltersObservation {
      const seen = filters[name];
      expect(
        seen,
        `${name}: harness recorded no facet observation`,
      ).toBeDefined();
      return seen!;
    }

    it("every event that sends a revalidation also flushes it", () => {
      for (const [name, sends] of Object.entries(result)) {
        if (sends.length === 0) continue;
        const seen = observe(name);
        const tags = sends.flatMap((send) => send.tags);
        const touchesCatalogue = tags.some(
          (tag) =>
            tag === TAG.products ||
            tag === TAG.collections ||
            tag === TAG.brands ||
            tag === TAG.catalog ||
            tag.startsWith("headkit:product:") ||
            tag.startsWith("headkit:collection:") ||
            tag.startsWith("headkit:brand:") ||
            tag.startsWith("headkit:catalog:"),
        );
        if (!touchesCatalogue) continue;
        expect(
          seen.lookup_hits,
          `${name}: a facet payload cached before the save survived it`,
        ).toBe(false);
        expect(seen.generation_after).toBeGreaterThan(seen.generation_before);
      }
    });

    it("a product save flushes it", () => {
      expect(observe("update").lookup_hits).toBe(false);
      expect(observe("stock_change").lookup_hits).toBe(false);
      expect(observe("price_change").lookup_hits).toBe(false);
    });

    it("a category or brand term change flushes it", () => {
      // The facet payload IS the category / brand / attribute counts.
      expect(observe("category_term_edit").lookup_hits).toBe(false);
      expect(observe("category_term_delete").lookup_hits).toBe(false);
      expect(observe("brand_term_edit").lookup_hits).toBe(false);
      expect(observe("category_change_via_save").lookup_hits).toBe(false);
      expect(observe("brand_change_via_crud").lookup_hits).toBe(false);
    });

    it("a menu or branding edit does NOT flush it", () => {
      // A flush bound to "any revalidation" would recount every category,
      // brand and attribute in the catalogue each time somebody moved a footer
      // link. That is the version of this fix people delete.
      for (const name of ["menu_save", "branding_change"]) {
        const seen = observe(name);
        expect(seen.lookup_hits, `${name}: flushed the facet cache`).toBe(true);
        expect(seen.generation_after).toBe(seen.generation_before);
      }
      // ...and both of them really did send something, or the assertion above
      // would pass for the wrong reason.
      expect(result["menu_save"]!.length).toBe(1);
      expect(result["branding_change"]!.length).toBe(1);
    });

    it("an event that sends nothing flushes nothing", () => {
      for (const name of [
        "term_noop",
        "flush_without_marker",
        "term_change_on_draft",
        "stock_change_draft",
      ]) {
        expect(result[name]).toEqual([]);
        expect(observe(name).lookup_hits, `${name}: flushed on a no-op`).toBe(
          true,
        );
      }
    });

    it("flushes once per EVENT even when the sends deduplicate", () => {
      // Three identical saves collapse into one scheduled send because the send
      // carries no data. A cache flush is not deduplicable the same way.
      const seen = observe("rapid_identical_saves");
      expect(firstSends("rapid_identical_saves")).toHaveLength(1);
      expect(seen.generation_after - seen.generation_before).toBe(3);
    });
  });

  describe("catalogue events notify commerce when it is configured", () => {
    function urlsOf(name: string): string[] {
      const urls = http[name];
      expect(urls, `${name}: harness recorded no outbound URLs`).toBeDefined();
      return urls!;
    }

    function bodyOf(name: string, index: number): Record<string, unknown> {
      const bodies = httpBodies[name];
      expect(
        bodies,
        `${name}: harness recorded no request bodies`,
      ).toBeDefined();
      const raw = bodies![index];
      expect(raw, `${name}: missing body ${index}`).toBeTypeOf("string");
      return JSON.parse(raw!) as Record<string, unknown>;
    }

    it("an unconfigured catalogue event still posts the storefront", () => {
      const urls = urlsOf("stock_change");
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain("/api/revalidate");
        expect(url).not.toContain("/catalog/sync");
      }
    });

    it("a configured catalogue event posts commerce only, including the repair", () => {
      const urls = urlsOf("stock_change_via_commerce");
      expect(urls).toHaveLength(2);
      for (const url of urls) {
        expect(url).toBe("https://commerce.harness.invalid/catalog/sync");
        expect(url).not.toContain("/api/revalidate");
        expect(url).not.toContain("/catalog-cache/invalidate");
      }

      const first = bodyOf("stock_change_via_commerce", 0);
      expect(first.provider).toBe("woocommerce");
      expect(first.slug).toBe("e-bike");
      expect(first.action).toBe("stock_change");
      expect(first.currency).toBe("AUD");
      expect(first.currencyMinorUnit).toBe(2);
      expect(first.currencyMinorUnitKnown).toBe(true);
      expect(first.revalidateSecret).toBe("harness-secret");
      expect(first.tags).toEqual(
        expect.arrayContaining(["headkit:product:e-bike"]),
      );

      const repair = bodyOf("stock_change_via_commerce", 1);
      expect(repair.action).toBe(`stock_change${config.repair_suffix}`);
      expect(repair.slug).toBe("e-bike");
      expect(repair.paths).toBeUndefined();
    });

    it("branding still posts the storefront when commerce is configured", () => {
      const urls = urlsOf("branding_change_via_commerce");
      expect(urls).toEqual(["https://harness.invalid/api/revalidate"]);
    });

    it("a catalogue event without the API token stays on the storefront", () => {
      const urls = urlsOf("stock_change_commerce_unconfigured");
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain("/api/revalidate");
        expect(url).not.toContain("/catalog/sync");
        expect(url).not.toContain("/catalog-cache/invalidate");
      }
    });
  });
});
