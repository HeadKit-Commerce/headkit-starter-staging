/**
 * Header trigger under a pointer, matched by box rather than hit-testing.
 *
 * While a menu is open, Base UI writes inline `pointer-events: none` on the
 * trigger's `<ul>`. The pointer then lands on the nav, and sibling triggers
 * never receive the hover that would swap the panel. Rects still describe
 * those triggers, so a move across the bar can set the open value directly.
 *
 * That direct write never records a hover open, so Base UI also never closes
 * the panel on leave. The same rects decide the close: a point on a trigger
 * opens that menu, a point on the open panel keeps it, and any other point
 * closes it. The strip under the open trigger is part of the panel so a move
 * down into the dropdown does not cross a dead band inside the bar.
 */

export interface HeaderMenuRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface HeaderMenuTriggerBox extends HeaderMenuRect {
  value: string;
}

export type HeaderMenuHover =
  | { readonly kind: "trigger"; readonly value: string }
  | { readonly kind: "panel" }
  | { readonly kind: "away" };

/** Slack across the seam where the bar meets the panel. */
const PANEL_SEAM_PX = 4;

/** The open menu value whose trigger box contains `(x, y)`, or null. */
export function headerMenuValueAtPoint(
  triggers: readonly HeaderMenuTriggerBox[],
  x: number,
  y: number,
): string | null {
  for (const trigger of triggers) {
    if (trigger.width === 0 || trigger.height === 0) continue;
    if (
      x >= trigger.left &&
      x <= trigger.right &&
      y >= trigger.top &&
      y <= trigger.bottom
    ) {
      return trigger.value;
    }
  }
  return null;
}

function rectHasSize(rect: HeaderMenuRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

/**
 * Where the header pointer is, for opening, switching, and closing.
 *
 * `openValue` is the menu already open. The band from that trigger's bottom
 * edge to the panel (across the panel's width, plus a few pixels of seam)
 * still counts as the panel: the triggers sit in the middle of the bar, and
 * the dropdown starts at the bar's bottom edge.
 */
export function headerMenuHoverTarget(
  triggers: readonly HeaderMenuTriggerBox[],
  panel: HeaderMenuRect | null,
  x: number,
  y: number,
  openValue: string | null,
): HeaderMenuHover {
  const value = headerMenuValueAtPoint(triggers, x, y);
  if (value != null) return { kind: "trigger", value };

  if (panel != null && rectHasSize(panel)) {
    const reachedPanel =
      x >= panel.left &&
      x <= panel.right &&
      y >= panel.top - PANEL_SEAM_PX &&
      y <= panel.bottom;
    if (reachedPanel) return { kind: "panel" };

    if (openValue != null) {
      const open = triggers.find((trigger) => trigger.value === openValue);
      if (
        open != null &&
        rectHasSize(open) &&
        x >= panel.left &&
        x <= panel.right &&
        y >= open.bottom &&
        y <= panel.top
      ) {
        return { kind: "panel" };
      }
    }
  }

  return { kind: "away" };
}

/**
 * The header viewport. Its id is the panel the triggers name with
 * `aria-controls`. Closed, the box is empty; callers skip a zero size.
 */
export function readHeaderMenuPanel(nav: HTMLElement): HeaderMenuRect | null {
  const node = nav.querySelector<HTMLElement>('[id^="headkit-nav-panel-"]');
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Dropdown triggers in the header lists. The attribute lives on those
 * buttons only, and the viewport that holds panel content is a sibling of
 * the lists, so a panel link cannot take the value over.
 */
export function readHeaderMenuTriggers(
  nav: HTMLElement,
): HeaderMenuTriggerBox[] {
  const nodes = nav.querySelectorAll<HTMLElement>(
    ":scope > ul > li [data-headkit-menu]",
  );
  const boxes: HeaderMenuTriggerBox[] = [];
  for (const node of nodes) {
    const value = node.getAttribute("data-headkit-menu");
    if (!value) continue;
    const rect = node.getBoundingClientRect();
    boxes.push({
      value,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
  }
  return boxes;
}
