import {useEffect,useId,useRef,useState} from "react";
import {contractCargosUseCases as api,buildCargosReceiptForm,type CargosPreflight,type CargosEvent} from "../../../application/usecases/contract-cargos-usecases";
import {captureSiteStamp,assertSiteStamp,useSiteAccessStore} from "../../../application/stores/site-access-store";
import {scopedFetch} from "../../../infrastructure/api/scoped-fetch";
import {getApiBaseUrl} from "../../../infrastructure/api/api-base-url";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Label} from "../ui/label";

const outcomes:Record<string,string>={ACCEPTED:"Accettato dalle API",MANUAL_CONFIRMED:"Confermato manualmente sul portale",UNKNOWN:"Esito incerto",REJECTED:"Rifiutato",UNAVAILABLE:"Servizio non disponibile",VALID:"Dati validi",INVALID:"Dati da correggere"};
export function CargosReceiptsPanel({bookingId,data,onUpdated,onBusy}:{bookingId:string;data:CargosPreflight;onUpdated:()=>void;onBusy:(busy:boolean)=>void}){
 const owner=useSiteAccessStore(s=>s.owner),revision=useSiteAccessStore(s=>s.revision),context=`${owner}:${revision}:${bookingId}`,id=useId();
 const[error,setError]=useState(""),[file,setFile]=useState<File|null>(null),[protocol,setProtocol]=useState(""),[date,setDate]=useState(""),[reference,setReference]=useState(data.transactionId??""),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[older,setOlder]=useState<CargosEvent[]>([]),[cursor,setCursor]=useState(data.historyCursor??null);
 const seq=useRef(0),inFlight=useRef(false),key=useRef(crypto.randomUUID()),alert=useRef<HTMLDivElement>(null),busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{seq.current++;inFlight.current=false;setBusy(false);setError("");setFile(null);setProtocol("");setDate("");setReference(data.transactionId??"");setVerified(false);setOlder([]);setCursor(data.historyCursor??null);key.current=crypto.randomUUID();return()=>{seq.current++;};},[context,data.sourceHash,data.status,data.historyCursor]);
 useEffect(()=>{if(error)alert.current?.focus();},[error]);
 const run=async(action:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);busyCallback.current(true);setError("");const n=seq.current;try{await action();}catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current){inFlight.current=false;setBusy(false);busyCallback.current(false);}}};
 const save=()=>run(async()=>{
  if(!file)throw new Error("Seleziona la ricevuta PDF scaricata dal portale");
  const stamp=captureSiteStamp(),n=seq.current;
  const form=buildCargosReceiptForm({sourceHash:data.sentSourceHash??data.sourceHash,transactionId:reference.trim(),protocol:protocol.trim(),receiptDate:date,kind:data.canReconcile?"CONFIRM_PORTAL":"ARCHIVE",verifiedOnPortal:verified},file);
  await api.receipt(bookingId,form,key.current);assertSiteStamp(stamp);if(n!==seq.current)return;busyCallback.current(false);onUpdated();
 });
 const download=(receiptId:string)=>run(async()=>{
  const stamp=captureSiteStamp(),n=seq.current,response=await scopedFetch(`${getApiBaseUrl()}/rental-bookings/${encodeURIComponent(bookingId)}/cargos/receipts/${encodeURIComponent(receiptId)}/pdf`,{credentials:"include",cache:"no-store"});
  if(!response.ok)throw new Error("Ricevuta non disponibile o autorizzazione cambiata");
  if(!response.headers.get("Content-Type")?.includes("application/pdf"))throw new Error("Il servizio non ha restituito un PDF");
  const blob=await response.blob();assertSiteStamp(stamp);if(n!==seq.current)return;
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="Ricevuta_CARGOS.pdf";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
 });
 const loadOlder=()=>run(async()=>{if(!cursor)return;const stamp=captureSiteStamp(),n=seq.current,next=await api.history(bookingId,cursor);assertSiteStamp(stamp);if(n!==seq.current)return;setOlder(values=>[...values,...next.events]);setCursor(next.cursor);});
 const canArchive=data.canManageReceipts&&(data.canReconcile||["ACCEPTED","MANUAL_CONFIRMED"].includes(data.status));
 return <section className="mt-5 space-y-4" aria-label="Ricevute e storico CARGOS" aria-busy={busy}>
  {error?<div role="alert" tabIndex={-1} ref={alert} className="commerce-field-error">{error}</div>:null}
  <div><h3 className="font-semibold">Ricevuta del portale</h3><p className="commerce-hint">Il riferimento dell’invio e la ricevuta PDF sono due riscontri distinti. Scarica la ricevuta dal portale CARGOS e conservala qui dopo averne verificato il contenuto.</p></div>
  {data.receipts?.length?<ul className="space-y-3">{data.receipts.map(receipt=><li key={receipt.id} className="rounded-lg border p-3 space-y-1"><p className="font-medium break-all" translate="no">Protocollo {receipt.protocol}</p><p className="commerce-hint">{new Date(receipt.receiptDate).toLocaleDateString("it-IT")} · {receipt.kind==="PORTAL_CONFIRMED"?"Verifica manuale del responsabile":"Associata all’invio accettato dalle API"}</p>{data.canManageReceipts?<Button variant="outline" disabled={busy} onClick={()=>void download(receipt.id)}>Scarica ricevuta</Button>:<p className="commerce-hint">Il PDF può contenere più contratti: accesso riservato all’amministratore nella vista tutte le sedi.</p>}</li>)}</ul>:<p className="text-sm">Nessuna ricevuta archiviata.</p>}
  {canArchive?<details><summary className="cursor-pointer font-medium">{data.canReconcile?"Registra verifica positiva sul portale":"Archivia ricevuta PDF"}</summary><form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
   {data.canReconcile?<p className="commerce-hint">Verifica in “Analisi Invii” il contratto e il riferimento. Questa operazione registra la tua verifica e non effettua un nuovo invio. Un controllo dati positivo o l’assenza di risultati non bastano a risolvere un invio incerto.</p>:null}
   <fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Dati della ricevuta verificata</legend>
    <Label htmlFor={`${id}-reference`}>Riferimento di invio sul portale</Label><Input id={`${id}-reference`} required maxLength={250} value={reference} readOnly={!data.canReconcile} onChange={e=>{setReference(e.target.value);key.current=crypto.randomUUID();}}/>
    <Label htmlFor={`${id}-protocol`}>Protocollo della ricevuta</Label><Input id={`${id}-protocol`} required maxLength={100} value={protocol} onChange={e=>{setProtocol(e.target.value);key.current=crypto.randomUUID();}}/>
    <Label htmlFor={`${id}-date`}>Data della ricevuta</Label><Input id={`${id}-date`} type="date" required value={date} onChange={e=>{setDate(e.target.value);key.current=crypto.randomUUID();}}/>
    <Label htmlFor={`${id}-file`}>Ricevuta PDF · massimo 2 MB</Label><Input id={`${id}-file`} type="file" accept="application/pdf,.pdf" required onChange={e=>{setFile(e.target.files?.[0]??null);key.current=crypto.randomUUID();}}/>
    <label className="flex items-start gap-2 text-sm min-h-11"><input type="checkbox" required checked={verified} onChange={e=>setVerified(e.target.checked)} className="mt-1"/><span>Ho verificato sul portale questo contratto e il riferimento di invio; la ricevuta allegata è pertinente.</span></label>
   </fieldset><p className="commerce-hint">Fleetum conserva il documento originale. La pertinenza della ricevuta è attestata dal responsabile; non viene certificata automaticamente la sua provenienza o firma.</p><Button disabled={busy||!verified||!file} type="submit">{busy?"Registrazione…":data.canReconcile?"Conferma verifica e archivia":"Archivia ricevuta"}</Button>
  </form></details>:null}
  {data.canReconcile&&!data.canManageReceipts?<p className="commerce-hint">Per registrare la verifica sul portale, chiedi all’amministratore di aprire questa pratica nella vista tutte le sedi.</p>:null}
  {data.status==="UNKNOWN"&&!data.canReconcile?<p className="commerce-hint">Invio incerto: verifica il portale e attendi la chiusura dell’eventuale richiesta ancora in corso. Non reinviare; se i dati sono cambiati serve una verifica del responsabile.</p>:null}
  <details><summary className="cursor-pointer font-medium">Storico dei controlli e degli invii</summary><ol className="mt-3 space-y-3">{[...(data.history??[]),...older].map(event=><li key={event.id} className="border-l-2 pl-3"><p className="text-sm font-medium">{event.message}</p><p className="commerce-hint">{new Date(event.createdAt).toLocaleString("it-IT")}{typeof event.details?.status==="string"?` · ${outcomes[event.details.status]??"Esito registrato"}`:""}</p>{typeof event.details?.transactionId==="string"?<p className="commerce-hint break-all" translate="no">Riferimento: {event.details.transactionId}</p>:null}</li>)}</ol>{!data.history?.length?<p className="commerce-hint mt-2">Nessun tentativo registrato.</p>:null}{cursor?<Button variant="outline" disabled={busy} onClick={()=>void loadOlder()}>Mostra eventi precedenti</Button>:null}</details>
 </section>;
}
