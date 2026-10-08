import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for swatch colours on the catalogue filter facet.
 *
 * The facet sidebar renders from `headkit/v2/product-filters`, which until theme
 * 0.4.72 emitted `name` / `slug` / `count` per choice and no swatch at all — so
 * a filter row could only ever be text, however many colours the merchant had
 * configured. This asserts the three things the fix is made of:
 *
 * 1. the colours travel as the KEYED pair the per-product payload already uses
 *    (`hk_swatch_colour` / `hk_swatch_colour_2`), which is what commerce decodes;
 * 2. the attribute that carries them is the one the PRODUCT route's three-way OR
 *    selects — swatch TYPE, or the name `pa_color` / `pa_colour`, or (last
 *    resort, singular) terms carrying a colour — so the two routes agree instead
 *    of the filter route being strictly narrower;
 * 3. a non-colour axis never gains swatches, however much meta its terms carry.
 *
 * (2) is the part that regresses silently, and it has failed in BOTH directions
 * already. A taxonomy-NAME gate (the legacy `headkit/v1` route, `strpos($term->
 * taxonomy, 'colour')`) misses a store whose swatches live on `pa_finish` — type
 * `wc-visual`, `hk_swatch_colour` `#1c1c1c`, measured 2026-10-08. A TYPE-only
 * gate (theme 0.4.72) misses the opposite store: Bike Society's attribute is
 * NAMED `pa_colour` and TYPED `select`, and on the rehearsal clone the filter
 * route returned 1,389 values with 0 non-empty colours while the product
 * endpoint served 21 from the same terms. Either way the payload looks perfectly
 * well-formed and nothing anywhere reports it, so both fixtures are load-bearing
 * and neither is redundant.
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

/**
 * The harness runs several store shapes in one process and reports them keyed
 * by scenario name, because the two gates that have failed here fail on
 * different shapes — a single fixture set cannot hold both counter-examples.
 */
type Scenarios = Record<string, Attribute[]>;

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

function run(): Scenarios {
  // The harness asserts its own contract and exits non-zero on a failure, which
  // execFileSync turns into a throw — so its own assertions gate this test too,
  // not only the ones spelled out below.
  const stdout = execFileSync("php", [HARNESS], {
    encoding: "utf8",
    env: { ...process.env, HARNESS_JSON: "1" },
  });
  return JSON.parse(stdout) as Scenarios;
}

