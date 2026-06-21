const DEFAULT_API_BASE_URL = "http://localhost:4000/api";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const getApiBaseUrl = () => {
  const configured = (import.meta.env?.VITE_API_BASE_URL as string | undefined) || DEFAULT_API_BASE_URL;

  if (typeof window === "undefined") return configured;

  try {
    const url = new URL(configured);
    const browserHost = window.location.hostname;

    if (LOCAL_HOSTS.has(url.hostname) && LOCAL_HOSTS.has(browserHost) && url.hostname !== browserHost) {
      url.hostname = browserHost;
      return url.toString().replace(/\/$/, "");
    }

    return configured.replace(/\/$/, "");
  } catch {
    return configured;
  }
};

export const getApiOrigin = () => {
  try {
    return new URL(getApiBaseUrl()).origin;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
};
