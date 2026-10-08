"use client";

import { InstantLink } from "@/components/headkit-ui/instant-link";
import { ChevronDownIcon } from "@/components/icon";
import { NavigationMenuLink } from "@/components/ui/navigation-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { normalizeMenuTree, toMegaMenuColumns } from "@/lib/menu-columns";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import type { NavMenuItem } from "@/components/headkit-ui/navigation-bar";

function removeTrailingSlash(url: string): string {
  return url.length > 1 ? url.replace(/\/$/, "") : url;
}

function isHighlightedItem(
  item: NavMenuItem,
  highlightedLinks: string[],
): boolean {
  return highlightedLinks.some(
    (h) => removeTrailingSlash(h) === removeTrailingSlash(item.uri),
  );
}

function groupMegaMenuColumnItems(
  column: readonly NavMenuItem[],
): (NavMenuItem | NavMenuItem[])[] {
  const groups: (NavMenuItem | NavMenuItem[])[] = [];
  let run: NavMenuItem[] = [];
  for (const item of column) {
    if (item.children.length > 0) {
      if (run.length > 0) {
        groups.push(run);
        run = [];
      }
      groups.push(item);
    } else {
      run.push(item);
    }
  }
  if (run.length > 0) groups.push(run);
  return groups;
}

/**
 * The desktop panel.
 *
 * Exported for `navigation-bar.test.tsx`: Radix keeps panel content unmounted
 * until the menu opens, so server markup of the whole bar cannot show what a
 * panel renders.
 *
 * `items` are the parent's raw children, so they may still contain WordPress
 * column containers; `toMegaMenuColumns` turns them into the columns to render
 * and drops any that would be empty (see `lib/menu-columns.ts`).
 */
