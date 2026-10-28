import { NextResponse } from "next/server";
import { resetPasswordRedirectUrl } from "@/lib/reset-password-link";

/**
 * GET /reset-password?key=…&login=… — 307 to `/account/reset-password`.
 *
 * The WordPress theme emails this path (before theme 0.4.99); the form is at
 * `/account/reset-password`. This route is the storefront half of the fix and
 * also rescues links already in inboxes (reset keys live 24 h). 307, not 308:
 * the link is single-use and must never be cached as a permanent move.
 *
 * A route handler outranks the `/[...slug]` catch-all, and `proxy.ts` passes
 * this path through untouched. It is not in the sitemap, and `robots.ts` does
 * not need to name it: it is a redirect with no content.
 */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(resetPasswordRedirectUrl(request.url), 307);
}
