const billingSelfServicePrefixes = ["/activate", "/upgrade", "/onboarding/azienda"];

export const isBillingSelfServiceRoute = (pathname: string) =>
  billingSelfServicePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

