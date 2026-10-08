import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * `CheckoutSteps` keeps two synchronous mirrors of its step state —
 * `currentStepRef` and `completedStepsRef` — because the sync-line-items
 * effect and `handleSessionExpired` both run after an `await` and can observe
 * the component between a step advance being queued and React committing it. A
 * 409 handled against a stale CONTACT recreates the session, remounts at
 * CONTACT and hides the delivery accordion (ENG-784).
 *
 * The mirrors used to be kept up to date by assigning them in the render body:
 *
 *   currentStepRef.current = currentStep;
 *   completedStepsRef.current = completedSteps;
 *
 * which `react-hooks/refs` reports as an error. The two lines were also
 * redundant and strictly worse than the mutation-site writes beside them: a
 * render React starts and discards carries the PRE-advance state, so that
 * assignment can move a mirror backwards over a value a handler had already
 * moved forward — the exact staleness the refs exist to avoid.
 *
 * Removing them is only safe while `goToStep` and `markCompleted` remain the
 * ONLY writers of the two states, each writing its mirror with the same value
 * it hands to the setter. That is a whole-component invariant, not a property
 * of any one call, so it is asserted here over the source text rather than
 * through a render: mounting `CheckoutSteps` needs a live Stripe
 * `CheckoutProvider`, and a test that mocked its way around that would be
 * asserting the mock.
 *
 * The trade is the usual one for a source scan — it reads identifiers, so a
 * writer introduced under a different name is invisible to it. What it does
 * catch is the regression that actually happens: someone calling
 * `setCurrentStep` directly, or re-adding the render-body assignment to
 * "keep the ref in sync".
 */

const SOURCE = new URL("./CheckoutForm.tsx", import.meta.url);

async function code(): Promise<string> {
  const source = await readFile(SOURCE, "utf8");

  // Vacuity guard: an empty or renamed read would make every assertion below
  // pass for the wrong reason.
  expect(
    source,
    "read the wrong file — these guards are worthless without CheckoutSteps in it",
  ).toContain("const currentStepRef = useRef(currentStep)");

  // Strip comments first: the rationale above the refs spells both forbidden
  // assignments out in prose. Naive, and that is the trade — a `//` inside a
  // string literal truncates the rest of that line.
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Assignments to `<ref>.current`, not comparisons: the guards below both read
 * `currentStepRef.current === …`, whose `=` a plain substring count would
 * score as a write.
 */
function assignments(haystack: string, ref: string): number {
  return (
    haystack.match(new RegExp(`\\b${ref}\\.current\\s*=(?!=)`, "g")) ?? []
  ).length;
}

describe("CheckoutSteps step-state mirrors", () => {
  it("never assigns either mirror from the render body", async () => {
    const stripped = await code();

    expect(
      /currentStepRef\.current\s*=\s*currentStep\b/.test(stripped),
      "currentStepRef must not be assigned from `currentStep` in the render body (react-hooks/refs): goToStep already writes it, and a discarded render would write the pre-advance step back over a mirror the handler had moved forward",
    ).toBe(false);

    expect(
      /completedStepsRef\.current\s*=\s*completedSteps\b/.test(stripped),
      "completedStepsRef must not be assigned from `completedSteps` in the render body (react-hooks/refs): markCompleted already writes it with the Set it returns",
    ).toBe(false);
  });

  it("writes each mirror exactly once, at its own mutation site", async () => {
    const stripped = await code();

    expect(
      assignments(stripped, "currentStepRef"),
      "exactly one writer of currentStepRef — the one inside goToStep",
    ).toBe(1);

    expect(
      assignments(stripped, "completedStepsRef"),
      "exactly one writer of completedStepsRef — the one inside markCompleted",
    ).toBe(1);
  });

  it("routes every step-state update through goToStep / markCompleted", async () => {
    const stripped = await code();

    // The `useState` destructuring is `setCurrentStep]`, so counting the CALL
    // form counts call sites only.
    expect(
      occurrences(stripped, "setCurrentStep("),
      "setCurrentStep has exactly one call site, inside goToStep; a direct call elsewhere advances the step without moving currentStepRef, and the async 409 path then recreates the session at a step the shopper has left",
    ).toBe(1);

    expect(
      occurrences(stripped, "setCompletedSteps("),
      "setCompletedSteps has exactly one call site, inside markCompleted; a direct call elsewhere marks a step complete without moving completedStepsRef, and handleSessionExpired then restores to CONTACT instead of DELIVERY",
    ).toBe(1);

    // And those single call sites are the paired ones. Whitespace-normalised so
    // the assertion is about the pairing, not about Prettier's line breaks.
    const flat = stripped.replace(/\s+/g, " ");

    expect(
      flat,
      "goToStep must write the mirror BEFORE calling the setter",
    ).toContain("currentStepRef.current = step; setCurrentStep(step);");

    expect(
      flat,
      "markCompleted must write the mirror with the very Set it returns",
    ).toContain(
      "const next = new Set([...prev, step]); completedStepsRef.current = next; return next;",
    );
  });
});
