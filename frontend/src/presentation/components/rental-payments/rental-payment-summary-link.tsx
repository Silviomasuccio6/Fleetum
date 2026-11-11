import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {Wallet} from 'lucide-react';
import {rentalCollectionsUseCases,type CollectionDetail} from '../../../application/usecases/rental-collections-usecases';
import {useAuthStore} from '../../../application/stores/auth-store';
import {useSiteAccessStore} from '../../../application/stores/site-access-store';
import {useFleetumLanguage} from '../../i18n/fleetum-language';
import {BookingDetailSection} from '../bookings/booking-detail-section';
import {Button} from '../ui/button';
import {collectionHref,collectionStateLabels} from '../../pages/rental-payments/collection-presentation';
export function RentalPaymentSummaryLink({booking,paymentSetupStatus}:{booking:{id:string};paymentSetupStatus?:string|null}){
 const canRead=useAuthStore(s=>!!s.user?.permissions.some(p=>p==='*'||p==='rental-payments:read')),revision=useSiteAccessStore(s=>s.revision),{language}=useFleetumLanguage(),navigate=useNavigate(),location=useLocation();
 const[data,setData]=useState<CollectionDetail|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError(null);if(!canRead)return;setLoading(true);rentalCollectionsUseCases.detail(booking.id).then(result=>{if(active)setData(result)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[booking.id,canRead,revision,refresh]);
 const money=(value:number|null)=>value===null?'—':new Intl.NumberFormat(language==='it'?'it-IT':'en-GB',{style:'currency',currency:'EUR'}).format(value/100);
 return <BookingDetailSection title="Pagamenti e garanzie" description="Riepilogo del saldo. Movimenti, carte e garanzie nella pagina dedicata." icon={<Wallet/>}>
  {!canRead?<p>Il tuo ruolo non consente l’accesso ai pagamenti.</p>:<>
   {loading?<p role="status">Caricamento pagamenti...</p>:error?<p className="booking-detail-error" role="alert">{error}</p>:data?<><dl className="grid gap-3 text-sm md:grid-cols-3"><div><dt>Totale concordato</dt><dd translate="no">{money(data.booking.agreedCents)}</dd></div><div><dt>Incassi netti</dt><dd translate="no">{money(data.booking.receivedCents)}</dd></div><div><dt>Saldo residuo</dt><dd translate="no">{money(data.booking.outstandingCents)}</dd></div></dl><p className="text-xs text-muted-foreground">{collectionStateLabels[data.booking.state]}</p></>:null}
   {paymentSetupStatus?<p className="text-xs text-muted-foreground">Il ritorno da Stripe non conferma un pagamento. Verifica lo stato nella pagina dedicata.</p>:null}
   <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Aggiorna</Button><Button onClick={()=>navigate(collectionHref(booking.id,location.pathname+location.search)+(paymentSetupStatus?'&payment_setup='+encodeURIComponent(paymentSetupStatus):''))}>Apri pagamenti e garanzie</Button></div>
  </>}
 </BookingDetailSection>;
}
