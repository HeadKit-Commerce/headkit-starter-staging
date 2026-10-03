import { describe, expect, it } from "vitest";
import { navPrefetchHrefs } from "./nav-prefetch-hrefs";

describe("navPrefetchHrefs", () => {
  it("includes dropdown collection links and skips home, hashes, and duplicates", () => {
    expect(
      navPrefetchHrefs([
        {
          uri: "/collections/outdoor-furniture",
          children: [
            { uri: "/collections/outdoor-furniture/" },
            {
              uri: "#",
              children: [
                {
                  uri: "/collections/outdoor-furniture/outdoor-seating/outdoor-dining-chairs",
                },
              ],
            },
          ],
        },
        { uri: "/" },
        { uri: "mailto:hello@example.com" },
        { uri: "https://example.com/elsewhere" },
      ]),
    ).toEqual([
      "/collections/outdoor-furniture",
      "/collections/outdoor-furniture/outdoor-seating/outdoor-dining-chairs",
    ]);
  });
});
