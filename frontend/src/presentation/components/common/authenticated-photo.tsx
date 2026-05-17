import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";

type AuthenticatedPhotoProps = {
  photoId: string;
  kind: "stoppage" | "vehicle";
  alt: string;
  className?: string;
};

const API_BASE_URL = getApiBaseUrl();

const buildPhotoEndpoint = (kind: "stoppage" | "vehicle", photoId: string) => {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const segment = kind === "stoppage" ? "stoppage-photos" : "vehicle-photos";
  return `${base}/uploads/${segment}/${encodeURIComponent(photoId)}/file`;
};

export const AuthenticatedPhoto = ({ photoId, kind, alt, className }: AuthenticatedPhotoProps) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const endpoint = useMemo(() => buildPhotoEndpoint(kind, photoId), [kind, photoId]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    const controller = new AbortController();

    setSrc(null);
    setFailed(false);

    void fetch(endpoint, {
      method: "GET",
      credentials: "include",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setSrc(objectUrl);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);

  if (failed || !src) {
    return (
      <div className={className ? `${className} bg-muted/50` : "h-40 w-full rounded-md border bg-muted/50"}>
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Immagine non disponibile</div>
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} />;
};
