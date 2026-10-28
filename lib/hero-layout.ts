/** Hero carousel shell variants. Shared by the server theme and the client carousel. */
export type HeroLayout = "inset" | "full-bleed" | "fixed-height";

/**
 * Tailwind classes for the hero shell.
 * Kept out of lib/store-theme.ts so the carousel does not download zod.
 */
export function heroLayoutClasses(heroLayout: HeroLayout): string {
  switch (heroLayout) {
    case "full-bleed":
      return "mx-0 rounded-none";
    case "fixed-height":
      return "mx-0 rounded-none";
    case "inset":
    default:
      return "mx-5";
  }
}

/**
 * `sizes` for the hero image. Inset heroes are `mx-5` (2.5rem), so `100vw`
 * asks the phone for a wider file than the box. Full-bleed and fixed-height
 * really are the viewport.
 * https://nextjs.org/docs/app/api-reference/components/image#sizes
 */
export function heroImageSizes(heroLayout: HeroLayout): string {
  if (heroLayout === "inset") {
    return "calc(100vw - 2.5rem)";
  }
  return "100vw";
}

/** Inner media box classes for hero height modes. */
export function heroMediaClasses(heroLayout: HeroLayout): string {
  const base = "relative aspect-square w-full overflow-hidden md:aspect-video";
  if (heroLayout === "fixed-height") {
    return `${base} md:aspect-auto md:h-[850px] md:max-h-none`;
  }
  if (heroLayout === "full-bleed") {
    return `${base} md:max-h-[85svh]`;
  }
  return `${base} md:max-h-[70svh]`;
}

/**
 * Where the hero's pagination row sits.
 *
 * From `md` up the text column is absolutely positioned over the photo, so the
 * row is simply 20 px above the hero's own bottom edge, identical for every
 * layout.
 *
 * Below `md` the text sits in flow BENEATH the image, so the hero's bottom edge
 * is the bottom of the text and the row has to be anchored to the IMAGE's
 * instead. The media box is `aspect-square w-full` in all three layouts
 * (`heroMediaClasses`), so its height is exactly the hero's own width, and the
 * only thing that differs is whether the shell is inset (`mx-5`, so 2.5rem
 * narrower than the viewport) or full width. 27px = the 10px dot plus 17px of
 * clearance above the image's bottom edge. The arithmetic holds at any width.
 *
 * NB the `_-_` spelling: without the underscores around the minus signs the
 * arbitrary-value utility emits NO RULE AT ALL and the row loses its offset.
 */
export function heroPaginationClasses(heroLayout: HeroLayout): string {
  const mobileTop =
    heroLayout === "inset"
      ? "top-[calc(100vw_-_2.5rem_-_27px)]"
      : "top-[calc(100vw_-_27px)]";
  return `${mobileTop} md:top-auto md:bottom-5`;
}
