"use client";

import { Suspense, type ReactNode } from "react";

/**
 * One selective-hydration unit.
 *
 * The streaming guide treats each Suspense boundary as its own hydration
 * task, so React can paint the shell and yield before this subtree runs.
 * https://nextjs.org/docs/app/guides/streaming#inp-interaction-to-next-paint
 *
 * Fallback is null: nothing here reads request-time data, so the server
 * still sends the finished HTML. Do not put an LCP image, the product
 * title, or the collection grid in this boundary. A completed boundary
 * over `progressiveChunkSize` is outlined into a hidden segment
 * (AGENTS.md, "Cached content renders OUTSIDE the boundary").
 */
export function HydrateLater({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return <Suspense fallback={null}>{children}</Suspense>;
}
