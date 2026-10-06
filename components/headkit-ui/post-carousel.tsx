import { Carousel } from "@/components/headkit-ui/carousel";
import { PostCard } from "@/components/headkit-ui/post-card";
import { DEFAULT_POSTS_BASE_PATH } from "@/lib/posts-path";
import type { Post } from "@headkit/sdk";

interface Props {
  posts: Pick<Post, "title" | "slug" | "featuredImage" | "uri">[];
  /** Public posts base path (WP Posts page slug). */
  postsBasePath?: string;
}

const PostCarousel = ({
  posts,
  postsBasePath = DEFAULT_POSTS_BASE_PATH,
}: Props) => {
  return (
    <Carousel
      className="w-full pb-8"
      showPagination={false}
    
    >
      {posts.map((post, index) => (

        <PostCard

          key={index}
          title={post.title}
          image={post?.featuredImage?.src ?? ""}
          uri={post.uri ?? post.slug}
          postsBasePath={postsBasePath}
        />
      
      ))}
    </Carousel>
  );
};

export { PostCarousel };
