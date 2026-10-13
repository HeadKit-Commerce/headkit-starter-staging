import Image from "next/image";
import { InstantLink } from "@/components/headkit-ui/instant-link";
import { DEFAULT_POSTS_BASE_PATH, resolvePostHref } from "@/lib/posts-path";
import { decodeHtmlEntities } from "@/lib/utils";

interface Props {
  title: string;
  image: string;
  /** Storefront-relative URI (`/insights/…`) or bare post slug. */
  uri: string;
  /** WP Posts-page slug when `uri` is a bare slug. */
  postsBasePath?: string;
}

const PostCard = ({
  title,
  image,
  uri,
  postsBasePath = DEFAULT_POSTS_BASE_PATH,
}: Props) => {
  const decodedTitle = decodeHtmlEntities(title);
  const href = resolvePostHref(uri, postsBasePath);
  return (
    <InstantLink href={href} className="block group">
      <div className="relative aspect-video w-full overflow-hidden rounded-brand bg-gray-100">
        {image && (
          <Image
            src={image}
            alt={decodedTitle}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 91vw, (max-width: 1024px) 50vw, 33vw"
          />
        )}
      </div>
      <h3 className="mt-3 text-[17px] leading-normal text-primary group-hover:underline">
        {decodedTitle}
      </h3>
    </InstantLink>
  );
};

export { PostCard };
