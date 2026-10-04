import sanitize from "sanitize-html";
import Image from "next/image";
import type { ProductCategoryDetail } from "@headkit/sdk";
import { decodeHtmlEntities } from "@/lib/utils";
import { SubcategoryCarousel } from "@/components/headkit-ui/collection/subcategory-carousel";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { showCollectionBreadcrumbs } from "@/overrides/collection-slots";

interface CollectionHeaderProps {
  name: string;
  description?: string;
  /**
   * Rendered above the heading (`Home > Shop > … > {category}`), plus fed to
   * `BreadcrumbJsonLD` by the caller so the two stay consistent. Root-first,
   * with `current: true` on the trailing (non-linked) crumb — the shape
   * `buildBreadcrumbFromCategory` in `collection/utils.ts` produces.
   */
  breadcrumbs?: { name: string; uri: string; current: boolean }[];
  thumbnail?: string;
  children?: ProductCategoryDetail[];
  /**
   * The path the subcategory cards link BENEATH — this collection's own
   * canonical path (`collectionPathFromCategory`) when the children are its
   * subcategories.
   *
   * A child category's payload carries no ancestors, so a card that knows only
   * its own slug can emit only the flat `/collections/{child}` shape, which the
   * collection route now 308s away from. The parent is where the ancestry is
   * known, so it hands it down.
   *
   * REQUIRED, and required for the same reason `SubcategoryCard.parentPath` is
   * — this is the prop that feeds it. A default would let a caller that renders
   * NESTED children omit it and emit the losing shape with no type error and no
   * test failure. A caller whose children are ROOT categories passes
   * `"/collections"` explicitly, because that IS the canonical base there.
   */
  childBasePath: string;
}

export function CollectionHeader({
  name,
  description,
  breadcrumbs,
  thumbnail,
  childBasePath,
  children: subcategories,
}: CollectionHeaderProps) {
  const decodedName = decodeHtmlEntities(name);
  const hasChildren = Boolean(subcategories && subcategories.length > 0);
  // Leaf subcategory: large featured image beside title (8/12 cols on desktop).
  // Aligns with PDP content inset (px-5 / md:px-10). Parent with children:
  // title + description only, then image-card carousel.
  const showLeafFeatured = !hasChildren && Boolean(thumbnail);
  const hasBreadcrumbs =
    showCollectionBreadcrumbs() &&
    Boolean(breadcrumbs && breadcrumbs.length > 0);

  return (
    <div className="overflow-x-clip">
      {hasBreadcrumbs ? (
        <div className="px-5 pt-5 md:px-10">
          <Breadcrumb items={breadcrumbs!} />
        </div>
      ) : null}
      {showLeafFeatured ? (
        <div
          className={`mb-5 grid grid-cols-1 gap-6 px-5 md:grid-cols-12 md:gap-8 md:px-10 ${hasBreadcrumbs ? "pt-2 md:pt-4" : "md:pt-8"}`}
        >
          <div
            className={
              hasBreadcrumbs ? "md:col-span-4" : "pt-5 md:col-span-4 md:pt-0"
            }
          >
            <h1 className="mb-[10px]">{decodedName}</h1>
            {description ? (
              <div
                className="text-base text-gray-800"
                dangerouslySetInnerHTML={{ __html: sanitize(description) }}
              />
            ) : null}
          </div>
          <div className="relative aspect-[915/458] w-full overflow-hidden bg-neutral-200 md:col-span-8 md:aspect-auto md:min-h-[320px] lg:min-h-[400px]">
            <Image
              alt=""
              src={thumbnail!}
              fill
              className="object-cover object-center"
              sizes="(max-width: 768px) calc(100vw - 2.5rem), 66vw"
              priority
              fetchPriority="high"
              quality={50}
            />
          </div>
        </div>
      ) : (
        <div
          className={`mb-5 px-5 md:px-10 ${hasBreadcrumbs ? "pt-2" : "pt-5"}`}
        >
          <h1 className={`mb-[10px] ${hasBreadcrumbs ? "mt-2" : "mt-5"}`}>
            {decodedName}
          </h1>
          {description ? (
            <div
              className="max-w-2xl text-base text-gray-800"
              dangerouslySetInnerHTML={{ __html: sanitize(description) }}
            />
          ) : null}
        </div>
      )}
      {hasChildren && subcategories ? (
        <SubcategoryCarousel
          subcategories={subcategories}
          parentPath={childBasePath}
        />
      ) : null}
    </div>
  );
}
