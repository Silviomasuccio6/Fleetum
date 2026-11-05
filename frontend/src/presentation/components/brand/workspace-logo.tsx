import { cn } from "../../../lib/utils";
import "../../styles/workspace-logo.css";

const frame = { width: 144, height: 36, artworkWidth: 124 };
// The original assets have different artboards. Align the visible artwork,
// keeping its proportions and leaving the source files and auth screens intact.
const artwork = [
  { theme: "light", src: "/brand/fleetum-logo-full-light.svg", width: 2365, height: 700,
    bounds: { x: 70, y: 280, width: 1875, height: 400 } },
  { theme: "dark", src: "/brand/fleetum-logo-full-dark.svg", width: 3104, height: 828,
    bounds: { x: 200, y: 176, width: 2854, height: 601 } }
];

export function WorkspaceLogo({ className }: { className?: string }) {
  return <span role="img" aria-label="Fleetum" translate="no" className={cn("workspace-logo", className)}>
    {artwork.map(asset => {
      const scale = frame.artworkWidth / asset.bounds.width;
      return <svg key={asset.theme} data-logo-theme={asset.theme} viewBox={`0 0 ${frame.width} ${frame.height}`}
        width={frame.width} height={frame.height} aria-hidden="true" focusable="false">
        <image href={asset.src} width={asset.width * scale} height={asset.height * scale}
          x={(frame.width - frame.artworkWidth) / 2 - asset.bounds.x * scale}
          y={(frame.height - asset.bounds.height * scale) / 2 - asset.bounds.y * scale}
          preserveAspectRatio="xMidYMid meet" />
      </svg>;
    })}
  </span>;
}
