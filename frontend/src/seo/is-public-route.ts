import { publicPrerenderRoutes } from "./public-prerender-routes";

const publicRouteSet = new Set<string>(publicPrerenderRoutes);

const normalizePathname = (pathname: string) => {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
};

export const isPublicRoute = (pathname: string) => publicRouteSet.has(normalizePathname(pathname));
