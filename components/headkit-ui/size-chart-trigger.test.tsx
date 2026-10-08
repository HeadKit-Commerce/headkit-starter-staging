import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { dialogContentProps } = vi.hoisted(() => ({
  dialogContentProps: {
    initialFocus: undefined as boolean | undefined,
  },
}));

vi.mock("@/lib/size-guide-actions", () => ({
  getSizeGuidePageHtml: async (): Promise<string> => "<p>Guide</p>",
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <div data-size-guide-dialog="">{children}</div>
  ),
  DialogContent: ({
    children,
    initialFocus,
  }: {
    children: ReactNode;
    initialFocus?: boolean;
  }) => {
    dialogContentProps.initialFocus = initialFocus;
    return <div>{children}</div>;
  },
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({
    children,
    render,
  }: {
    children?: ReactNode;
    render?: ReactElement<{ children?: ReactNode }>;
  }) =>
    isValidElement(render) ? (
      cloneElement(render, undefined, children)
    ) : (
      <>{children}</>
    ),
}));

import { SizeChartTrigger } from "./size-chart-trigger";

describe("SizeChartTrigger", () => {
  it("opens a modal button instead of navigating to the Size Guide page", () => {
    const html = renderToStaticMarkup(
      <SizeChartTrigger pageHref="/size-guide" />,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain("Size Guide");
    expect(html).not.toContain("Loading size guide…");
    expect(html).not.toContain("Size guide is not available yet.");
    expect(html).not.toContain('href="/size-guide"');
    expect(html).not.toContain("<a ");
  });

  it("hides the trigger when no chart HTML and no Size Guide page are set", () => {
    const html = renderToStaticMarkup(<SizeChartTrigger />);
    expect(html).toBe("");
  });

  it("renders supplied chart HTML in the dialog", () => {
    const html = renderToStaticMarkup(
      <SizeChartTrigger html="<table><tr><td>M</td></tr></table>" />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain("Size Guide");
    expect(html).not.toContain('href="/size-guide"');
  });

  it("prevents open auto-focus so the close control is not ringed", () => {
    renderToStaticMarkup(
      <SizeChartTrigger html="<table><tr><td>M</td></tr></table>" />,
    );

    expect(dialogContentProps.initialFocus).toBe(false);
  });
});
