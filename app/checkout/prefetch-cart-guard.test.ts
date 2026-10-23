import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Both server-rendered cart readers must `await connection()` BEFORE they
 * read the cart.
 *
 * A client prefetch under Cache Components runs a RUNTIME prerender, which
 * resolves `cookies()` rather than hanging them, so a route that reads the
 * cart without a `connection()` boundary starts a real `cart.get()` that Next
 * aborts when the prefetch completes — and the null cart renders as a terminal
 * page. `connection()` never resolves in a `prerender-runtime` store, so the
 * prefetch stops at the boundary.
 *
 * One test, both routes: a guard that holds on `/checkout` while `/quote` is
 * unguarded is the shape this exists to prevent. It reads source text only;
 * the rethrow backstop is covered by `lib/cart-actions.prefetch.test.ts`.
 */

const ROOT = join(__dirname, "..", "..");

const ROUTES = [
  { label: "/checkout", file: join(ROOT, "app", "checkout", "page.tsx") },
  { label: "/quote", file: join(ROOT, "app", "quote", "page.tsx") },
] as const;

describe("the cart-reading routes gate a prefetch with connection()", () => {
  for (const { label, file } of ROUTES) {
    it(`${label} awaits connection() from next/server before the cart read`, () => {
      const src = readFileSync(file, "utf8");

      expect(src).toMatch(
        /import\s*\{[^}]*\bconnection\b[^}]*\}\s*from\s*["']next\/server["']/,
      );

      const awaited = src.indexOf("await connection()");
      const cartRead = src.indexOf("getFullCartAction()");
      expect(
        awaited,
        `${label} must call \`await connection()\``,
      ).toBeGreaterThan(-1);
      expect(cartRead).toBeGreaterThan(-1);
      expect(
        awaited,
        `${label} reads the cart before \`await connection()\`; the boundary ` +
          `has to come first or the fetch has already started.`,
      ).toBeLessThan(cartRead);
    });

    it(`${label} does not reach for \`export const dynamic\` instead`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /export\s+const\s+dynamic\s*=/,
      );
    });
  }
});
