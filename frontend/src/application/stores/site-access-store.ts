import {create} from "zustand";
import {useAuthStore} from "./auth-store";
import type {User} from "../../domain/entities/models";
import type {SiteAccessSnapshot} from "../../domain/entities/site-access";

export const siteIdentity = (user: User | null) => user
  ? JSON.stringify([user.tenantId,user.id,[...user.roles].sort(),[...user.permissions].sort()]) : "anonymous";
export class SiteContextChangedError extends Error {
  readonly code="STALE_SITE_CONTEXT";
  constructor(){super("La vista è cambiata. Verifica l’esito nella sede corretta.");this.name="SiteContextChangedError";}
}
type SiteState={owner:string;context:SiteAccessSnapshot|null;status:"idle"|"loading"|"ready"|"error";view:string;revision:number;accountEpoch:number;writing:number;error:string|null;refreshRequested:number;
  reset:()=>void;begin:()=>void;accept:(owner:string,value:SiteAccessSnapshot)=>void;fail:(owner:string,message:string)=>void;select:(siteId:string)=>void};
export const useSiteAccessStore=create<SiteState>((set,get)=>({
  owner:siteIdentity(useAuthStore.getState().user),context:null,status:"idle",view:"all",revision:0,accountEpoch:0,writing:0,error:null,refreshRequested:0,
  reset:()=>set(s=>({owner:siteIdentity(useAuthStore.getState().user),context:null,status:"idle",view:"all",revision:s.revision+1,accountEpoch:s.accountEpoch+1,writing:0,error:null})),
  begin:()=>set(s=>s.context?{}:{status:"loading",error:null}),
  accept:(owner,context)=>{
    const user=useAuthStore.getState().user;
    if(owner!==siteIdentity(user)||context.userId!==user?.id||context.tenantId!==user?.tenantId)return;
    const previous=get();
    let view=context.enforced?(context.canViewAllSites?previous.view:context.sites[0]?.id??"none"):"all";
    if(context.canViewAllSites&&view!=="all"&&!context.sites.some(s=>s.id===view))view="all";
    const changed=previous.owner!==owner||previous.context?.revision!==context.revision||previous.context?.enforced!==context.enforced||previous.view!==view;
    set({owner,context,status:"ready",view,error:null,...(changed?{revision:previous.revision+1,writing:0}:{})});
  },
  fail:(owner,error)=>{if(owner!==siteIdentity(useAuthStore.getState().user))return;set(s=>({context:null,status:"error",error,revision:s.revision+1,writing:0}));},
  select:view=>{
    const s=get();if(s.status!=="ready"||!s.context?.enforced||!s.context.canViewAllSites||s.writing)throw new Error("Cambio sede non disponibile durante questa operazione.");
    if(view!=="all"&&!s.context.sites.some(site=>site.id===view))throw new Error("Sede non disponibile.");
    if(view!==s.view)set({view,revision:s.revision+1});
  }
}));
// Invalidate synchronously on identity/authority changes, including logout and
// account switches inside the same tenant. Normal refresh with equal claims stays stable.
useAuthStore.subscribe((state,previous)=>{if(siteIdentity(state.user)!==siteIdentity(previous.user))useSiteAccessStore.getState().reset();});
export type SiteStamp={owner:string;revision:number;serverRevision?:string;view?:string};
export type SiteAccountStamp={owner:string;epoch:number};
export const captureSiteAccount=():SiteAccountStamp=>({owner:siteIdentity(useAuthStore.getState().user),epoch:useSiteAccessStore.getState().accountEpoch});
export const assertSiteAccount=(stamp:SiteAccountStamp)=>{const current=captureSiteAccount();if(stamp.owner!==current.owner||stamp.epoch!==current.epoch)throw new SiteContextChangedError();};
export const captureSiteStamp=():SiteStamp=>{const s=useSiteAccessStore.getState();return{owner:siteIdentity(useAuthStore.getState().user),revision:s.revision,...(s.status==="ready"&&s.context?.enforced?{serverRevision:s.context.revision,view:s.view}:{})};};
export const assertSiteStamp=(stamp:SiteStamp)=>{const current=captureSiteStamp();if(stamp.owner!==current.owner||stamp.revision!==current.revision)throw new SiteContextChangedError();};
export const siteRequestHeaders=():Record<string,string>=>{const s=useSiteAccessStore.getState();return s.status==="ready"&&s.context?.enforced?{"X-Fleetum-Site":s.view,"X-Fleetum-Site-Revision":s.context.revision}:{};};
export const invalidateSiteStamp=(stamp:SiteStamp)=>{
  assertSiteStamp(stamp);
  useSiteAccessStore.setState(s=>({context:null,status:"error",error:"La sede o le autorizzazioni sono cambiate. Aggiornamento della vista…",revision:s.revision+1,writing:0,refreshRequested:s.refreshRequested+1}));
};
export const assertSiteResponse=(stamp:SiteStamp,serverRevision?:string|null,view?:string|null,required=false)=>{
  assertSiteStamp(stamp);
  if(stamp.serverRevision&&((required&&(!serverRevision||!view))||(serverRevision&&serverRevision!==stamp.serverRevision)||(view&&view!==stamp.view))){
    invalidateSiteStamp(stamp);throw new SiteContextChangedError();
  }
};
export const beginSiteWrite=(stamp:SiteStamp,method="GET")=>{
  assertSiteStamp(stamp);if(!["POST","PUT","PATCH","DELETE"].includes(method.toUpperCase()))return()=>{};
  useSiteAccessStore.setState(s=>({writing:s.writing+1}));let finished=false;
  return()=>{if(finished)return;finished=true;const s=useSiteAccessStore.getState();if(s.revision===stamp.revision&&s.owner===stamp.owner)useSiteAccessStore.setState({writing:Math.max(0,s.writing-1)});};
};
export const companySiteView=()=>{const s=useSiteAccessStore.getState();return s.context?.canViewAllSites===true&&(!s.context.enforced||s.view==="all");};
