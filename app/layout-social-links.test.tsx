import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * `app/layout.tsx` is a TEMPLATE file: every storefront built from this starter
 * ships it verbatim, and a template sync replaces a store's copy wholesale.
 *
 * It used to hard-code HeadKit's own Instagram, Discord, GitHub, LinkedIn and
 * YouTube into the `socialLinks` prop, so every merchant's footer advertised
 * the vendor's community accounts. One store had forked those lines to its own
 * two accounts, with a warning comment saying the fork would be lost at the
 * next sync; it was, and the sync republished the vendor's five on a live
 * customer storefront.
 *
 * The guarantee is a CHAIN, and both links are asserted here by executing the
 * real modules rather than reading their source:
 *
 *   1. `Footer` gates its whole Connect block on `hasSocialLinks`, so with no
 *      links the block is ABSENT from the rendered markup, not empty — proved
 *      by rendering it both ways.
 *   2. `RootLayout` supplies no links — proved by invoking it and inspecting
 *      the `<Footer>` element it actually returns.
 *
 * Either half alone passes the bug: a footer that renders an empty Connect
 * section satisfies (2), and a layout that hard-codes the vendor's accounts
 * satisfies (1).
 *
 * The durable answer would be a per-store platform field, and whether to build
 * one is an OPEN DECISION — `store-social-links-platform-field` is a name to
 * hold it by, NOT a ticket id, and no ticket exists. It would span the Mongo
 * store document, the dashboard-api schema and resolver, the dashboard form,
 * `packages/sdk` codegen and `app/layout.tsx` reading it. Until that is decided,
 * this is the useful half: the worst a future sync can do is drop a store's own
 * links, never publish someone else's.
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
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }): ReactElement => (
    <img src={src} alt={alt} />
  ),
}));
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
vi.mock("@/components/headkit-ui/navigation-wrapper", () => ({
  NavigationWrapper: (): null => null,
  fallbackNavigation: (): null => null,
  getFooterMenus: (): Promise<unknown[]> => Promise.resolve([]),
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

/** A merchant's own accounts — what a store SHOULD be able to publish. */
const MERCHANT_LINKS = {
  instagram: "https://instagram.com/a-real-merchant",
  facebook: "https://facebook.com/a-real-merchant",
} as const;

/**
 * Accounts belonging to the template's vendor, not to any merchant. Matched
 * against RENDERED markup, so a mention in a comment or a doc block cannot
 * trip it — only a link a shopper would actually see.
 */
const VENDOR_ACCOUNTS = [
  "headkit-commerce",
  "headkitcommerce",
  "discord.gg",
] as const;

describe("the footer Connect block is gated on real social links", () => {
  it("renders no Connect block when no social links are supplied", () => {
    const html = renderToStaticMarkup(<Footer siteName="A Store" />);

    expect(
      html,
      `Footer must omit the Connect block entirely when it gets no ` +
        `socialLinks — an empty section still advertises a heading with ` +
        `nothing under it.`,
    ).not.toContain("headkit-footer-connect");
    expect(html).not.toContain(">Connect<");
  });

  it("renders no Connect block when every supplied link is empty", () => {
    const html = renderToStaticMarkup(
      <Footer siteName="A Store" socialLinks={{ instagram: "", github: "" }} />,
    );

    expect(
      html,
      `A socialLinks object whose values are all empty is the same as none: ` +
        `the block must stay absent rather than render an empty icon row.`,
    ).not.toContain("headkit-footer-connect");
  });

  it("renders the Connect block for a store that supplies its own links", () => {
    const html = renderToStaticMarkup(
      <Footer siteName="A Store" socialLinks={MERCHANT_LINKS} />,
    );

    expect(
      html,
      `A store that passes its own accounts must still get the Connect ` +
        `block: the fix removes the VENDOR's links, not the capability.`,
    ).toContain("headkit-footer-connect");
    expect(html).toContain(MERCHANT_LINKS.instagram);
    expect(html).toContain(MERCHANT_LINKS.facebook);
  });
});

describe("the storefront template supplies no social links of its own", () => {
  /**
   * Walk the element tree `RootLayout` returned and hand back the props of the
   * `<Footer>` it rendered. The layout is invoked for real — only its data
   * reads and its sibling components are stubbed — so this asserts what the
   * template PASSES, not what its source says.
   */
  function findFooterProps(
    node: ReactNode,
  ): Record<string, unknown> | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findFooterProps(child);
        if (found) return found;
      }
      return undefined;
    }
    if (!isValidElement(node)) return undefined;
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.type === Footer) {
      return element.props as Record<string, unknown>;
    }
    return findFooterProps(element.props.children);
  }

  it("app/layout.tsx passes no social links to <Footer>", async () => {
    const { default: RootLayout } = await import("./layout");
    const tree = await RootLayout({ children: null });
    const footerProps = findFooterProps(tree);

    expect(
      footerProps,
      "app/layout.tsx must render <Footer> — this test cannot prove anything otherwise.",
    ).toBeDefined();
    expect(
      footerProps?.socialLinks,
      `app/layout.tsx must supply no social links to <Footer>: whatever it ` +
        `passes is the same for EVERY store on this template, so a literal ` +
        `here publishes the vendor's accounts in every merchant's footer. ` +
        `Footer gates the Connect block on hasSocialLinks, so with the prop ` +
        `absent the block does not render at all. A store adds its own by ` +
        `forking this line until the per-store platform field exists.`,
    ).toBeUndefined();
  });

  it("the template's own footer markup carries no vendor account link", async () => {
    const { default: RootLayout } = await import("./layout");
    const footerProps = findFooterProps(await RootLayout({ children: null }));
    const html = renderToStaticMarkup(
      <Footer {...(footerProps as Record<string, never>)} />,
    );

    const offending = VENDOR_ACCOUNTS.filter((needle) => html.includes(needle));
    expect(
      offending,
      `the footer this template renders links the vendor's own accounts ` +
        `(${offending.join(", ")}). A template file is shipped to every ` +
        `store, so a literal there reaches every merchant's footer.`,
    ).toEqual([]);
  });
});
