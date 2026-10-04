// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DeferredThirdPartyScripts } from "@/components/headkit-ui/deferred-third-party-scripts";
import { resetConsentStoreForTests } from "@/lib/consent-store";

/**
 * The claim: by default the tag stack is scheduled from the `load` EVENT, not
 * from mount — so an idle gap inside the paint window can no longer pull the
 * third-party stack in ahead of LCP — while the two properties that make the
 * deferral safe are kept (a gesture still loads immediately, and a page whose
 * `load` never arrives still reports at the ceiling), AND
 * `NEXT_PUBLIC_THIRD_PARTY_EAGER` still buys a store the old schedule back.
 *
 * WHERE IT STOPS.
 *  - The deferred schedule is `load`, then a fixed 3.5 s timeout. The eager
 *    hatch still uses idle-from-mount; jsdom has no `requestIdleCallback`, so
 *    that hatch exercises its `setTimeout` fallback. LCP itself is a browser
 *    measurement — the numbers are in the PR.
 *  - Nothing here loads gtm.js, reaches Google, or observes a cookie. "The
 *    tags still fire" is a browser claim, not one of these assertions.
 *  - `document.readyState` is stubbed. A real browser's ordering of hydration
 *    against `load` is not reproducible here; both branches are covered
 *    explicitly instead.
 *  - The escape-hatch cases stub `process.env`. In a production build Next
 *    INLINES `NEXT_PUBLIC_*` at build time, so what a deployed store actually
 *    does depends on the value present when its build ran — which no unit
 *    test can see.
 *
 * The CONSENT ordering under the default schedule is also covered by
 * `consent-gate.test.tsx`, which drives the banner and this loader together.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GTM_SRC = "https://www.googletagmanager.com/gtm.js";

function gtmScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll("script")].filter((script) =>
    script.src.startsWith(GTM_SRC),
  );
}

/** jsdom reports `complete`; both branches have to be reachable. */
function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => value,
  });
}

let container: HTMLElement;
let root: Root;

function render(consentEnabled = false): void {
  act(() => {
    root.render(
      <DeferredThirdPartyScripts
        gtmId="GTM-TEST"
        consentEnabled={consentEnabled}
      />,
    );
  });
}

/** The consent commands pushed so far, in dataLayer order. */
function consentCommands(): unknown[] {
  const dataLayer =
    (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.filter(
    (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
  );
}

/** Index of the first consent command in the dataLayer, or -1. */
function indexOfConsentCommand(): number {
  const dataLayer =
    (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.findIndex(
    (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
  );
}

/** Index of the `gtm.start` message, or -1. */
function indexOfGtmStart(): number {
  const dataLayer =
    (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.findIndex(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "gtm.start" in (entry as Record<string, unknown>),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  resetConsentStoreForTests();
  delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
  for (const script of gtmScripts()) script.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setReadyState("complete");
});

describe("a page still loading", () => {
  beforeEach(() => setReadyState("loading"));

  it("loads nothing while the page is still painting", () => {
    render();
    act(() => {
      // Past the 4 s cap this used to schedule against, which is what put the
      // tag stack inside the paint window.
      vi.advanceTimersByTime(5000);
    });

    expect(gtmScripts()).toHaveLength(0);
  });

  it("schedules only once the load event fires", () => {
    render();
    act(() => {
      vi.advanceTimersByTime(5000);
      window.dispatchEvent(new Event("load"));
    });
    expect(gtmScripts()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(gtmScripts()).toHaveLength(1);
    expect(gtmScripts()[0]?.async).toBe(true);
  });

  it("still reports at the ceiling when load never arrives", () => {
    render();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    // A deferral that can silently never fire is data loss, not a win.
    expect(gtmScripts()).toHaveLength(1);
  });

  it("loads immediately on a gesture, ahead of the load wait", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(gtmScripts()).toHaveLength(1);
  });

  it("loads exactly once when the load event and the ceiling both happen", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(30_000);
    });

    expect(gtmScripts()).toHaveLength(1);
  });
});

describe("the per-store consent gate and the schedule are orthogonal", () => {
  // `consentEnabled` decides WHETHER a consent command is pushed; the schedule
  // decides WHEN the container loads. Neither may be read from the other, and
  // a merge of the two is exactly where that could have gone wrong.
  beforeEach(() => setReadyState("loading"));

  it("still pushes the default BEFORE gtm.start on the deferred schedule", () => {
    render(true);
    act(() => {
      window.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(3500);
    });

    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands()).toHaveLength(1);
    expect(indexOfConsentCommand()).toBeGreaterThanOrEqual(0);
    expect(indexOfConsentCommand()).toBeLessThan(indexOfGtmStart());
  });

  it("pushes no consent command with the gate off, and still waits for load", () => {
    render(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(gtmScripts()).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(3500);
    });
    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands()).toHaveLength(0);
  });
});

describe("a page that had already loaded when the effect ran", () => {
  beforeEach(() => setReadyState("complete"));

  it("still waits the post-load delay when load has already fired", () => {
    render();
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(gtmScripts()).toHaveLength(1);
  });
});

describe("NEXT_PUBLIC_THIRD_PARTY_EAGER — the way back", () => {
  beforeEach(() => setReadyState("loading"));

  it('with "true", schedules from MOUNT again and never waits for load', () => {
    vi.stubEnv("NEXT_PUBLIC_THIRD_PARTY_EAGER", "true");
    render();
    act(() => {
      // No load event, no gesture. The old schedule fires on its own cap.
      vi.advanceTimersByTime(3500);
    });

    expect(gtmScripts()).toHaveLength(1);
  });

  it("still pushes the consent default before gtm.start under the hatch", () => {
    // The hard constraint: the Consent Mode v2 default precedes any Google
    // tag under EVERY value of the switch.
    vi.stubEnv("NEXT_PUBLIC_THIRD_PARTY_EAGER", "1");
    render(true);
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands()).toHaveLength(1);
    expect(indexOfConsentCommand()).toBeGreaterThanOrEqual(0);
    expect(indexOfConsentCommand()).toBeLessThan(indexOfGtmStart());
  });

  it("treats an empty value and a typo as the deferred default", () => {
    // A cleared platform variable arrives as "", and an operator typo must
    // not silently move analytics timing back.
    for (const value of ["", "ture", "enabled"]) {
      vi.stubEnv("NEXT_PUBLIC_THIRD_PARTY_EAGER", value);
      render();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(gtmScripts(), `value ${JSON.stringify(value)}`).toHaveLength(0);

      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
  });
});
