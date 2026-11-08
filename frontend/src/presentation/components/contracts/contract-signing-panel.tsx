import {ContractInPersonSignature} from "./contract-in-person-signature";
import {useEffect,useRef,useState} from "react";
import {contractSigningUseCases,type SigningStatus} from "../../../application/usecases/contract-signing-usecases";
import {assertSiteStamp,captureSiteStamp,useSiteAccessStore} from "../../../application/stores/site-access-store";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Label} from "../ui/label";
export function ContractSigningPanel({bookingId,canManage,onFreeze,onSigned,onRevision,hasUnsavedChanges=false}:{bookingId:string;canManage:boolean;onFreeze:(locked:boolean)=>void;onSigned:()=>void;onRevision?:()=>void;hasUnsavedChanges?:boolean}){
 const revision=useSiteAccessStore(s=>s.revision),owner=useSiteAccessStore(s=>s.owner),context=`${owner}:${revision}:${bookingId}`;
 const[value,setValue]=useState<{context:string;data:SigningStatus}|null>(null),[recipient,setRecipient]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const callbacks=useRef({onFreeze,onSigned,onRevision});callbacks.current={onFreeze,onSigned,onRevision};const version=useRef(0);
 const seq=useRef(0),inFlight=useRef(false),key=useRef(crypto.randomUUID()),signed=useRef(false);
 const data=value?.context===context?value.data:null,request=data?.request,locked=request?.status==="SIGNED"||request?.status==="PENDING";
 const apply=(data:SigningStatus)=>{setValue({context,data});callbacks.current.onFreeze(Boolean(data.request&&["SIGNED","PENDING"].includes(data.request.status)));if(data.request?.status==="SIGNED"&&!signed.current){signed.current=true;callbacks.current.onSigned();}};
 useEffect(()=>{let disposed=false;const n=++seq.current,stamp=captureSiteStamp();signed.current=false;key.current=crypto.randomUUID();inFlight.current=false;setBusy(false);setValue(null);setError("");callbacks.current.onFreeze(true);
  const load=async(first=false)=>{const revision=++version.current;try{const next=await contractSigningUseCases.status(bookingId);assertSiteStamp(stamp);if(disposed||n!==seq.current||revision!==version.current)return;apply(next);if(first)setRecipient(next.recipient);}catch(e){if(!disposed&&n===seq.current)setError((e as Error).message);}};
  void load(true);const timer=window.setInterval(()=>{if(!inFlight.current)void load();},10000);
  return()=>{disposed=true;seq.current++;window.clearInterval(timer);};
 },[context,bookingId]);
 const downloadEvidence=async()=>{const stamp=captureSiteStamp(),n=seq.current;try{const blob=await contractSigningUseCases.evidence(bookingId);assertSiteStamp(stamp);if(n!==seq.current)return;const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="Registrazione_firma_email.pdf";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){if(n===seq.current)setError((e as Error).message);}};
 const beginRevision=async()=>{if(inFlight.current||!data)return;inFlight.current=true;setBusy(true);setError('');const n=seq.current,stamp=captureSiteStamp();try{await contractSigningUseCases.startRevision(bookingId,data.documentRevision??0);assertSiteStamp(stamp);if(n===seq.current)callbacks.current.onRevision?.();}catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current){inFlight.current=false;setBusy(false);}}};
 const downloadVersion=async(id:string)=>{const stamp=captureSiteStamp(),n=seq.current;try{const blob=await contractSigningUseCases.version(bookingId,id);assertSiteStamp(stamp);if(n!==seq.current)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Contratto_firmato_conservato.pdf';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){if(n===seq.current)setError((e as Error).message);}};
 const run=async(revoke:boolean,presence=false)=>{if(inFlight.current||!data||(!revoke&&hasUnsavedChanges))return;inFlight.current=true;version.current++;setBusy(true);setError("");const n=seq.current,stamp=captureSiteStamp();try{
  const next=revoke?await contractSigningUseCases.revoke(bookingId):{...data,request:presence?await contractSigningUseCases.prepareInPerson(bookingId,key.current):await contractSigningUseCases.invite(bookingId,recipient,key.current)};
  assertSiteStamp(stamp);if(n!==seq.current)return;apply(next);key.current=crypto.randomUUID();
 }catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current){inFlight.current=false;setBusy(false);}}};
 return <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Firma del contratto" aria-busy={busy}>
  <div><h3 className="font-semibold">Firma del contratto</h3><p className="text-sm text-muted-foreground">Il cliente legge il PDF conservato e firma in presenza oppure con un codice ricevuto per email.</p></div>
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  {!data?<p role="status">Verifica della firma…</p>:!data.configured?<p className="text-sm">Il servizio di firma email deve essere configurato dall’amministratore.</p>:null}
  {request?<div role="status" className="text-sm space-y-1"><p className="font-medium">{request.status==="SIGNED"?"Firma registrata":request.status==="PENDING"?"In attesa del cliente":request.status==="EXPIRED"?"Invito scaduto":"Invito revocato"} · Versione {request.version}</p>
   <p>{request.method==="IN_PERSON"?"In presenza":request.maskedEmail} · {request.signedAt?new Date(request.signedAt).toLocaleString("it-IT"):"Scadenza "+new Date(request.expiresAt).toLocaleString("it-IT")}</p>
   {request.sourceChanged?<p className="text-destructive">I dati della pratica sono cambiati: revoca l’invito e prepara una nuova versione.</p>:null}
   {request.status==="PENDING"&&request.method!=="IN_PERSON"?<p>{request.inviteDelivery==="SENT"?"Invito accettato dal servizio email.":request.inviteDelivery==="FAILED"?"Invio non riuscito. Revoca l’invito e verifica il servizio email.":"Invito in coda di invio."}</p>:null}
   {request.status==="SIGNED"&&request.method!=="IN_PERSON"?<p>Il PDF originale resta invariato. La copia e la registrazione della firma {request.copyDelivery==="SENT"?"sono state accettate dal servizio email.":request.copyDelivery==="FAILED"?"non sono state inviate: contatta l’amministratore.":"sono in coda per il cliente."}</p>:null}
  </div>:null}
  {data&&!data.issuedAt&&!request?<p className="text-sm">Trasforma prima la prenotazione in contratto e conferma il riepilogo.</p>:null}
  {data?.configured&&data.emailConfigured!==false&&data.issuedAt&&canManage&&!locked?<form onSubmit={e=>{e.preventDefault();void run(false);}} className="space-y-2"><Label htmlFor="contract-signer-email">Email del firmatario</Label><Input id="contract-signer-email" type="email" required maxLength={254} value={recipient} onChange={e=>{setRecipient(e.target.value);key.current=crypto.randomUUID();}} disabled={busy}/><p className="text-xs text-muted-foreground">Salva prima le modifiche al contratto. L’invio conserva una versione che non potrà essere modificata durante la firma.</p><Button disabled={busy||hasUnsavedChanges} type="submit">{busy?"Preparazione…":"Invia per firma email"}</Button></form>:null}
  {hasUnsavedChanges?<p className="text-sm" role="status">Salva le condizioni e il documento prima della firma.</p>:null}
  {data?.configured&&data.emailConfigured===false?<p className="text-sm">Invio email non configurato. La firma in presenza resta disponibile.</p>:null}
  {data?.configured&&data.issuedAt&&canManage&&!locked?<Button variant="outline" disabled={busy||hasUnsavedChanges} onClick={()=>void run(false,true)}>Prepara firma in loco</Button>:null}
  {request?.method==="IN_PERSON"&&request.status==="PENDING"&&canManage?<ContractInPersonSignature key={request.id} bookingId={bookingId} request={request} onSigned={next=>{if(data)apply({...data,request:next});}}/>:null}
  {request?.status==="SIGNED"?<Button variant="outline" onClick={()=>void downloadEvidence()}>Scarica registrazione della firma</Button>:null}
  {data?.history?.length?<div className="space-y-2"><h4 className="font-medium">Versioni firmate conservate</h4>{data.history.map(version=><p key={version.id} className="text-sm"><Button variant="outline" onClick={()=>void downloadVersion(version.id)}>Scarica versione {version.version}</Button> · {version.method==='IN_PERSON'?'Firma in presenza':'Firma email'} · {version.signedAt?new Date(version.signedAt).toLocaleString('it-IT'):''}</p>)}</div>:null}
  {canManage&&request?.status==='SIGNED'?<div className="space-y-2"><p className="text-sm text-muted-foreground">Per correggere un contratto prima della consegna, prepara una nuova revisione: la versione firmata resta conservata e serviranno una nuova emissione e una nuova firma.</p><Button variant="outline" disabled={busy} onClick={()=>void beginRevision()}>Prepara nuova revisione</Button></div>:null}
  {canManage&&request?.status==="PENDING"?<Button variant="outline" disabled={busy} onClick={()=>void run(true)}>Revoca richiesta per modificare il contratto</Button>:null}
 </section>;
}
