import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  invalidatesManyPages,
  ROOT_LAYOUT_CHROME_TAGS,
  TAG,
} from "./cache-tags";

/**
 * The rule behind the layout-chrome classification, in executable form:
 * **a cache tag's blast-radius class follows its CARRIERS, not what the tag
 * means.** Anything reachable from a read `app/layout.tsx` awaits is on every
 * CDN entry in the storefront by construction, because under Cache Components a
 * tag declared inside a nested cached read propagates outward onto the awaiting
 * route's entry unconditionally.
 *
 * Classifying such a tag NARROW sends it to `revalidateTag(t, { expire: 0 })`,
 * an unconditional DELETE — so one branding save destroys every prerendered
 * page on the store, and nothing re-warms them but real visitors each paying a
 * cold render.
 *
 * A hand-kept list of five tags cannot catch the SIXTH. So this file derives
 * the set from source instead:
 *
 *   1. `app/layout.tsx` must await exactly the reads declared in
 *      `LAYOUT_AWAITED_READS` — adding a read to the layout fails here until
 *      someone declares which module carries it and what it tags.
 *   2. every `cacheTag(...)` argument in those carrier modules must classify
 *      WIDE through the real `invalidatesManyPages`.
 *
 * ## What this does NOT cover
 *
 * It is a SOURCE reading. It does not render the layout, does not execute a
 * cached read, and cannot see a tag added at runtime or one reached through a
 * call chain deeper than the carrier module's own `cacheTag` line (a carrier
 * that awaits a further cached read propagates that read's tags too, and this
 * file would not notice). It observes no CDN and no cache header: that the
 * route sends the wide class through `invalidateByTag` is
 * `app/api/revalidate/route.test.ts`, and only a runtime log on a deployment
 * can show `x-vercel-cache: STALE`.
 *
 * It also proves nothing about the blast RADIUS. The classification decides the
 * mechanism only — a chrome purge still marks every entry in the storefront.
 */

const appRoot = path.resolve(import.meta.dirname, "..");

function source(relative: string): string {
  return readFileSync(path.join(appRoot, relative), "utf8");
}

/**
 * Every cached read `app/layout.tsx` awaits, mapped to the module that declares
 * its tags. `NavigationWrapper` is included because the layout renders it and
 * it is the header menus' carrier; the layout awaits `getFooterMenus`
 * directly.
 */
const LAYOUT_AWAITED_READS: ReadonlyArray<{
  /** The call as it appears in one of `app/layout.tsx`'s `Promise.all` blocks. */
  call: string;
  /** The module whose `cacheTag(...)` calls decide that read's tags. */
  carrier: string;
}> = [
  { call: "getBranding()", carrier: "lib/branding.ts" },
  {
    call: "safeGetFooterMenus()",
    carrier: "components/headkit-ui/navigation-wrapper.tsx",
  },
  { call: "getBrandingAssets()", carrier: "lib/branding.ts" },
  { call: "getEmailMarketingStatus()", carrier: "lib/email-marketing.ts" },
];

/** `fetchMenu` (header locations) is reached through the rendered wrapper. */
const EXTRA_CARRIERS: readonly string[] = [
  "components/headkit-ui/navigation-wrapper.tsx",
];

/**
 * Tags a chrome carrier declares that are wide on their OWN grounds and are
 * therefore not part of the chrome set: the menu hrefs are re-derived from the
 * category tree, so `TAG.collections` rides these reads too.
 */
const NON_CHROME_KEYS: readonly string[] = ["collections"];

function allCarriers(): string[] {
  return [
    ...new Set([
      ...LAYOUT_AWAITED_READS.map((r) => r.carrier),
      ...EXTRA_CARRIERS,
    ]),
  ];
}

/**
 * Extract the `TAG.*` members named inside every `cacheTag(...)` call in one
 * module. Deliberately literal: it reads the same text a human reviewing the
 * file reads, so a tag passed through a variable is invisible here rather than
 * silently accepted — see the coverage note above.
 */
function taggedBy(relative: string): string[] {
  const text = source(relative);
  const found = new Set<string>();
  const call = /cacheTag\(([\s\S]*?)\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(text)) !== null) {
    const args = match[1] ?? "";
    for (const member of args.matchAll(/TAG\.(\w+)/g)) {
      const key = member[1];
      if (key) found.add(key);
    }
  }
  return [...found];
}

/** One representative tag string per `TAG` member, for the builders. */
function sampleFor(key: string): string {
  const member = (TAG as Record<string, unknown>)[key];
  if (typeof member === "string") return member;
  if (typeof member === "function") {
    return (member as (id: string) => string)(
      key === "route" ? "home" : key === "menu" ? "PRIMARY" : "sample-slug",
    );
  }
  throw new Error(`TAG.${key} is neither a string nor a builder`);
}

describe("root-layout chrome tags are classified by their carriers", () => {
  it("app/layout.tsx awaits exactly the reads declared here", () => {
    const layout = source("app/layout.tsx");
    for (const { call } of LAYOUT_AWAITED_READS) {
      expect(
        layout.includes(call),
        `${call} is declared as a root-layout read but app/layout.tsx no longer awaits it — update LAYOUT_AWAITED_READS`,
      ).toBe(true);
    }
    // The other direction: a NEW await inside the layout must be declared
    // before this suite will pass, so a sixth chrome tag cannot arrive
    // unclassified the way the first five did. Both of the layout's
    // `Promise.all` blocks are read — `generateMetadata`'s reads are cached and
    // tagged exactly like the body's, so they carry the same propagation.
    const awaited: string[] = [];
    const marker = "await Promise.all([";
    for (let at = layout.indexOf(marker); at !== -1; ) {
      const end = layout.indexOf("]);", at);
      const block = layout.slice(at, end === -1 ? undefined : end);
      for (const call of block.matchAll(/(\w+)\(\)/g)) {
        awaited.push(`${call[1]}()`);
      }
      at = layout.indexOf(marker, end === -1 ? layout.length : end);
    }
    expect([...new Set(awaited)].sort()).toEqual(
      [...new Set(LAYOUT_AWAITED_READS.map((r) => r.call))].sort(),
    );
  });

  it("every tag a root-layout carrier declares classifies WIDE", () => {
    for (const carrier of allCarriers()) {
      const keys = taggedBy(carrier);
      expect(
        keys.length,
        `found no cacheTag(TAG.*) call in ${carrier} — the extractor has drifted from the source`,
      ).toBeGreaterThan(0);
      for (const key of keys) {
        const tag = sampleFor(key);
        expect(
          invalidatesManyPages(tag),
          `${carrier} declares ${tag}, and the root layout awaits that read, so the tag sits on EVERY CDN entry. Classifying it narrow DELETES the whole prerendered site on one save`,
        ).toBe(true);
      }
    }
  });

  it("the declared chrome set matches what those carriers actually tag", () => {
    const keys = new Set<string>();
    for (const carrier of allCarriers()) {
      for (const key of taggedBy(carrier)) keys.add(key);
    }
    for (const key of NON_CHROME_KEYS) keys.delete(key);
    expect([...keys].map(sampleFor).sort()).toEqual(
      [...ROOT_LAYOUT_CHROME_TAGS].sort(),
    );
  });
});
