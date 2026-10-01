/**
 * The ONE form-control surface for the storefront template.
 *
 * Every text-entry control the storefront renders in its own HTML — `Input`,
 * `Textarea`, `SelectTrigger` — composes `FORM_CONTROL_SURFACE`, and the two
 * boolean controls (`Checkbox`, `RadioGroupItem`) compose
 * `FORM_CONTROL_BOOLEAN_SURFACE`. There is deliberately no second copy: a
 * storefront that styles its fields per call site drifts one field at a time,
 * which is exactly the state this replaced (four implementations, below).
 *
 * `apps/starter` is the template every customer store is generated from, so a
 * neutral default here is not one store's cosmetic bug — it ships to every
 * store that has ever been generated.
 *
 * ## What "correct" is, and where it comes from
 *
 * The reference is CHECKOUT. Checkout's fields are Stripe Elements, styled from
 * `lib/stripe-appearance.ts`, which reads the dashboard brand tokens off
 * `:root` and hands Stripe concrete strings. So the values below are not a new
 * palette — they are the same tokens Stripe is already given, expressed as
 * Tailwind utilities:
 *
 * | Stripe `.Input` rule                  | token                  | utility here                |
 * | ------------------------------------- | ---------------------- | --------------------------- |
 * | `outline: 1px solid ${primary}`       | `--color-primary`      | `border-primary`            |
 * | `borderRadius: ${radius}`             | `--radius`             | `rounded-md`                |
 * | `:focus` → `2px solid ${primary}`     | `--color-primary`      | `focus-visible:ring-1`      |
 * | `:focus` → `fontWeight: 500`          | —                      | `focus-visible:font-medium` |
 * | `colorTextPlaceholder: "#76766B"`     | `--color-gray-700`     | `placeholder:text-gray-700` |
 *
 * There is NO literal colour here on purpose. `--color-primary`, `--radius` and
 * `--color-primary-text` are the tokens `app/layout.tsx` overrides per store
 * from the dashboard branding, so each generated store inherits its OWN brand
 * edge from the same utilities. A hex would pin every store to one brand; the
 * guard test in `form-control-surface.test.tsx` refuses one.
 *
 * `--color-primary` and `--color-primary-text` are declared in `@theme` (not
 * `@theme inline`) in `app/globals.css`, which is what makes the VARIANT forms
 * used below (`focus-visible:ring-primary`, `data-[state=checked]:bg-primary`)
 * generate at all. The hand-written `.bg-primary` / `.text-on-primary` rules in
 * that file's `@layer utilities` block do not get variants — its own comment
 * says so — so the checked fill must name `text-primary-text`, the theme token,
 * and never `text-on-primary`.
 *
 * ## The focus ring is 1px ON PURPOSE
 *
 * Stripe's focus state is a 2px solid outline with `focusBoxShadow: none` — a
 * thickened edge, not a glow. A 1px `border-primary` plus a 1px `ring-primary`
 * at `ring-offset-0` paints exactly that 2px band and shifts no layout (the
 * ring is a box-shadow). The `ring-offset-2` these controls used to carry drew
 * a white gap and then a near-black ring, which is a different visual language
 * from checkout and is the thing that read as un-branded.
 *
 * ## `dark:` overrides were REMOVED, and they were LIVE here
 *
 * Nothing in this app puts a `dark` class on `<html>` (searched: no
 * `classList`/`className` write of one anywhere in `apps/starter`), so the
 * shadcn `dark:` variants these components shipped with looked dead. They are
 * not. `apps/starter` declares no `@custom-variant dark` — `@custom-variant`
 * appears nowhere in the repo — so Tailwind v4's BUILT-IN `dark` variant
 * applies, and that compiles to `@media (prefers-color-scheme: dark)`. Every
 * visitor whose OS is in dark mode was getting them. They all re-asserted the
 * same neutral values as the light defaults, which is why nobody noticed.
 *
 * Whether one would have DEFEATED this change comes down to byte order in the
 * emitted stylesheet. MEASURED 2026-10-01 by running `app/globals.css` through
 * this app's own `@tailwindcss/postcss` plugin over `apps/starter` as the
 * content base (unminified, 153,585 bytes — the same plugin `next build` uses,
 * so the ORDER is the shipped order even though minified offsets differ):
 * the first `@media (prefers-color-scheme: dark)` block opens at byte 128928,
 * and every GENERATED utility this surface relies on sits BEFORE it —
 * `ring-primary` at 82198, `placeholder:text-gray-700` at 92046,
 * `focus-visible:ring-primary` at 103309, `aria-invalid:border-red-500` at
 * 104915, `data-[state=checked]:bg-primary` at 108412. A `dark:` twin of any of
 * those is later, in the same layer, at the same specificity — and therefore
 * WINS.
 *
 * `border-primary` is the one exception, and it is luck rather than design.
 * It is emitted TWICE: Tailwind generates it from the `@theme` token at 59805,
 * which the dark block would beat, and `app/globals.css` ALSO hand-writes it
 * inside its own `@layer utilities`, which lands at 144079 — after the dark
 * block. The second copy is the whole reason the brand border survives
 * `dark:border-neutral-200`, and it exists for an unrelated reason.
 *
 * So of the five properties those overrides touched, only the BORDER was safe;
 * the focus ring, placeholder, background and checked fill would all have
 * reverted to neutral for dark-mode visitors. Do not reintroduce a `dark:`
 * variant on a form control without a dark palette to go with it, and do not
 * reason about one from the border case.
 *
 * ## The error colour is the REPO'S, not Stripe's, and they differ
 *
 * `FormControl` (`components/ui/form.tsx`) already sets `aria-invalid` from
 * react-hook-form's error state on every wrapped field, so `aria-invalid:`
 * lights these controls up with no call-site change. It resolves to `red-500` —
 * the colour `FormMessage` and `FormLabel` already paint the error TEXT, so the
 * field edge matches the sentence under it. Stripe's invalid outline is
 * `#E01577`, the `danger` literal in `lib/stripe-appearance.ts`'s `FALLBACKS`.
 * There is no `--color-danger` token to unify them with; one is not invented
 * here. (`form.tsx` also carries `dark:text-red-900` on the error text, so in
 * dark mode the SENTENCE moves while this edge does not — same missing token,
 * same open gap, and out of this surface's reach.)
 *
 * ## What this replaced
 *
 * Four implementations, all live at once:
 *   1. these components — `border-neutral-200`, `ring-neutral-950` focus;
 *   2. checkout's own steps — raw `<input className="border rounded-md p-2
 *      w-full">`, which takes `--color-gray-200` from the `@layer base` reset
 *      and has no focus ring at all;
 *   3. the account/auth pages — raw `<input>` with a branded `focus:ring-primary`
 *      but an un-branded resting border;
 *   4. Stripe Elements — the only branded one.
 */

