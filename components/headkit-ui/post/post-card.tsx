"use client";

import { useState, type ReactElement } from "react";
import Image from "next/image";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { CATALOG_GRID_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_POSTS_BASE_PATH, resolvePostHref } from "@/lib/posts-path";
import { isVideoPost, videoEmbed } from "@/lib/post-video";
import { cn, decodeHtmlEntities } from "@/lib/utils";
import { renderPostVideoDialog } from "@/overrides/post-video-dialog";
import type { PostSummaryFieldsFragment } from "@headkit/sdk";

interface PostCardProps {
  post: PostSummaryFieldsFragment;
  textStyle?: "dark" | "light";
  /** Mark early-grid images as LCP candidates. */
  priority?: boolean;
  className?: string;
  /** WP Posts-page slug when `post.uri` is missing. */
  postsBasePath?: string;
  /** Journal grid matches collection tiles (3:4). Carousel stays 16:9. */
  imageRatio?: "video" | "portrait";
}

function PlayMark(): ReactElement {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white">
        <svg
          viewBox="0 0 24 24"
          className="ml-0.5 h-6 w-6 fill-current"
          aria-hidden
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

export function PostCard({
  post,
  textStyle = "dark",
  priority = false,
  className,
  postsBasePath = DEFAULT_POSTS_BASE_PATH,
  imageRatio = "video",
}: PostCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [journal, setJournal] = useState(false);
  const href = resolvePostHref(post.uri ?? post.slug ?? "", postsBasePath);
  const categories = (post.categories ?? []).filter(
    (c) => c.slug !== "uncategorized",
  );
  const title = decodeHtmlEntities(post.title ?? "");
  const video = isVideoPost(post);
  const embed = video ? videoEmbed(post.videoUrl) : null;

  const mediaClass =
    imageRatio === "portrait" ? "aspect-[3/4]" : "aspect-video";

  const body = (
    <div className="w-full">
      {post.featuredImage?.src ? (
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-brand",
            mediaClass,
          )}
        >
          <Image
            alt={post.featuredImage.alt ?? title}
            src={post.featuredImage.src}
            fill
            priority={priority}
            fetchPriority={priority ? "high" : "auto"}
            className="object-cover"
            sizes={CATALOG_GRID_IMAGE_SIZES}
          />
          {video ? <PlayMark /> : null}
        </div>
      ) : embed?.kind === "file" ? (
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-brand bg-gray-100",
            mediaClass,
          )}
        >
          <video
            src={`${embed.src}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <PlayMark />
        </div>
      ) : (
        <div
          className={cn(
            "relative w-full rounded-brand bg-gray-100",
            mediaClass,
          )}
        >
          {video ? <PlayMark /> : null}
        </div>
      )}
      <div className="flex justify-between pt-3">
        <h3
          className={cn("text-[17px] text-primary", {
            "text-pink-500": textStyle === "light",
          })}
        >
          {title}
        </h3>
      </div>
      {categories.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {categories.map((c) => decodeHtmlEntities(c.name ?? "")).join(", ")}
        </p>
      )}
    </div>
  );

  if (!video) {
    return (
      <InstantLink
        href={href}
        className={cn("block", className)}
      >
        {body}
      </InstantLink>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn("block w-full text-left", className)}
        onClick={(event) => {
          setJournal(event.currentTarget.closest(".headkit-home") !== null);
          setOpen(true);
        }}
        aria-label={`Play ${title}`}
      >
        {body}
      </button>
      {renderPostVideoDialog({
        open,
        onOpenChange: setOpen,
        title,
        embed,
        excerpt: decodeHtmlEntities(post.excerpt ?? ""),
        href,
        journal,
      }) ?? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <DialogDescription className="sr-only">
              {embed
                ? "Video"
                : "This video does not have a playable file yet."}
            </DialogDescription>
            {embed?.kind === "iframe" ? (
              <iframe
                src={embed.src}
                title={title}
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : embed?.kind === "file" ? (
              <video controls src={embed.src} className="aspect-video w-full" />
            ) : (
              <p className="px-6 py-16 text-center text-sm text-white">
                This video does not have a playable file yet.
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
