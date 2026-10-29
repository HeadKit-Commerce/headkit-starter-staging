import { unstable_rethrow } from "next/navigation";
import { getLlmsCollections } from "@/lib/markdown/llms-collections";
import { llmsTxtBody, type LlmsCollection } from "@/lib/markdown/llms-txt";
import {
  MARKDOWN_CACHE_CONTROL,
  markdownUnavailable,
} from "@/lib/markdown/response";
import { readMirrorStore } from "@/lib/markdown/store-context";

/**
 * `/llms.txt`: the store, its collections, and how to ask for Markdown.
 *
 * `proxy.ts` already matches `/:key.txt` (IndexNow ownership files), so this
 * path reaches it without a matcher change; `INDEXNOW_KEY_FILE` needs 8+
 * characters and does not claim it.
 *
 * A failed category read degrades to a file with no Collections section rather
 * than a 500 — the rest of the file is still correct.
 */
export async function GET(): Promise<Response> {
  const store = await readMirrorStore();
  if (!store) return markdownUnavailable();

  let collections: LlmsCollection[] = [];
  try {
    collections = await getLlmsCollections();
  } catch (error) {
    unstable_rethrow(error);
  }

  return new Response(llmsTxtBody(store, collections), {
    headers: {
      "Cache-Control": MARKDOWN_CACHE_CONTROL,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
