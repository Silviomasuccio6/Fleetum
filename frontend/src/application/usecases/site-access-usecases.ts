import {httpClient} from "../../infrastructure/api/http-client";
import {useAuthStore} from "../stores/auth-store";
import {siteIdentity,useSiteAccessStore} from "../stores/site-access-store";
import type {SiteAccessSnapshot} from "../../domain/entities/site-access";
let sequence=0;
export const reloadSiteAccess=async()=>{
  const owner=siteIdentity(useAuthStore.getState().user),request=++sequence;
  if(owner==="anonymous")return;
  useSiteAccessStore.getState().begin();
  try{const result=await httpClient.get<{data:SiteAccessSnapshot}>("/auth/site-access");if(request!==sequence)return;
    const value=result.data;
    const user=useAuthStore.getState().user;
    if(!value||value.userId!==user?.id||value.tenantId!==user?.tenantId||typeof value.revision!=="string"||typeof value.enforced!=="boolean"||typeof value.canViewAllSites!=="boolean"||typeof value.canAssignSites!=="boolean"||!Array.isArray(value.sites)||value.sites.some(s=>typeof s.id!=="string"||typeof s.name!=="string")||new Set(value.sites.map(s=>s.id)).size!==value.sites.length||(!value.canViewAllSites&&value.sites.length>1))throw new Error("Le informazioni sulla sede non sono disponibili.");
    useSiteAccessStore.getState().accept(owner,value);
  }catch(error){if(request===sequence)useSiteAccessStore.getState().fail(owner,(error as Error).message);}
};