/**
 * Text-entry surface: `Input`, `Textarea`, `SelectTrigger`, and the one native
 * `<select>` left in the template (`components/quote/quote-checkout.tsx`).
 *
 * Carries colour, radius and state only — no sizing. Each control keeps its own
 * height/padding/typography so a textarea's `min-h` and a trigger's flex row do
 * not have to be unpicked from a shared string.
 */
export const FORM_CONTROL_SURFACE =
  "rounded-md border border-primary bg-white placeholder:text-gray-700 " +
  "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:font-medium " +
  "aria-invalid:border-red-500 aria-invalid:focus-visible:ring-red-500 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The same surface for a control the primitive drives with `focus:` rather than
 * `focus-visible:` — `SelectTrigger` keeps Radix's own focus semantics, where a
 * pointer-opened trigger is focused and must still show the ring.
 */
export const FORM_CONTROL_SURFACE_FOCUS_WITHIN =
  "rounded-md border border-primary bg-white placeholder:text-gray-700 " +
  "focus:outline-hidden focus:ring-1 focus:ring-primary focus:ring-offset-0 " +
  "aria-invalid:border-red-500 aria-invalid:focus:ring-red-500 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Boolean surface: `Checkbox`.
 *
 * Mirrors Stripe's `.CheckboxInput` family — a 1px primary edge on white,
 * filled with primary when checked, with the checkmark in the brand's
 * on-primary colour (`--color-primary-text`) rather than a hard-coded white.
 * The checked fill is what makes these read as the same control family as the
 * text fields beside them.
 *
 * Both the Radix `data-[state=checked]` and the Base UI `data-[checked]`
 * selectors are named. `apps/starter` on `staging` is Radix; `main` has already
 * migrated it to Base UI (#546), where the attribute is `data-checked`. Naming
 * both costs one dead selector per primitive and means the promotion merge
 * cannot silently drop the checked fill. Drop the stale half when the two
 * branches agree on one primitive.
 *
 * `RadioGroupItem` deliberately does NOT compose this: its dot is drawn by the
 * indicator in `currentColor`, so a filled circle would swallow its own dot.
 * It keeps a white fill and `text-primary`, written out in `radio-group.tsx`.
 */
export const FORM_CONTROL_BOOLEAN_SURFACE =
  "border border-primary bg-white " +
  "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "data-[state=checked]:bg-primary data-[state=checked]:text-primary-text " +
  "data-[checked]:bg-primary data-[checked]:text-primary-text";
