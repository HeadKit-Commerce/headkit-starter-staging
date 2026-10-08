// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

function render(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(node);
  });
  return host;
}

function OpenMenu({ link }: { link: ReactNode }): React.JSX.Element {
  const [value, setValue] = useState<string | null>("shop");
  return (
    <NavigationMenu
      value={value}
      onValueChange={(next) => {
        setValue(next);
      }}
    >
      <NavigationMenuList>
        <NavigationMenuItem value="shop">
          <NavigationMenuTrigger>Shop</NavigationMenuTrigger>
          <NavigationMenuContent>{link}</NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

async function flush(): Promise<void> {
  await act(async () => {});
}

describe("navigation menu panel", () => {
  it("closes when a link inside the open panel is clicked", async () => {
    const host = render(
      <OpenMenu
        link={<NavigationMenuLink href="/sale">Sale</NavigationMenuLink>}
      />,
    );
    await flush();

    const link = host.querySelector<HTMLAnchorElement>('a[href="/sale"]');
    expect(link).not.toBeNull();

    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(host.querySelector('a[href="/sale"]')).toBeNull();
  });

  it("closes a mega-menu InstantLink without dropping its click", async () => {
    const onClick = vi.fn();
    const host = render(
      <OpenMenu
        link={
          <NavigationMenuLink
            render={<InstantLink href="/sale" onClick={onClick} />}
          >
            Sale
          </NavigationMenuLink>
        }
      />,
    );
    await flush();

    const link = host.querySelector<HTMLAnchorElement>('a[href="/sale"]');
    expect(link).not.toBeNull();

    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(host.querySelector('a[href="/sale"]')).toBeNull();
  });

  it("places the open panel inside the nav, flush with its left edge", async () => {
    const host = render(
      <OpenMenu
        link={<NavigationMenuLink href="/sale">Sale</NavigationMenuLink>}
      />,
    );
    await flush();

    const nav = host.querySelector("nav");
    const link = host.querySelector('a[href="/sale"]');
    expect(nav).not.toBeNull();
    expect(link).not.toBeNull();
    expect(nav?.contains(link ?? null)).toBe(true);

    const shell = nav?.querySelector(":scope > div");
    expect(shell?.className).toContain("absolute");
    expect(shell?.className).toContain("left-0");
    expect(shell?.className).toContain("top-full");
    // The shell follows the content. `w-full` here clips `w-screen` back to
    // the nav, which is the width that did not move.
    expect(shell?.className).toContain("w-max");
    expect(shell?.className).not.toContain("w-full");

    const content = link?.closest("div");
    expect(content?.className).toContain("w-screen");
  });

  it("names the open panel from the trigger's aria-controls", async () => {
    const host = render(
      <OpenMenu
        link={<NavigationMenuLink href="/sale">Sale</NavigationMenuLink>}
      />,
    );
    await flush();

    const trigger = host.querySelector("button");
    const panelId = trigger?.getAttribute("aria-controls");
    const link = host.querySelector('a[href="/sale"]');
    expect(panelId).toBeTruthy();
    // The e2e looks the panel up as `#${aria-controls}`. The id has to be a
    // CSS identifier, and that node has to contain the open links.
    expect(panelId).toMatch(/^headkit-nav-panel-[A-Za-z0-9_-]+$/);
    expect(link).not.toBeNull();
    expect(
      panelId ? host.querySelector(`#${panelId} a[href="/sale"]`) : null,
    ).toBe(link);
  });
});
