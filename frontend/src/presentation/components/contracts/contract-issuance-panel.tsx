import {useEffect,useRef,useState} from 'react';
import {contractIssuanceUseCases as api,type ContractReview} from '../../../application/usecases/contract-issuance-usecases';
import {assertSiteStamp,captureSiteStamp,useSiteAccessStore} from '../../../application/stores/site-access-store';
import {captureOperationContext,publishOperationFeedback} from '../../../application/stores/operation-feedback';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
const money=(cents:number|null)=>cents===null?'Da concordare':new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(cents/100);
export function ContractIssuancePanel({bookingId,canManage,canAgreePrice,onIssued,onChanged,hasUnsavedChanges=false}:{bookingId:string;canManage:boolean;canAgreePrice:boolean;onIssued:()=>void;onChanged:(kind:"price"|"issuance")=>void;hasUnsavedChanges?:boolean}){
 const revision=useSiteAccessStore(s=>s.revision),owner=useSiteAccessStore(s=>s.owner),context=`${owner}:${revision}:${bookingId}`;
 const [reload,setReload]=useState(0),[loaded,setLoaded]=useState<{context:string;value:ContractReview}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false),[list,setList]=useState(''),[discount,setDiscount]=useState('0.00'),[reason,setReason]=useState('');
 const seq=useRef(0),inFlight=useRef(false),callbacks=useRef({onIssued,onChanged});callbacks.current={onIssued,onChanged};
 const value=loaded?.context===context?loaded.value:null;
 useEffect(()=>{const n=++seq.current,stamp=captureSiteStamp();setLoaded(null);setError('');setBusy(false);setEditing(false);inFlight.current=false;void api.review(bookingId).then(value=>{assertSiteStamp(stamp);if(n===seq.current)setLoaded({context,value});}).catch(e=>{if(n===seq.current)setError((e as Error).message);});return()=>{seq.current++};},[context,bookingId,reload]);
 const run=async(price:boolean)=>{if(inFlight.current||!value)return;const n=seq.current,stamp=captureSiteStamp(),feedback=captureOperationContext();inFlight.current=true;setBusy(true);setError('');try{
  let result:ContractReview;
  if(price){const exact=(s:string)=>/^\d+(?:[.,]\d{1,2})?$/.test(s)?Math.round(Number(s.replace(',','.'))*100):NaN;const listCents=exact(list),discountCents=exact(discount);if(!Number.isSafeInteger(listCents)||!Number.isSafeInteger(discountCents)||discountCents>listCents||reason.trim().length<3)throw new Error('Inserisci importi validi e una motivazione di almeno 3 caratteri.');result=await api.agree(bookingId,{listCents,discountCents,reason:reason.trim(),reviewHash:value.reviewHash});}
  else {if(hasUnsavedChanges)throw new Error("Salva le condizioni e il documento prima dell’emissione.");result=await api.convert(bookingId,value.reviewHash);}
  assertSiteStamp(stamp);if(n!==seq.current)return;setLoaded({context,value:result});setEditing(false);callbacks.current.onChanged(price?"price":"issuance");publishOperationFeedback(()=>{},price?'Prezzo concordato salvato':'Contratto creato',feedback);if(!price)callbacks.current.onIssued();
 }catch(e){if(n===seq.current){const message=(e as Error).message;setError(message);}}finally{if(n===seq.current){inFlight.current=false;setBusy(false);}}};
 return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Trasformazione in contratto" aria-busy={busy}>
  <h3 className="font-semibold">{value?.issuedAt?'Contratto emesso':value?.legacySigned?'Contratto storico firmato':'Trasforma in contratto'}</h3>
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  <Button size="sm" variant="outline" disabled={busy} onClick={()=>setReload(v=>v+1)}>Rileggi riepilogo</Button>
  {!value?<p role="status">{error?'Riapri la prenotazione per rileggere i dati.':'Caricamento del riepilogo…'}</p>:<>
   <p className="text-sm break-words" translate="no">{value.customer} · {value.vehicle} · {value.bookingCode}</p>
   {value.pickupAt&&value.returnAt?<p className="text-sm">Ritiro: {new Date(value.pickupAt).toLocaleString('it-IT')} · {value.pickupLocation||'Sede da definire'}<br/>Rientro: {new Date(value.returnAt).toLocaleString('it-IT')} · {value.returnLocation||'Sede da definire'}</p>:null}
   {value.readinessIssues?.length?<div className="text-sm" role="status"><p className="font-medium">Prima dell’emissione:</p><ul className="list-disc pl-5">{value.readinessIssues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>:null}
   <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><dt>Prezzo concordato</dt><dd className="text-right tabular-nums" translate="no">{money(value.balance.agreedCents)}</dd><dt>Incassi registrati</dt><dd className="text-right tabular-nums" translate="no">{money(value.balance.receivedCents)}</dd><dt>Saldo da incassare</dt><dd className="text-right tabular-nums" translate="no">{money(value.balance.outstandingCents)}</dd>{value.balance.creditCents>0?<><dt>Credito cliente</dt><dd className="text-right tabular-nums" translate="no">{money(value.balance.creditCents)}</dd></>:null}</dl>
   {value.priceAgreement?<p className="text-sm break-words">Listino {money(value.priceAgreement.listCents)} · Sconto {money(value.priceAgreement.discountCents)} · {value.priceAgreement.reason}</p>:<p className="text-xs text-muted-foreground">Provenienza di eventuali sconti storici non registrata.</p>}
   {!value.issuedAt&&!value.legacySigned?<><p className="text-sm text-muted-foreground">Conferma i dati e le condizioni nella sezione sottostante. Sono ammessi importi gratuiti, sconti e saldo aperto; la cauzione resta separata dagli incassi.</p>
    {canAgreePrice?<Button className="mr-2" variant="outline" disabled={busy} onClick={()=>{setEditing(v=>!v);setList(((value.priceAgreement?.listCents??value.balance.agreedCents??0)/100).toFixed(2));setDiscount(((value.priceAgreement?.discountCents??0)/100).toFixed(2));}}>Concorda prezzo e sconto</Button>:null}
    {editing?<form onSubmit={e=>{e.preventDefault();void run(true);}} className="space-y-2"><label className="block text-sm">Prezzo prima dello sconto (€)<Input inputMode="decimal" value={list} onChange={e=>setList(e.target.value)} disabled={busy} required/></label><label className="block text-sm">Sconto (€)<Input inputMode="decimal" value={discount} onChange={e=>setDiscount(e.target.value)} disabled={busy} required/></label><label className="block text-sm">Motivazione<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={500} disabled={busy} required/></label><Button type="submit" disabled={busy}>Salva prezzo concordato</Button></form>:null}
    {hasUnsavedChanges?<p className="text-sm" role="status">Salva le condizioni e il documento prima dell’emissione.</p>:null}
    <Button disabled={busy||!canManage||hasUnsavedChanges||editing||value.balance.agreedCents===null||Boolean(value.readinessIssues?.length)} onClick={()=>void run(false)}>{busy?'Verifica in corso…':'Conferma e trasforma in contratto'}</Button>
   </>:<p className="text-sm">{value.issuedAt?'Emissione confermata il '+new Date(value.issuedAt).toLocaleString('it-IT'):'La versione storica e la sua firma vengono conservate.'}</p>}
  </>}
 </section>;
}
