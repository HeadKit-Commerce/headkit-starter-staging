// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// See deferred-third-party-scripts.load-gate.test.tsx.
vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: function MockGoogleTagManager({ gtmId }: { gtmId: string }) {
    if (typeof document === "undefined") return null;
    const src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
    if ([...document.scripts].some((script) => script.src === src)) return null;
    const layer = ((window as unknown as { dataLayer?: unknown[] }).dataLayer =
      (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []);
    layer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const el = document.createElement("script");
    el.id = "_next-gtm";
    el.async = true;
    el.src = src;
    document.head.appendChild(el);
    return null;
  },
}));

import { ConsentBanner } from "@/components/headkit-ui/consent-banner";
import { DeferredThirdPartyScripts } from "@/components/headkit-ui/deferred-third-party-scripts";
import { CONSENT_STORAGE_KEY, CONSENT_VERSION } from "@/lib/consent";
import { resetConsentStoreForTests } from "@/lib/consent-store";

/**
 * The claim this file exists to make: the banner and the tag loader compose
 * into a gate — the container is told `denied` BEFORE `gtm.start`, a press
 * reaches it, a returning visitor is never asked again, and the idle deferral
 * the consent default rides inside is unchanged.
 *
 * It drives BOTH components together, against the real store, because a test
 * of either alone stays green while the other half is broken: the banner can
 * write a perfect record nothing reads, and the loader can push a perfect
 * default no press ever updates.
 *
 * WHERE IT STOPS, and this is most of the value of the feature.
 *  - Nothing here loads `gtm.js`, reaches Google, or observes a cookie. That
 *    the denied default actually prevents `test_cookie` on `.doubleclick.net`,
 *    and that the page then scores 100, are BROWSER measurements — the four
 *    arms are tabulated in the PR that introduced this.
 *  - jsdom has no layout, so it cannot see that the bar shifts nothing, that
 *    it is not the LCP element, or that Decline and Accept are the same size.
 *  - The deferral assertions below use jsdom's absent `requestIdleCallback`,
 *    so they exercise the `setTimeout` fallback branch, and jsdom reports
 *    `document.readyState === "complete"`, so they exercise the
 *    already-loaded branch of the schedule. The `load`-event branch, the
 *    ceiling, the gesture-ahead-of-load case and the
 *    `NEXT_PUBLIC_THIRD_PARTY_EAGER` escape hatch live in
 *    `deferred-third-party-scripts.load-gate.test.tsx`; that the real
 *    `requestIdleCallback` path behaves the same is unchanged code, measured
 *    in a browser, not here.
 *
 * AND THE PER-STORE HALF. Every suite below renders with the gate ON, because
 * that is the store that has one. The suite named "with the gate OFF" is the
 * one that guards the default every existing store lands on, and it asserts
 * the WHOLE gate is gone rather than just the banner — the failure this
 * feature invites is removing the banner while leaving the denied default
 * pushed, which pins every visitor at denied with no control that could ever
 * grant. Google tags then never fire, and nothing reports it: it surfaces
 * weeks later as a conversion report that went quiet.
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

function dataLayer(): unknown[] {
  return (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
}

/** The consent commands, in dataLayer order. */
function consentCommands(): Array<{ command: unknown; signals: unknown }> {
  return dataLayer()
    .filter(
      (entry): entry is IArguments =>
        Object.prototype.toString.call(entry) === "[object Arguments]" &&
        (entry as IArguments)[0] === "consent",
    )
    .map((entry) => ({ command: entry[1], signals: entry[2] }));
}

function indexOfGtmStart(): number {
  return dataLayer().findIndex(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "gtm.start" in (entry as Record<string, unknown>),
  );
}

