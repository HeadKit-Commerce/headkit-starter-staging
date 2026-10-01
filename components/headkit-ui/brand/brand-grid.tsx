import { Skeleton } from "@/components/ui/skeleton";
import type { BrandSummaryFieldsFragment } from "@headkit/sdk";
import { BrandCard } from "./brand-card";

interface BrandGridProps {
  brands: BrandSummaryFieldsFragment[];
  loading?: boolean;
}

function BrandGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-6 px-5 md:grid-cols-3 md:px-10 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-32 w-full rounded-brand" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/**
 * Two columns from the smallest viewport up, not one.
 *
 * The index now renders EVERY brand (`app/brand/page.tsx`), so the column count
 * is what decides the page's height: measured at 115 brands, a single mobile
 * column was 42,044px of scroll against 7,929px at three. A brand tile is a
 * contained logo in a 3:2 box, which stays legible at half width in a way a
 * product card would not.
 */
export function BrandGrid({ brands, loading }: BrandGridProps) {
  if (loading) return <BrandGridSkeleton />;

  if (!brands.length) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <p className="text-lg text-gray-500">No brands found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4 px-5 md:px-10">
      {brands.map((brand) => (
        <BrandCard key={brand.id} brand={brand} />
      ))}
    </div>
  );
}
