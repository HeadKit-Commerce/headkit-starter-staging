import "server-only";

import { headkit as sdk } from "@/lib/sdk";
import type { BrandSummaryFieldsFragment } from "@headkit/sdk";

/**
 * The ONE brand walk. Three surfaces need every brand the store has, and until
 * 2026-10-01 each decided for itself how many to ask for:
 *
 *  - `app/sitemap.ts` walked `headkit/v2/brands` to completion (generic
 *    `collectListPages`, which owns its own per-family failure logging),
 *  - `app/brand/[...slug]`'s `generateStaticParams` walked it with a private
 *    copy of the same loop,
 *  - `app/brand/page.tsx` — the brand INDEX — called `sdk.brands.list()` with
 *    no arguments and rendered whatever came back. The SDK's `perPage` default
 *    is 24, so the index showed 24 brands out of 110 on the Bike Society
 *    rehearsal store and offered nothing to reach the other 86. The sitemap
 *    advertised all 110 the whole time.
 *
 * This module is the walk the last two share, so a terminator rule can no
 * longer be taught to one emitter and not the other.
 *
 * PAGINATE, NEVER CAP. `perPage` maxes out at 100 because WordPress REST
 * argument validation REJECTS a larger ask (`'maximum' => 100` in
 * `integrations/wordpress/theme/inc/rest-api/headkit-*.php`) with
 * `rest_invalid_param` rather than clamping it — asking for 200 inside a
 * `catch` yields an EMPTY family, silently. Reading one page is the other wrong
 * conclusion to draw from that cap, and is the bug above.
 *
 * Terminator rules match `collectListPages`: stop on the endpoint's own
 * `totalPages`, and on an EMPTY page, but NEVER on a short page — only the
 * endpoint knows whether it dropped a row, and treating a short page as the
 * last one is how a paginated walk quietly truncates.
 *
 * The SDK's own defaults are deliberately left alone: they are a published
 * contract every consumer of `@headkit/sdk` reads, and the caller was what was
 * wrong here.
 */

/** Largest page the `headkit/v2/brands` schema accepts (`'maximum' => 100`). */
export const BRAND_PER_PAGE = 100;

/**
 * Fail-safe bound on pages walked, matching `app/sitemap.ts`'s `MAX_LIST_PAGES`
 * and the bound `app/brand/[...slug]` already used.
 *
 * It exists so a provider reporting a wrong `totalPages` cannot spin a build or
 * a request forever — not as a content limit. At an implausible brand count the
 * walk therefore stops at 100 pages / 10,000 brands having made at most 100
 * sequential origin reads, and reports `complete: false` so the index SAYS a
 * brand may be missing instead of looking finished. No store is near this: the
 * largest measured catalogue has 110 brands, two pages.
 */
export const BRAND_MAX_PAGES = 100;

/** One page of the brand endpoint, as both callers need to read it. */
interface BrandPage {
  brands: BrandSummaryFieldsFragment[];
  total: number;
  totalPages: number;
}

/** Outcome of a brand walk. */
export interface BrandWalk {
  /** Every brand the walk actually collected, in endpoint order. */
  brands: BrandSummaryFieldsFragment[];
  /**
   * The endpoint's own count of brands it holds, from page 1 — `null` when page
   * 1 never answered. This is the number `complete` is measured against, so an
   * omission is detected by the provider's arithmetic and not by ours.
   */
  total: number | null;
  /**
   * True only when the walk reached a real terminator AND holds at least as
   * many brands as the endpoint said it had. False means brands are missing
   * from `brands`, and a surface rendering them must say so — the index having
   * silently shown a subset is the whole reason this field exists.
   */
  complete: boolean;
}

/**
 * Walk the brand endpoint to exhaustion.
 *
 * A failure mid-walk KEEPS what was already collected rather than discarding
 * it — 100 brands beats none — and reports `complete: false`. A failure on page
 * 1 yields no brands, also `complete: false`; the caller's empty state and the
 * incompleteness notice are both correct in that case and both render.
 *
 * `fetchPage` is injectable for tests only; production callers pass nothing.
 */
export async function collectAllBrands(
  fetchPage: (page: number) => Promise<BrandPage> = defaultFetchPage,
): Promise<BrandWalk> {
  const brands: BrandSummaryFieldsFragment[] = [];
  let total: number | null = null;
  let reachedEnd = false;

  for (let page = 1; page <= BRAND_MAX_PAGES; page++) {
    let result: BrandPage;
    try {
      result = await fetchPage(page);
    } catch {
      /* Keep what the walk collected; `complete` stays false. */
      break;
    }

    if (page === 1) total = result.total;
    brands.push(...result.brands);

    if (result.brands.length === 0) {
      reachedEnd = true;
      break;
    }
    const { totalPages } = result;
    if (!Number.isFinite(totalPages) || page >= totalPages) {
      reachedEnd = true;
      break;
    }
  }

  // `reachedEnd` implies page 1 answered, so `total` is set; the null arm is
  // only there so a future terminator cannot make this throw.
  const complete = reachedEnd && (total === null || brands.length >= total);

  return { brands, total, complete };
}

async function defaultFetchPage(page: number): Promise<BrandPage> {
  const result = await sdk.brands.list({ page, perPage: BRAND_PER_PAGE });
  return {
    brands: result.brands,
    total: result.total,
    totalPages: result.totalPages,
  };
}