function choice(
  attributes: Attribute[] | undefined,
  taxonomy: string,
  slug: string,
): Choice | undefined {
  return attributes
    ?.find((a) => a.name === taxonomy)
    ?.choices.find((c) => c.slug === slug);
}

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  let scenarios: Scenarios;

  beforeAll(() => {
    // Only reachable in CI: the local run without `php` skipped above.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping. " +
          "Install php on the runner, or run locally where it skips instead.",
      );
    }
    scenarios = run();
  });

  it("reads swatches from a swatch-TYPE attribute whose name is not a colour word", () => {
    // The live counter-example for a NAME gate. Nothing else in this suite
    // fails when the type arm is dropped.
    const anthracite = choice(
      scenarios.type_and_name,
      "pa_finish",
      "anthracite",
    );

    expect(
      anthracite?.hk_swatch_colour,
      "pa_finish is type wc-visual; a name gate would drop its colour",
    ).toBe("#1c1c1c");
  });

  it("reads swatches from a `select`-typed attribute NAMED pa_colour", () => {
    // The live counter-example for a TYPE-only gate, and the reason this
    // scenario exists at all: Bike Society's colour attribute is typed
    // `select`, so 0.4.72 served its 1,389 values with 0 colours.
    const cayenne = choice(
      scenarios.select_typed_colour,
      "pa_colour",
      "gloss-cayenne-metallic",
    );

    expect(
      cayenne?.hk_swatch_colour,
      "pa_colour is typed `select`; a TYPE-only gate drops its colour",
    ).toBe("#d3481d");

    const twoTone = choice(
      scenarios.select_typed_colour,
      "pa_colour",
      "black-red",
    );
    expect(twoTone?.hk_swatch_colour).toBe("#000000");
    expect(twoTone?.hk_swatch_colour_2).toBe("#ff0000");
  });

  it("withholds swatches from a non-colour axis even when the term has the meta", () => {
    // Both halves of the same rule. The colour pickers are hooked onto every
    // attribute taxonomy, so Size terms really do carry the meta on these
    // stores — a per-attribute meta arm would put colour dots on Size.
    const large = choice(scenarios.type_and_name, "pa_size", "large");
    expect(
      large,
      "the pa_size choice itself must still be emitted",
    ).toBeDefined();
    expect(Object.keys(large ?? {})).toEqual(["name", "slug", "count"]);

    const medium = choice(scenarios.select_typed_colour, "pa_size", "medium");
    expect(
      medium,
      "the pa_size choice itself must still be emitted",
    ).toBeDefined();
    expect(
      Object.keys(medium ?? {}),
      "widening the gate to the name arm must not widen the meta arm",
    ).toEqual(["name", "slug", "count"]);
  });

  it("falls back to term meta for one attribute only, never for every attribute carrying it", () => {
    // Nothing typed, nothing colour-named: the meta arm is all that is left,
    // and it must pick exactly one axis.
    const sand = choice(scenarios.meta_only_fallback, "pa_shade", "sand");
    expect(
      sand?.hk_swatch_colour,
      "with no typed and no colour-named attribute, the meta arm must select pa_shade",
    ).toBe("#c2b280");

    const small = choice(scenarios.meta_only_fallback, "pa_size", "small");
    expect(
      Object.keys(small ?? {}),
      "pa_size carries the meta too; the fallback selects at most one attribute",
    ).toEqual(["name", "slug", "count"]);
  });

  it("selects every swatch-typed or colour-named attribute, not just the first", () => {
    // A store can legitimately run two swatch axes, and 0.4.72 served both.
    // The type and name arms are per-attribute; only the meta arm is singular.
    for (const taxonomy of ["pa_finish", "pa_colour", "pa_trim"]) {
      const first = scenarios.type_and_name?.find((a) => a.name === taxonomy)
        ?.choices[0];
      expect(
        first?.hk_swatch_colour,
        `${taxonomy} is swatch-typed or colour-named and must emit the pair`,
      ).toBeDefined();
    }
  });

  it("keeps the two colours in their own keys, so a second colour alone is unambiguous", () => {
    // The v1 route pushed both colours into one unnamed positional array with
    // two conditional pushes, so ["#bbbbbb"] could mean either colour. Keys are
    // what remove that; this is the case that proves it.
    const trimOnly = choice(scenarios.type_and_name, "pa_trim", "trim-only");

    expect(
      trimOnly?.hk_swatch_colour,
      "must not shift up from the second",
    ).toBe("");
    expect(trimOnly?.hk_swatch_colour_2).toBe("#bbbbbb");

    const harlequin = choice(scenarios.type_and_name, "pa_trim", "harlequin");
    expect(harlequin?.hk_swatch_colour).toBe("#aaaaaa");
    expect(harlequin?.hk_swatch_colour_2).toBe("#bbbbbb");
  });

  it("reports empty strings, never a placeholder colour, for an unconfigured term", () => {
    const unpainted = choice(scenarios.type_and_name, "pa_trim", "unpainted");

    expect(unpainted?.hk_swatch_colour).toBe("");
    expect(unpainted?.hk_swatch_colour_2).toBe("");
  });

  it("leaves the three keys every choice has always carried untouched", () => {
    for (const [scenario, attributes] of Object.entries(scenarios)) {
      for (const attribute of attributes) {
        for (const c of attribute.choices) {
          expect(
            c.name,
            `${scenario}/${attribute.name} choice lost its name`,
          ).toBeTruthy();
          expect(
            c.slug,
            `${scenario}/${attribute.name} choice lost its slug`,
          ).toBeTruthy();
          expect(
            typeof c.count,
            `${scenario}/${attribute.name} choice lost its count`,
          ).toBe("number");
        }
      }
    }
  });
});