export function MegaMenu({
  items,
  viewAll,
}: {
  items: NavMenuItem[];
  /** The parent's own destination, moved off the trigger into the panel. */
  viewAll?: { href: string; label: string };
}) {
  const columns = toMegaMenuColumns(items);
  return (
    <ul className="grid gap-5 w-full px-5 md:px-10 py-6 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
      {viewAll && (
        <li className="col-span-full">
          <NavigationMenuLink asChild>
            <InstantLink
              prefetch={true}
              href={viewAll.href}
              pendingVariant="text"
              className="font-semibold text-primary hover:opacity-80 underline block"
            >
              View all {viewAll.label}
            </InstantLink>
          </NavigationMenuLink>
        </li>
      )}
      {columns.map((column, index) => (
        <li key={column[0]?.id ?? index} className="flex flex-col gap-5">
          {groupMegaMenuColumnItems(column).map((group, groupIndex) =>
            Array.isArray(group) ? (
              // A run of childless items: one `gap-1` list, same rhythm as the
              // child links under a heading — not a heading each.
              <ul
                key={group[0]?.id ?? groupIndex}
                className="flex flex-col gap-1"
              >
                {group.map((item) => (
                  <MegaMenuChild key={item.id} item={item} depth={0} />
                ))}
              </ul>
            ) : (
              <div key={group.id}>
                <NavigationMenuLink asChild>
                  <InstantLink
                    prefetch={true}
                    href={removeTrailingSlash(group.uri)}
                    pendingVariant="text"
                    className="font-semibold text-primary hover:opacity-80 uppercase block mb-2"
                  >
                    {decodeHtmlEntities(group.label)}
                  </InstantLink>
                </NavigationMenuLink>
                <ul className="flex flex-col gap-1">
                  {group.children.map((child) => (
                    <MegaMenuChild key={child.id} item={child} depth={0} />
                  ))}
                </ul>
              </div>
            ),
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One link inside a column, under its column heading, plus anything beneath it.
 *
 * Recursive: Bike Society's menu is four levels deep
 * (`EQUIPMENT → column → category → subcategory`), so a category heading in a
 * column carries its own subcategory list. Sub-levels indent and lighten rather
 * than repeating the heading treatment.
 */
function MegaMenuChild({ item, depth }: { item: NavMenuItem; depth: number }) {
  return (
    <li>
      <NavigationMenuLink asChild>
        <InstantLink
          prefetch={true}
          href={removeTrailingSlash(item.uri)}
          pendingVariant="text"
          className={cn(
            "hover:opacity-80 text-[15px] block py-0.5",
            depth === 0 ? "text-primary/70" : "text-primary/50",
          )}
        >
          {decodeHtmlEntities(item.label)}
        </InstantLink>
      </NavigationMenuLink>
      {item.children.length > 0 && (
        <ul className="flex flex-col gap-1 pl-3">
          {item.children.map((child) => (
            <MegaMenuChild key={child.id} item={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mobile – MobileMenuSection
// ---------------------------------------------------------------------------

/**
 * The mobile sheet's list. Exported for `navigation-bar.test.tsx`: the sheet is
 * a Radix dialog and stays unmounted until it opens.
 */
export function MobileMenuSection({
  items,
  onSelect,
  highlightedLinks,
}: {
  items: NavMenuItem[];
  onSelect?: (() => void) | undefined;
  highlightedLinks: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <MobileMenuItem
          key={item.id}
          item={item}
          onSelect={onSelect}
          highlightedLinks={highlightedLinks}
        />
      ))}
    </div>
  );
}

/**
 * One row inside an open mobile section, plus everything under it.
 *
 * Recursive, so the sheet carries however many levels the menu has — Bike
 * Society's is four (`EQUIPMENT → column → category → subcategory`), and the
 * columns are already spliced out by the time this renders. `depth` only drives
 * indentation and weight: the first row under a section stands out, everything
 * below it is a sub-link.
 *
 * Exported for `navigation-bar.test.tsx`: a closed Radix collapsible renders no
 * content, so the sheet's rows are not reachable through `MobileMenuSection`.
 */
export function MobileMenuBranch({
  item,
  depth,
  onSelect,
}: {
  item: NavMenuItem;
  depth: number;
  onSelect?: (() => void) | undefined;
}) {
  const hasChildren = item.children.length > 0;
  return (
    <div>
      <InstantLink
        prefetch={true}
        href={removeTrailingSlash(item.uri)}
        pendingVariant="text"
        className={cn(
          "block text-[15px]",
          depth === 0 && hasChildren
            ? "font-medium text-primary hover:opacity-70 py-1"
            : "text-primary/70 hover:opacity-70",
          depth === 0 && !hasChildren ? "py-1" : "py-0.5",
        )}
        {...(onSelect ? { onClick: onSelect } : {})}
      >
        {decodeHtmlEntities(item.label)}
      </InstantLink>
      {hasChildren && (
        <div className="flex flex-col gap-1 pl-3">
          {item.children.map((child) => (
            <MobileMenuBranch
              key={child.id}
              item={child}
              depth={depth + 1}
              {...(onSelect ? { onSelect } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileMenuItem({
  item,
  onSelect,
  highlightedLinks,
}: {
  item: NavMenuItem;
  onSelect?: (() => void) | undefined;
  highlightedLinks: string[];
}) {
  // The sheet is a flat list, so a WordPress column container has no meaning
  // here at all: splice it away at every depth and show the real links.
  const children = normalizeMenuTree(item.children);

  if (children.length > 0) {
    return (
      <Collapsible>
        <CollapsibleTrigger className="text-xl font-semibold font-body text-primary flex w-full justify-between items-center group focus-visible:outline-none">
          <span className="group-data-[state=open]:opacity-70">
            {decodeHtmlEntities(item.label)}
          </span>
          <span className="group-data-[state=open]:hidden text-primary">
            <ChevronDownIcon size={20} />
          </span>
          <span className="hidden group-data-[state=open]:block rotate-180 text-primary">
            <ChevronDownIcon size={20} />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          {children.map((child) => (
            <MobileMenuBranch
              key={child.id}
              item={child}
              depth={0}
              {...(onSelect ? { onSelect } : {})}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <InstantLink
      prefetch={true}
      href={removeTrailingSlash(item.uri)}
      pendingVariant="text"
      className={cn(
        "text-xl font-semibold font-body text-primary hover:opacity-70",
        isHighlightedItem(item, highlightedLinks) &&
          "text-pink-500 hover:!text-pink-600",
      )}
      {...(onSelect ? { onClick: onSelect } : {})}
    >
      {decodeHtmlEntities(item.label)}
    </InstantLink>
  );
}
