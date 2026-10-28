import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");

/**
 * The shape Next's flight client uses for a slot created in a Server
 * Component: `{ $$typeof: react.lazy, _init, _payload }`. `readChunk`
 * returns the fulfilled value. `Children.only` rejects this wrapper.
 */
function flightChild(element: React.ReactElement): React.ReactNode {
  const chunk: { status: "fulfilled"; value: React.ReactElement } = {
    status: "fulfilled",
    value: element,
  };
  return {
    $$typeof: REACT_LAZY_TYPE,
    _payload: chunk,
    _init(payload: { status: string; value: React.ReactElement }) {
      if (payload.status === "fulfilled") return payload.value;
      throw new Error("pending flight child");
    },
  } as unknown as React.ReactNode;
}

describe("Button asChild", () => {
  it("merges button styles onto the single child element", () => {
    const html = renderToStaticMarkup(
      <Button asChild className="headkit-section-cta">
        <a href="https://example.test/sale">Shop Sale</a>
      </Button>,
    );
    expect(html.startsWith("<a ")).toBe(true);
    expect(html).toContain('href="https://example.test/sale"');
    expect(html).toContain("headkit-section-cta");
    expect(html).not.toContain("<button");
  });

  it("unwraps a prerender flight wrapper around a server-created child", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Button,
        { asChild: true, className: "headkit-section-cta" },
        flightChild(
          React.createElement(
            "a",
            { href: "/news" },
            "All Articles",
            React.createElement("span", { "aria-hidden": true }, "›"),
          ),
        ),
      ),
    );
    expect(html.startsWith("<a ")).toBe(true);
    expect(html).toContain('href="/news"');
    expect(html).toContain("headkit-section-cta");
    expect(html).toContain("All Articles");
    expect(html).not.toContain("<button");
  });
});
