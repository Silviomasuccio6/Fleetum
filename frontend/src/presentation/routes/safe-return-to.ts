const DEFAULT_RETURN_TO = "/dashboard";
const MAX_RETURN_TO_LENGTH = 240;

export const getSafeReturnTo = (value: string | null | undefined, fallback = DEFAULT_RETURN_TO) => {
  const rawValue = (value ?? "").trim();
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) return fallback;

  try {
    const parsed = new URL(rawValue, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;

    const safeValue = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!safeValue.startsWith("/") || safeValue.startsWith("//")) return fallback;
    return safeValue.slice(0, MAX_RETURN_TO_LENGTH);
  } catch {
    return fallback;
  }
};

