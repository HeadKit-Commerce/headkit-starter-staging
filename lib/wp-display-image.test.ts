import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Category and brand tiles must not hand the storefront optimizer the original
 * attachment. `headkit_display_image_url()` prefers the 1536 derivative, then
 * `large`, then the original, and returns empty when nothing resolves.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/display-image-harness.php",
);

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
const SKIPPING = !PHP_AVAILABLE && !IS_CI;

describe(
  SKIPPING
    ? "category tile image URL [skipped: requires `php` on PATH]"
    : "category tile image URL",
  () => {
    beforeAll(() => {
      if (!PHP_AVAILABLE && IS_CI) {
        throw new Error("php is required in CI to run display-image-harness.php");
      }
    });

    it("prefers 1536, then large, then the original", () => {
      if (SKIPPING) return;
      const output = execFileSync("php", [HARNESS], { encoding: "utf8" });
      expect(output.trim()).toBe("ok");
    });
  },
);
