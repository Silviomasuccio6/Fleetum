import {useEffect,useId,useState,type ReactNode} from "react";
import {useLocation,useNavigate} from "react-router-dom";
import {MapPin} from "lucide-react";
import {useAuthStore} from "../../../application/stores/auth-store";
import {siteIdentity,useSiteAccessStore,companySiteView} from "../../../application/stores/site-access-store";
import {reloadSiteAccess} from "../../../application/usecases/site-access-usecases";
import {Button} from "../ui/button";
import {AnchoredSelect} from "../ui/anchored-select";
import {CommerceNotice} from "../ui/commerce-workspace";
import {FleetumBlockLoader} from "../brand/fleetum-logo-loader";
import "../../styles/site-context.css";

export const useSiteContextSync=()=>{
  const user=useAuthStore(s=>s.user),owner=siteIdentity(user),refreshRequested=useSiteAccessStore(s=>s.refreshRequested),accountEpoch=useSiteAccessStore(s=>s.accountEpoch);
  useEffect(()=>{
    if(!user)return;
    void reloadSiteAccess();
    const refresh=()=>{if(document.visibilityState==="visible")void reloadSiteAccess();};
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);const timer=setInterval(refresh,30000);
    return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[owner,accountEpoch,refreshRequested]);
};
export const useCompanySiteView=()=>useSiteAccessStore(s=>Boolean(s.context?.canViewAllSites&&(!s.context.enforced||s.view==="all")));
export const siteChangePath=(pathname:string)=>pathname.startsWith("/rental-bookings/")?"/booking":/^\/fermi\/[^/]+/.test(pathname)&&!["/fermi/kanban","/fermi/calendario","/fermi/nuovo"].includes(pathname)?"/fermi":pathname;

// Track actual field edits instead of warning merely because a pristine form
// exists. Weak references do not retain closed forms or their field values.
const editedSiteFields=new WeakSet<HTMLElement>();
const siteDraftSelector='form input:not([type="hidden"]):enabled:not([readonly]),form select:enabled,textarea:enabled:not([readonly])';
export const trackSiteDraftEdit=(event:Event)=>{
 const field=event.target;if(field instanceof HTMLElement&&field.matches(siteDraftSelector))editedSiteFields.add(field);
};
export const siteViewHasEditableForm=()=>Array.from(document.querySelectorAll<HTMLElement>(siteDraftSelector)).some(element=>editedSiteFields.has(element)&&element.getClientRects().length>0);
export function SiteContextControl(){
  const state=useSiteAccessStore(),navigate=useNavigate(),location=useLocation(),id=useId();
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    document.addEventListener("input",trackSiteDraftEdit,true);document.addEventListener("change",trackSiteDraftEdit,true);
    return()=>{document.removeEventListener("input",trackSiteDraftEdit,true);document.removeEventListener("change",trackSiteDraftEdit,true);};
  },[]);
  const ctx=state.context,ready=state.status==="ready",switchable=Boolean(ready&&ctx?.enforced&&ctx.canViewAllSites);
  const label=!ready?state.status==="error"?"Sede non disponibile":"Verifica della sede…":!ctx?.enforced?"Vista aziendale":ctx.canViewAllSites&&state.view==="all"?"Tutte le sedi":ctx.sites.find(s=>s.id===state.view)?.name??(ctx.assignedSite&&!ctx.assignedSite.isActive?"Sede non disponibile":"Sede non assegnata");
  const help=state.writing>0?"Attendi il completamento del salvataggio in corso.":state.status==="error"?"Non possiamo verificare la sede. Riprova prima di continuare.":!ready?"Verifica della sede in corso.":!ctx?.enforced?"Il filtro per sede non è disponibile in questa versione. La vista corrente è aziendale.":ctx.assignedSite&&!ctx.assignedSite.isActive?"La sede assegnata non è disponibile. Contatta l’amministratore.":switchable?"Scegli una sede autorizzata o la vista di tutte le sedi.":"La sede operativa viene assegnata dall’amministratore.";
  const apply=(selection:string)=>{
    setError(null);if(selection===state.view)return;
    try{
      if(useSiteAccessStore.getState().writing)throw new Error("Attendi il completamento del salvataggio in corso.");
      if(siteViewHasEditableForm()&&!window.confirm("Cambiare sede chiude i moduli aperti. Le eventuali modifiche non salvate verranno perse. Vuoi continuare?"))return;
      useSiteAccessStore.getState().select(selection);
      navigate(siteChangePath(location.pathname),{replace:true});
    }catch(e){setError((e as Error).message);}
  };
  return <div className="site-context-control">
    <MapPin aria-hidden="true" className="h-4 w-4 shrink-0"/>
    <div className="site-context-caption">
      {switchable?<><label className="sr-only" htmlFor={id}>Sede</label><AnchoredSelect key={`${state.owner}:${state.revision}`} id={id} value={state.view}
        options={[{value:"all",label:"Tutte le sedi"},...ctx!.sites.map(site=>({value:site.id,label:site.name}))]}
        onValueChange={apply} disabled={state.writing>0} describedBy={`${id}-help`} title={label}/></>:<strong title={help} aria-describedby={`${id}-help`}>{label}</strong>}
      <span className="sr-only" id={`${id}-help`}>{help}</span>
    </div>
    {state.status==="error"?<Button variant="outline" onClick={()=>void reloadSiteAccess()}>Riprova</Button>:null}
    {error?<span role="alert" className="site-context-error">{error}</span>:null}
  </div>;
}
export function SiteDataBoundary({children}:{children:ReactNode}){
  const s=useSiteAccessStore(),user=useAuthStore(s=>s.user),location=useLocation();
  if(s.owner!==siteIdentity(user)||s.status==="loading"||s.status==="idle")return <FleetumBlockLoader label="Verifica della sede"/>;
  if(s.status==="error")return <CommerceNotice>Non possiamo verificare la vista corrente. <Button variant="outline" onClick={()=>void reloadSiteAccess()}>Riprova</Button></CommerceNotice>;
  if(s.context?.enforced&&s.view==="none"&&location.pathname!=="/profilo")return <div className="site-context-empty"><MapPin aria-hidden="true"/><h1>{s.context.assignedSite?"Sede non disponibile":"Sede non assegnata"}</h1><p>Chiedi all’amministratore di assegnarti una sede attiva per accedere ai dati operativi.</p></div>;
  if(location.pathname==="/profilo/azienda"&&!companySiteView())return <CommerceNotice>Il profilo aziendale richiede la vista Tutte le sedi. Usa il selettore della vista corrente.</CommerceNotice>;
  return <div key={`${s.owner}:${s.revision}`}>{children}</div>;
}
