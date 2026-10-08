/**
 * What a failed dashboard branding read is allowed to persist.
 *
 * A return value inside `"use cache"` is a successful fill. Next stores it,
 * and a later revalidation that returns the empty default replaces a good
 * logo with the HeadKit Demo wordmark. A throw is not saved, so the previous
 * logo entry stays.
 *
 * A throw during `next build` is different: Next records it in the prerender
 * error map and fails the build even when the caller catches it. The build
 * path still returns the empty default. That copy is cached for the
 * deployment; a runtime revalidation that then throws does not overwrite it.
 */

export class BrandingUnavailableError extends Error {
  constructor() {
    super("dashboard branding unavailable");
    this.name = "BrandingUnavailableError";
  }
}

/** What to persist when dashboard branding cannot be read (env IS set). */
export function brandingCacheOnDashboardMiss(
  phase: string | undefined,
): "default" | "throw" {
  if (phase === "phase-production-build") return "default";
  return "throw";
}
