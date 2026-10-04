import { decodeHtmlEntities } from "@/lib/utils";

/**
 * Named entities `decodeHtmlEntities` does not cover. Category blurbs used to
 * run through sanitize-html, which decodes the full HTML set; this keeps the
 * ones that show up in store copy.
 */
const EXTRA_ENTITIES: Record<string, string> = {
  aacute: "\u00e1",
  acirc: "\u00e2",
  aelig: "\u00e6",
  agrave: "\u00e0",
  aring: "\u00e5",
  atilde: "\u00e3",
  auml: "\u00e4",
  ccedil: "\u00e7",
  eacute: "\u00e9",
  ecirc: "\u00ea",
  egrave: "\u00e8",
  eth: "\u00f0",
  euml: "\u00eb",
  iacute: "\u00ed",
  icirc: "\u00ee",
  igrave: "\u00ec",
  iuml: "\u00ef",
  ntilde: "\u00f1",
  oacute: "\u00f3",
  ocirc: "\u00f4",
  ograve: "\u00f2",
  oslash: "\u00f8",
  otilde: "\u00f5",
  ouml: "\u00f6",
  szlig: "\u00df",
  thorn: "\u00fe",
  uacute: "\u00fa",
  ucirc: "\u00fb",
  ugrave: "\u00f9",
  uuml: "\u00fc",
  yacute: "\u00fd",
  yuml: "\u00ff",
  hellip: "\u2026",
  trade: "\u2122",
  reg: "\u00ae",
  copy: "\u00a9",
  deg: "\u00b0",
  pound: "\u00a3",
  euro: "\u20ac",
  yen: "\u00a5",
  cent: "\u00a2",
  bull: "\u2022",
  middot: "\u00b7",
  times: "\u00d7",
  divide: "\u00f7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  shy: "\u00ad",
  plusmn: "\u00b1",
  micro: "\u00b5",
  para: "\u00b6",
  sect: "\u00a7",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  iexcl: "\u00a1",
  iquest: "\u00bf",
  ordf: "\u00aa",
  ordm: "\u00ba",
  not: "\u00ac",
  macr: "\u00af",
  acute: "\u00b4",
  cedil: "\u00b8",
  uml: "\u00a8",
  brvbar: "\u00a6",
  curren: "\u00a4",
};

/**
 * Plain text for a category blurb. The card renders this as a text node, so
 * tags do not need sanitize-html — that library was shipping the HTML parser
 * into the client carousel.
 */
export function plainTextFromHtml(html: string): string {
  // React renders the result as text, so a tag strip is enough and a script
  // body cannot run. Do not special-case <script>: a closing-tag regexp misses
  // end tags such as `</script >`, which CodeQL reports as a bad HTML filter.
  const stripped = html.replace(/<[^>]+>/g, " ");
  const named = stripped.replace(/&([a-z]+);/gi, (match, name: string) => {
    const extra = EXTRA_ENTITIES[name.toLowerCase()];
    return extra !== undefined ? extra : match;
  });
  return decodeHtmlEntities(named).replace(/\s+/g, " ").trim();
}
