import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for swatch colours on the catalogue filter facet.
 *
 * The facet sidebar renders from `headkit/v2/product-filters`, which until the
 * accompanying theme change emitted `name` / `slug` / `count` per choice and no
 * swatch at all — so a filter row could only ever be text, however many colours
 * the merchant had configured. This asserts the two things that fix is made of:
 *
 * 1. the colours travel as the KEYED pair the per-product payload already uses
 *    (`hk_swatch_colour` / `hk_swatch_colour_2`), which is what commerce decodes;
 * 2. the read is gated on the attribute's TYPE, never on its taxonomy name.
 *
 * (2) is the part that regresses silently. The legacy `headkit/v1` route gates on
 * `strpos($term->taxonomy, 'colour')`, and a store measured on 2026-10-08 keeps
 * its swatches on `pa_finish` — type `wc-visual`, `hk_swatch_colour` `#1c1c1c`.
 * A name gate reads that attribute as having no colours, the payload looks
 * perfectly well-formed, and nothing anywhere reports it. So the `pa_finish`
 * fixture is the load-bearing one here, not the `pa_colour` one.
 *
 * The theme ships no PHP test runner, so this runs the theme's PHP directly out
 * of the vitest suite that already gates every PR — the same arrangement as
 * `wp-featured-brands-cap.test.ts`, whose docblock carries the full rationale.
 * `php` is preinstalled on `ubuntu-latest`; macOS has not bundled it since
 * Monterey, so this SKIPS on a developer machine without it and FAILS in CI,
 * where a silent skip would drop the only guard on this contract.
 *
 * Behavioural, not a source assertion: it fails if the gate regresses to a name
 * check whether or not the predicate is still spelled in the file.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/filter-swatch-harness.php",
);

interface Choice {
  name: string;
  slug: string;
  count: number;
  hk_swatch_colour?: string;
  hk_swatch_colour_2?: string;
}

interface Attribute {
  label: string;
  name: string;
  slug: string;
  choices: Choice[];
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

const SUITE = "WordPress filters endpoint: attribute swatch colours";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
// Carried in the suite title so the reporter says WHY it was skipped — skipIf
// itself takes no message.
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

function run(): Attribute[] {
  // The harness asserts its own contract and exits non-zero on a failure, which
  // execFileSync turns into a throw — so its own assertions gate this test too,
  // not only the ones spelled out below.
  const stdout = execFileSync("php", [HARNESS], {
    encoding: "utf8",
    env: { ...process.env, HARNESS_JSON: "1" },
  });
  return JSON.parse(stdout) as Attribute[];
}

function choice(
  attributes: Attribute[],
  taxonomy: string,
  slug: string,
): Choice | undefined {
  return attributes
    .find((a) => a.name === taxonomy)
    ?.choices.find((c) => c.slug === slug);
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  let attributes: Attribute[];

  beforeAll(() => {
    // Only reachable in CI: the local run without `php` skipped above.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping. " +
          "Install php on the runner, or run locally where it skips instead.",
      );
    }
    attributes = run();
  });

  it("reads swatches from a swatch-TYPE attribute whose name is not a colour word", () => {
    // The live counter-example. A taxonomy-name gate fails exactly here, and
    // nowhere else in this suite.
    const anthracite = choice(attributes, "pa_finish", "anthracite");

    expect(
      anthracite?.hk_swatch_colour,
      "pa_finish is type wc-visual; a name gate would drop its colour",
    ).toBe("#1c1c1c");
  });

  it("withholds swatches from a non-swatch attribute even when the term has the meta", () => {
    const large = choice(attributes, "pa_size", "large");

    expect(
      large,
      "the pa_size choice itself must still be emitted",
    ).toBeDefined();
    expect(Object.keys(large ?? {})).toEqual(["name", "slug", "count"]);
  });

  it("keeps the two colours in their own keys, so a second colour alone is unambiguous", () => {
    // The v1 route pushed both colours into one unnamed positional array with
    // two conditional pushes, so ["#bbbbbb"] could mean either colour. Keys are
    // what remove that; this is the case that proves it.
    const trimOnly = choice(attributes, "pa_trim", "trim-only");

    expect(
      trimOnly?.hk_swatch_colour,
      "must not shift up from the second",
    ).toBe("");
    expect(trimOnly?.hk_swatch_colour_2).toBe("#bbbbbb");

    const harlequin = choice(attributes, "pa_trim", "harlequin");
    expect(harlequin?.hk_swatch_colour).toBe("#aaaaaa");
    expect(harlequin?.hk_swatch_colour_2).toBe("#bbbbbb");
  });

  it("reports empty strings, never a placeholder colour, for an unconfigured term", () => {
    const unpainted = choice(attributes, "pa_trim", "unpainted");

    expect(unpainted?.hk_swatch_colour).toBe("");
    expect(unpainted?.hk_swatch_colour_2).toBe("");
  });

  it("leaves the three keys every choice has always carried untouched", () => {
    for (const attribute of attributes) {
      for (const c of attribute.choices) {
        expect(c.name, `${attribute.name} choice lost its name`).toBeTruthy();
        expect(c.slug, `${attribute.name} choice lost its slug`).toBeTruthy();
        expect(typeof c.count, `${attribute.name} choice lost its count`).toBe(
          "number",
        );
      }
    }
  });
});
