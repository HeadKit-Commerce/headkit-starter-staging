import sanitize from "sanitize-html";

/**
 * FAQ answers are injected as HTML. Sanitize on the server, inside the FAQ
 * page cache, so the client accordion does not import sanitize-html.
 * Defaults match the allowlist the accordion used to apply in the browser.
 */
export function sanitizeFaqAnswers<T extends { answer: string }>(
  faqs: readonly T[],
): T[] {
  return faqs.map((faq) => ({ ...faq, answer: sanitize(faq.answer) }));
}
