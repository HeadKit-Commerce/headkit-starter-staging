// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SearchDrawer } from "@/components/headkit-ui/search-drawer";

/**
 * The header search used to paint whichever response came back last, and it
 * swapped an existing grid for skeletons as soon as the next query started.
 * A shopper then saw one set of cards, a blank, and a different set.
 */

const { pending } = vi.hoisted(() => ({
  pending: new Map<
    string,
    (products: Array<{ id: string; name: string; slug: string }>) => void
  >(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/search-actions", () => ({
  searchProducts: (q: string) =>
    new Promise<Array<{ id: string; name: string; slug: string }>>(
      (resolve) => {
        pending.set(q, resolve);
      },
    ),
}));

vi.mock("@/lib/catalog-display", () => ({
  expandCatalogProducts: (
    products: Array<{ id: string; name?: string; slug?: string }>,
  ) => products.map((product) => ({ ...product, colorwaySlug: null })),
}));

vi.mock("@/components/headkit-ui/catalog-display-provider", () => ({
  useCatalogDisplay: () => ({ showVariants: false }),
}));

vi.mock("@/components/branding/branding-icons-provider", () => ({
  useChromeIcons: () => ({
    Search: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
  }),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: () => null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: () => null,
  SheetDescription: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/headkit-ui/product-card", () => ({
  ProductCard: ({ product }: { product: { id: string; name?: string } }) => (
    <article data-product-id={product.id}>{product.name}</article>
  ),
}));

vi.mock("@/components/headkit-ui/skeletons/product-card-skeleton", () => ({
  ProductCardSkeleton: () => <div role="status">Loading results</div>,
}));

let container: HTMLDivElement;
let root: Root;

function mount(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SearchDrawer defaultOpen />);
  });
}

function setQuery(value: string): void {
  const input = container.querySelector("input");
  if (!input) throw new Error("search input missing");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

async function answer(query: string, name: string): Promise<void> {
  const resolve = pending.get(query);
  if (!resolve) throw new Error(`no in-flight search for ${query}`);
  pending.delete(query);
  await act(async () => {
    resolve([{ id: name, name, slug: name.toLowerCase() }]);
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  pending.clear();
  vi.useFakeTimers();
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("search drawer results", () => {
  it("keeps the cards on screen while the next query is in flight", async () => {
    setQuery("hel");
    await settleDebounce();
    await answer("hel", "Helmet One");
    expect(container.textContent).toContain("Helmet One");

    setQuery("helmet");
    await settleDebounce();
    expect(container.textContent).toContain("Helmet One");
    expect(container.textContent).not.toContain("Loading results");

    await answer("helmet", "Aero Helmet");
    expect(container.textContent).toContain("Aero Helmet");
    expect(container.textContent).not.toContain("Helmet One");
  });

  it("drops a late response for an earlier query", async () => {
    setQuery("hel");
    await settleDebounce();
    setQuery("helmet");
    await settleDebounce();
    await answer("hel", "Wrong Product");
    expect(container.textContent).not.toContain("Wrong Product");
    expect(container.textContent).toContain("Loading results");

    await answer("helmet", "Aero Helmet");
    expect(container.textContent).toContain("Aero Helmet");
    expect(container.textContent).not.toContain("Wrong Product");
    expect(container.textContent).not.toContain("Loading results");
  });

  it("does not restore results after the query is cleared", async () => {
    setQuery("hel");
    await settleDebounce();
    setQuery("");
    await settleDebounce();
    await answer("hel", "Helmet One");
    expect(container.textContent).not.toContain("Helmet One");
  });
});
