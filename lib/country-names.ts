/**
 * ISO 3166-1 alpha-2 codes and their English display names, from `Intl`
 * rather than a hand-typed table, so no store's selling region is baked into
 * the template.
 *
 * WooCommerce validates a country against `allowed_countries`, a CODE list, so
 * every address that leaves the storefront for a finalize must carry a code:
 * "Australia" is rejected exactly like "" (`lib/finalize-address.ts`). The
 * reverse lookup here is what turns a display name a form or wallet produced
 * back into one.
 */

/**
 * Two-letter codes `Intl` names that are NOT assigned ISO 3166-1 countries:
 * aggregates (`EU`, `UN`), exceptional reservations (`AC`, `IC`, `UK`, …) and
 * withdrawn codes (`DD`, `SU`, `YU`, …). Excluded because each would otherwise
 * claim a real country's name in the reverse lookup — `UK` and `FX` sort after
 * `GB` and `FR` and would map "United Kingdom" and "France" to codes
 * WooCommerce rejects.
 */
const NON_ISO_REGIONS: ReadonlySet<string> = new Set([
  "AC",
  "AN",
  "BU",
  "CP",
  "CQ",
  "CS",
  "DD",
  "DG",
  "DY",
  "EA",
  "EU",
  "EZ",
  "FX",
  "HV",
  "IC",
  "NH",
  "QO",
  "RH",
  "SU",
  "TA",
  "TP",
  "UK",
  "UN",
  "VD",
  "YD",
  "YU",
  "ZR",
  "ZZ",
]);

let regionNames: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (regionNames !== undefined) return regionNames;
  try {
    regionNames = new Intl.DisplayNames(["en"], {
      type: "region",
      fallback: "none",
    });
  } catch {
    regionNames = null;
  }
  return regionNames;
}

let codesByName: Map<string, string> | null = null;
let assignedCodes: string[] | null = null;

/**
 * Every two-letter code `Intl` names, minus {@link NON_ISO_REGIONS} and the
 * `X?` user-assigned block (`XK`, Kosovo, excepted — WooCommerce lists it).
 * Computed once.
 */
function buildTables(): { byName: Map<string, string>; codes: string[] } {
  if (codesByName && assignedCodes) {
    return { byName: codesByName, codes: assignedCodes };
  }
  const byName = new Map<string, string>();
  const codes: string[] = [];
  const names = displayNames();
  if (names) {
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        if (NON_ISO_REGIONS.has(code)) continue;
        if (code.startsWith("X") && code !== "XK") continue;
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          name = undefined;
        }
        if (!name || name === code) continue;
        codes.push(code);
        if (!byName.has(name.toLowerCase())) {
          byName.set(name.toLowerCase(), code);
        }
      }
    }
  }
  codesByName = byName;
  assignedCodes = codes;
  return { byName, codes };
}

/**
 * Normalise a country to an upper-case ISO-2 code, or "" when it is not one:
 * a two-letter value is upper-cased, an English display name ("New Zealand")
 * is mapped back to its code, anything else answers "".
 */
export function countryCodeFrom(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return buildTables().byName.get(raw.toLowerCase()) ?? "";
}

/** An ISO-2 code as an English country name, or the code itself. */
export function countryName(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return code.trim();
  try {
    return displayNames()?.of(trimmed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * "Australia or New Zealand" — the list a shopper reads, never codes. The
 * conjunction is the sentence's choice: alternatives read "or", a set the
 * store serves ("We deliver to …") reads "and".
 */
export function countryNameList(
  codes: readonly string[],
  conjunction: "or" | "and" = "or",
): string {
  const names = codes.map((code) => countryName(code));
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

/** Every assignable country code, sorted by English name. */
export function allCountryCodes(): string[] {
  return [...buildTables().codes].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), "en"),
  );
}
