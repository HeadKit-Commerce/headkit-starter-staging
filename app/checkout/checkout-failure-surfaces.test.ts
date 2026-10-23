import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level tripwires for the failure-routing rules. They execute nothing —
 * the behaviour is asserted in `lib/checkout-failure.test.ts`,
 * `app/checkout/page.session-failure.test.ts` and
 * `app/checkout/success/post-payment-dispositions.test.tsx`. What these catch
 * is the shape the original defect had: a call site building its own route or
 * its own country, beside a helper that would have been correct.
 */

const ROOT = join(__dirname, "..", "..");
const SCANNED = ["app", "components", "lib"];

function sources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      out.push({
        path: relative(ROOT, full),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  for (const dir of SCANNED) walk(join(ROOT, dir));
  return out;
}

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("checkout failure surfaces", () => {
  it("no call site builds a /checkout/error URL by hand", () => {
    const offenders = sources()
      .filter(({ path }) => path !== "lib/checkout-failure.ts")
      .filter(({ text }) => /["'`]\/checkout\/error\?/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("no checkout redirect carries a message payload", () => {
    for (const path of [
      "app/checkout/page.tsx",
      "app/checkout/success/page.tsx",
      "app/checkout/success/[orderId]/page.tsx",
    ]) {
      expect(read(path)).not.toMatch(
        /message=|URLSearchParams\(\{[^}]*message/,
      );
    }
  });

  it("the error page renders no technical details", () => {
    const page = read("app/checkout/error/page.tsx");
    expect(page).not.toContain("<pre");
    expect(page).not.toContain("JSON.stringify");
    expect(page).not.toMatch(/Technical Details/i);
  });

  it("the order return page no longer throws a post-payment finalize error", () => {
    expect(read("app/checkout/success/[orderId]/page.tsx")).not.toMatch(
      /if\s*\(\s*!alreadyFinalized\s*\)\s*throw/,
    );
  });

  it.each([
    "app/checkout/success/page.tsx",
    "app/checkout/success/[orderId]/page.tsx",
    "app/checkout/actions.ts",
  ])(
    "%s builds its finalize pair through lib/finalize-address, with no inline empty geo field",
    (path) => {
      const text = read(path);
      expect(text).toContain("buildFinalizeAddresses(");
      for (const field of ["country", "state", "postcode"]) {
        expect(text).not.toMatch(
          new RegExp(`${field}\\s*:[^,\\n]*\\?\\?\\s*""`),
        );
        expect(text).not.toMatch(new RegExp(`${field}\\s*:\\s*""`));
      }
    },
  );
});
