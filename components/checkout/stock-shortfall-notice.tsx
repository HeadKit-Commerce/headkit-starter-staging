import type { StockShortfallNotice as Notice } from "@/lib/stock-shortfall";

/**
 * The amber alert at the top of the order confirmation when items sold out
 * while the payment was processing. `lib/stock-shortfall.ts` owns every word;
 * this file only lays it out (a full-width amber card, a warning icon, the
 * title and the refund sentence).
 *
 * On a fully refunded order the title IS the page's `<h1>` — there is no
 * "order confirmed" heading to sit under — so `headingLevel` is 1 there and 2
 * on a partly refunded one, where the "Thanks, …!" heading follows.
 */
export function StockShortfallNotice({
  notice,
  headingLevel,
}: {
  notice: Notice;
  headingLevel: 1 | 2;
}): React.ReactElement {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  // The refunded amount is bolded; split on its first occurrence.
  const at = notice.amount ? notice.body.indexOf(notice.amount) : -1;
  return (
    <div
      role="alert"
      data-testid="stock-shortfall-notice"
      className="flex items-start gap-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 md:px-6 md:py-5"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-7 w-7 shrink-0 text-amber-700"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="7" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="flex flex-col gap-1.5">
        <Heading
          className={
            headingLevel === 1
              ? "text-2xl font-bold text-gray-900 md:text-[26px]"
              : "text-xl font-bold text-gray-900 md:text-[22px]"
          }
        >
          {notice.title}
        </Heading>
        <p className="text-base leading-normal">
          {at === -1 ? (
            notice.body
          ) : (
            <>
              {notice.body.slice(0, at)}
              <strong className="font-semibold text-gray-900">
                {notice.amount}
              </strong>
              {notice.body.slice(at + notice.amount.length)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
