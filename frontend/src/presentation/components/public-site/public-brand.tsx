import { ResponsiveMedia } from "./responsive-media";

type PublicBrandProps = {
  tone?: "light" | "dark";
  compact?: boolean;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
};

const brandAssets = {
  dark: {
    logo: "/brand/fleetum-logo-for-dark-bg.svg",
    logoWebp: "/brand/fleetum-logo-on-dark.webp",
    logoWidth: 320,
    logoHeight: 85,
    symbol: "/brand/fleetum-symbol-for-dark-bg.svg",
    symbolWebp: "/brand/fleetum-symbol-on-dark.webp",
    symbolWidth: 128,
    symbolHeight: 113
  },
  light: {
    logo: "/brand/fleetum-logo-for-light-bg.svg",
    logoWebp: "/brand/fleetum-logo-on-light.webp",
    logoWidth: 320,
    logoHeight: 95,
    symbol: "/brand/fleetum-symbol-for-light-bg.svg",
    symbolWebp: "/brand/fleetum-symbol-on-light.webp",
    symbolWidth: 128,
    symbolHeight: 87
  }
} as const;

export const PublicBrand = ({
  tone = "light",
  compact = false,
  className = "",
  priority = false,
  decorative = false
}: PublicBrandProps) => {
  const assets = brandAssets[tone];
  const src = compact ? assets.symbol : assets.logo;
  const webpSrc = compact ? assets.symbolWebp : assets.logoWebp;
  const width = compact ? assets.symbolWidth : assets.logoWidth;
  const height = compact ? assets.symbolHeight : assets.logoHeight;

  return (
    <ResponsiveMedia
      src={src}
      webpSrc={webpSrc}
      width={width}
      height={height}
      alt={decorative ? "" : "Fleetum"}
      aria-hidden={decorative || undefined}
      className={className}
      priority={priority}
    />
  );
};
