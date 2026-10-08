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
 * This file guards exactly one thing: that neither assignment comes back. It is
 * the same claim `react-hooks/refs` reports in CI, and it is a claim about the
 * source text rather than about behaviour — a render React starts and discards
 * carries the PRE-advance state, so such an assignment can move a mirror
 * backwards over a value a handler had already moved forward, which is the
 * staleness the refs exist to avoid.
 *
 * The companion invariant — `goToStep` and `markCompleted` are the only writers
 * of either state, each assigning its mirror synchronously before calling its
 * setter — is upheld by the component's own mechanism and documented there, not
 * asserted here.
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

describe("CheckoutSteps step-state mirrors", () => {
  it("never assigns either mirror from the render body", async () => {
    const stripped = await code();

    expect(
      /currentStepRef\.current\s*=\s*currentStep\b/.test(stripped),
      "currentStepRef must not be assigned from `currentStep` in the render body (react-hooks/refs): goToStep already writes it, and a discarded render would write the pre-advance step back over a mirror the handler had moved forward",
    ).toBe(false);

    expect(
      /completedStepsRef\.current\s*=\s*completedSteps\b/.test(stripped),
      "completedStepsRef must not be assigned from `completedSteps` in the render body (react-hooks/refs): markCompleted already writes it with the Set it hands the setter",
    ).toBe(false);
  });
});