function press(label: string): void {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labelled ${label}`);
  act(() => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function bannerVisible(): boolean {
  return document.querySelector(".headkit-consent-banner") !== null;
}

/**
 * An in-memory `localStorage`. jsdom's own is not a complete Storage here
 * (`clear` is missing), and a stub is the more honest test anyway: the store's
 * contract is "a read or write that throws means NOT CHOSEN", and this makes
 * that branch reachable.
 */
function installStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    },
  });
  return entries;
}

let container: HTMLElement;
let root: Root;

/**
 * Render the pair exactly as `app/layout.tsx` does: ONE flag drives both the
 * loader's consent default and whether the banner is mounted at all. Passing
 * the flag to only one of them is the bug this file exists to catch, so the
 * helper cannot express that state — the "off" suite proves the composition,
 * not a hand-wired half of it.
 */
function render(consentEnabled = true): void {
  act(() => {
    root.render(
      <>
        <DeferredThirdPartyScripts
          gtmId="GTM-TEST"
          consentEnabled={consentEnabled}
        />
        {consentEnabled ? <ConsentBanner /> : null}
      </>,
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installStorage();
  resetConsentStoreForTests();
  delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
  document.getElementById("_next-gtm-init")?.remove();
  document.getElementById("_next-gtm")?.remove();
  for (const script of gtmScripts()) script.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/**
 * The default every store on the platform lands on today.
 *
 * THE POINT OF THIS SUITE is the difference between "the banner is gone" and
 * "the gate is gone". Those are two different pieces: the DEFAULT is pushed by
 * the loader and is what denies Google its cookie; the BANNER only records a
 * choice. Remove the banner alone and the default stays `denied` forever with
 * no control anywhere that could send an `update` — every Google tag is
 * permanently denied, the store's analytics and Ads measurement go dark, and
 * nothing errors. Nobody finds out until someone opens a conversion report.
 *
 * So the assertions are stated as absences of BOTH, and the positive control
 * sits beside them: the tags must still load, byte-for-byte as they did before
 * this feature existed.
 */
describe("with the gate OFF — every store that has not turned it on", () => {
  it("pushes NO consent command at all, not merely a hidden banner", () => {
    render(false);
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // The whole gate, not half of it.
    expect(consentCommands()).toHaveLength(0);
    expect(bannerVisible()).toBe(false);
  });

  it("still loads the tags, exactly as before the gate existed", () => {
    render(false);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(gtmScripts()).toHaveLength(1);
    expect(gtmScripts()[0]?.async).toBe(true);
    // gtm.start is still the FIRST dataLayer message: with no consent command
    // ahead of it, the container initialises on an untouched dataLayer.
    expect(indexOfGtmStart()).toBe(0);
  });

  it("leaves an existing stored decision unread — an old choice cannot re-arm it", () => {
    // A store that turned the gate on, collected decisions, then turned it off
    // must not keep half-applying them. A stored `denied` silently re-pushed
    // as a default is the same outage as above, with a more confusing cause.
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_VERSION,
        at: "2026-09-23T00:00:00.000Z",
        choices: { analytics: false, advertising: false },
      }),
    );
    resetConsentStoreForTests();

    render(false);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(consentCommands()).toHaveLength(0);
    expect(gtmScripts()).toHaveLength(1);
  });

  it("renders no banner even on a gesture or after a long wait", () => {
    render(false);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(60_000);
    });

    expect(bannerVisible()).toBe(false);
    expect(consentCommands()).toHaveLength(0);
    expect(gtmScripts()).toHaveLength(1);
  });
});

describe("the gate, with no choice made — what Lighthouse sees", () => {
  it("tells the container denied BEFORE gtm.start", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    const commands = consentCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toBe("default");
    expect(commands[0]?.signals).toMatchObject({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      security_storage: "granted",
    });

    // Order is the load-bearing part: a default that lands after the container
    // initialises gates nothing.
    const consentIndex = dataLayer().findIndex(
      (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
    );
    expect(consentIndex).toBeGreaterThanOrEqual(0);
    expect(consentIndex).toBeLessThan(indexOfGtmStart());
  });

  it("shows the banner, and offers decline and accept as equal one-press controls", () => {
    render();
    expect(bannerVisible()).toBe(true);

    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".headkit-consent-actions button",
      ),
    ];
    const labels = buttons.map((button) => button.textContent?.trim());
    // ONLY those two, in that order: nothing else competes for the press, and
    // the refusal is not a third-class control tucked behind something.
    expect(labels).toEqual(["Decline", "Accept"]);

    // Equal prominence, as far as a DOM can see it: same size utilities, same
    // width floor. jsdom has no layout, so the rendered geometry is a browser
    // claim and the screenshots in the PR are what carry it.
    const [decline, accept] = buttons;
    for (const size of ["h-10", "px-4", "py-2", "text-base", "min-w-[132px]"]) {
      expect(decline?.className).toContain(size);
      expect(accept?.className).toContain(size);
    }
  });

  it("never grants on a timer — the whole gate depends on it", () => {
    render();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(gtmScripts()).toHaveLength(0);
    expect(consentCommands()).toHaveLength(0);
    expect(bannerVisible()).toBe(true);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it("never grants on a scroll, which also loads the tags", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands().map((entry) => entry.command)).toEqual([
      "default",
    ]);
    expect(bannerVisible()).toBe(true);
  });
});

describe("after accepting", () => {
  it("pushes a granted consent update and stores the decision", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    press("Accept");

    const commands = consentCommands();
    expect(commands.map((entry) => entry.command)).toEqual([
      "default",
      "update",
    ]);
    expect(commands[1]?.signals).toMatchObject({
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
    });
    expect(bannerVisible()).toBe(false);

    const stored = JSON.parse(
      window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? "null",
    );
    expect(stored).toMatchObject({
      version: CONSENT_VERSION,
      choices: { analytics: true, advertising: true },
    });
  });

  it("carries the grant to the container as the DEFAULT on the next page view", () => {
    // A returning visitor must not have a denied window at all.
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_VERSION,
        at: "2026-09-23T00:00:00.000Z",
        choices: { analytics: true, advertising: true },
      }),
    );
    resetConsentStoreForTests();

    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    const commands = consentCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toBe("default");
    expect(commands[0]?.signals).toMatchObject({ ad_storage: "granted" });
    expect(bannerVisible()).toBe(false);
  });
});

describe("after declining", () => {
  it("keeps every signal denied and hides the banner", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    press("Decline");

    const commands = consentCommands();
    expect(commands.map((entry) => entry.command)).toEqual([
      "default",
      "update",
    ]);
    expect(commands[1]?.signals).toMatchObject({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    });
    expect(bannerVisible()).toBe(false);
  });

  it("stays denied on the next page view, and asks no second time", () => {
    render();
    press("Decline");

    // A fresh page view: new module state, same storage.
    act(() => root.unmount());
    resetConsentStoreForTests();
    delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    for (const script of gtmScripts()) script.remove();
    root = createRoot(container);

    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    const commands = consentCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toBe("default");
    expect(commands[0]?.signals).toMatchObject({ ad_storage: "denied" });
    expect(bannerVisible()).toBe(false);
  });
});

describe("the re-open control", () => {
  it("re-opens the choices from any a[href='#cookie-settings'] in the document", () => {
    render();
    press("Accept");
    expect(bannerVisible()).toBe(false);

    const link = document.createElement("a");
    link.href = "#cookie-settings";
    document.body.appendChild(link);
    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(bannerVisible()).toBe(true);
    // It opens on the stored choices, not on a blank slate.
    const advertising = document.querySelector<HTMLInputElement>(
      "#consent-advertising",
    );
    expect(advertising?.checked).toBe(true);
    link.remove();
  });
});

describe("the deferral still gates the consent default", () => {
  it("loads nothing — and pushes no consent command — before idle or a gesture", () => {
    render();

    expect(gtmScripts()).toHaveLength(0);
    expect(consentCommands()).toHaveLength(0);
    // The dataLayer stub still exists immediately, as before.
    expect(Array.isArray(dataLayer())).toBe(true);
  });

  it("does not load on a timer with no interaction", () => {
    render();
    expect(gtmScripts()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(gtmScripts()).toHaveLength(0);
    expect(consentCommands()).toHaveLength(0);
  });

  it("still loads on the first gesture, before the cap", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(gtmScripts()).toHaveLength(1);
  });

  it("loads exactly once when a gesture and the cap both happen", () => {
    render();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(10_000);
    });

    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands()).toHaveLength(1);
  });

  it("a press before the container loads needs no update — the default carries it", () => {
    render();
    press("Accept");

    // Nothing loaded yet, so nothing to update.
    expect(gtmScripts()).toHaveLength(0);
    expect(consentCommands()).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    const commands = consentCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toBe("default");
    expect(commands[0]?.signals).toMatchObject({ ad_storage: "granted" });
  });
});
