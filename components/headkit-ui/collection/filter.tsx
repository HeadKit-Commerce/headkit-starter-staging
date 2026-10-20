"use client";

import { useState } from "react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { useCollection } from "./collection-context";
import { FilterMenuItem } from "./filter-menu-item";
import { CategoryFilter } from "./category-filter";
import { AttributeFilter } from "./attribute-filter";
import { BrandFilter } from "./brand-filter";
import { PriceFilter } from "./price-filter";
import { ClearFiltersButton } from "./clear-filters-button";
import { FACET_DROPDOWN_GRID_CLASS } from "./facet-panel";
import { SortMenu, MobileSortMenu } from "./sort-menu";
import type { ProductFilterAttribute } from "@headkit/sdk";

/** Shared count of active facets — drives the mobile drawer badge. */
function useActiveFacetCount(includeCommerceFacets: boolean) {
  const { filterValues } = useCollection();
  return (
    filterValues.categories.length +
    filterValues.brands.length +
    Object.values(filterValues.attributes).reduce((n, a) => n + a.length, 0) +
    (includeCommerceFacets && filterValues.instock ? 1 : 0) +
    (includeCommerceFacets &&
    ((filterValues.price_min ?? "") !== "" ||
      (filterValues.price_max ?? "") !== "")
      ? 1
      : 0)
  );
}

/**
 * Labels the loading pills are sized from. A pill is the real trigger's box
 * (`navigationMenuTriggerStyle`, h-10) around an invisible label, so the bar's
 * height never moves and each pill is roughly the width of the button that
 * replaces it. The real attribute list is unknown until the options arrive;
 * Colour and Size are the common pair.
 */
const SKELETON_FACET_LABELS = ["Category", "Brand", "Price", "Colour", "Size"];

function FacetSkeletonPill({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      data-facet-skeleton=""
      className={cn(navigationMenuTriggerStyle(), "pointer-events-none")}
    >
      <span className="relative whitespace-nowrap">
        <Skeleton animated className="absolute inset-0 rounded-full" />
        <span className="invisible">{label}</span>
      </span>
    </span>
  );
}

/** Skeleton rows for the mobile drawer, opened before the options landed. */
function FacetDrawerSkeleton() {
  return (
    <div className="flex flex-col gap-0 pb-10" aria-busy="true">
      <span className="sr-only" role="status">
        Loading filters
      </span>
      {SKELETON_FACET_LABELS.map((label) => (
        <section
          key={label}
          className="border-b border-gray-200 px-5 py-5"
          aria-hidden
        >
          <Skeleton animated className="mb-3 h-4 w-20" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton animated className="h-6 w-full" />
            <Skeleton animated className="h-6 w-full" />
          </div>
        </section>
      ))}
    </div>
  );
}

