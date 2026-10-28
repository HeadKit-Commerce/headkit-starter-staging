import { describe, expect, it } from "vitest";
import { isAssetLikeSlug } from "./catch-all-slug-guard";

describe("isAssetLikeSlug", () => {
  it.each([
    [["wp-content", "uploads", "2019", "photo.jpg"]],
    [["wp-admin"]],
    [["wp-admin", "setup-config.php"]],
    [["wp-includes", "js", "x"]],
    [["wp-json", "wp", "v2", "users"]],
    [[".well-known", "x"]],
    [["cgi-bin", "test"]],
    [["WP-Content", "x"]],
    [["favicon-96x96.png"]],
    [["apple-touch-icon.PNG"]],
    [["sitemap.xml"]],
    [["xmlrpc.php"]],
    [["assets", "app.js.map"]],
  ])("refuses %j", (segments) => {
    expect(isAssetLikeSlug(segments)).toBe(true);
  });

  it.each([
    [["about"]],
    [["contact-us"]],
    [["legal", "privacy-policy"]],
    [["size-guide"]],
    [["our-story"]],
    // A dot in a NON-final segment is not an extension probe.
    [["v1.2", "notes"]],
    [["wp-contents"]],
    [[]],
  ])("serves %j", (segments) => {
    expect(isAssetLikeSlug(segments)).toBe(false);
  });
});
