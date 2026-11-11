import {
  captureSiteStamp, assertSiteStamp, assertSiteResponse, invalidateSiteStamp, siteRequestHeaders, beginSiteWrite, type SiteStamp, SiteContextChangedError
} from "../../application/stores/site-access-store";

const bodyMethods = new Set(["json", "text", "blob", "arrayBuffer", "formData"]);
const fenceResponse = (response: Response, stamp: SiteStamp): Response => new Proxy(response, {
  get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key === "clone") return () => {
      assertSiteStamp(stamp);
      return fenceResponse(target.clone(), stamp);
    };
    if (bodyMethods.has(String(key)) && typeof value === "function") return async () => {
      assertSiteStamp(stamp);
      const result = await value.call(target);
      assertSiteStamp(stamp);
      return result;
    };
    return typeof value === "function" ? value.bind(target) : value;
  }
});

// Tenant business adapters only. Auth, public and Platform use their own transports.
// Body readers and clones retain the originating view, even after headers arrive.
export const scopedFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
  const stamp = captureSiteStamp();
  const release = beginSiteWrite(stamp, init.method ?? request?.method);
  const headers = new Headers(init.headers ?? request?.headers);
  headers.delete("X-Fleetum-Site");
  headers.delete("X-Fleetum-Site-Revision");
  for (const [key, value] of Object.entries(siteRequestHeaders())) headers.set(key, value);
  try {
    const response = await fetch(input, {...init, headers});
    assertSiteResponse(stamp,response.headers.get("X-Fleetum-Site-Revision"),response.headers.get("X-Fleetum-Site-View"),response.ok);
    if(response.status===409){
      const error=await response.clone().json().catch(()=>null);
      if(error?.error==="SITE_CONTEXT_STALE"){invalidateSiteStamp(stamp);throw new SiteContextChangedError();}
    }
    return fenceResponse(response, stamp);
  } finally {
    release();
  }
};
