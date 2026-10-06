import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MegaMenu,
  MobileMenuBranch,
  MobileMenuSection,
  NavigationBar,
  type NavMenuItem,
} from "@/components/headkit-ui/navigation-bar";
import { NavigationMenu } from "@/components/ui/navigation-menu";
import { normalizeMenuTree } from "@/lib/menu-columns";
import {
  BIKES,
  CLOTHING_AND_GEAR,
  column,
  EQUIPMENT,
  link,
} from "@/lib/__fixtures__/bikesociety-nav";

/**
 * Desktop nav: every WordPress parent that HAS children must render a dropdown
 * trigger — a <button> that only opens the panel, never a link that navigates.
 *
 * Shaped on Pebblr's real PRIMARY menu (headkit/v2/menus/location/primary):
 * four parents with children, of which "Events" is authored as a `#` Custom
 * Link, plus one childless leaf. That store shipped Events as a flat top-level
 * link while its three siblings opened correctly — the asymmetry this locks.
 *
 * Radix keeps `NavigationMenuContent` unmounted until the menu opens, so the
 * child links themselves are absent from server markup for working and broken
 * parents alike. The trigger is therefore the only server-observable proof that
 * the subtree was wired, and it is the exact signal the live-site diagnosis
 * used: the broken parent carried neither `data-state` nor
 * `data-radix-collection-item`, both siblings carried both.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

vi.mock("@/components/headkit-ui/header-actions", () => ({
  HeaderActions: () => <div data-stub="header-actions" />,
  MobileHeaderActions: () => <div data-stub="mobile-header-actions" />,
}));

vi.mock("@/components/headkit-ui/cart-trigger-button", () => ({
  CartTriggerButton: () => <button type="button" data-stub="cart" />,
}));

const leaf = (id: string, label: string, uri: string): NavMenuItem => ({
  id,
  label,
  uri,
  description: null,
  cssClasses: [],
  children: [],
});

const PEBBLR_PRIMARY: NavMenuItem[] = [
  {
    ...leaf("1982", "Photobooth Packages", "/packages/"),
    children: [leaf("2557", "Silver Package", "/silver-package/")],
  },
  {
    ...leaf("2594", "Booths", "/booths/"),
    children: [leaf("2585", "Open Photo Booth", "/open-photo-booth/")],
  },
  {
    // The regression: a dropdown-only parent authored as a `#` Custom Link.
    ...leaf("1814", "Events", "#"),
    children: [
      leaf("1956", "Birthdays", "/birthdays/"),
      leaf("1969", "Graduations", "/graduations/"),
    ],
  },
  {
    ...leaf("3569", "Customise", "/"),
    children: [leaf("3570", "Backdrop Designs", "/backdrop-designs/")],
  },
  leaf("1874", "FAQ", "/faq/"),
];

function renderNav(): string {
  return renderToStaticMarkup(
    <NavigationBar
      primaryMenuItems={PEBBLR_PRIMARY}
      logo={<span>Pebblr</span>}
    />,
  );
}

/** The `<li>` wrapping one desktop root item, by visible label. */
function desktopItem(html: string, label: string): string {
  const items = html.match(/<li class="hidden xl:flex">[\s\S]*?<\/li>/g) ?? [];
  const found = items.find((item) => item.includes(`>${label}<`));
  if (!found) {
    throw new Error(`no desktop nav item rendered for ${label}`);
  }
  return found;
}

/**
 * The opening tag of the interactive element for one desktop root item —
 * `<button>` for a dropdown-only parent, `<a>` for anything navigable.
 */
function rootControl(html: string, label: string): string {
  const item = desktopItem(html, label);
  const tag = item.match(/<(?:button|a)\b[^>]*>/);
  if (!tag) {
    throw new Error(`no button or anchor rendered for ${label}`);
  }
  return tag[0];
}

