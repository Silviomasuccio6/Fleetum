import {CargosReceiptsPanel} from "./cargos-receipts-panel";
import { useEffect,useRef,useState } from "react";
import { Send,CheckCircle2,AlertTriangle } from "lucide-react";
import { contractCargosUseCases,type CargosPreflight } from "../../../application/usecases/contract-cargos-usecases";
import { captureSiteStamp,assertSiteStamp,useSiteAccessStore } from "../../../application/stores/site-access-store";
import { CommerceDrawer,CommerceNotice } from "../ui/commerce-workspace";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function ContractCargosDialog({bookingId,onClose,onUpdated}:{bookingId:string;onClose:()=>void;onUpdated:()=>void}){
 const revision=useSiteAccessStore(s=>s.revision),owner=useSiteAccessStore(s=>s.owner),context=`${owner}:${revision}:${bookingId}`;
 const[refresh,setRefresh]=useState(0);
 const[loaded,setLoaded]=useState<{context:string;value:CargosPreflight}|null>(null),[draft,setDraft]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const sequence=useRef(0),inFlight=useRef(false);const data=loaded?.context===context?loaded.value:null;
 useEffect(()=>{const current=++sequence.current,stamp=captureSiteStamp();inFlight.current=false;setBusy(false);setLoaded(null);setDraft({});setError(null);setNotice(null);void contractCargosUseCases.preflight(bookingId).then(value=>{assertSiteStamp(stamp);if(current!==sequence.current)return;setLoaded({context,value});setDraft(Object.fromEntries(value.fields.filter(f=>f.editable).map(f=>[f.key,f.value])));}).catch(e=>{if(current===sequence.current)setError((e as Error).message);});return()=>{sequence.current++};},[bookingId,context,refresh]);
 const run=async(send:boolean|"check")=>{
  if(!data||inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);setNotice(null);const current=sequence.current,stamp=captureSiteStamp();
  let outcomeSnapshot:CargosPreflight|null=null;
  try{
   let value=data;const changed=value.fields.some(f=>f.editable&&(draft[f.key]??"")!==f.value);
   if(changed)value=await contractCargosUseCases.saveDraft(bookingId,draft);
   assertSiteStamp(stamp);if(current!==sequence.current)return;setLoaded({context,value});
   if(send==="check"){
    const checked=await contractCargosUseCases.check(bookingId,value.sourceHash);assertSiteStamp(stamp);if(current!==sequence.current)return;setLoaded({context,value:checked});setNotice(checked.validation?.status==="VALID"?"Dati validati da CARGOS. Nessun invio effettuato.":"Controllo non riuscito: verifica i dati o riprova più tardi. Nessun invio effettuato.");
   }else if(send){
    if(!value.canSend){setError(value.message??"Completa i dati indicati prima di inviare.");return;}
    const result=await contractCargosUseCases.transmit(bookingId,value.sourceHash);assertSiteStamp(stamp);if(current!==sequence.current)return;
    outcomeSnapshot={...value,status:result.status,canSend:false,transactionId:result.transactionId??null,acceptedAt:null};
    setLoaded({context,value:outcomeSnapshot});
    setNotice(result.status==="ACCEPTED"?null:result.status==="UNKNOWN"?"Esito incerto: verifica sul portale CARGOS prima di riprovare.":result.status==="REJECTED"?"CARGOS ha rifiutato i dati. Verifica il tracciato prima di riprovare.":"Servizio non disponibile. Nessuna trasmissione confermata.");
    const refreshed=await contractCargosUseCases.preflight(bookingId);assertSiteStamp(stamp);if(current!==sequence.current)return;setLoaded({context,value:refreshed});onUpdated();
   }else setNotice("Dati per la trasmissione salvati.");
  }catch(e){
   if(current===sequence.current){
    setError((e as Error).message);
    if(send===true){
     try{const latest=await contractCargosUseCases.preflight(bookingId);assertSiteStamp(stamp);if(current===sequence.current)setLoaded({context,value:latest});}
     catch{if(current===sequence.current)setLoaded({context,value:outcomeSnapshot??{...data,status:"UNKNOWN",canSend:false,message:"Esito non confermato: verifica lo stato prima di riprovare."}});}
    }
   }
  }
  finally{if(current===sequence.current){inFlight.current=false;setBusy(false);}}
 };
 const locked=Boolean(data&&["ACCEPTED","SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(data.status));
 return <CommerceDrawer compact level={145} title="Trasmetti contratto a CARGOS" description="Controlla la pratica e premi Invia per trasmettere i dati." busy={busy} onClose={onClose} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Chiudi</Button>{locked?<Button variant="outline" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Rileggi stato locale</Button>:null}{data&&!locked?<Button disabled={busy||!data.configured} onClick={()=>void run(true)}><Send aria-hidden="true" className="h-4 w-4"/>{busy?"Invio in corso…":"Invia"}</Button>:null}</>}>
  <div role="region" aria-label="Dati della trasmissione CARGOS" tabIndex={0} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
  {error?<CommerceNotice>{error}</CommerceNotice>:null}{notice?<CommerceNotice tone={data?.status==="ACCEPTED"||notice==="Dati per la trasmissione salvati."||notice==="Dati validati da CARGOS. Nessun invio effettuato."?"success":"error"}>{notice}</CommerceNotice>:null}
  {!data&&!error?<p role="status">Caricamento della pratica…</p>:null}
  {data?<><dl className="grid gap-3"><div><dt className="commerce-hint">Contratto</dt><dd className="font-semibold" translate="no">{data.code}</dd></div><div><dt className="commerce-hint">Cliente · Veicolo</dt><dd translate="no">{data.customer} · {data.plate}</dd></div></dl>
   {data.status==="MANUAL_CONFIRMED"?<div role="status" className="my-4"><CheckCircle2 aria-hidden="true" className="inline h-5 w-5"/> Invio verificato manualmente sul portale<p className="commerce-hint">Conferma registrata dal responsabile con ricevuta allegata; nessun nuovo invio effettuato.</p><p className="break-all" translate="no">Riferimento: {data.transactionId}</p></div>:null}
   {data.validation?.status?<p role="status" className="commerce-hint mt-4">Ultimo controllo dati: {data.validation.status==="VALID"?"valido":data.validation.status==="INVALID"?"dati da correggere":"non disponibile"}{!data.validation.current?" · dati modificati dopo il controllo":""}. Il controllo non è un invio.</p>:null}
   {data.status==="ACCEPTED"?<div role="status" className="mt-4"><CheckCircle2 aria-hidden="true" className="inline h-5 w-5"/> Trasmissione accettata{data.transactionId?<p className="break-all" translate="no">Riferimento: {data.transactionId}</p>:null}<p className="commerce-hint">La ricevuta ufficiale va conservata quando disponibile.</p></div>:null}
   {data.message?<p role="status" className="my-4"><AlertTriangle aria-hidden="true" className="mr-2 inline h-4 w-4"/>{data.message}</p>:null}
   {!data.configured?<p className="commerce-hint">La pratica rimane da trasmettere. L'amministratore deve configurare il collegamento aziendale.</p>:null}
   {data.configured&&!locked?<details className="mt-4"><summary>Dati e codici per CARGOS{data.fields.some(f=>f.issue)?" · da completare":""}</summary><div className="mt-3 grid gap-3">{data.fields.filter(f=>f.editable||f.issue).map(field=><div key={field.key}><Label htmlFor={`cargos-${field.key}`}>{field.label}</Label>{field.editable?<Input id={`cargos-${field.key}`} value={draft[field.key]??""} maxLength={field.width} disabled={busy} onChange={event=>setDraft(old=>({...old,[field.key]:event.target.value}))} aria-describedby={field.issue?`cargos-error-${field.key}`:undefined}/>:<p>{field.value||"Da completare nella pratica o nell'anagrafica"}</p>}{field.issue?<p id={`cargos-error-${field.key}`} className="commerce-field-error">{field.issue}</p>:null}</div>)}<Button variant="outline" disabled={busy} onClick={()=>void run(false)}>Salva e verifica dati</Button></div></details>:null}
   {data.configured&&!locked?<Button variant="outline" className="mt-3" disabled={busy||!data.canSend} onClick={()=>void run("check")}>Controlla dati su CARGOS senza inviare</Button>:null}
   <CargosReceiptsPanel bookingId={bookingId} data={data} onUpdated={()=>{setRefresh(value=>value+1);onUpdated();}} onBusy={value=>{inFlight.current=value;setBusy(value);}}/>
   {!locked&&!busy?<p className="commerce-hint mt-4">Chiudendo senza inviare, il contratto resta da trasmettere.</p>:null}
  </>:null}
  </div>
 </CommerceDrawer>;
}
