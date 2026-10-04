/**
 * The 16 px colourway dot a product card shows — presentational only.
 *
 * WHY THIS EXISTS AND `VariantSwatch` IS NOT REUSED HERE. On a card the dot
 * sits inside the colourway's own link, and `VariantSwatch` renders a
 * `<button>`. A `<button>` inside an `<a>` is invalid HTML, and axe's
 * `target-size` scores that pair as TWO failing nodes per dot with "0 px of
 * safe clickable space" — every card swatch on a listing, a homepage rail or a
 * PDP's related rail. The card's link is now the only interactive element and
 * carries the 24 x 24 target; this draws what the shopper sees inside it.
 *
 * `VariantSwatch` stays the PDP's control, where the button IS the target and
 * already measures 24 px at `size="default"`. The two files must keep the same
 * LOOK at the small size — 16 px circle, 1 px border, a 1 px ring sitting 1 px
 * clear of the edge when selected — so a change to one is a change to both.
 *
 * It renders no interactive element and holds no state of its own, so it adds
 * no event handler and no hook to the card. The hover ring is `group-hover:`
 * off the link, which is a class and not JavaScript. A missing photo can still
 * stream in through `SwatchPhotoLayer`, which is the child that holds the hooks.
 */
import { cn } from "@/lib/utils";
import { SwatchPhotoLayer } from "@/components/headkit-ui/swatch-image-fill";

interface Props {
  /** Colourway name, exposed to assistive tech by the link, not by the dot. */
  label: string;
  color1?: string | undefined;
  color2?: string | undefined;
  /** Option image (Shopify option image or a Woo term image). */
  imageSrc?: string | undefined;
  /** The colourway the card is currently previewing. */
  isSelected: boolean;
  /** Option slug, so a late photo can find this dot. */
  optionSlug?: string | undefined;
  /** Visual attribute id. Ignored unless the experimental lookup is on. */
  attributeId?: string | undefined;
  /** Product image URL used to find the WordPress host for a late photo. */
  commerceSrc?: string | undefined;
}

/**
 * Shared with `VariantSwatch`'s `size="small"` branch. `outline` is the style,
 * `outline-1` the width and `outline-offset-1` the 1 px gap; the ring is
 * transparent until the dot is selected or the link is hovered.
 */
const DOT_CLASS =
  "block h-4 w-4 rounded-brand-button border border-gray-700 outline outline-1 outline-offset-1 transition-all group-hover:outline-primary";

export function SwatchDot({
  label,
  color1,
  color2,
  imageSrc,
  isSelected,
  optionSlug,
  attributeId,
  commerceSrc,
}: Props): React.JSX.Element {
  const ring = isSelected ? "outline-primary" : "outline-transparent";
  const style = color1
    ? color2
      ? {
          background: `linear-gradient(90deg, ${color1}, ${color1} 50%, ${color2} 51%)`,
        }
      : { backgroundColor: color1 }
    : undefined;

  return (
    <span className={cn(DOT_CLASS, ring, "relative")} {...(style ? { style } : {})}>
      {/* Clip the photo inside the dot. Overflow on the dot itself would crop
          the selection outline. */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
        <SwatchPhotoLayer
          imageSrc={imageSrc ?? ""}
          optionSlug={optionSlug ?? ""}
          size="small"
          {...(attributeId ? { attributeId } : {})}
          {...(commerceSrc ? { commerceSrc } : {})}
        />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
