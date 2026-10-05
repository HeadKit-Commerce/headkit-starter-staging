import sanitize from "sanitize-html";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { TitleEmphasis } from "@/components/headkit-ui/title-emphasis";
import { cn, decodeHtmlEntities } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  allButton?: string;
  allButtonPath?: string;
  allButtonTarget?: string;
  className?: string;
}

/**
 * Section title + optional description stacked under the title, with the
 * “View all” CTA aligned to the right on desktop.
 */
export function SectionHeader({
  title,
  description,
  allButton,
  allButtonPath,
  allButtonTarget,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "headkit-section-header flex w-full flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-2xl flex-col gap-2">
        <h2 className="text-primary">
          <TitleEmphasis text={title} highlight />
        </h2>
        {description ? (
          <div
            className="font-medium text-primary [&_p]:m-0"
            dangerouslySetInnerHTML={{ __html: sanitize(description) }}
          />
        ) : null}
      </div>

      {allButton ? (
        <div className="shrink-0 font-semibold md:pb-0.5">
          <InstantLink
            href={allButtonPath || "/"}
            prefetch={true}
            pendingVariant="text"
            target={allButtonTarget ?? ""}
            className="underline"
          >
            {decodeHtmlEntities(allButton)}
          </InstantLink>
        </div>
      ) : null}
    </div>
  );
}
