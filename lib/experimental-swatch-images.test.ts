import { afterEach, describe, expect, it, vi } from "vitest";
import { experimentalSwatchImagesEnabled } from "./experimental-swatch-images";

describe("experimentalSwatchImagesEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays off when the variable is unset or empty", () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "");
    expect(experimentalSwatchImagesEnabled()).toBe(false);
    delete process.env.HEADKIT_EXPERIMENTAL_SWATCH_IMAGES;
    expect(experimentalSwatchImagesEnabled()).toBe(false);
  });

  it.each(["true", "TRUE", "1", "on", "yes", "  Yes  "])(
    "turns on for %j",
    (value) => {
      vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", value);
      expect(experimentalSwatchImagesEnabled()).toBe(true);
    },
  );

  it.each(["false", "0", "off", "enabled", "ture"])(
    "stays off for %j",
    (value) => {
      vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", value);
      expect(experimentalSwatchImagesEnabled()).toBe(false);
    },
  );
});
