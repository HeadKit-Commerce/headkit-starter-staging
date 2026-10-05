import { isFlagOptedIn } from "@/lib/nav-interaction-flags";

/**
 * WHEN the marketing tag stack loads, and the one place that decision is read.
 *
 * `DeferredThirdPartyScripts` has always deferred the stack; what changed is
 * what it defers UNTIL. It used to schedule straight from its effect with
 * `requestIdleCallback(..., { timeout: 4000 })`, and an idle callback is only
 * ever as late as the main thread is busy — on the Bike Society fork, measured
 * on the deployed store, gtm.js started at 250-265 ms while the `load` event
 * was at 1,405-1,717 ms, so the whole third-party stack arrived 1,151-1,467 ms
 * BEFORE the page finished loading, squarely inside a ~5.9 s LCP window.
 * `DeferredThirdPartyScripts` no longer reads this switch. Every store loads
 * Google Tag Manager through `@next/third-parties/google` `GoogleTagManager`,
 * which runs after hydration. The function remains so an existing env value
 * does not become an unknown export.
 *
 * THIS IS A PLATFORM-WIDE TIMING CHANGE, so it carries a way back.
 * `NEXT_PUBLIC_THIRD_PARTY_EAGER` restores the previous schedule for one
 * store, with no code change and no fork:
 *
 *   unset / absent      -> DEFERRED (the default): first pointer, key, or
 *                          scroll. No timer. A visit with no gesture is not
 *                          tagged.
 *   ""                  -> DEFERRED (a platform env editor stores a cleared
 *                          variable as an empty string, and "I cleared it"
 *                          must read as "use the default")
 *   "true" / "1"        -> EAGER: schedule from MOUNT with
 *   "on" / "yes"           `requestIdleCallback({ timeout: 4000 })`, which is
 *                          byte-for-byte what every storefront did before this
 *                          change. No load wait, and therefore no ceiling —
 *                          there is nothing to be ceiling-ed against.
 *   anything else       -> DEFERRED (a typo must not silently move analytics
 *                          timing back; the failure mode of an unrecognised
 *                          value is "the switch did nothing")
 *
 * WHAT EAGER BUYS, and it is the only reason the hatch exists: under the
 * default, a visit with no gesture is not counted, and Klaviyo's on-site
 * popups wait for that gesture. A store whose analytics or popup timing
 * matters more than its paint can have the old behaviour back; it should not
 * be the platform default, because the tag stack in the paint window is a
 * pure loss.
 *
 * ORTHOGONAL TO CONSENT, and that must stay true. `consentEnabled` decides
 * WHETHER a Consent Mode default is pushed; this decides WHEN the container
 * loads. The default is pushed inside the same `load()` call that injects
 * gtm.js, immediately before the `gtm.start` message, so it precedes the
 * container IN THE DATALAYER under BOTH values of this switch — neither may
 * ever be read from the other.
 *
 * READ AS A LITERAL MEMBER EXPRESSION, not through `lib/env.ts`. Next inlines
 * `process.env.NEXT_PUBLIC_*` into the client bundle only where the name
 * appears verbatim in the source. It is still DECLARED in `lib/env.ts`'s
 * client schema, which is where an operator looks for the full variable set —
 * the same split `lib/nav-interaction-flags.ts` uses, and `isFlagOptedIn` is
 * borrowed from there so there is one table of recognised on-values, not two.
 */
export function thirdPartyEagerLoadEnabled(): boolean {
  return isFlagOptedIn(process.env.NEXT_PUBLIC_THIRD_PARTY_EAGER);
}
