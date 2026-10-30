// @vitest-environment jsdom
/**
 * The Contact step's header-band control: "Have an account? Sign in" for a
 * guest, "Checkout as guest" while the panel is up, and NOTHING for a signed-in
 * shopper (there is no sign-out control — see the component header).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { ContactAccountRow } = await import("./contact-account-row");

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(props: {
  signInOpen: boolean;
  isAuthenticated: boolean;
  onSignInOpenChange?: (open: boolean) => void;
}): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ContactAccountRow
        signInOpen={props.signInOpen}
        isAuthenticated={props.isAuthenticated}
        onSignInOpenChange={props.onSignInOpenChange ?? (() => {})}
      />,
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe("ContactAccountRow", () => {
  it("offers the sign-in to a guest and opens the panel on click", async () => {
    const onSignInOpenChange = vi.fn();
    const container = await render({
      signInOpen: false,
      isAuthenticated: false,
      onSignInOpenChange,
    });

    expect(container.textContent).toContain("Have an account?");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Sign in");

    await act(async () => {
      button?.click();
    });
    expect(onSignInOpenChange).toHaveBeenCalledWith(true);
  });

  it("offers the way back to guest checkout while the panel is up", async () => {
    const onSignInOpenChange = vi.fn();
    const container = await render({
      signInOpen: true,
      isAuthenticated: false,
      onSignInOpenChange,
    });

    expect(container.textContent).toContain("Checkout as");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Guest");

    await act(async () => {
      button?.click();
    });
    expect(onSignInOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing for a signed-in shopper, whatever the panel flag says", async () => {
    for (const signInOpen of [false, true]) {
      const container = await render({ signInOpen, isAuthenticated: true });
      expect(container.innerHTML).toBe("");
      act(() => root?.unmount());
      host?.remove();
    }
  });

  it("does not bubble the click to the accordion card", async () => {
    // The listener sits on an OUTER node: React delegates to its root container,
    // and stopPropagation does not stop other listeners on that same node.
    const card = document.createElement("div");
    const onCardClick = vi.fn();
    card.addEventListener("click", onCardClick);
    host = document.createElement("div");
    card.appendChild(host);
    document.body.appendChild(card);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <ContactAccountRow
          signInOpen={false}
          isAuthenticated={false}
          onSignInOpenChange={() => {}}
        />,
      );
    });

    await act(async () => {
      host!.querySelector("button")?.click();
    });

    expect(onCardClick).not.toHaveBeenCalled();
    card.remove();
  });
});
