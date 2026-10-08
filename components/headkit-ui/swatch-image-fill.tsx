"use client";

import { Suspense, use, useEffect, useState } from "react";
import Image from "next/image";
import { fetchSwatchImages } from "@/lib/swatch-image-action";
import { commerceOriginFromImageSrc, swatchImageKey } from "@/lib/swatch-image";
import { useSwatchImageContext } from "@/components/headkit-ui/swatch-image-provider";
import type { SwatchImageStream } from "@/lib/swatch-image";

const ATTRIBUTE_ID = /^[0-9]+$/;
const pending = new Map<string, Promise<Record<string, string>>>();

function attributeSwatchImages(
  origin: string,
  attributeId: string,
): Promise<Record<string, string>> {
  const key = `${origin}|${attributeId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = fetchSwatchImages(origin, attributeId).catch(
    () => ({}) as Record<string, string>,
  );
  pending.set(key, promise);
  return promise;
}

function SwatchPhoto({
  src,
  size,
}: {
  src: string;
  size: "small" | "default";
}) {
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={size === "default" ? "24px" : "16px"}
      quality={50}
      priority={false}
      loading="lazy"
      fetchPriority="low"
      className="object-cover"
    />
  );
}

function FilledSwatchPhoto({
  attributeId,
  optionSlug,
  commerceSrc,
  size,
}: {
  attributeId: string;
  optionSlug: string;
  commerceSrc: string;
  size: "small" | "default";
}) {
  const origin = commerceOriginFromImageSrc(commerceSrc);
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    void attributeSwatchImages(origin, attributeId).then((images) => {
      if (cancelled) return;
      setSrc(images[swatchImageKey(attributeId, optionSlug)] ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [attributeId, optionSlug, origin]);
  if (!src) return null;
  return <SwatchPhoto src={src} size={size} />;
}

function StreamedSwatchPhoto({
  promise,
  attributeId,
  optionSlug,
  commerceSrc,
  size,
}: {
  promise: Promise<SwatchImageStream>;
  attributeId: string;
  optionSlug: string;
  commerceSrc: string;
  size: "small" | "default";
}) {
  const result = use(promise);
  const key = swatchImageKey(attributeId, optionSlug);
  const src = result.images[key];
  if (src) return <SwatchPhoto src={src} size={size} />;
  if (result.covered[key]) return null;
  return (
    <FilledSwatchPhoto
      attributeId={attributeId}
      optionSlug={optionSlug}
      commerceSrc={commerceSrc}
      size={size}
    />
  );
}

/**
 * The photo inside a colour chip. An image already on the product renders
 * through `next/image` whether or not the experimental lookup is on. A missing
 * image streams in only when the layout has enabled the lookup.
 */
export function SwatchPhotoLayer({
  imageSrc,
  attributeId,
  optionSlug,
  commerceSrc,
  size,
}: {
  imageSrc: string;
  attributeId?: string;
  optionSlug: string;
  commerceSrc?: string;
  size: "small" | "default";
}) {
  const { enabled, promise } = useSwatchImageContext();
  if (imageSrc) return <SwatchPhoto src={imageSrc} size={size} />;
  if (!enabled || !attributeId || !optionSlug) return null;
  if (!ATTRIBUTE_ID.test(attributeId)) return null;
  if (promise) {
    return (
      <Suspense fallback={null}>
        <StreamedSwatchPhoto
          promise={promise}
          attributeId={attributeId}
          optionSlug={optionSlug}
          commerceSrc={commerceSrc ?? ""}
          size={size}
        />
      </Suspense>
    );
  }
  if (!commerceSrc) return null;
  return (
    <FilledSwatchPhoto
      attributeId={attributeId}
      optionSlug={optionSlug}
      commerceSrc={commerceSrc}
      size={size}
    />
  );
}
