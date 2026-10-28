// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const resetUserPassword = vi.fn();

// Mirrors Next: `useSearchParams` follows the live address bar, so it empties
// once the page strips the credentials.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/account-actions", () => ({
  resetUserPassword: (input: unknown) => resetUserPassword(input),
}));

import Page from "./page";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(url: string): Promise<void> {
  window.history.replaceState({ marker: 1 }, "", url);
  await act(async () => {
    root.render(<Page />);
  });
}

beforeEach(() => {
  resetUserPassword.mockReset().mockResolvedValue({ success: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("reset-password page", () => {
  it("removes key and login from the address bar, keeping path and history state", async () => {
    await mount("/account/reset-password?key=SECRET&login=jo&utm_source=email");
    expect(window.location.pathname).toBe("/account/reset-password");
    expect(window.location.search).toBe("?utm_source=email");
    expect(window.location.href).not.toContain("SECRET");
    expect(window.history.state).toEqual({ marker: 1 });
  });

  it("still resets with the captured key after the strip", async () => {
    await mount("/account/reset-password?key=SECRET&login=jo");
    expect(host.textContent).not.toContain("Invalid reset password link");

    const [pw, confirm] = [...host.querySelectorAll("input")];
    const set = (el: HTMLInputElement | undefined, v: string): void => {
      if (!el) throw new Error("input missing");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      set(pw, "Passw0rdOK");
      set(confirm, "Passw0rdOK");
    });
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(resetUserPassword).toHaveBeenCalledWith({
      key: "SECRET",
      login: "jo",
      password: "Passw0rdOK",
    });
  });

  it("shows the invalid-link notice when the credentials are absent", async () => {
    await mount("/account/reset-password");
    expect(host.textContent).toContain("Invalid reset password link");
  });
});
