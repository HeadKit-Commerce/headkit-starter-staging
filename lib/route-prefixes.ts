/**
 * Route segments that more than one module has to agree on, declared once.
 *
 * This file exists because a shared literal is where URL rules drift — the cost
 * of that class of bug is recorded in `AGENTS.md` under "Canonical URL shape:
 * NESTED wins, and one helper derives it": two emitters, one set, and nothing
 * fails when they disagree because both shapes answer 200.
 *
 * Deliberately dependency-free, and deliberately NOT inside
 * `components/headkit-ui/collection/utils.ts` or `lib/canonical-path.ts`. Many
 * suites partially mock `collection/utils`, so a constant read from there at
 * module scope turns every partial mock into a crash; and `canonical-path`
 * already imports `collection/utils`, so putting it there would need an import
 * back the other way. A leaf module both can read is the shape that survives.
 *
 * `SHOP_PATH_PREFIX` is NOT here: it lives in `app/shop/shop-slug.ts` beside the
 * parser that reads it, which is the same "declaration next to its authority"
 * rule this file follows. Do not move it here for symmetry.
 */

/**
 * The route segment every category listing is served under.
 *
 * Two kinds of module have to agree on it: the URL BUILDERS
 * (`collectionPathFromCategory` in `components/headkit-ui/collection/utils.ts`,
 * `collectionPathFromSegments` in `lib/canonical-path.ts`) and the RECOGNISERS,
 * which decide whether a path is a category listing by matching exactly what
 * those emit — the navigation skeleton's target test
 *, the proxy's canonical-redirect gate
 * (`lib/canonical-redirect-request.ts`, and so `proxy.ts`, which is why this
 * file must stay dependency-free) and the CMS-menu href rewrite
 * (`lib/menu-canonical-href.ts`).
 */
export const COLLECTION_PATH_PREFIX = "collections";
