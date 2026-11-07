import {captureOperationContext,publishOperationFeedback} from "../../../application/stores/operation-feedback";
import {useEffect,useId,useRef,useState} from "react";
import {amountLabels,conditionLabels,contractRentalDetailsUseCases as api,parseContractCents,type DriverOption,type RentalDetails,type RentalTerms} from "../../../application/usecases/contract-rental-details-usecases";
import {captureSiteStamp,assertSiteStamp,useSiteAccessStore} from "../../../application/stores/site-access-store";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Label} from "../ui/label";
import {Select} from "../ui/select";
import {Textarea} from "../ui/textarea";

export function ContractRentalDetailsPanel({bookingId,canManage,freeze,onSaved}:{bookingId:string;canManage:boolean;freeze:boolean;onSaved:()=>void}){
 const owner=useSiteAccessStore(s=>s.owner),revision=useSiteAccessStore(s=>s.revision),context=`${owner}:${revision}:${bookingId}`,id=useId();
 const[data,setData]=useState<{context:string;value:RentalDetails}|null>(null),[draft,setDraft]=useState<RentalTerms|null>(null),[amounts,setAmounts]=useState<Record<string,string>>({}),[annexes,setAnnexes]=useState("");
 const[search,setSearch]=useState(""),[options,setOptions]=useState<DriverOption[]>([]),[searchBusy,setSearchBusy]=useState(false),[searchMessage,setSearchMessage]=useState("");
 const[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[reload,setReload]=useState(0),[invalid,setInvalid]=useState<string|null>(null);
 const seq=useRef(0),searchSeq=useRef(0),saving=useRef(false),alertRef=useRef<HTMLDivElement>(null);
 const current=data?.context===context?data.value:null,disabled=!current||!canManage||freeze||current.frozen||busy;
 const apply=(value:RentalDetails)=>{setData({context,value});setDraft(value.terms);setOptions(value.drivers);setAmounts(Object.fromEntries(Object.keys(amountLabels).map(key=>{const v=value.terms[key as keyof typeof amountLabels];return[key,v===null?"":(v/100).toFixed(2).replace(".",",")];})));setAnnexes(value.terms.annexes.join("\n"));};
 useEffect(()=>{let disposed=false;const n=++seq.current,stamp=captureSiteStamp();saving.current=false;setData(null);setDraft(null);setError("");setNotice("");setSearch("");setOptions([]);setBusy(false);setSearchMessage("");setSearchBusy(false);
  void api.read(bookingId).then(value=>{assertSiteStamp(stamp);if(!disposed&&n===seq.current)apply(value);}).catch(e=>{if(!disposed&&n===seq.current)setError((e as Error).message);});
  return()=>{disposed=true;seq.current++;searchSeq.current++;};
 },[context,reload]);
 useEffect(()=>{if(error)alertRef.current?.focus();},[error]);
 const findDrivers=async()=>{if(search.trim().length<2||disabled)return;const n=++searchSeq.current,epoch=seq.current,stamp=captureSiteStamp();setSearchBusy(true);setSearchMessage("");
  try{const values=await api.candidates(bookingId,search.trim());assertSiteStamp(stamp);if(epoch!==seq.current||n!==searchSeq.current)return;setOptions(old=>[...new Map([...old,...values].map(value=>[value.id,value])).values()]);setSearchMessage(values.length?`${values.length} conducenti trovati. Seleziona la persona qui sotto.`:"Nessuna persona trovata. Completa prima l’anagrafica Clienti.");}
  catch(e){if(epoch===seq.current&&n===searchSeq.current)setError((e as Error).message);}finally{if(epoch===seq.current&&n===searchSeq.current)setSearchBusy(false);}
 };
 const save=async()=>{
    const notificationScope=captureOperationContext();if(disabled||!draft||!current||saving.current)return;setError("");setInvalid(null);setNotice("");let terms:RentalTerms;
  try{const values:Record<string,number|null>={};for(const key of Object.keys(amountLabels)){try{values[key]=parseContractCents(amounts[key]??"");}catch(e){setInvalid(key);throw e;}}terms={...draft,...values,annexes:annexes.split("\n").map(value=>value.trim()).filter(Boolean)};}
  catch(e){setError((e as Error).message);return;}
  saving.current=true;setBusy(true);const n=seq.current,stamp=captureSiteStamp();try{const value=await api.save(bookingId,current.revision,terms);assertSiteStamp(stamp);if(n!==seq.current)return;apply(value);publishOperationFeedback(setNotice, "Condizioni salvate. Il PDF usa questa versione.", notificationScope, "info");onSaved();}
  catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current){setBusy(false);saving.current=false;}}
 };
 return <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Condizioni specifiche del noleggio" aria-busy={busy}>
  <div><h3 className="font-semibold">Condizioni specifiche del noleggio</h3><p className="text-sm text-muted-foreground">Intestatario e firmatario restano quelli del contratto. Indica separatamente chi guiderà il veicolo e le condizioni concordate.</p></div>
  {error?<div ref={alertRef} tabIndex={-1} role="alert" className="text-sm text-destructive"><p>{error}</p>{invalid?<a href={`#${id}-${invalid}`} className="underline">Correggi l’importo</a>:<Button type="button" variant="outline" onClick={()=>setReload(v=>v+1)}>Ricarica condizioni salvate</Button>}</div>:null}
  {notice?<p role="status" className="text-sm">{notice}</p>:null}
  {!current||!draft?<p role="status">Caricamento condizioni…</p>:<form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-4">
   {current.frozen||freeze?<p className="text-sm">Documento protetto dalla firma. Per modificarlo revoca l’invito; il contratto già sottoscritto resta immutabile.</p>:null}
   <fieldset disabled={disabled} className="space-y-3"><legend className="font-medium mb-2">Conducenti autorizzati</legend>
    <Label htmlFor={`${id}-search`}>Cerca una persona nell’anagrafica aziendale</Label><div className="flex flex-wrap gap-2"><Input id={`${id}-search`} maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} className="min-w-0 flex-1"/><Button type="button" variant="outline" disabled={searchBusy||search.trim().length<2} onClick={()=>void findDrivers()}>{searchBusy?"Ricerca…":"Cerca conducente"}</Button></div>
    {searchMessage?<p role="status" className="text-sm">{searchMessage}</p>:null}
    <div className="grid gap-3 md:grid-cols-2">{(["primary","additional"] as const).map(kind=><div className="space-y-1" key={kind}><Label htmlFor={`${id}-${kind}`}>{kind==="primary"?"Conducente principale":"Conducente aggiuntivo (facoltativo)"}</Label><Select id={`${id}-${kind}`} value={kind==="primary"?draft.primaryDriverId??"":draft.additionalDriverIds[0]??""} onChange={e=>setDraft({...draft,...(kind==="primary"?{primaryDriverId:e.target.value||null}:{additionalDriverIds:e.target.value?[e.target.value]:[]})})}><option value="">{kind==="primary"?"Seleziona una persona":"Nessuno"}</option>{options.filter(option=>kind==="primary"?!draft.additionalDriverIds.includes(option.id):option.id!==draft.primaryDriverId).map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</Select></div>)}</div>
    <p className="text-xs text-muted-foreground">Patente, documento e residenza vengono letti dall’anagrafica. Una società o il suo rappresentante non diventano automaticamente conducenti.</p>
   </fieldset>
   <fieldset disabled={disabled} className="space-y-3"><legend className="font-medium mb-2">Cauzione e franchigie · EUR</legend><p className="text-sm text-muted-foreground">Indica zero se non previste. Il campo vuoto significa “da definire”. Questi importi non effettuano addebiti o preautorizzazioni.</p><div className="grid gap-3 md:grid-cols-3">{Object.entries(amountLabels).map(([key,label])=><div key={key} className="space-y-1"><Label htmlFor={`${id}-${key}`}>{label}</Label><Input id={`${id}-${key}`} inputMode="decimal" maxLength={10} value={amounts[key]??""} aria-invalid={invalid===key} aria-describedby={invalid===key?`${id}-amount-error`:undefined} onChange={e=>setAmounts({...amounts,[key]:e.target.value})}/>{invalid===key?<p id={`${id}-amount-error`} className="text-xs text-destructive">Importo non valido: massimo due decimali.</p>:null}</div>)}</div></fieldset>
   <fieldset disabled={disabled} className="space-y-3"><legend className="font-medium mb-2">Regole concordate</legend><div className="grid gap-3 md:grid-cols-2">{Object.entries(conditionLabels).map(([key,label])=><div key={key} className="space-y-1"><Label htmlFor={`${id}-${key}`}>{label}</Label><Textarea id={`${id}-${key}`} rows={3} maxLength={4000} value={draft[key as keyof typeof conditionLabels]??""} onChange={e=>setDraft({...draft,[key]:e.target.value||null})}/></div>)}</div><Label htmlFor={`${id}-annexes`}>Documenti richiamati (uno per riga, massimo 12)</Label><Textarea id={`${id}-annexes`} rows={3} value={annexes} onChange={e=>setAnnexes(e.target.value)}/><p className="text-xs text-muted-foreground">L’elenco è stampato nel contratto. Non allega automaticamente i file: consegna e sottoscrizione dei documenti vanno verificate separatamente.</p></fieldset>
   {current.issues.length?<details className="text-sm"><summary className="cursor-pointer font-medium">Da completare prima della firma ({current.issues.length})</summary><ul className="list-disc pl-5 mt-2 space-y-1">{current.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></details>:<p className="text-sm">Dati essenziali completi. Verifica il PDF prima dell’invio.</p>}
   {canManage?<Button type="submit" disabled={disabled}>{busy?"Salvataggio…":"Salva condizioni"}</Button>:null}
  </form>}
 </section>;
}
