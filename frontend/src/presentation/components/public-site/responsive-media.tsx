import type { CSSProperties, ImgHTMLAttributes } from "react";

type ResponsiveMediaProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  src: string;
  avifSrc?: string;
  avifSrcSet?: string;
  webpSrc?: string;
  webpSrcSet?: string;
  fallbackSrcSet?: string;
  pictureClassName?: string;
  priority?: boolean;
  aspectRatio?: CSSProperties["aspectRatio"];
};

export const ResponsiveMedia = ({
  src,
  avifSrc,
  avifSrcSet,
  webpSrc,
  webpSrcSet,
  fallbackSrcSet,
  pictureClassName = "",
  priority = false,
  aspectRatio,
  loading,
  decoding = "async",
  style,
  ...imageProps
}: ResponsiveMediaProps) => {
  const fetchPriorityAttribute = priority ? { fetchpriority: "high" } : {};

  return (
    <picture className={`fleetum-responsive-media ${pictureClassName}`.trim()}>
      {avifSrc || avifSrcSet ? (
        <source type="image/avif" srcSet={avifSrcSet ?? avifSrc} sizes={imageProps.sizes} />
      ) : null}
      {webpSrc || webpSrcSet ? (
        <source type="image/webp" srcSet={webpSrcSet ?? webpSrc} sizes={imageProps.sizes} />
      ) : null}
      <img
        {...imageProps}
        {...fetchPriorityAttribute}
        src={src}
        srcSet={fallbackSrcSet}
        loading={priority ? "eager" : (loading ?? "lazy")}
        decoding={decoding}
        style={{ ...style, ...(aspectRatio ? { aspectRatio } : {}) }}
      />
    </picture>
  );
};
