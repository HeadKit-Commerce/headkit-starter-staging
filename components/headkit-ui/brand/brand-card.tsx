import Image from "next/image";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { decodeHtmlEntities } from "@/lib/utils";
import type { BrandSummaryFieldsFragment } from "@headkit/sdk";

interface BrandCardProps {
  brand: BrandSummaryFieldsFragment;
}

export function BrandCard({ brand }: BrandCardProps) {
  const name = decodeHtmlEntities(brand.name);
  return (
    <InstantLink href={`/brand/${brand.slug}`}>
      <div className="group relative flex flex-col">
        <div className="aspect-3/2 w-full overflow-hidden flex justify-center items-center bg-white border border-gray-200 rounded-brand">
          {brand.image?.src ? (
            <div className="relative h-[50px] w-[160px]">
              <Image
                alt={decodeHtmlEntities(brand.image.alt ?? brand.name)}
                src={brand.image.src}
                fill
                sizes="160px"
                quality={65}
                className="object-contain object-center"
              />
            </div>
          ) : brand.thumbnail ? (
            <div className="relative h-[50px] w-[160px]">
              <Image
                alt={name}
                src={brand.thumbnail}
                fill
                sizes="160px"
                quality={65}
                className="object-contain object-center"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="text-lg text-gray-500">{name}</span>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-col">
          <h3 className="text-[17px] text-primary">{name}</h3>
        </div>
      </div>
    </InstantLink>
  );
}
