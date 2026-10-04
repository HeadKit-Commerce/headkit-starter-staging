import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
}));

import { fetchSwatchImages } from "./swatch-image-action";
import { loadSwatchImageMap } from "./swatch-visual";

const BLACK = "https://commerce.example/wp-content/uploads/black.png";

function product(attributeId: string) {
  return {
    image: {
      src: "https://commerce.example/wp-content/uploads/chair.jpg",
    },
    attributes: [
      {
        id: attributeId,
        slug: "pa_color",
        type: "wc-visual",
        fullOptions: [
          { slug: "black", swatchColor: "#000000", swatchImage: null },
        ],
      },
    ],
  };
}

describe("loadSwatchImageMap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not call WordPress when the flag is off", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not fetch"));
    await expect(loadSwatchImageMap([product("9")])).resolves.toEqual({
      images: {},
      covered: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call WordPress for an unrecognised flag value", async () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "enabled");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not fetch"));
    await expect(loadSwatchImageMap([product("11")])).resolves.toEqual({
      images: {},
      covered: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams an image term when the flag is on without throwing on a 429", async () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "true");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 429 }),
    );
    await expect(loadSwatchImageMap([product("12")])).resolves.toEqual({
      images: {},
      covered: { "12:black": true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "__experimental_visual=true",
    );
  });

  it("maps a term photo onto the option when the flag is on", async () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "on");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            slug: "black",
            __experimentalVisual: { type: "image", value: BLACK },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(loadSwatchImageMap([product("13")])).resolves.toEqual({
      images: { "13:black": BLACK },
      covered: { "13:black": true },
    });
  });

  it("ignores a Shopify-shaped id and a non-WordPress image host", async () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "yes");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not fetch"));
    await expect(
      loadSwatchImageMap([
        {
          image: { src: "https://cdn.shopify.com/s/files/chair.jpg" },
          attributes: [
            {
              id: "gid://shopify/ProductOption/1",
              slug: "color",
              type: "color",
              fullOptions: [{ slug: "black", swatchImage: null }],
            },
          ],
        },
      ]),
    ).resolves.toEqual({ images: {}, covered: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchSwatchImages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns nothing when the flag is off", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not fetch"));
    await expect(
      fetchSwatchImages("https://commerce.example", "9"),
    ).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric attribute id when the flag is on", async () => {
    vi.stubEnv("HEADKIT_EXPERIMENTAL_SWATCH_IMAGES", "true");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not fetch"));
    await expect(
      fetchSwatchImages("https://commerce.example", "pa_color"),
    ).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
