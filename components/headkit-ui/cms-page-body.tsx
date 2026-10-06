import { EditorialContent } from "@/components/headkit-ui/editorial-content";
import { BlockEditor } from "@/components/headkit-ui/block-editor";
import {
  hasEditorSectionClass,
  processHomepageContent,
  type RawEditorBlock,
} from "@/lib/process-editor-blocks";
import { decodeHtmlEntities } from "@/lib/utils";
import {
  preparePageHtml,
  renderPageMediaSegment,
} from "@/overrides/page-columns";

interface Props {
  /** Page title shown as the H1. */
  title: string;
  /** Untrusted WordPress `content.rendered` HTML (may include GF markers). */
  html: string;
  /**
   * Optional hydrated HeadKit section blocks from `/content/page/{slug}`
   * (hero carousel, project carousel, callouts, etc.). When present, sections
   * render via BlockEditor in document order — same path as the homepage.
   */
  editorBlocks?: RawEditorBlock[] | null | undefined;
  /**
   * Optional fallback when a marker's form cannot load (e.g. GF plugin off).
   * Applied to every form on the page.
   */
  formFallback?: React.ReactNode;
  /**
   * When false, a customer media-column override is not asked to split this
   * HTML. Form pages pass false so the form can take that column.
   */
  splitMedia?: boolean;
}

/** Matches homepage HTML segment padding (`app/page.tsx` HomeContent). */
const CONTENT_PAD = "headkit-cms-page hk-section-content px-5 md:px-10 py-10";

function HtmlSegment({
  html,
  formFallback,
  showTitle,
  title,
  splitMedia,
}: {
  html: string;
  formFallback?: React.ReactNode;
  showTitle: boolean;
  title: string;
  splitMedia: boolean;
}): React.ReactNode {
  if (!html.trim() && !showTitle) return null;

  const columns = renderPageMediaSegment({
    title,
    showTitle,
    html,
    formFallback,
    splitMedia,
  });
  if (columns) return columns;

  return (
    <div className={showTitle ? undefined : "mt-5"}>
      {showTitle ? <h1 className="text-primary">{title}</h1> : null}
      {html.trim() ? (
        <div className={showTitle ? "mt-5" : undefined}>
          <EditorialContent html={html} formFallback={formFallback} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * CMS page body with Gravity Forms hydrated in place and HeadKit section
 * patterns (carousels/callouts).
 *
 * Gravity Form markers stay where WordPress placed them — including inside
 * Columns blocks — so Contact and similar pages use the editor's 2-column
 * layout rather than a React grid. EditorialContent swaps each marker for
 * the React form (see `formFallback` when GF cannot load).
 *
 * When `editorBlocks` include HeadKit sections (hero/project carousels, etc.),
 * those hydrate via BlockEditor in WordPress document order — full-bleed like
 * the homepage (no outer page padding). HTML leftovers keep homepage padding
 * and the standard 45rem / 68rem / full measures.
 *
 * A `headkit-hero-carousel` replaces the page title H1 (carousel slide already
 * renders an H1) so CMS pages like /hospitality do not double up.
 */
export async function CmsPageBody({
  title,
  html,
  editorBlocks,
  formFallback,
  splitMedia = true,
}: Props): Promise<React.JSX.Element> {
  // WordPress `title.rendered` is already entity-encoded. The document
  // title is decoded in makeSeoMetadata. This heading is a text node, so
  // it needs the same decode or React escapes the ampersand again.
  const heading = decodeHtmlEntities(title);
  const rawBlocks = editorBlocks ?? [];
  html = preparePageHtml(html);
  const { segments, blocks } = processHomepageContent(html, rawBlocks);
  const suppressPageTitle = hasEditorSectionClass(
    blocks,
    "headkit-hero-carousel",
  );

  // No HeadKit section patterns — title + editorial (GF markers in place).
  if (blocks.length === 0) {
    const columns = renderPageMediaSegment({
      title: heading,
      showTitle: true,
      html,
      formFallback,
      splitMedia,
    });
    if (columns) {
      return <div className={CONTENT_PAD}>{columns}</div>;
    }
    return (
      <div className={CONTENT_PAD}>
        <h1 className="text-primary">{heading}</h1>
        <div className="mt-5">
          <EditorialContent html={html} formFallback={formFallback} />
        </div>
      </div>
    );
  }

  // Document-order: HeadKit blocks (full-bleed) + leftover HTML (padded).
  let titleShown = false;
  return (
    <>
      {segments.map((seg, index) => {
        if (seg.kind === "block") {
          return (
            <BlockEditor key={`cms-block-${index}`} blocks={[seg.block]} />
          );
        }

        const showTitle = !suppressPageTitle && !titleShown;
        if (showTitle) titleShown = true;
        if (!seg.html.trim() && !showTitle) return null;
        return (
          <section key={`cms-html-${index}`} className={CONTENT_PAD}>
            <HtmlSegment
              html={seg.html}
              formFallback={formFallback}
              showTitle={showTitle}
              title={heading}
              splitMedia={splitMedia}
            />
          </section>
        );
      })}
      {!suppressPageTitle && !titleShown ? (
        <section className={CONTENT_PAD}>
          <h1 className="text-primary">{heading}</h1>
        </section>
      ) : null}
    </>
  );
}
