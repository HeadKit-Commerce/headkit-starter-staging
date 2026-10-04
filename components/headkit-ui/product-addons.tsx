"use client";

import { useRef } from "react";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ADDON_TYPE,
  addonPricePrefix,
  estimateAddonsTotal,
  formatAddonPriceSuffix,
  visibleAddonOptions,
  type AddonGroupShape,
  type AddonOptionShape,
  type AddonSelection,
  type AddonSelectionValue,
} from "@/lib/addons";
import { cn, decodeHtmlEntities, formatPrice } from "@/lib/utils";

/**
 * The PDP add-on form — the merchant's own groups, rendered in the order the
 * store returned them, collecting a selection map that is already the wire
 * shape.
 *
 * **There is no client-side validation here, deliberately.** The extension's
 * validator catalogue is merchant-configurable, translated, and lives on a
 * definition this client's copy of can be minutes stale; a required / min / max
 * / restrictions check re-implemented here could not stay in sync with it
 * (D-14.1-02, and V1's client-side required check is explicitly not ported).
 * So the CTA stays enabled, an incomplete form may be submitted, and the
 * store's own rejection is what the shopper sees. Required-ness is a marker and
 * an `aria-required`, never a verdict. The character counter is never coloured
 * and typing is never blocked, for the same reason.
 *
 * **Nothing the merchant did not author is rendered.** No section heading is
 * injected (UI-SPEC U-01), and with no groups the component returns `null` —
 * which makes a store without the extension the same code path rather than a
 * special case (D-14.1-04, PAO-04). The call site guards on list length too, so
 * not even a wrapper's margin enters the DOM.
 *
 * **Two rendering trust boundaries, pointing opposite ways.** Merchant group
 * descriptions may carry HTML including inline links and are rendered as HTML —
 * the same source and the same boundary as the product short description this
 * page already renders that way. Option labels and shopper-typed values are
 * rendered as React children and stay escaped, because text and textarea values
 * are shopper-supplied and round-trip into the cart and the order meta.
 */

/** One selectable choice, plus the swatch image only this surface reads. */
export type ProductAddonOptionDefinition = AddonOptionShape & {
  readonly image?: string | null;
};

/** The add-on group shape this surface renders. `ProductAddon` from the SDK satisfies it. */
export type ProductAddonDefinition = Omit<AddonGroupShape, "options"> & {
  readonly options: readonly ProductAddonOptionDefinition[];
} & {
  readonly description?: string | null;
  readonly display?: string | null;
  readonly titleFormat?: string | null;
  readonly required: boolean;
  readonly restrictionsType?: string | null;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly placeholderEnable: boolean;
  readonly placeholder?: string | null;
};

interface ProductAddonsProps {
  /** The store's definitions, in received order. Never sorted, never filtered here. */
  addons: readonly ProductAddonDefinition[];
  /** The shopper's choices so far — already the wire shape. */
  selection: Readonly<AddonSelection>;
  /** Lifts the next selection to the parent. `changedAddonId` clears that group's stale rejection. */
  onChange: (next: AddonSelection, changedAddonId: string) => void;
  /** Per-group server rejections, keyed by add-on id; the message is already entity-decoded. */
  errors: Readonly<Record<string, string>>;
  /** Cart/store currency code for the price suffixes and the preview. */
  currency?: string;
  /** Current quantity — the preview's flat fees are per line, everything else per unit. */
  quantity: number;
  /** Unit price the preview builds on. */
  basePrice: number;
}

/** The group container's DOM id — `product-detail.tsx` scrolls to this on a rejection. */
export function addonGroupDomId(addonId: string): string {
  return `addon-group-${addonId}`;
}

/** The group's focusable control — `product-detail.tsx` moves focus here on a rejection. */
export function addonControlDomId(addonId: string): string {
  return `addon-control-${addonId}`;
}

const UNSET = "";

/** `min` / `max` arrive as null when unset; a literal 0 is the extension's unset sentinel too. */
function bound(value: number | null | undefined): number | null {
  return value === null || value === undefined || value === 0 ? null : value;
}