describe("NavigationBar desktop dropdowns", () => {
  it("wires a dropdown trigger for the '#' parent without an href", () => {
    const events = rootControl(renderNav(), "Events");

    expect(events).toMatch(/^<button\b/);
    expect(events).toContain('data-state="closed"');
    expect(events).toContain("data-radix-collection-item");
    expect(events).toContain('aria-expanded="false"');
    // No href means the browser has no fragment to follow: clicking "Events"
    // opens the menu without pushing `/#` or scrolling the page to the top.
    expect(events).not.toContain("href");
  });

  it("makes a NAVIGABLE parent a button too, so a click cannot navigate", () => {
    // The regression this locks: Bike Society's EQUIPMENT and CLOTHING & GEAR
    // are Custom Links whose URI collapses to `/`, so the anchor branch sent a
    // shopper to the home page on the way to the panel.
    const packages = rootControl(renderNav(), "Photobooth Packages");

    expect(packages).toMatch(/^<button\b/);
    expect(packages).not.toContain("href");
    expect(packages).toContain('data-state="closed"');
    expect(packages).toContain("data-radix-collection-item");
    expect(packages).toContain('aria-expanded="false"');
  });

  it("wires a trigger for every parent with children, and none without", () => {
    const html = renderNav();
    const hasTrigger = (label: string): boolean =>
      rootControl(html, label).includes('data-state="closed"');

    // All four WordPress parents that carry children, across both element
    // types: "Events" is a `#` button, the other three are anchors.
    expect(hasTrigger("Photobooth Packages")).toBe(true);
    expect(hasTrigger("Booths")).toBe(true);
    expect(hasTrigger("Events")).toBe(true);
    expect(hasTrigger("Customise")).toBe(true);
    // The childless leaf stays a plain link.
    expect(hasTrigger("FAQ")).toBe(false);
  });
});

/**
 * The panel itself. Radix keeps `NavigationMenuContent` unmounted until the
 * menu opens, so these render `MegaMenu` directly — the same component the
 * content wraps.
 */
