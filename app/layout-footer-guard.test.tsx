import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * The root layout's last-resort guard around the footer read.
 *
 * `getFooterMenus` degrades a failed MENU read itself, inside its cache scope
 * (`components/headkit-ui/navigation-wrapper.test.ts` holds that). What can
 * still throw out of it is a read it awaits and does not own — the category
 * tree, branding. The layout must then render an empty footer for that one
 * request instead of failing every page, log once, and still hand a
 * `BrandingUnavailableError` to its own branding fallback.
 *
 * This proves the layout's CATCH. It cannot prove a build survives: a throw
 * inside a `"use cache"` scope fails the prerender whether or not a caller
 * catches it, which is why the real fix lives inside `getFooterMenus`.
 */

// `app/layout.tsx` pulls in `lib/env`, whose Zod parse runs at module scope.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children?: ReactNode;
  }): ReactElement => <a href={href}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: (): null => null }));
vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    href,
    children,
  }: {
    href: string;
    children?: ReactNode;
  }): ReactElement => <a href={href}>{children}</a>,
}));

// The layout's own data reads and its sibling components, stubbed at module
// scope so every test that imports `./layout` stands alone — registering these
// inside one test made the next one depend on the module cache it left behind.
// Only the reads are stubbed; the layout body itself runs for real.
vi.mock("@/lib/branding", () => ({
  getBranding: (): Promise<unknown> =>
    Promise.resolve({
      branding: {
        iconUrl: null,
        iconLibrary: "lucide",
        cornerStyle: "soft",
        showVariants: false,
        showSwatches: false,
        imageRollover: false,
        defaultCollectionSort: "",
      },
      storeSettings: { name: "A Store", domain: "shop.example.com" },
      seoSettings: { description: "", allowIndexing: true },
    }),
  getBrandingAssets: (): Promise<unknown> => Promise.resolve({ iconUrl: null }),
  fallbackBrandingBundle: (): unknown => ({
    branding: {
      iconUrl: null,
      iconLibrary: "lucide",
      cornerStyle: "soft",
      showVariants: false,
      showSwatches: false,
      imageRollover: false,
      defaultCollectionSort: "",
    },
    storeSettings: { name: "A Store", domain: "shop.example.com" },
    seoSettings: { description: "", allowIndexing: true },
  }),
}));
const { getFooterMenus, logError } = vi.hoisted(() => ({
  getFooterMenus: vi.fn<() => Promise<unknown[]>>(),
  logError: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}));

vi.mock("@/components/headkit-ui/navigation-wrapper", () => ({
  NavigationWrapper: (): null => null,
  fallbackNavigation: (): null => null,
  getFooterMenus: (): Promise<unknown[]> => getFooterMenus(),
}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logger: { info: vi.fn(), error: logError },
}));
vi.mock("@/lib/email-marketing", () => ({
  getEmailMarketingStatus: (): Promise<unknown> =>
    Promise.resolve({ enabled: false, provider: "", publicApiKey: "" }),
}));
vi.mock("@/lib/brand-fonts", () => ({
  resolveBrandFonts: (): Promise<unknown> =>
    Promise.resolve({
      cssVars: "",
      fontFaceCss: "",
      variableClassNames: "",
      usesFontsourceCdn: false,
    }),
}));

import { Footer } from "@/components/headkit-ui/footer";
import { BrandingUnavailableError } from "@/lib/branding-cache-policy";

function footerMenusOf(node: ReactNode): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = footerMenusOf(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{
    children?: ReactNode;
    menus?: unknown;
  }>;
  if (element.type === Footer) return element.props.menus ?? [];
  return footerMenusOf(element.props.children);
}

beforeEach(() => {
  getFooterMenus.mockReset();
  logError.mockReset();
});

describe("RootLayout — footer read guard", () => {
  it("passes the footer menus through when the read succeeds", async () => {
    const menus = [{ location: "FOOTER", name: "Shop", items: [] }];
    getFooterMenus.mockResolvedValue(menus);
    const { default: RootLayout } = await import("./layout");
    const tree = await RootLayout({ children: null });
    expect(footerMenusOf(tree)).toEqual(menus);
    expect(logError).not.toHaveBeenCalled();
  });

  it("renders an empty footer, logging once, when the read throws", async () => {
    getFooterMenus.mockRejectedValue(new Error("category tree down"));
    const { default: RootLayout } = await import("./layout");
    const tree = await RootLayout({ children: null });
    expect(footerMenusOf(tree)).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toBe("menu_read_failed");
    expect(logError.mock.calls[0]?.[1]).toMatchObject({
      caller: "RootLayout",
      action: "fallback-this-request",
    });
  });

  it("leaves BrandingUnavailableError to the layout's own branding fallback", async () => {
    getFooterMenus.mockRejectedValue(new BrandingUnavailableError());
    const { default: RootLayout } = await import("./layout");
    const tree = await RootLayout({ children: null });
    expect(footerMenusOf(tree)).toEqual([]);
    expect(logError).not.toHaveBeenCalled();
  });
});
