const billingSelfServicePrefixes = ["/activate", "/upgrade", "/billing/recovery", "/onboarding/azienda"];

export const isBillingSelfServiceRoute = (pathname: string) =>
  billingSelfServicePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
