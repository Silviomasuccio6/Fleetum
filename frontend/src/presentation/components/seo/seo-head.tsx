import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";

const SITE_URL = "https://fleetum.it";
const DEFAULT_OG_IMAGE = `${SITE_URL}/brand/fleetum-social-preview.png`;

type SeoHeadProps = {
  title: string;
  description: string;
  canonicalPath?: string;
  ogImage?: string;
  type?: "website" | "article";
  children?: ReactNode;
};

const absoluteUrl = (pathOrUrl: string) => {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
};

export const SeoHead = ({
  title,
  description,
  canonicalPath = "/",
  ogImage = DEFAULT_OG_IMAGE,
  type = "website",
  children
}: SeoHeadProps) => {
  const canonical = absoluteUrl(canonicalPath);
  const image = absoluteUrl(ogImage);

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="Fleetum - Il sistema operativo per autonoleggi moderni" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      {children}
    </Helmet>
  );
};
