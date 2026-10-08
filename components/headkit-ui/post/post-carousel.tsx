import { Carousel } from "@/components/headkit-ui/carousel";
import { PostCard } from "./post-card";
import { DEFAULT_POSTS_BASE_PATH } from "@/lib/posts-path";
import type { Post, PostSummaryFieldsFragment } from "@headkit/sdk";

interface PostCarouselProps {
  posts: (PostSummaryFieldsFragment | Post)[];
  /** Public posts base path (WP Posts page slug). */
  postsBasePath?: string;
}

export function PostCarousel({
  posts,
  postsBasePath = DEFAULT_POSTS_BASE_PATH,
}: PostCarouselProps) {
  return (
    <Carousel className="w-full pb-8" showPagination={false}>
      {posts.map((post, index) => (
        <PostCard
          key={index}
          post={post as PostSummaryFieldsFragment}
          textStyle="dark"
          postsBasePath={postsBasePath}
        />
      ))}
    </Carousel>
  );
}
