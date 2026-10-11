const DEFAULT_RETURN_TO = "/dashboard";
const MAX_RETURN_TO_LENGTH = 240;
const NON_RETURNABLE_AUTH_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/auth/social-callback"
]);

type LocationParts = {
  pathname: string;
  search: string;
  hash: string;
};

const normalizePathname = (pathname: string) => (pathname.replace(/\/+$/, "") || "/").toLowerCase();

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

export const getLoginRedirectPath = (location: LocationParts) => {
  if (NON_RETURNABLE_AUTH_PATHS.has(normalizePathname(location.pathname))) return "/login";
  const returnTo = getSafeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  return `/login?next=${encodeURIComponent(returnTo)}`;
};

export const getPostLoginReturnTo = (search: string) => {
  const next = new URLSearchParams(search).get("next");
  const returnTo = getSafeReturnTo(next);
  const pathname = normalizePathname(new URL(returnTo, window.location.origin).pathname);
  return pathname === "/login" ? DEFAULT_RETURN_TO : returnTo;
};