describe("MegaMenu panel", () => {
  // `NavigationMenuLink` reads the root Radix context, so the panel is
  // rendered inside a bare `NavigationMenu` exactly as the open menu does.
  const panel = (
    item: NavMenuItem,
    viewAll?: { href: string; label: string },
  ): string =>
    renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu items={item.children} {...(viewAll ? { viewAll } : {})} />
      </NavigationMenu>,
    );

  it("renders no WordPress column-container label", () => {
    const html = panel(EQUIPMENT) + panel(CLOTHING_AND_GEAR);

    expect(html).not.toMatch(/Column\s*\d/i);
  });

  it("renders one column per container, and its children as the headings", () => {
    const html = panel(EQUIPMENT);
    const columns = html.match(/<li class="flex flex-col gap-5">/g) ?? [];

    expect(columns).toHaveLength(6);
    expect(html).toContain(">Bags &amp; Storage<");
    expect(html).toContain(">Components<");
    expect(html).toContain(">Tyres<");
  });

  it("renders no empty column", () => {
    // A container left with no children by hide-empty must vanish entirely.
    const emptied: NavMenuItem = {
      ...CLOTHING_AND_GEAR,
      children: CLOTHING_AND_GEAR.children.map((child, i) =>
        i === 3 || i === 4 ? { ...child, children: [] } : child,
      ),
    };
    const html = panel(emptied);

    expect(html.match(/<li class="flex flex-col gap-5">/g) ?? []).toHaveLength(
      4,
    );
    expect(html).not.toContain('<li class="flex flex-col gap-5"></li>');
  });

  it("keeps a container-free panel one column per child", () => {
    const html = panel(BIKES);

    expect(html.match(/<li class="flex flex-col gap-5">/g) ?? []).toHaveLength(
      5,
    );
    expect(html).toContain(">Electric Bikes<");
  });

  it("moves a parent's own destination into the panel as a View all link", () => {
    const html = panel(BIKES, { href: "/collections/bikes", label: "BIKES" });

    expect(html).toContain('href="/collections/bikes"');
    expect(html).toContain("View all BIKES");
  });

  /**
   * EQUIPMENT's "Column 3" is exactly this shape on Bike Society: twelve
   * second-level items, none with a sub-menu (`reference-megamenu.png`). None
   * of them may carry the heading treatment (bold/uppercase/teal) — they must
   * read as ordinary links, like BAGS & STORAGE's children in Column 1.
   */
  it("renders a childless second-level item as an ordinary link, not a heading", () => {
    const html = panel(EQUIPMENT);
    const link = /<a[^>]*>Electronic Components<\/a>/.exec(html)?.[0];

    expect(link).toBeDefined();
    expect(link).not.toContain("font-semibold");
    expect(link).not.toContain("uppercase");
    expect(link).toContain("text-primary/70");
  });

  it("keeps the heading treatment for a second-level item that has children", () => {
    const html = panel(EQUIPMENT);
    const link = /<a[^>]*>Bags &amp; Storage<\/a>/.exec(html)?.[0];

    expect(link).toBeDefined();
    expect(link).toContain("font-semibold");
    expect(link).toContain("uppercase");
  });

  /**
   * The class string alone doesn't prove the rhythm: a childless item styled
   * like a link but still spaced by the column's `gap-5` (one per `<div>`)
   * reads exactly as bold-stripped headings, which was the captain's
   * follow-up complaint. Consecutive childless items must share ONE `gap-1`
   * list — the same wrapper their heading siblings' own children use — not
   * sit each in their own `gap-5` slot.
   */
  it("groups a run of consecutive childless items into one gap-1 list", () => {
    // Column 3 on Bike Society: twelve childless items in a row, no heading.
    const html = panel(EQUIPMENT);
    const gap1Lists =
      html.match(/<ul class="flex flex-col gap-1">[\s\S]*?<\/ul>/g) ?? [];
    const columnThreeList = gap1Lists.find((block) =>
      block.includes("Electronic Components"),
    );

    expect(columnThreeList).toBeDefined();
    // All twelve share the same gap-1 wrapper — none reverts to gap-5.
    for (const label of [
      "Electronic Components",
      "Fenders",
      "Frame Parts",
      "Groupset",
      "Handlebars",
      "Handlebar Stems",
      "Headset",
      "Kickstand",
      "Pedals",
      "Seat Post",
      "Shifters",
      "Suspension",
    ]) {
      expect(columnThreeList).toContain(`>${label}<`);
    }
  });

  it("mixes a heading (own gap-1 sub-list) and a run of bare links (own gap-1 group) in one column, still gap-5 apart", () => {
    // Column 1 on Bike Society mixes both shapes; this fixture makes it
    // explicit rather than relying on which column happens to carry which.
    const mixedColumn = column("Mixed", [
      link("Heading With Kids", [link("Kid A"), link("Kid B")]),
      link("Bare One"),
      link("Bare Two"),
      link("Bare Three"),
    ]);
    const html = renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu items={[mixedColumn]} />
      </NavigationMenu>,
    );

    // Exactly one column, so exactly one gap-5 group boundary.
    expect(html.match(/class="flex flex-col gap-5"/g)).toHaveLength(1);

    // Two gap-1 lists: the heading's own children, and the bare-link run.
    const gap1Lists =
      html.match(/<ul class="flex flex-col gap-1">[\s\S]*?<\/ul>/g) ?? [];
    expect(gap1Lists).toHaveLength(2);

    const bareGroup = gap1Lists.find((block) => block.includes("Bare One"));
    expect(bareGroup).toBeDefined();
    expect(bareGroup).toContain("Bare Two");
    expect(bareGroup).toContain("Bare Three");
    // The bare-link group and the heading's own children never merge.
    expect(bareGroup).not.toContain("Heading With Kids");
    expect(bareGroup).not.toContain("Kid A");

    const headingKidsGroup = gap1Lists.find((block) => block.includes("Kid A"));
    expect(headingKidsGroup).toBeDefined();
    expect(headingKidsGroup).toContain("Kid B");
    expect(headingKidsGroup).not.toContain("Bare One");

    // The heading itself keeps the heading treatment; the bare links don't.
    const headingLink = /<a[^>]*>Heading With Kids<\/a>/.exec(html)?.[0];
    expect(headingLink).toContain("font-semibold");
    expect(headingLink).toContain("mb-2");
    const bareLink = /<a[^>]*>Bare One<\/a>/.exec(html)?.[0];
    expect(bareLink).not.toContain("font-semibold");
    expect(bareLink).not.toContain("mb-2");
    expect(bareLink).toContain("py-0.5");
  });
});

/**
 * The mobile sheet is flat, so a column container has no meaning there: it is
 * spliced away and its children take its place.
 *
 * A closed Radix collapsible does not render its content, so what is observable
 * server-side is the CHOICE the normalized children drive — a collapsible
 * <button> for an item that really has links under it, a plain <a> for one
 * whose only child was an emptied container.
 */
