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

const containsSensitiveNestedQuery = (value: string) => {
  if (!value.includes("?")) return false;
  try {
    const nested = new URL(value, "http://localhost");
    return Array.from(nested.searchParams.keys()).some(isSensitiveQueryParam);
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
      const shouldMask = isSensitiveQueryParam(key) || values.some(containsSensitiveNestedQuery);
      if (shouldMask) parsed.searchParams.set(key, "***");
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    const [pathname] = rawUrl.split("?");
    return pathname || "/";
  }
};
