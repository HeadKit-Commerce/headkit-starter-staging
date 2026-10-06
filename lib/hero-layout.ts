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
