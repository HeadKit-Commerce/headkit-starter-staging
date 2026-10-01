import type { BrandSummaryFieldsFragment } from "@headkit/sdk";
import { BrandGrid } from "./brand-grid";

interface BrandPageProps {
  brands: BrandSummaryFieldsFragment[];
  /**
   * The store's own brand count, from the brand endpoint — `null` when it never
   * answered. Rendered beside the heading so the page states how many brands it
   * is showing rather than leaving a shopper to count cards.
   */
  total?: number | null | undefined;
  /**
   * False when the walk in `lib/brand-list.ts` could not prove it collected
   * every brand. The index silently showing a subset is the defect this prop
   * exists to make impossible: when it is false the page SAYS so.
   */
  complete?: boolean | undefined;
}

export function BrandPage({ brands, total, complete = true }: BrandPageProps) {
  const shown = brands.length;
  return (
    <div className="flex flex-col gap-8">
      {/*
        Outside any <Suspense> on purpose — the whole grid is in the prerendered
        shell, so this notice is too and a crawler sees the same claim a shopper
        does. See `app/brand/page.tsx`.
      */}
      {!complete && (
        <div
          role="status"
          className="mx-5 rounded-brand border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 md:mx-10"
        >
          {typeof total === "number" && total > shown
            ? `Showing ${shown} of ${total} brands — the rest could not be loaded. Please try again shortly.`
            : "Some brands could not be loaded, so this list may be incomplete. Please try again shortly."}
        </div>
      )}
      {complete && typeof total === "number" && shown > 0 && (
        <p className="px-5 text-sm text-gray-500 md:px-10">
          {shown === 1 ? "1 brand" : `${shown} brands`}
        </p>
      )}
      <BrandGrid brands={brands} />
    </div>
  );
}
