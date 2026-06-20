export const publicPrerenderRoutes = [
  "/",
  "/software-autonoleggio",
  "/software-rent-a-car",
  "/gestionale-flotta",
  "/booking-noleggi",
  "/contratti-noleggio-digitali",
  "/report-redditivita-veicolo",
  "/prezzi",
  "/demo",
  "/privacy",
  "/cookie",
  "/termini",
  "/dpa"
] as const;

export type PublicPrerenderRoute = (typeof publicPrerenderRoutes)[number];
