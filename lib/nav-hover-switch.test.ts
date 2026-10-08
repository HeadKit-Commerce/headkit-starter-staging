// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  headerMenuHoverTarget,
  headerMenuValueAtPoint,
  readHeaderMenuPanel,
  readHeaderMenuTriggers,
  type HeaderMenuRect,
  type HeaderMenuTriggerBox,
} from "@/lib/nav-hover-switch";

const box = (
  value: string,
  left: number,
  width: number,
  height = 40,
): HeaderMenuTriggerBox => ({
  value,
  left,
  right: left + width,
  top: 20,
  bottom: 20 + height,
  width,
  height,
});

describe("headerMenuValueAtPoint", () => {
  const triggers = [
    box("hidden", 0, 80, 0),
    box("1982", 40, 160),
    box("2594", 200, 80),
  ];

  it("returns the trigger whose box contains the point", () => {
    expect(headerMenuValueAtPoint(triggers, 220, 30)).toBe("2594");
  });

  it("skips a zero-size trigger that shares the same coordinates", () => {
    expect(headerMenuValueAtPoint(triggers, 50, 30)).toBe("1982");
  });

  it("returns null when the point is outside every trigger", () => {
    expect(headerMenuValueAtPoint(triggers, 220, 120)).toBeNull();
  });
});

const panel: HeaderMenuRect = {
  left: 0,
  right: 1440,
  top: 80,
  bottom: 400,
  width: 1440,
  height: 320,
};

describe("headerMenuHoverTarget", () => {
  const triggers = [box("1982", 200, 80), box("2594", 280, 80)];

  it("opens the trigger under the pointer", () => {
    expect(headerMenuHoverTarget(triggers, panel, 220, 30, null)).toEqual({
      kind: "trigger",
      value: "1982",
    });
  });

  it("switches when the pointer moves onto another trigger", () => {
    expect(headerMenuHoverTarget(triggers, panel, 300, 30, "1982")).toEqual({
      kind: "trigger",
      value: "2594",
    });
  });

  it("keeps the menu across the seam above the panel", () => {
    expect(headerMenuHoverTarget(triggers, panel, 900, 78, null)).toEqual({
      kind: "panel",
    });
  });

  it("keeps the menu while the pointer is over the open panel", () => {
    expect(headerMenuHoverTarget(triggers, panel, 500, 200, "1982")).toEqual({
      kind: "panel",
    });
  });

  it("keeps the menu across the band between the open trigger and the panel", () => {
    expect(headerMenuHoverTarget(triggers, panel, 900, 70, "1982")).toEqual({
      kind: "panel",
    });
  });

  it("closes when that band is crossed with no menu open", () => {
    expect(headerMenuHoverTarget(triggers, panel, 900, 70, null)).toEqual({
      kind: "away",
    });
  });

  it("closes over the bar beside the triggers", () => {
    expect(headerMenuHoverTarget(triggers, panel, 40, 30, "1982")).toEqual({
      kind: "away",
    });
  });

  it("closes below the panel", () => {
    expect(headerMenuHoverTarget(triggers, panel, 500, 480, "1982")).toEqual({
      kind: "away",
    });
  });

  it("ignores an empty panel box", () => {
    const closed: HeaderMenuRect = {
      left: 0,
      right: 0,
      top: 80,
      bottom: 80,
      width: 0,
      height: 0,
    };
    expect(headerMenuHoverTarget(triggers, closed, 500, 200, "1982")).toEqual({
      kind: "away",
    });
  });
});

describe("readHeaderMenuPanel", () => {
  it("reads the header viewport and ignores a panel in another menu", () => {
    document.body.innerHTML = `
      <nav id="bar">
        <ul><li><button data-headkit-menu="1982">Packages</button></li></ul>
        <div id="headkit-nav-panel-bar"></div>
      </nav>
      <nav id="facets">
        <div id="headkit-nav-panel-facets"></div>
      </nav>
    `;
    const nav = document.getElementById("bar");
    const panelNode = document.getElementById("headkit-nav-panel-bar");
    if (!nav || !panelNode) throw new Error("fixture missing");
    panelNode.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1440,
        top: 80,
        bottom: 400,
        width: 1440,
        height: 320,
        x: 0,
        y: 80,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(readHeaderMenuPanel(nav)).toEqual(panel);
  });
});

describe("readHeaderMenuTriggers", () => {
  it("reads header-list triggers and ignores a panel button with the same attribute", () => {
    document.body.innerHTML = `
      <nav id="bar">
        <ul>
          <li><button data-headkit-menu="1982">Photobooth Packages</button></li>
          <li><a href="/faq/">FAQ</a></li>
        </ul>
        <div class="viewport">
          <button data-headkit-menu="nope">Silver Package</button>
        </div>
      </nav>
    `;
    const nav = document.getElementById("bar");
    const trigger = nav?.querySelector("button");
    if (!nav || !trigger) throw new Error("fixture missing");
    trigger.getBoundingClientRect = () =>
      ({
        left: 40,
        right: 200,
        top: 20,
        bottom: 60,
        width: 160,
        height: 40,
        x: 40,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(readHeaderMenuTriggers(nav)).toEqual([
      {
        value: "1982",
        left: 40,
        right: 200,
        top: 20,
        bottom: 60,
        width: 160,
        height: 40,
      },
    ]);
  });
});
