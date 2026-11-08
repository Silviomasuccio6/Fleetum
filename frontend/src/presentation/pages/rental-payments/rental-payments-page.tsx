import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {ArrowLeft,RefreshCw,Wallet,Landmark,ShieldCheck} from 'lucide-react';
import {rentalCollectionsUseCases,type CollectionBooking,type CollectionDetail,type CollectionEntry,type CollectionMethod,type CollectionWorkspace} from '../../../application/usecases/rental-collections-usecases';
import {captureOperationContext,publishOperationFeedback} from '../../../application/stores/operation-feedback';
import {useAuthStore} from '../../../application/stores/auth-store';
import {useSiteAccessStore} from '../../../application/stores/site-access-store';
import {Button} from '../../components/ui/button';
import {Input} from '../../components/ui/input';
import {Select} from '../../components/ui/select';
import {Textarea} from '../../components/ui/textarea';
import {CommerceCollection,CommerceDrawer,CommerceField,CommerceNotice} from '../../components/ui/commerce-workspace';
import {WorkspaceMetricStrip} from '../../components/ui/workspace-ui';
import {FleetumInlineLoader} from '../../components/brand/fleetum-logo-loader';
import {RentalPaymentGuaranteePanel} from '../../components/rental-payments/RentalPaymentGuaranteePanel';
import {getSafeReturnTo} from '../../routes/safe-return-to';
import {useFleetumLanguage} from '../../i18n/fleetum-language';
import {collectionStateLabels,collectionMethodLabels,collectionKindLabels,parseCollectionCents,receiptRemaining,canReverseEntry} from './collection-presentation';
import '../../styles/commerce-workspace.css';
import './rental-payments.css';
const filters=['search','from','to','siteId','state','method','bookingId','customerId'] as const;
type Command={kind:CollectionEntry['kind'];source?:CollectionEntry;amount:string;method:CollectionMethod;occurredAt:string;reference:string;reason:string;key:string;confirmed:boolean;retryLocked?:boolean};
const localDate=()=>{const now=new Date();return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export function RentalPaymentsPage(){
 const user=useAuthStore(s=>s.user),site=useSiteAccessStore(),{language}=useFleetumLanguage(),[params,setParams]=useSearchParams(),navigate=useNavigate();
 const allowed=(permission:string)=>!!user?.permissions.some(p=>p===permission||p==='*');const canRead=allowed('rental-payments:read'),canCollect=allowed('rental-payments:charge'),canRefund=allowed('rental-payments:refund');
 const scope=[user?.tenantId,user?.id,site.revision].join(':'),query=useMemo(()=>Object.fromEntries(filters.map(key=>[key,params.get(key)||undefined])),[params]);
 const selectedId=params.get('detailId')||params.get('bookingId'),page=Math.max(1,Number(params.get('page'))||1),returnTo=getSafeReturnTo(params.get('returnTo'),'/booking');
 const [data,setData]=useState<CollectionWorkspace|null>(null),[detail,setDetail]=useState<CollectionDetail|null>(null),[error,setError]=useState<string|null>(null),[detailError,setDetailError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[refresh,setRefresh]=useState(0);
 const [command,setCommand]=useState<Command|null>(null),[commandError,setCommandError]=useState<string|null>(null),[busy,setBusy]=useState(false),lock=useRef(false),generation=useRef(0),origin=useRef<HTMLElement|null>(null);
 const key=JSON.stringify([scope,query,page,canRead]),detailKey=[scope,selectedId,canRead].join(':');
 const current=useRef(detailKey);current.current=detailKey;
 useEffect(()=>{let active=true;setData(null);setError(null);if(!canRead)return;setLoading(true);rentalCollectionsUseCases.list({...query,page,pageSize:20}).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[key,refresh]);
 useEffect(()=>{let active=true;generation.current++;setDetail(null);setDetailError(null);setCommand(null);setCommandError(null);setNotice(null);if(!canRead||!selectedId)return;setDetailLoading(true);rentalCollectionsUseCases.detail(selectedId).then(value=>{if(active)setDetail(value)}).catch(e=>{if(active)setDetailError(e.message)}).finally(()=>{if(active)setDetailLoading(false)});return()=>{active=false};},[detailKey,refresh]);
 const currency=(cents:number|null)=>cents===null?'—':new Intl.NumberFormat(language==='it'?'it-IT':'en-GB',{style:'currency',currency:'EUR'}).format(cents/100);
 const date=(value:string)=>new Date(value).toLocaleString(language==='it'?'it-IT':'en-GB',{dateStyle:'short',timeStyle:'short'});
 const set=(name:string,value:string)=>{if(busy)return;setParams(current=>{const next=new URLSearchParams(current);value?next.set(name,value):next.delete(name);next.delete('page');return next})};
 const open=(row:CollectionBooking,element:HTMLElement)=>{origin.current=element;set('detailId',row.id)};
 const close=()=>{if(busy)return;setParams(current=>{const next=new URLSearchParams(current);next.delete('detailId');if(next.has('bookingId'))next.delete('bookingId');return next})};
 const start=(kind:Command['kind'],source?:CollectionEntry)=>{if(!detail||detail.booking.archived||busy)return;setCommandError(null);setCommand({kind,source,amount:kind==='REVERSAL'?String((source!.amountCents/100).toFixed(2)):'',method:source?.method??'CASH',occurredAt:localDate(),reference:'',reason:'',key:crypto.randomUUID(),confirmed:false})};
 const update=(patch:Partial<Command>)=>{if(!busy&&!command?.retryLocked)setCommand(current=>current?{...current,...patch,key:crypto.randomUUID(),confirmed:false}:null)};
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(lock.current||!command||!detail||detail.booking.archived)return;
  if(command.kind==='RECEIPT'?!canCollect:!canRefund)return;
  const amountCents=command.kind==='REVERSAL'?command.source!.amountCents:parseCollectionCents(command.amount);
  if(!amountCents||!command.confirmed){setCommandError('Verifica importo e conferma della registrazione.');return;}
  if(command.kind==='REFUND'&&amountCents>receiptRemaining(command.source!,detail.entries)){setCommandError('Il rimborso supera l’importo ancora rimborsabile.');return;}
  const captured=current.current,scope=captureOperationContext(),n=generation.current;lock.current=true;setBusy(true);setCommandError(null);
  try{
   const input={...(command.kind!=='REVERSAL'?{amountCents}:{}),...(command.kind==='RECEIPT'?{method:command.method}:{}),occurredAt:new Date(command.occurredAt).toISOString(),reference:command.reference.trim(),reason:command.reason.trim()};
   await rentalCollectionsUseCases.record(detail.booking.id,command.kind,input,command.key,command.source?.id);
   if(current.current!==captured||generation.current!==n)return;
   publishOperationFeedback(setNotice,command.kind==='RECEIPT'?'Incasso manuale registrato.':command.kind==='REFUND'?'Rimborso manuale registrato.':'Storno di registrazione salvato.',scope);
   setCommand(null);setRefresh(value=>value+1);
  }catch(e){if(current.current===captured&&generation.current===n){setCommandError((e as Error).message);const issue=e as {isNetwork?:boolean;isTimeout?:boolean;status?:number};if(issue.isNetwork||issue.isTimeout||(issue.status!==undefined&&issue.status>=500))setCommand(value=>value?{...value,retryLocked:true}:null);}}finally{lock.current=false;setBusy(false)}
 };
 const columns=[
  {key:'booking',label:'Prenotazione e cliente',render:(row:CollectionBooking)=><><button type="button" className="commerce-name" aria-haspopup="dialog" onClick={event=>open(row,event.currentTarget)}><strong translate="no">{row.code}</strong></button><small translate="no">{row.customerName}</small>{row.archived?<small>Prenotazione archiviata</small>:null}</>},
  {key:'vehicle',label:'Veicolo e sede',render:(row:CollectionBooking)=><><span translate="no">{row.plate}</span><small translate="no">{row.siteName||'—'}</small></>},
  {key:'agreed',label:'Totale concordato',render:(row:CollectionBooking)=><span className="collection-money" translate="no">{currency(row.agreedCents)}</span>},
  {key:'received',label:'Incassi netti',render:(row:CollectionBooking)=><span className="collection-money" translate="no">{currency(row.receivedCents)}</span>},
  {key:'due',label:'Saldo residuo',render:(row:CollectionBooking)=><><span className="collection-money" translate="no">{currency(row.outstandingCents)}</span>{row.creditCents>0?<small>Credito da restituire: <span translate="no">{currency(row.creditCents)}</span></small>:null}</>},
  {key:'state',label:'Stato noleggio',render:(row:CollectionBooking)=><span className="commerce-status">{collectionStateLabels[row.state]}</span>},
  {key:'actions',label:'Azioni',render:(row:CollectionBooking)=><Button variant="outline" onClick={event=>open(row,event.currentTarget)}>Apri pagamenti</Button>}
 ];
 if(!canRead)return <section className="commerce-workspace"><h1>Pagamenti e garanzie</h1><p>Il tuo ruolo non consente l’accesso ai pagamenti.</p></section>;
 const summary=data?.summary,booking=detail?.booking;
 return <section className="commerce-workspace collection-workspace">
  <header className="workspace-page-header"><div><h1>Pagamenti e garanzie</h1><p className="workspace-description">Incassi del noleggio, saldo e movimenti. Garanzie ed extra rimangono separati.</p></div><div className="workspace-page-actions">{params.has('returnTo')?<Button variant="outline" onClick={()=>navigate(returnTo)}><ArrowLeft aria-hidden="true" className="h-4 w-4"/> Torna al contesto</Button>:null}<Button variant="outline" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw aria-hidden="true" className="h-4 w-4"/> Aggiorna</Button></div></header>
  <WorkspaceMetricStrip loading={!summary||loading} collapsible items={[
   {label:'Totale concordato',value:currency(summary?.agreedCents??0),hint:'Noleggi con importo definito',icon:Wallet},
   {label:'Incassi netti',value:currency(summary?.receivedCents??0),hint:'Ricevuti meno rimborsi e storni',icon:Landmark},
   {label:'Saldo residuo',value:currency(summary?.outstandingCents??0),hint:'Da incassare sui risultati filtrati',icon:Wallet},
   {label:'Garanzie autorizzate',value:currency(summary?.authorizedGuaranteeCents??0),hint:'Somme bloccate, separate dal noleggio',icon:ShieldCheck}
  ]}/>
  {summary?.unknownTotalCount?<p className="collection-note" role="status">{summary.unknownTotalCount} noleggi con totale da definire: esclusi dal saldo da incassare.</p>:null}
  {summary&&summary.creditCents>0?<p className="collection-note">Credito da restituire: <span translate="no">{currency(summary.creditCents)}</span></p>:null}
  <section className="commerce-panel"><header className="commerce-panel-header"><div><h2>Registro del noleggio <span>{data?.total??'—'}</span></h2><p>Le date filtrano il periodo del noleggio. L’incasso indica soltanto movimenti confermati.</p></div></header>
   <form className="commerce-filters collection-filters" onSubmit={event=>event.preventDefault()}>
    <div><label htmlFor="collection-search">Cerca cliente, prenotazione o targa</label><Input id="collection-search" value={query.search??''} onChange={e=>set('search',e.target.value)} maxLength={160}/></div>
    <div><label htmlFor="collection-from">Dal</label><Input id="collection-from" type="date" value={query.from??''} onChange={e=>set('from',e.target.value)}/></div>
    <div><label htmlFor="collection-to">Al</label><Input id="collection-to" type="date" value={query.to??''} onChange={e=>set('to',e.target.value)}/></div>
    <div><label htmlFor="collection-state">Stato del saldo</label><Select id="collection-state" value={query.state??''} onChange={e=>set('state',e.target.value)}><option value="">Tutti gli stati</option>{Object.entries(collectionStateLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></div>
    <div><label htmlFor="collection-method">Metodo registrato</label><Select id="collection-method" value={query.method??''} onChange={e=>set('method',e.target.value)}><option value="">Tutti i metodi</option>{Object.entries(collectionMethodLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></div>
    <div><label htmlFor="collection-site">Sede coinvolta</label><Select id="collection-site" value={query.siteId??''} onChange={e=>set('siteId',e.target.value)}><option value="">Vista attuale</option>{site.context?.sites.map(value=><option value={value.id} key={value.id}>{value.name}</option>)}</Select></div>
    <Button variant="ghost" onClick={()=>setParams(current=>{const next=new URLSearchParams();if(current.get('returnTo'))next.set('returnTo',current.get('returnTo')!);return next})}>Azzera filtri</Button>
   </form>
   <div aria-busy={loading}>{loading?<div className="commerce-empty"><FleetumInlineLoader label="Caricamento pagamenti"/></div>:error?<div className="commerce-empty"><CommerceNotice>{error}</CommerceNotice><Button onClick={()=>setRefresh(v=>v+1)}>Riprova caricamento</Button></div>:data?.data.length?<CommerceCollection rows={data.data} columns={columns} caption="Pagamenti del noleggio per prenotazione" selectedId={selectedId}/>:<div className="commerce-empty"><h3>Nessuna pratica trovata</h3><p>Modifica i filtri o apri Pagamenti e garanzie da una prenotazione.</p></div>}</div>
   <footer className="commerce-pagination"><span>Pagina {page} · {data?.total??0} risultati</span><div><Button variant="outline" disabled={page<=1||loading} onClick={()=>setParams(current=>{const next=new URLSearchParams(current);next.set('page',String(page-1));return next})}>Precedente</Button><Button variant="outline" disabled={loading||page*20>=(data?.total??0)} onClick={()=>setParams(current=>{const next=new URLSearchParams(current);next.set('page',String(page+1));return next})}>Successiva</Button></div></footer>
  </section>
  {selectedId?<CommerceDrawer showEyebrow={false} title="Pagamenti della prenotazione" description={booking?.code} translateDescription={false} origin={origin.current} onClose={close} busy={busy} footer={<><Button variant="outline" disabled={busy} onClick={close}>Chiudi</Button>{booking?<Button variant="outline" disabled={busy} onClick={()=>navigate(`/booking?bookingId=${encodeURIComponent(booking.id)}`)}>Apri prenotazione</Button>:null}</>}>
   {detailLoading?<FleetumInlineLoader label="Caricamento movimenti"/>:detailError?<><CommerceNotice>{detailError}</CommerceNotice><Button onClick={()=>setRefresh(v=>v+1)}>Riprova dettaglio</Button></>:detail&&booking?<>
    {notice?<CommerceNotice tone="success">{notice}</CommerceNotice>:null}
    <section className="collection-detail-summary"><h3 translate="no">{booking.customerName}</h3><p translate="no">{booking.plate} · {booking.brand} {booking.model}</p><span className="commerce-status">{collectionStateLabels[booking.state]}</span>
     <dl><div><dt>Totale concordato</dt><dd translate="no">{currency(booking.agreedCents)}</dd></div><div><dt>Incassi netti</dt><dd translate="no">{currency(booking.receivedCents)}</dd></div><div><dt>Saldo residuo</dt><dd translate="no">{currency(booking.outstandingCents)}</dd></div></dl>
     {booking.state==='FREE'?<p>Gratuito / nessun importo dovuto. Nessun pagamento fittizio registrato.</p>:null}
     {booking.creditCents>0?<p>Credito da restituire: <span translate="no">{currency(booking.creditCents)}</span></p>:null}
     {detail.priceAgreement?<div className="collection-price-source"><h4>Prezzo concordato registrato</h4><p>Prima dello sconto: {currency(detail.priceAgreement.listCents)}</p><p>Sconto: {currency(detail.priceAgreement.discountCents)}</p><p>Motivazione: {detail.priceAgreement.reason}</p><p>Registrato il {new Date(detail.priceAgreement.recordedAt).toLocaleString(language==='it'?'it-IT':'en-GB')}</p></div>:null}
     {detail.pricing?<div className="collection-price-source"><h4>Origine del prezzo</h4><p>Listino: <span translate="no">{detail.pricing.priceListName??'—'}</span></p><p>Tariffa memorizzata: <span translate="no">{detail.pricing.unitRateAmount==null||!Number.isFinite(Number(detail.pricing.unitRateAmount))?'—':new Intl.NumberFormat(language==='it'?'it-IT':'en-GB',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(detail.pricing.unitRateAmount))}</span> · {detail.pricing.unit==='DAILY'?'al giorno':detail.pricing.unit==='WEEKLY'?'alla settimana':detail.pricing.unit==='MONTHLY'?'al mese':'unità non disponibile'}</p><p>Sconto registrato: <span translate="no">{detail.pricing.discountPercent===null?'—':detail.pricing.discountPercent+'%'}</span></p><p>Autore e motivo dello sconto non registrati nella versione storica.</p><p className="commerce-hint">La tariffa di listino non è il totale del noleggio. Extra, durata, IVA e accordi possono differire; il saldo usa il totale concordato della prenotazione.</p></div>:<p className="collection-note">Dati del listino e provenienza dello sconto non disponibili per questa prenotazione. Il totale concordato non viene ricostruito o modificato.</p>}
     <p className="commerce-hint">Il totale concordato viene dalla prenotazione. Cauzioni ed extra non saldano il noleggio.</p>
    </section>
    <section className="collection-ledger"><header><div><h3>Movimenti del noleggio</h3><p className="commerce-hint">Registrazioni manuali di denaro già ricevuto o restituito, con autore e riferimento.</p></div>{canCollect&&!booking.archived?<Button onClick={()=>start('RECEIPT')}>Registra incasso</Button>:null}</header>
     {booking.archived?<p className="collection-note">Prenotazione archiviata: storico disponibile, nuovi movimenti disabilitati.</p>:null}
     {!detail.entries.length?<p className="collection-note">Nessun incasso registrato. Una carta salvata o un bonifico atteso non attestano un pagamento.</p>:<ol>{detail.entries.map(entry=><li key={entry.id}><header><strong>{collectionKindLabels[entry.kind]}</strong><span className="collection-money" translate="no">{currency(entry.amountCents)}</span></header><p>{collectionMethodLabels[entry.method]} · <time translate="no" dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time></p><p translate="no">{entry.reference} · {entry.reason}</p><small>Registrato da <span translate="no">{entry.createdBy.firstName} {entry.createdBy.lastName}</span> · <time translate="no" dateTime={entry.createdAt}>{date(entry.createdAt)}</time></small>{entry.sourceId?<small>Collegato al movimento <span translate="no">{entry.sourceId}</span></small>:null}
      {canRefund&&!booking.archived?<div className="commerce-row-actions">{entry.kind==='RECEIPT'&&receiptRemaining(entry,detail.entries)>0?<Button variant="outline" onClick={()=>start('REFUND',entry)}>Registra rimborso</Button>:null}{canReverseEntry(entry,detail.entries)?<Button variant="ghost" onClick={()=>start('REVERSAL',entry)}>Storna registrazione</Button>:null}</div>:null}
     </li>)}</ol>}
    </section>
    <section className="collection-provider"><h3>Incasso online del noleggio</h3><p>Da configurare per l’azienda di noleggio. Nessun incasso online viene simulato o attribuito all’account degli abbonamenti Fleetum.</p></section>
    {!booking.archived&&booking.customerId?<RentalPaymentGuaranteePanel booking={{...booking,vehicle:{plate:booking.plate,brand:booking.brand,model:booking.model},customer:booking.customerId?{id:booking.customerId}:null}} paymentSetupStatus={params.get("payment_setup")} onChanged={()=>setRefresh(v=>v+1)}/>:null}
   </>:null}
  </CommerceDrawer>:null}
  {command&&detail?<CommerceDrawer showEyebrow={false} compact level={110} title={command.kind==='RECEIPT'?'Registra incasso':command.kind==='REFUND'?'Registra rimborso':'Storna registrazione'} description={detail.booking.code} onClose={()=>{if(!busy)setCommand(null)}} busy={busy} footer={<><Button variant="outline" disabled={busy} onClick={()=>setCommand(null)}>Annulla</Button><Button type="submit" form="collection-command" disabled={busy||!command.confirmed}>{busy?'Registrazione...':'Conferma registrazione'}</Button></>}>
   <form id="collection-command" className="collection-command" onSubmit={submit}>{commandError?<CommerceNotice>{commandError}</CommerceNotice>:null}
    {command.retryLocked?<p className="collection-note">Esito non confermato: puoi riprovare la stessa registrazione senza cambiare i dati. Per altre operazioni chiudi e verifica prima il registro.</p>:null}
    <p className="collection-note">Questa azione registra un movimento già effettuato. Non addebita carte e non dispone un bonifico. Lo storno corregge il registro senza spostare denaro.</p>
    <CommerceField id="collection-amount" label="Importo in euro"><Input required inputMode="decimal" value={command.amount} disabled={busy||command.retryLocked||command.kind==='REVERSAL'} onChange={event=>update({amount:event.target.value})}/></CommerceField>
    <CommerceField id="collection-payment-method" label="Metodo"><Select disabled={busy||command.retryLocked||command.kind!=='RECEIPT'} value={command.method} onChange={event=>update({method:event.target.value as CollectionMethod})}>{Object.entries(collectionMethodLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</Select></CommerceField>
    <CommerceField id="collection-occurred" label="Data e ora del movimento"><Input required type="datetime-local" disabled={busy||command.retryLocked} value={command.occurredAt} onChange={event=>update({occurredAt:event.target.value})}/></CommerceField>
    <CommerceField id="collection-reference" label="Riferimento" hint="Ricevuta, distinta bonifico o riferimento del POS. Non inserire dati della carta."><Input required maxLength={160} disabled={busy||command.retryLocked} value={command.reference} onChange={event=>update({reference:event.target.value})}/></CommerceField>
    <CommerceField id="collection-reason" label="Causale o motivo"><Textarea required minLength={3} maxLength={1000} disabled={busy||command.retryLocked} value={command.reason} onChange={event=>update({reason:event.target.value})}/></CommerceField>
    {command.kind==='RECEIPT'&&parseCollectionCents(command.amount)!==null&&detail.booking.outstandingCents!==null&&parseCollectionCents(command.amount)!>detail.booking.outstandingCents?<p className="collection-note">L’importo supera il saldo residuo: la differenza risulterà come credito del cliente.</p>:null}
    <label className="collection-confirm"><input type="checkbox" disabled={busy} checked={command.confirmed} onChange={event=>setCommand(current=>current?{...current,confirmed:event.target.checked}:null)}/>Confermo <span translate="no">{currency(command.kind==='REVERSAL'?command.source!.amountCents:parseCollectionCents(command.amount))}</span> con il metodo indicato; il movimento è già avvenuto o la correzione è necessaria.</label>
   </form>
  </CommerceDrawer>:null}
 </section>;
}
