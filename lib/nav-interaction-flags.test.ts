import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFlagOptedIn,
  navMouseDownEnabled,
} from "@/lib/nav-interaction-flags";

describe("isFlagOptedIn", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["on", true],
    ["yes", true],
    ["TRUE", true],
    [undefined, false],
    ["", false],
    ["false", false],
    ["ture", false],
  ] as const)("raw %j -> %s", (raw, expected) => {
    expect(isFlagOptedIn(raw)).toBe(expected);
  });
});

describe("navMouseDownEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults off", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", undefined);
    expect(navMouseDownEnabled()).toBe(false);
  });

  it("turns on for an explicit on value", () => {
    vi.stubEnv("NEXT_PUBLIC_NAV_MOUSEDOWN", "true");
    expect(navMouseDownEnabled()).toBe(true);
  });
});
