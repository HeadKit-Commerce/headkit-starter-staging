// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: function MockGoogleTagManager({
    gtmId,
  }: {
    gtmId: string;
  }) {
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

import { DeferredThirdPartyScripts } from "@/components/headkit-ui/deferred-third-party-scripts";
import { resetConsentStoreForTests } from "@/lib/consent-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GTM_SRC = "https://www.googletagmanager.com/gtm.js";

function gtmScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll("script")].filter((script) =>
    script.src.startsWith(GTM_SRC),
  );
}

function consentCommands(): unknown[] {
  const dataLayer =
    (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.filter(
    (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
  );
}

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

function indexOfConsentCommand(): number {
  const dataLayer =
    (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return dataLayer.findIndex(
    (entry) => Object.prototype.toString.call(entry) === "[object Arguments]",
  );
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

beforeEach(() => {
  resetConsentStoreForTests();
  delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
  document.getElementById("_next-gtm")?.remove();
  for (const script of gtmScripts()) script.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("GoogleTagManager from @next/third-parties", () => {
  it("mounts gtm.js after hydration when the consent gate is off", () => {
    render(false);
    expect(gtmScripts()).toHaveLength(1);
    expect(gtmScripts()[0]?.async).toBe(true);
    expect(consentCommands()).toHaveLength(0);
  });

  it("pushes the consent default before gtm.start when the gate is on", () => {
    render(true);
    expect(gtmScripts()).toHaveLength(1);
    expect(consentCommands()).toHaveLength(1);
    expect(indexOfConsentCommand()).toBeGreaterThanOrEqual(0);
    expect(indexOfConsentCommand()).toBeLessThan(indexOfGtmStart());
  });
});
