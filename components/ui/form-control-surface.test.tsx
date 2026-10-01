// @vitest-environment jsdom
/**
 * Guards the ONE form-control surface (`form-control-surface.ts`).
 *
 * WHAT THIS COVERS
 *   - the five shared controls RENDER the brand surface (border, focus ring,
 *     placeholder, invalid), read off the real DOM node rather than a constant;
 *   - the surface names no literal colour. `apps/starter` is the template every
 *     customer store is generated from, so a hex here would pin every store to
 *     one brand instead of letting each inherit `--color-primary` from its own
 *     dashboard branding;
 *   - no `dark:` variant survives on any of them. `apps/starter` declares no
 *     `@custom-variant dark`, so Tailwind v4 compiles those under
 *     `@media (prefers-color-scheme: dark)` — live for dark-mode visitors — and
 *     four of the five properties they touched would have beaten the branded
 *     base on source order. The surface module's header carries the measured
 *     byte offsets and the one exception (`border-primary`);
 *   - every surface that used to hand-roll an input now composes the shared
 *     one, at SOURCE level, so a re-inline fails here instead of on a store.
 *
 * WHAT IT CANNOT SEE, and these are the claims that matter most:
 *   no CSS is loaded and jsdom performs no layout, so nothing here resolves
 *   `var(--color-primary)`, paints a border, or can tell a 1px ring from a 2px
 *   one or a brand colour from a grey. That the resting edge is the store's
 *   primary, that focus thickens it to a 2px band, and that the result matches
 *   Stripe's fields at checkout are BROWSER measurements and live in the PR.
 *   It loads no stylesheet either, so it cannot see the cascade the `dark:`
 *   claim rests on — only that no such class is emitted any more.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Input } from "./input";
import { Textarea } from "./textarea";
import { Checkbox } from "./checkbox";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Select, SelectTrigger, SelectValue } from "./select";
import {
  FORM_CONTROL_BOOLEAN_SURFACE,
  FORM_CONTROL_SURFACE,
  FORM_CONTROL_SURFACE_FOCUS_WITHIN,
} from "./form-control-surface";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Radix's Checkbox measures itself through `useSize`, which jsdom has no
// implementation for. Nothing here asserts a size.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  NoopResizeObserver;

/**
 * Read a repo file by its path from `apps/starter`.
 *
 * Resolved against `process.cwd()`, which vitest sets to the package root for
 * both `bun run test` here and the turbo task in CI. Anchoring on the directory
 * (rather than on this file) is what keeps `FORMERLY_HAND_ROLLED` readable as
 * the inventory it is.
 */
const read = (file: string): string =>
  readFileSync(resolve(process.cwd(), file), "utf8");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Mount into a real jsdom tree — the repo's convention (no testing-library). */
function render(ui: React.ReactNode): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

/** Call sites that each used to carry their own input markup. */
const FORMERLY_HAND_ROLLED = [
  "components/checkout/steps/contact-form-step.tsx",
  "components/checkout/steps/billing-address-step.tsx",
  "components/checkout/steps/delivery-method-step.tsx",
  "app/account/page.tsx",
  "app/account/(private)/profile/page.tsx",
  "app/account/(private)/addresses/page.tsx",
  "app/account/(public)/forgot-password/page.tsx",
  "app/account/(public)/reset-password/page.tsx",
];

const SHARED_CONTROLS = [
  "components/ui/input.tsx",
  "components/ui/textarea.tsx",
  "components/ui/select.tsx",
  "components/ui/checkbox.tsx",
  "components/ui/radio-group.tsx",
];

const ALL_SURFACES = [
  FORM_CONTROL_SURFACE,
  FORM_CONTROL_SURFACE_FOCUS_WITHIN,
  FORM_CONTROL_BOOLEAN_SURFACE,
];

describe("the brand form-control surface", () => {
  it("states the brand edge, focus ring and placeholder in ONE place", () => {
    // The values, not just their presence: a surface that silently loses its
    // brand border still composes everywhere and still passes a presence test.
    for (const surface of [
      FORM_CONTROL_SURFACE,
      FORM_CONTROL_SURFACE_FOCUS_WITHIN,
    ]) {
      expect(surface).toContain("border-primary");
      expect(surface).toContain("ring-primary");
      expect(surface).toContain("ring-offset-0");
      expect(surface).toContain("placeholder:text-gray-700");
      expect(surface).toContain("aria-invalid:border-red-500");
    }
    expect(FORM_CONTROL_BOOLEAN_SURFACE).toContain("border-primary");
    expect(FORM_CONTROL_BOOLEAN_SURFACE).toContain(
      "data-[state=checked]:bg-primary",
    );
  });

  it("names no literal colour, in any surface or any of the five controls", () => {
    // The whole point is that these track the dashboard tokens Stripe is
    // already handed, so each generated store inherits its own brand.
    for (const surface of ALL_SURFACES) {
      expect(surface).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(surface).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/);
    }
    for (const path of SHARED_CONTROLS) {
      const code = stripComments(read(path));
      expect(code, `${path} must name no literal colour`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
    }
  });

  it("renders the brand edge on every text-entry control", () => {
    const container = render(
      <>
        <Input placeholder="in" />
        <Textarea placeholder="ta" />
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="sel" />
          </SelectTrigger>
        </Select>
      </>,
    );
    const nodes = [
      container.querySelector("input"),
      container.querySelector("textarea"),
      container.querySelector("button"),
    ];
    for (const node of nodes) {
      expect(node).not.toBeNull();
      const cls = node!.className;
      expect(cls).toContain("border-primary");
      expect(cls).toContain("ring-primary");
      expect(cls).toContain("placeholder:text-gray-700");
      // The pre-fix vocabulary, named so a partial revert is caught.
      expect(cls).not.toContain("border-neutral-200");
      expect(cls).not.toContain("ring-neutral-950");
      expect(cls).not.toContain("ring-offset-2");
    }
  });

  it("renders the brand edge on the boolean controls", () => {
    const container = render(
      <>
        <Checkbox />
        <RadioGroup>
          <RadioGroupItem value="a" />
        </RadioGroup>
      </>,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b.className).toContain("border-primary");
      expect(b.className).toContain("ring-primary");
      expect(b.className).not.toContain("ring-neutral-950");
    }
    // The checkbox fills with primary when checked; the radio must NOT, or the
    // filled circle swallows its own indicator dot.
    const [checkbox, radio] = buttons;
    expect(checkbox!.className).toContain("data-[state=checked]:bg-primary");
    expect(radio!.className).not.toContain("data-[state=checked]:bg-primary");
  });

  it("emits no `dark:` variant on any shared control", () => {
    for (const path of SHARED_CONTROLS) {
      expect(
        stripComments(read(path)),
        `${path} must emit no dark: variant`,
      ).not.toMatch(/dark:/);
    }
  });

  it("leaves no hand-rolled input at the surfaces that used to carry one", () => {
    for (const path of FORMERLY_HAND_ROLLED) {
      const source = read(path);
      expect(source, `${path} must use the shared Input`).toContain(
        'from "@/components/ui/input"',
      );
      // The two exact strings these files used to repeat.
      expect(source).not.toContain('className="border rounded-md p-2 w-full"');
      expect(source).not.toContain("focus:ring-2 focus:ring-primary");
    }
  });
});

/** Strip comments: the modules explain WHY the old vocabulary is gone. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
