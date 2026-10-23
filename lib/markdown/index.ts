export function markdownFrontmatter({
  canonicalUrl,
  description,
  lastUpdated,
  title,
}: {
  canonicalUrl: string;
  description?: string;
  lastUpdated?: string;
  title: string;
}): string {
  // JSON strings are valid YAML double-quoted scalars.
  const fields = [
    `title: ${JSON.stringify(title)}`,
    description ? `description: ${JSON.stringify(description)}` : null,
    `canonical_url: ${JSON.stringify(canonicalUrl)}`,
    lastUpdated ? `last_updated: ${JSON.stringify(lastUpdated)}` : null,
  ].filter((field) => field !== null);
  return ["---", ...fields, "---"].join("\n");
}

export function escapeMarkdown(text: string): string {
  // Backslashes first so later escapes cannot be undone by a trailing `\`.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[|*_`\[\]]/g, "\\$&")
    .replace(/^#/gm, "\\#");
}

export function summarizeText(text: string, maxLength = 200): string {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return "";
  const [firstSentence = source] = source.split(/(?<=[.!?])\s+/, 1);
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}
