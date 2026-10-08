import { CAROUSEL_CARD_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import { Carousel } from "@/components/headkit-ui/carousel";
import { FeaturedImage } from "@/components/headkit-ui/featured-image";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { decodeHtmlEntities } from "@/lib/utils";
import { isAppNavigationHref } from "@/lib/convert-uri";
import type { FeaturedCategory } from "@headkit/sdk";

interface Props {
  categories: Pick<FeaturedCategory, "name" | "slug" | "uri" | "thumbnail">[];
  /**
   * Optional CTA under the collection title (e.g. “Discover Collection”).
   * Omit on starter — title only. The whole card stays one InstantLink.
   */
  cardLinkText?: string;
}

/**
 * Homepage / editor "Shop by Category" carousel.
 * Prefetch={true} (via InstantLink) so Partial Prefetching can warm each
 * collection PLP before click (Next.js 16.3 Instant Navigation).
 */
const CategoryCarousel = ({ categories, cardLinkText }: Props) => {
  const cardCta = cardLinkText?.trim() ?? "";
  return (
    <Carousel className="w-full" showPagination={false}>
      {categories.map((item, index) => {
        // `uri` is PREFERRED because a server caller resolves it to the
        // CANONICAL storefront path via `collectionPathResolver`: a nested
        // category reaches here as `/collections/parent/child`, and synthesising
        // `/collections/{slug}` from the slug instead is what pointed every
        // homepage tile at the shape the collection route now 308s away from.
        //
        // But it is preferred ONLY when it is a site-relative path. The prop
        // type is `Pick<FeaturedCategory, …>` and `FeaturedCategory.uri` from
        // the SDK is the ABSOLUTE WordPress permalink, so the field's natural
        // value navigates off the Next.js app entirely. Both live callers
        // overwrite it (`app/page.tsx`, `block-editor.tsx`), but this is a
        // shared starter template that customer repos flatten and merge, so a
        // dropped `.map` must not silently become off-app navigation.
        //
        // `isAppNavigationHref` is the repo's ONE in-app-navigation gate
        // (NavigationBar uses it for the same purpose) and already rejects the
        // protocol-relative `//host/…` case, which is path-like but resolves
        // off-site. A second local copy of a security-shaped predicate is how
        // one copy gets hardened and the other does not.
        const resolvedUri = item?.uri?.trim() ?? "";
        const inAppUri = isAppNavigationHref(resolvedUri) ? resolvedUri : "";
        const href =
          inAppUri ||
          (item?.slug ? `/collections/${item.slug}` : undefined) ||
          "/shop";
        const thumbnail = item?.thumbnail?.trim() || null;
        const name = decodeHtmlEntities(item?.name ?? "");
        return (
          <InstantLink
            key={index}
            href={href}
            prefetch={true}
            pendingVariant="card"
            className="group block"
          >
            <FeaturedImage
              src={thumbnail}
              alt={name}
              // Below-fold on home — never compete with the hero LCP image.
              priority={false}
              quality={50}
              sizes={CAROUSEL_CARD_IMAGE_SIZES}
              className="aspect-video"
            />
            <h2 className="pt-3 text-[17px] text-primary">{name}</h2>
            {cardCta ? (
              <span className="headkit-collection-card-cta mt-1 block font-semibold underline">
                {decodeHtmlEntities(cardCta)}
              </span>
            ) : null}
          </InstantLink>
        );
      })}
    </Carousel>
  );
};

export { CategoryCarousel };