/** Informational only — never a verdict on validity. */
function restrictionHelper(
  group: ProductAddonDefinition,
  currency?: string,
): string | null {
  const min = bound(group.min);
  const max = bound(group.max);

  if (group.type === ADDON_TYPE.CustomPrice) {
    const parts: string[] = [];
    if (min !== null) parts.push(`Minimum ${formatPrice(min, currency)}`);
    if (max !== null) parts.push(`Maximum ${formatPrice(max, currency)}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (group.type === ADDON_TYPE.InputMultiplier) {
    if (min !== null && max !== null) return `Between ${min} and ${max}`;
    if (min !== null) return `Minimum ${min}`;
    if (max !== null) return `Maximum ${max}`;
    return null;
  }

  const parts: string[] = [];
  switch (group.restrictionsType) {
    case "only_letters":
      parts.push("Letters only");
      break;
    case "only_numbers":
      parts.push("Numbers only");
      break;
    case "only_letters_numbers":
      parts.push("Letters and numbers only");
      break;
    case "email":
      parts.push("Email address");
      break;
    case "decimal":
      parts.push("Decimal number");
      break;
    default:
      break;
  }

  if (min !== null && max !== null) parts.push(`${min}–${max} characters`);
  else if (min !== null) parts.push(`Minimum ${min} characters`);
  else if (max !== null) parts.push(`Maximum ${max} characters`);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `type="date"` ignores `placeholder`, so the merchant's hint becomes helper text instead. */
function datePlaceholderHelper(group: ProductAddonDefinition): string | null {
  if (group.type !== ADDON_TYPE.Datepicker) return null;
  if (!group.placeholderEnable || !group.placeholder) return null;
  return decodeHtmlEntities(group.placeholder);
}

function textInputType(group: ProductAddonDefinition): string {
  return group.restrictionsType === "email" ? "email" : "text";
}

function textInputMode(
  group: ProductAddonDefinition,
): "numeric" | "decimal" | undefined {
  if (group.restrictionsType === "only_numbers") return "numeric";
  if (group.restrictionsType === "decimal") return "decimal";
  return undefined;
}

function placeholderFor(group: ProductAddonDefinition): string | undefined {
  if (!group.placeholderEnable || !group.placeholder) return undefined;
  return decodeHtmlEntities(group.placeholder);
}

/** One row of the "Your selection" panel: what was chosen, and what its own price type means. */
type SummaryRow = { key: string; label: string; suffix: string };

function summaryRows(
  addons: readonly ProductAddonDefinition[],
  selection: Readonly<AddonSelection>,
  currency?: string,
): SummaryRow[] {
  const rows: SummaryRow[] = [];

  for (const group of addons) {
    const raw = selection[group.id];
    if (raw === undefined) continue;
    const groupName = decodeHtmlEntities(group.name);

    if (
      group.type === ADDON_TYPE.Checkbox ||
      group.type === ADDON_TYPE.MultipleChoice
    ) {
      const indexes = Array.isArray(raw) ? raw : [raw];
      for (const candidate of indexes) {
        const index = Number(candidate);
        const option = group.options[index];
        if (!option) continue;
        const suffix = formatAddonPriceSuffix(
          option.price,
          option.priceType,
          currency,
        );
        if (!suffix) continue;
        rows.push({
          key: `${group.id}-${index}`,
          label: `${groupName} · ${decodeHtmlEntities(option.label)}`,
          suffix,
        });
      }
      continue;
    }

    if (typeof raw === "string" && raw.trim().length === 0) continue;

    if (group.type === ADDON_TYPE.CustomPrice) {
      const typed = Number(raw);
      if (!Number.isFinite(typed) || typed === 0) continue;
      rows.push({
        key: group.id,
        label: groupName,
        suffix: `+${formatPrice(typed, currency)}`,
      });
      continue;
    }

    const suffix = formatAddonPriceSuffix(
      group.price,
      group.priceType,
      currency,
    );
    if (!suffix) continue;
    rows.push({
      key: group.id,
      label:
        group.type === ADDON_TYPE.InputMultiplier
          ? `${groupName} × ${String(raw)}`
          : groupName,
      suffix,
    });
  }

  return rows;
}

/**
 * The merchant's group description — **the only raw-HTML render prop in this
 * file**, and deliberately so.
 *
 * Descriptions are merchant-authored and routinely carry inline links (Pebblr's
 * "Backdrop Design" description does), which is the same source and the same
 * trust boundary as the product short description this page already renders as
 * HTML. Option labels and shopper-typed values go the other way — they render
 * as React children and stay escaped, because `custom_text` values are
 * shopper-supplied and round-trip into the cart and the order meta.
 *
 * Kept as one component so that boundary is one line to audit rather than one
 * per branch.
 */
function AddonGroupDescription({
  id,
  html,
}: {
  id: string | undefined;
  html: string | null | undefined;
}): React.ReactElement | null {
  if (!html) return null;
  return (
    <div
      id={id}
      className="mt-1 text-sm leading-normal text-gray-700 [&_a]:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * `multiple_choice` + `display: "images"` — a tile grid, not a radio with a
 * picture, reusing the PDP variation swatch's selected-state idiom so add-on
 * and variation swatches read as one system.
 *
 * The label always renders beneath the tile: the image never carries the
 * meaning alone (WCAG 1.4.1), and an option the merchant left imageless falls
 * back to a text tile rather than disappearing — skipping it would shift every
 * later index and mis-buy the shopper's choice.
 */
function AddonImageSwatches({
  group,
  selectedIndex,
  onSelect,
  currency,
  labelledBy,
  describedBy,
  invalid,
}: {
  group: ProductAddonDefinition;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  currency: string | undefined;
  labelledBy: string;
  describedBy: string | undefined;
  invalid: boolean;
}): React.ReactElement {
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const rendered = visibleAddonOptions(group);
  const activePosition = Math.max(
    rendered.findIndex((r) => r.index === selectedIndex),
    0,
  );

  function move(position: number, delta: number): void {
    const next = (position + delta + rendered.length) % rendered.length;
    const target = rendered[next];
    if (!target) return;
    onSelect(target.index);
    tiles.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={group.required}
      aria-invalid={invalid}
      id={addonControlDomId(group.id)}
      tabIndex={-1}
      className="mt-2 flex flex-wrap gap-3"
    >
      {rendered.map(({ option, index }, position) => {
        const isSelected = selectedIndex === index;
        const label = decodeHtmlEntities(option.label);
        const suffix = formatAddonPriceSuffix(
          option.price,
          option.priceType,
          currency,
        );
        return (
          <button
            key={`${group.id}-${index}`}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={position === activePosition ? 0 : -1}
            ref={(el) => {
              tiles.current[position] = el;
            }}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(position, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(position, -1);
              } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onSelect(index);
              }
            }}
            className="flex w-[72px] cursor-pointer flex-col gap-1 md:w-[88px]"
          >
            {option.image ? (
              <span
                className={cn(
                  "relative block h-[72px] w-[72px] overflow-hidden rounded-md outline-2 outline-solid outline-offset-1 transition-all hover:outline-primary md:h-[88px] md:w-[88px]",
                  isSelected ? "outline-primary" : "outline-transparent",
                )}
              >
                {/*
                  Product Add-Ons option image. The theme publishes the medium
                  attachment (~300px) on the store image host, which is already
                  in remotePatterns. The tile is 72–88px, so 88px at quality 50
                  is the file the browser should receive.
                */}
                <Image
                  src={option.image}
                  alt=""
                  fill
                  sizes="88px"
                  quality={50}
                  className="object-cover"
                />
              </span>
            ) : (
              <span
                // aria-hidden: the caption below is this tile's accessible
                // name. Without this the no-image fallback contributes the
                // label twice and a screen reader announces "Plain Black Plain
                // Black" — measured live on `glam-booth-all-types`.
                aria-hidden="true"
                className={cn(
                  "flex h-[72px] w-[72px] items-center justify-center rounded-md border border-gray-700 px-[10px] text-center text-xs leading-tight outline-2 outline-solid -outline-offset-1 transition-all hover:outline-primary md:h-[88px] md:w-[88px]",
                  isSelected
                    ? "font-semibold outline-primary"
                    : "outline-transparent",
                )}
              >
                {label}
              </span>
            )}
            <span className="text-xs leading-normal text-gray-700">
              {label}
              {suffix ? ` ${suffix}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ProductAddons({
  addons,
  selection,
  onChange,
  errors,
  currency,
  quantity,
  basePrice,
}: ProductAddonsProps): React.ReactElement | null {
  // PAO-04: no element, no margin, no zero-height wrapper. The call site guards
  // on length too, so this is belt and braces rather than the whole contract.
  if (addons.length === 0) return null;

  const set = (
    addonId: string,
    value: AddonSelectionValue | undefined,
  ): void => {
    const next: AddonSelection = { ...selection };
    if (value === undefined) delete next[addonId];
    else next[addonId] = value;
    onChange(next, addonId);
  };

  const rows = summaryRows(addons, selection, currency);
  const estimate = estimateAddonsTotal(addons, selection, basePrice, quantity);
  // The custom_price adornment and the room the input reserves for it. Derived
  // once per render from the store's currency — the symbol's width is variable
  // and the reservation must be too (UAT gap 2).
  const pricePrefix = addonPricePrefix(currency);

  return (
    <div className="mb-5 flex flex-col gap-6">
      {addons.map((group) => {
        const nameId = `addon-name-${group.id}`;
        const descId = group.description ? `addon-desc-${group.id}` : undefined;
        const helper =
          restrictionHelper(group, currency) ?? datePlaceholderHelper(group);
        const helperId = helper ? `addon-help-${group.id}` : undefined;
        const error = errors[group.id];
        const errorId = error ? `addon-error-${group.id}` : undefined;
        const controlId = addonControlDomId(group.id);
        const describedBy =
          [descId, helperId, errorId].filter(Boolean).join(" ") || undefined;
        const raw = selection[group.id];
        const groupName = decodeHtmlEntities(group.name);
        const max = bound(group.max);
        const isHeading = group.type === ADDON_TYPE.Heading;
        const isFileUpload = group.type === ADDON_TYPE.FileUpload;

        const nameNode = (
          <span
            id={nameId}
            className={cn(
              "text-base font-semibold leading-tight text-primary",
              group.titleFormat === "hide" && "sr-only",
            )}
          >
            {groupName}
            {group.required && (
              <>
                <span aria-hidden="true" className="ml-1 text-red-600">
                  *
                </span>
                <span className="sr-only"> required</span>
              </>
            )}
          </span>
        );

        // A `type: "heading"` ENTRY is a section divider with no control. It is
        // skipped by every one of the extension's validators and never appears
        // in the selection map. (Distinct from `title_format: "heading"`, which
        // is a per-group title style — RESEARCH A5, do not conflate them.)
        if (isHeading) {
          return (
            <div
              key={group.id}
              id={addonGroupDomId(group.id)}
              className="mt-2 border-t border-gray-200 pt-4"
            >
              {nameNode}
              <AddonGroupDescription id={descId} html={group.description} />
            </div>
          );
        }

        return (
          <div
            key={group.id}
            id={addonGroupDomId(group.id)}
            className={cn(error && "border-l-2 border-red-600 pl-3")}
          >
            {group.type === ADDON_TYPE.Checkbox ||
            group.type === ADDON_TYPE.MultipleChoice ? (
              nameNode
            ) : (
              <Label
                htmlFor={controlId}
                className="text-base font-semibold leading-tight text-primary"
              >
                {nameNode}
              </Label>
            )}

            <AddonGroupDescription id={descId} html={group.description} />

            {isFileUpload && (
              // D-14.1-05: the extension's uploader is a classic form POST to
              // WordPress with no headless equivalent. Surfaced in its own
              // position so the shopper sees which option is affected, and it
              // blocks add-to-cart rather than failing obscurely at the store.
              <div className="mt-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">
                    Not available online
                  </p>
                  <p className="mt-0.5 text-sm text-amber-800">
                    &ldquo;{groupName}&rdquo; needs a file upload, which this
                    store can&rsquo;t accept online yet. Please contact us to
                    order this product.
                  </p>
                </div>
              </div>
            )}

            {group.type === ADDON_TYPE.Checkbox && (
              <div
                role="group"
                aria-labelledby={nameId}
                aria-describedby={describedBy}
                id={controlId}
                tabIndex={-1}
                className="mt-2 flex flex-col gap-2"
              >
                {visibleAddonOptions(group).map(({ option, index }) => {
                  const chosen = Array.isArray(raw)
                    ? raw.map(Number)
                    : raw === undefined
                      ? []
                      : [Number(raw)];
                  const isChecked = chosen.includes(index);
                  const optionId = `${controlId}-${index}`;
                  const suffix = formatAddonPriceSuffix(
                    option.price,
                    option.priceType,
                    currency,
                  );
                  return (
                    <div
                      key={optionId}
                      className="flex items-center gap-2 py-3 md:py-1"
                    >
                      <Checkbox
                        id={optionId}
                        checked={isChecked}
                        aria-required={group.required}
                        aria-invalid={Boolean(error)}
                        onCheckedChange={(checked) => {
                          const next =
                            checked === true
                              ? [...chosen, index].sort((a, b) => a - b)
                              : chosen.filter((i) => i !== index);
                          set(group.id, next.length > 0 ? next : undefined);
                        }}
                      />
                      <Label
                        htmlFor={optionId}
                        className="cursor-pointer text-base font-normal leading-normal"
                      >
                        {decodeHtmlEntities(option.label)}
                        {suffix ? (
                          <span className="text-sm text-gray-700">
                            {" "}
                            {suffix}
                          </span>
                        ) : null}
                      </Label>
                    </div>
                  );
                })}
              </div>
            )}

            {group.type === ADDON_TYPE.MultipleChoice &&
              group.display === "images" && (
                <AddonImageSwatches
                  group={group}
                  selectedIndex={raw === undefined ? null : Number(raw)}
                  onSelect={(index) => set(group.id, index)}
                  currency={currency}
                  labelledBy={nameId}
                  describedBy={describedBy}
                  invalid={Boolean(error)}
                />
              )}

            {group.type === ADDON_TYPE.MultipleChoice &&
              group.display === "radiobutton" && (
                <RadioGroup
                  id={controlId}
                  aria-labelledby={nameId}
                  aria-describedby={describedBy}
                  aria-required={group.required}
                  aria-invalid={Boolean(error)}
                  value={raw === undefined ? UNSET : String(raw)}
                  onValueChange={(value) => set(group.id, Number(value))}
                  className="mt-2"
                >
                  {visibleAddonOptions(group).map(({ option, index }) => {
                    const optionId = `${controlId}-${index}`;
                    const suffix = formatAddonPriceSuffix(
                      option.price,
                      option.priceType,
                      currency,
                    );
                    return (
                      <div
                        key={optionId}
                        className="flex items-center gap-2 py-3 md:py-1"
                      >
                        <RadioGroupItem id={optionId} value={String(index)} />
                        <Label
                          htmlFor={optionId}
                          className="cursor-pointer text-base font-normal leading-normal"
                        >
                          {decodeHtmlEntities(option.label)}
                          {suffix ? (
                            <span className="text-sm text-gray-700">
                              {" "}
                              {suffix}
                            </span>
                          ) : null}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              )}

            {group.type === ADDON_TYPE.MultipleChoice &&
              group.display !== "images" &&
              group.display !== "radiobutton" && (
                <Select
                  // Controlled from the first render (`""` = nothing picked),
                  // so React never sees the control flip uncontrolled to
                  // controlled when the shopper makes their first choice.
                  value={raw === undefined ? UNSET : String(raw)}
                  onValueChange={(value) => set(group.id, Number(value))}
                >
                  <SelectTrigger
                    id={controlId}
                    aria-labelledby={nameId}
                    aria-describedby={describedBy}
                    aria-required={group.required}
                    aria-invalid={Boolean(error)}
                    className="mt-2 w-full"
                  >
                    <SelectValue placeholder={`Select ${groupName}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleAddonOptions(group).map(({ option, index }) => {
                      const suffix = formatAddonPriceSuffix(
                        option.price,
                        option.priceType,
                        currency,
                      );
                      return (
                        <SelectItem
                          key={`${controlId}-${index}`}
                          value={String(index)}
                        >
                          {decodeHtmlEntities(option.label)}
                          {suffix ? ` ${suffix}` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}

            {group.type === ADDON_TYPE.CustomText && (
              <Input
                id={controlId}
                type={textInputType(group)}
                inputMode={textInputMode(group)}
                placeholder={placeholderFor(group)}
                aria-describedby={describedBy}
                aria-required={group.required}
                aria-invalid={Boolean(error)}
                value={raw === undefined ? UNSET : String(raw)}
                onChange={(e) => set(group.id, e.target.value)}
                className="mt-2"
              />
            )}

            {group.type === ADDON_TYPE.CustomTextarea && (
              <Textarea
                id={controlId}
                placeholder={placeholderFor(group)}
                aria-describedby={describedBy}
                aria-required={group.required}
                aria-invalid={Boolean(error)}
                value={raw === undefined ? UNSET : String(raw)}
                onChange={(e) => set(group.id, e.target.value)}
                className="mt-2"
              />
            )}

            {group.type === ADDON_TYPE.Datepicker && (
              // The gift-card form's answer, and the reason this phase needs no
              // date library: a native date-typed Input.
              <Input
                id={controlId}
                type="date"
                aria-describedby={describedBy}
                aria-required={group.required}
                aria-invalid={Boolean(error)}
                value={raw === undefined ? UNSET : String(raw)}
                onChange={(e) => set(group.id, e.target.value)}
                className="mt-2"
              />
            )}

            {group.type === ADDON_TYPE.InputMultiplier && (
              <Input
                id={controlId}
                type="number"
                inputMode="numeric"
                step={1}
                // Surfaced from the definition as browser affordances only. The
                // store still decides — these are not a validity gate.
                min={bound(group.min) ?? undefined}
                max={bound(group.max) ?? undefined}
                aria-describedby={describedBy}
                aria-required={group.required}
                aria-invalid={Boolean(error)}
                // Default EMPTY, not 0 — a required multiplier must be typed.
                value={raw === undefined ? UNSET : String(raw)}
                onChange={(e) => set(group.id, e.target.value)}
                className="mt-2"
              />
            )}

            {group.type === ADDON_TYPE.CustomPrice && (
              <div className="relative mt-2">
                <span
                  id={`addon-price-prefix-${group.id}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
                >
                  {pricePrefix.symbol}
                </span>
                <Input
                  id={controlId}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={bound(group.min) ?? undefined}
                  max={bound(group.max) ?? undefined}
                  aria-describedby={describedBy}
                  aria-required={group.required}
                  aria-invalid={Boolean(error)}
                  value={raw === undefined ? UNSET : String(raw)}
                  onChange={(e) => set(group.id, e.target.value)}
                  // Derived from the prefix, never a fixed utility class — a
                  // constant reservation for a variable-width symbol is what
                  // put `A$` on top of the shopper's value (UAT gap 2). An
                  // inline style also outranks the primitive's own `px-3`
                  // with no `!important` and no specificity contest.
                  style={{ paddingLeft: pricePrefix.paddingLeft }}
                />
              </div>
            )}

            {(helper || max !== null) && (
              <div className="mt-2 flex items-start justify-between gap-2 text-xs leading-normal text-gray-600">
                {helper ? <span id={helperId}>{helper}</span> : <span />}
                {max !== null &&
                  (group.type === ADDON_TYPE.CustomText ||
                    group.type === ADDON_TYPE.CustomTextarea) && (
                    // Never coloured, even past the maximum, and typing is never
                    // blocked: a colour change would be a client verdict on
                    // validity, and the client does not get a verdict.
                    <span className="shrink-0">
                      {typeof raw === "string" ? raw.length : 0}/{max}
                    </span>
                  )}
              </div>
            )}

            {error ? (
              <p
                id={errorId}
                role="alert"
                className="mt-2 text-sm leading-normal text-red-600"
              >
                {error}
              </p>
            ) : null}
          </div>
        );
      })}

      {rows.length > 0 && (
        <div className="rounded-[3px] bg-primary/5 px-3 py-2">
          <p className="text-xs font-semibold text-primary">Your selection</p>
          <div className="mt-0.5 space-y-0.5">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex items-start justify-between gap-3 text-xs text-gray-600"
              >
                <span>{row.label}</span>
                <span className="shrink-0">{row.suffix}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
            {/* Never a bare "Total", and deliberately quieter than ProductPrice
                above it — this must never read as the authoritative price. */}
            <span className="text-sm text-gray-600">Estimated total</span>
            <span className="text-base font-semibold text-gray-800">
              {formatPrice(estimate, currency)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-600">
            Final price is confirmed in your cart.
          </p>
        </div>
      )}
    </div>
  );
}
