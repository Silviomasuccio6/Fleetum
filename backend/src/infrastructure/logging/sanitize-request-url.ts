const sensitiveQueryParams = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "otp",
  "password",
  "secret",
  "code",
  "state",
  "nonce"
]);

const isSensitiveQueryParam = (key: string) => {
  const lowerKey = key.toLowerCase();
  return sensitiveQueryParams.has(lowerKey) || lowerKey.includes("token") || lowerKey.includes("secret");
};

// The final segment is the credential for a public contract, so logs retain only the route shape.
const sanitizeSensitivePathSegments = (pathname: string) =>
  pathname.replace(/(\/api\/contracts\/public\/)[^/?#]+/gi, "$1:token");

const containsSensitiveNestedUrl = (value: string) => {
  try {
    const nested = new URL(value, "http://localhost");
    return sanitizeSensitivePathSegments(nested.pathname) !== nested.pathname
      || Array.from(nested.searchParams.keys()).some(isSensitiveQueryParam);
  } catch {
    return false;
  }
};

export const sanitizeRequestUrl = (rawUrl?: string) => {
  if (!rawUrl) return "/";
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    for (const key of new Set(parsed.searchParams.keys())) {
      const values = parsed.searchParams.getAll(key);
      const shouldMask = isSensitiveQueryParam(key) || values.some(containsSensitiveNestedUrl);
      if (shouldMask) parsed.searchParams.set(key, "***");
    }
    return `${sanitizeSensitivePathSegments(parsed.pathname)}${parsed.search}`;
  } catch {
    const [pathname] = rawUrl.split("?");
    return sanitizeSensitivePathSegments(pathname || "/");
  }
};
