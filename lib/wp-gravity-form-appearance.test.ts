import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate for the Gravity Forms field settings the HeadKit REST payload carries.
 *
 * Three settings a merchant sets in the WordPress form editor used to reach no
 * storefront at all, and they were lost in two different places: `isSelected`
 * on a choice and a field's `description` were transmitted by the theme and
 * discarded by commerce, while the Appearance block (Field Label Visibility,
 * Description Placement) and the Custom Validation Message were never emitted
 * by the theme in the first place. This covers the theme half.
 *
 * It runs the theme's own PHP: `tests/gravity-form-appearance-harness.php` shims
 * the WordPress functions the endpoint touches, loads the REAL endpoint file
 * unmodified, and reports what `headkit_format_gravity_form()` emitted. See
 * `wp-featured-brands-cap.test.ts` for why the theme has harnesses rather than
 * phpunit, and why this suite SKIPS without `php` locally but FAILS in CI.
 *
 * Verified red against `origin/staging` (every new key `null`, every choice's
 * `input_id` absent) and green on this branch.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/gravity-form-appearance-harness.php",
);

interface HarnessResult {
  emailLabelPlacement: string;
  emailDescription: string;
  emailDescriptionPlacement: string;
  emailErrorMessage: string;
  plainLabelPlacement: string;
  plainDescriptionPlacement: string;
  plainErrorMessage: string;
  unknownLabelPlacement: string;
  checkboxInputIds: string[];
  checkboxSelected: boolean[];
  checkboxValues: string[];
  radioInputIds: string[];
  radioSelected: boolean[];
  inheritedAbove: string;
  overriddenBelow: string;
}

/** A working `php` on PATH — the harness is executed, not parsed. */
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

const SUITE = "WordPress Gravity Forms endpoint: field settings";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function format(): HarnessResult {
  const stdout = execFileSync("php", [HARNESS], { encoding: "utf8" });
  return JSON.parse(stdout) as HarnessResult;
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  it("emits Field Label Visibility raw, so anything but hidden_label reads as visible", () => {
    const r = format();
    expect(r.emailLabelPlacement).toBe("hidden_label");
    expect(r.plainLabelPlacement).toBe("");
    // Gravity Forms stores only '' and 'hidden_label' on a FIELD, but the
    // form-level property shares the name and carries left/right/top. Carrying
    // an unrecognised value verbatim is what lets the storefront default it to
    // visible instead of guessing.
    expect(r.unknownLabelPlacement).toBe("left_label");
  });

  it("resolves Description Placement against the form, not just the field", () => {
    const r = format();
    expect(r.emailDescription).toBe("We only use this to reply.");
    expect(r.emailDescriptionPlacement).toBe("above");
    // No field setting and no form setting — Gravity Forms' own default.
    expect(r.plainDescriptionPlacement).toBe("below");
    expect(r.inheritedAbove).toBe("above");
    expect(r.overriddenBelow).toBe("below");
  });

  it("carries the Custom Validation Message, and an empty string when unset", () => {
    const r = format();
    expect(r.emailErrorMessage).toBe(
      "We need an email address to reply to you.",
    );
    expect(r.plainErrorMessage).toBe("");
  });

  it("pairs every Checkboxes choice with the input it is submitted back on", () => {
    const r = format();
    // Gravity Forms never uses an index ending in 0, so that "3.1" cannot be
    // confused with "3.10" — the 10th choice is 3.11.
    expect(r.checkboxInputIds).toEqual([
      "3.1",
      "3.2",
      "3.3",
      "3.4",
      "3.5",
      "3.6",
      "3.7",
      "3.8",
      "3.9",
      "3.11",
      "3.12",
      "3.13",
    ]);
    expect(r.checkboxValues).toHaveLength(12);
    expect(r.checkboxSelected[1]).toBe(true);
    expect(r.checkboxSelected[10]).toBe(true);
    expect(r.checkboxSelected.filter(Boolean)).toHaveLength(2);
  });

  it("leaves input_id empty for a field with no inputs, which posts under its field id", () => {
    const r = format();
    expect(r.radioInputIds).toEqual(["", ""]);
    expect(r.radioSelected).toEqual([true, false]);
  });
});