describe("MobileMenuSection", () => {
  const sheet = (items: NavMenuItem[]): string =>
    renderToStaticMarkup(
      <MobileMenuSection items={items} highlightedLinks={[]} />,
    );

  it("never renders a container label as a row", () => {
    expect(sheet([EQUIPMENT, CLOTHING_AND_GEAR])).not.toMatch(/Column\s*\d/i);
  });

  it("still opens a section whose links only exist inside containers", () => {
    // EQUIPMENT's children are SIX containers and nothing else. Before the
    // splice the sheet saw six rows named "Column N"; after it, one expandable
    // EQUIPMENT carrying the real categories.
    const html = sheet([EQUIPMENT]);

    expect(html).toContain("<button");
    expect(html).toContain(">EQUIPMENT<");
  });

  it("degrades a parent whose containers are all empty to a plain link", () => {
    const hollow: NavMenuItem = {
      ...EQUIPMENT,
      children: EQUIPMENT.children.map((child) => ({ ...child, children: [] })),
    };
    const html = sheet([hollow]);

    expect(html).not.toContain("<button");
    expect(html).toContain('href="/collections/equipment"');
  });
});

/**
 * The fourth level. Bike Society's menu is `EQUIPMENT → column → category →
 * subcategory`, and `NavigationMenuFields` now selects all four, so the
 * subcategories must reach both surfaces.
 */
describe("fourth menu level", () => {
  it("renders subcategory links under their category heading in the panel", () => {
    const html = renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu items={EQUIPMENT.children} />
      </NavigationMenu>,
    );

    // The container spends level 2, so the panel's heading is level 3 and the
    // links under it are the level-4 subcategories the old query dropped.
    expect(html).toContain(">Bags &amp; Storage<");
    expect(html).toContain(">Backpacks<");
    expect(html).toContain(">Travel Bags<");
  });

  it("indents a fourth level that sits under a CONTAINER-FREE parent", () => {
    // No container, so the four levels land one deeper in the panel: column
    // heading, sub-link, and a sub-sub-list beneath it.
    const html = renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu
          items={[
            link("Electric Bikes", [
              link("E-Bikes Mountain", [link("Full Suspension")]),
            ]),
          ]}
        />
      </NavigationMenu>,
    );

    expect(html).toContain(">Full Suspension<");
    expect(html).toContain('<ul class="flex flex-col gap-1 pl-3">');
  });

  it("renders every subcategory the fixture carries", () => {
    const html = renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu items={CLOTHING_AND_GEAR.children} />
      </NavigationMenu>,
    );

    for (const label of [
      "Base Layer",
      "Sunglasses",
      "Cold Weather",
      "Kids &amp; Youth",
      "Hydration",
      "Lakers Triathlon Club",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("carries the fourth level into the mobile sheet", () => {
    const bags = normalizeMenuTree(EQUIPMENT.children)[0]!;
    const html = renderToStaticMarkup(
      <MobileMenuBranch item={bags} depth={0} />,
    );

    expect(html).toContain(">Bags &amp; Storage<");
    expect(html).toContain(">Backpacks<");
    expect(html).toContain('<div class="flex flex-col gap-1 pl-3">');
  });

  /**
   * The mobile accordion (`MobileMenuBranch`) already branches on `hasChildren`
   * rather than depth alone, so a childless second-level row never got the
   * bold/uppercase heading treatment to begin with — unlike the desktop panel.
   * This locks that existing, correct behaviour rather than changing it.
   */
  it("renders a childless second-level row as a plain link on the mobile sheet", () => {
    const electronicComponents = normalizeMenuTree(EQUIPMENT.children)[3]!;
    expect(electronicComponents.label).toBe("Electronic Components");
    expect(electronicComponents.children).toHaveLength(0);

    const html = renderToStaticMarkup(
      <MobileMenuBranch item={electronicComponents} depth={0} />,
    );

    expect(html).toContain(">Electronic Components<");
    expect(html).not.toContain("font-medium");
  });

  it("stops where the menu stops — a three-level menu renders no sub-list", () => {
    const threeDeep: NavMenuItem[] = BIKES.children.map((child) => ({
      ...child,
      children: child.children.map((sub) => ({ ...sub, children: [] })),
    }));
    const html = renderToStaticMarkup(
      <NavigationMenu>
        <MegaMenu items={threeDeep} />
      </NavigationMenu>,
    );

    expect(html).toContain(">Electric Bikes<");
    expect(html).toContain(">E-Bikes Mountain<");
    expect(html).not.toContain('<ul class="flex flex-col gap-1 pl-3">');
  });
});