export function Filter() {
  const {
    filterValues,
    productFilter,
    facetStatus,
    isLoading,
    setFilterValues,
  } = useCollection();
  const isQuoteMode = useIsQuoteMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Price + In Stock are commerce facets — hide for HeadKit Quote checkout.
  const showCommerceFacets = !isQuoteMode;
  const activeCount = useActiveFacetCount(showCommerceFacets);

  const categories = (productFilter.categories ?? [])
    .filter((c): c is NonNullable<typeof c> => !!c?.slug && !!c?.name)
    .map((c) => ({ slug: c!.slug, name: c!.name }));

  const attributes = (productFilter.attributes ?? []).filter(
    (attr): attr is ProductFilterAttribute & { slug: string } => !!attr?.slug,
  );

  // Scoped (search) options carry their own brand list; with none of the
  // matches branded there is nothing to offer, so the button goes. The
  // un-scoped bar keeps the store's brand list (BrandFilter) as before.
  const showBrand =
    facetStatus !== "ready" || (productFilter.brands ?? []).length > 0;

  const inStockToggle = (
    <div className="flex min-h-10 items-center gap-2 px-2">
      <Switch
        aria-label="In Stock"
        checked={filterValues.instock}
        onCheckedChange={(checked) =>
          setFilterValues({ ...filterValues, instock: checked, page: 1 })
        }
      />
      <span
        className={cn("whitespace-nowrap font-semibold", {
          "font-bold": filterValues.instock,
        })}
      >
        In Stock
      </span>
    </div>
  );

  return (
    <>
      {menuOpen && (
        <div
          className="fixed inset-0 z-9 bg-black/50 backdrop-blur-xs"
          aria-hidden
        />
      )}

      {/* Desktop / tablet: inline facet nav (sidebar-style dropdowns) */}
      <NavigationMenu
        onValueChange={(v) => setMenuOpen(!!v)}
        className={cn(
          "sticky top-20 z-10 hidden w-full items-center justify-between px-5 md:flex md:px-10",
          menuOpen
            ? "bg-brand-bg"
            : "bg-brand-bg/80 hover:bg-brand-bg backdrop-blur-xs",
        )}
      >
        <div
          className={cn("w-full transition-opacity", {
            "opacity-50 pointer-events-none": isLoading,
          })}
        >
          <div className="flex w-full items-center justify-between overflow-x-auto py-5 pr-4 scrollbar-hide">
            <NavigationMenuList className="flex items-center gap-0">
              {facetStatus === "loading" && (
                <>
                  <li className="sr-only" role="status">
                    Loading filters
                  </li>
                  {SKELETON_FACET_LABELS.map((label) => (
                    <li key={label}>
                      <FacetSkeletonPill label={label} />
                    </li>
                  ))}
                </>
              )}

              {(facetStatus === "static" || facetStatus === "ready") && (
                <>
                  {categories.length > 0 && (
                    <FilterMenuItem
                      label="Category"
                      count={filterValues.categories.length}
                    >
                      <CategoryFilter
                        categories={categories}
                        gridClassName={FACET_DROPDOWN_GRID_CLASS}
                      />
                    </FilterMenuItem>
                  )}

                  {showBrand && (
                    <FilterMenuItem
                      label="Brand"
                      count={filterValues.brands.length}
                    >
                      <BrandFilter gridClassName={FACET_DROPDOWN_GRID_CLASS} />
                    </FilterMenuItem>
                  )}

                  {showCommerceFacets && (
                    <FilterMenuItem
                      label="Price"
                      count={
                        (filterValues.price_min ?? "") !== "" ||
                        (filterValues.price_max ?? "") !== ""
                          ? 1
                          : 0
                      }
                    >
                      <PriceFilter />
                    </FilterMenuItem>
                  )}

                  {attributes.map((attr) => (
                    <FilterMenuItem
                      key={attr.slug}
                      label={decodeHtmlEntities(attr.name)}
                      count={
                        (
                          filterValues.attributes[`pa_${attr.slug}`] ??
                          filterValues.attributes[attr.slug] ??
                          []
                        ).length
                      }
                    >
                      <AttributeFilter
                        attribute={attr}
                        gridClassName={FACET_DROPDOWN_GRID_CLASS}
                      />
                    </FilterMenuItem>
                  ))}

                  {/* <li> wrapper: NavigationMenuList is a <ul>, and a bare <div>
                  child fails the a11y list rule (the same toggle renders
                  without it in the mobile drawer, outside any list). */}
                  {showCommerceFacets && (
                    <NavigationMenuItem>{inStockToggle}</NavigationMenuItem>
                  )}
                </>
              )}

              <ClearFiltersButton />
            </NavigationMenuList>

            <NavigationMenuList className="flex items-center gap-2 -mr-4">
              <SortMenu />
            </NavigationMenuList>
          </div>
        </div>
      </NavigationMenu>

      {/* Mobile: facets live in a drawer — trigger matches Sort / desktop FilterMenuItem chrome */}
      <div
        className={cn(
          "sticky top-20 z-10 flex w-full items-center justify-between gap-2 bg-brand-bg/80 px-5 py-5 backdrop-blur-xs md:hidden",
          { "opacity-50 pointer-events-none": isLoading },
        )}
      >
        {/* No options to offer (failed, too slow, or nothing matched): no
            Filters button at all, so Sort keeps its place. */}
        {facetStatus !== "hidden" && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    navigationMenuTriggerStyle(),
                    "relative cursor-pointer font-semibold",
                  )}
                />
              }
            >
              Filters
              {activeCount > 0 ? (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-white">
                  {activeCount}
                </span>
              ) : null}
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[88vw] max-w-sm overflow-y-auto border-none bg-brand-bg px-0"
            >
              <SheetHeader className="border-b border-gray-200 px-5 pb-4 text-left">
                <SheetTitle className="text-xl font-bold text-primary">
                  Filters
                </SheetTitle>
              </SheetHeader>
              {facetStatus === "loading" ? (
                <FacetDrawerSkeleton />
              ) : (
                <div className="flex flex-col gap-0 pb-10">
                  {categories.length > 0 && (
                    <section className="border-b border-gray-200 px-5 py-5">
                      <h3 className="mb-3 text-sm text-primary">Category</h3>
                      <CategoryFilter categories={categories} />
                    </section>
                  )}
                  {showBrand && (
                    <section className="border-b border-gray-200 px-5 py-5">
                      <h3 className="mb-3 text-sm text-primary">Brand</h3>
                      <BrandFilter />
                    </section>
                  )}
                  {showCommerceFacets && (
                    <section className="border-b border-gray-200 px-5 py-5">
                      <h3 className="mb-3 text-sm text-primary">Price</h3>
                      <PriceFilter />
                    </section>
                  )}
                  {attributes.map((attr) => (
                    <section
                      key={attr.slug}
                      className="border-b border-gray-200 px-5 py-5"
                    >
                      <h3 className="mb-3 text-sm text-primary">
                        {decodeHtmlEntities(attr.name)}
                      </h3>
                      <AttributeFilter attribute={attr} />
                    </section>
                  ))}
                  {showCommerceFacets && (
                    <section className="border-b border-gray-200 px-5 py-4">
                      {inStockToggle}
                    </section>
                  )}
                  <div className="px-5 pt-4">
                    <ClearFiltersButton />
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
        )}

        <MobileSortMenu />
      </div>
    </>
  );
}
