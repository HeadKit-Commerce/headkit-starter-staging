import { decodeHtmlEntities } from "@/lib/utils";

export type MarkdownFrontmatterInput = {
  canonicalUrl: string;
  title: string;
  /**
   * Optional under `exactOptionalPropertyTypes`: callers pass an explicit
   * `undefined` when the description is empty.
   */
  description?: string | undefined;
};

/** YAML frontmatter. JSON strings are valid YAML double-quoted scalars. */
export function markdownFrontmatter({
  canonicalUrl,
  description,
  title,
}: MarkdownFrontmatterInput): string {
  const fields = [
    `title: ${JSON.stringify(title)}`,
    description ? `description: ${JSON.stringify(description)}` : null,
    `canonical_url: ${JSON.stringify(canonicalUrl)}`,
  ].filter((field) => field !== null);
  return ["---", ...fields, "---"].join("\n");
}

/**
 * Escape store-supplied text for ONE line of Markdown (a heading, a list item,
 * link text, a blockquote line).
 *
 * - Line breaks collapse to a space first: a name carrying `\n\n[x](y)` must
 *   not be able to open a second block.
 * - The backslash is escaped BEFORE every other metacharacter. Done the other
 *   way round, the `\` that escaping a `*` adds would itself be doubled, and a
 *   trailing `\` in the input would swallow the next character's escape.
 * - `<` and `>` are escaped so a renderer cannot take them for raw HTML.
 * - A marker at the start of the line (`#`, `>`, `-`, `+`, `1.`) is escaped so
 *   the text cannot turn its own line into a heading, quote or list.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/[|*_`[\]<>]/g, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^[#>+-]/, "\\$&");
}

/** Plain text of a WordPress HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string | null | undefined): string {
  return decodeHtmlEntities((html ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of `text`, cut to `maxLength` with an ellipsis. */
export function summarizeText(text: string, maxLength = 200): string {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return "";
  const [firstSentence = source] = source.split(/(?<=[.!?])\s+/, 1);
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}
