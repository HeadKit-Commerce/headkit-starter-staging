import Image from "next/image";
import { Carousel } from "@/components/headkit-ui/carousel";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { decodeHtmlEntities } from "@/lib/utils";
import type { FeaturedBrand } from "@headkit/sdk";

interface Props {
  brands: Pick<FeaturedBrand, "name" | "slug" | "thumbnail">[];
}

/** Logo strip: only brands with a real logo (skips name-only top-brand fallbacks). */
function brandsWithLogos(brands: Props["brands"]): Props["brands"] {
  return brands.filter(
    (b) => typeof b?.thumbnail === "string" && b.thumbnail.trim() !== "",
  );
}

const BrandCarousel = ({ brands }: Props) => {
  const logos = brandsWithLogos(brands);
  if (logos.length === 0) {
    return null;
  }

  return (
    <Carousel
      // Original 160px logo slots; 100px gap between logos (not wide columns).
      gap="gap-[100px]"
      padding="px-5 md:px-10"
      centerWhenFits
      itemSizing={{
        base: "w-[160px]",
        sm: "sm:w-[160px]",
        lg: "lg:w-[160px]",
      }}
      showControls={false}
      showScrollbar={false}
      className="w-full"
      autoplay={{
        enabled: true,
        delay: 3000,
        stopOnInteraction: true,
      }}
      loop={true}
      showPagination={false}
    
    >
      {logos.map((item, index) => {
        const href = `/brand/${item?.slug ?? ""}`;
        const src = item.thumbnail.trim();
        const name = decodeHtmlEntities(item?.name ?? "");

        return (
          <InstantLink
            key={index}
            href={href}
            className="relative flex h-[50px] w-[160px] items-center justify-center"
            aria-label={name}
          >
            <Image
              alt={name}
              src={src}
              fill
              quality={65}
              sizes="160px"
              className="object-contain object-center"
            />
          </InstantLink>
        );
      
      })}
    </Carousel>
  );
};

export { BrandCarousel };
