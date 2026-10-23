import { afterEach, describe, expect, it, vi } from "vitest";
import { serverActionsAllowedOrigins } from "./server-actions-origins";

/**
 * A Server Action POST replayed across an apex <-> www edge redirect keeps the
 * other host's `Origin`, which Next refuses unless that host is allow-listed.
 * The allowlist is derived from `NEXT_PUBLIC_FRONTEND_URL`, never literal.
 */
describe("serverActionsAllowedOrigins", () => {
  it("allows the apex when the store is served on www", () => {
    expect(serverActionsAllowedOrigins("https://www.shop.example")).toEqual([
      "www.shop.example",
      "shop.example",
    ]);
  });

  it("allows www when the store is served on the apex", () => {
    expect(serverActionsAllowedOrigins("https://shop.example/")).toEqual([
      "shop.example",
      "www.shop.example",
    ]);
  });

  it("accepts a bare host and normalises case", () => {
    expect(serverActionsAllowedOrigins("WWW.Shop.Example")).toEqual([
      "www.shop.example",
      "shop.example",
    ]);
  });

  it("keeps a non-default port on both hosts", () => {
    expect(serverActionsAllowedOrigins("http://shop.example:8443")).toEqual([
      "shop.example:8443",
      "www.shop.example:8443",
    ]);
  });

  it("never strips www down to a bare TLD", () => {
    expect(serverActionsAllowedOrigins("https://www.com")).toEqual(["www.com"]);
  });

  it("adds no twin for localhost or an IP", () => {
    expect(serverActionsAllowedOrigins("http://localhost:3000")).toEqual([
      "localhost:3000",
    ]);
    expect(serverActionsAllowedOrigins("http://127.0.0.1:3000")).toEqual([
      "127.0.0.1:3000",
    ]);
  });

  it("returns undefined for unset or unusable input, keeping Next's default", () => {
    expect(serverActionsAllowedOrigins(undefined)).toBeUndefined();
    expect(serverActionsAllowedOrigins("")).toBeUndefined();
    expect(serverActionsAllowedOrigins("   ")).toBeUndefined();
  });
});

describe("next.config wires it from NEXT_PUBLIC_FRONTEND_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sets experimental.serverActions.allowedOrigins from the env", async () => {
    vi.stubEnv("NEXT_PUBLIC_FRONTEND_URL", "https://www.store.example");
    const { default: config } = await import("../next.config");
    expect(config.experimental?.serverActions?.allowedOrigins).toEqual([
      "www.store.example",
      "store.example",
    ]);
  });

  it("sets no serverActions block when the env is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_FRONTEND_URL", "");
    const { default: config } = await import("../next.config");
    expect(config.experimental?.serverActions).toBeUndefined();
  });
});
