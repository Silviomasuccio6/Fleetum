import {useEffect,useRef,useState} from 'react';
import {contractSigningUseCases as api,type SigningView} from '../../../application/usecases/contract-signing-usecases';
import {assertSiteStamp,captureSiteStamp} from '../../../application/stores/site-access-store';
import {SigningPdfReader} from './signing-pdf-reader';
import {Button} from '../ui/button';
import '../../pages/contracts/contract-signing-page.css';
import './contract-workflow.css';
export function ContractInPersonSignature({bookingId,request,onSigned}:{bookingId:string;request:SigningView;onSigned:(value:SigningView)=>void}){
 const[bytes,setBytes]=useState<Uint8Array|null>(null),[ready,setReady]=useState(false),[consent,setConsent]=useState(false),[ink,setInk]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const canvas=useRef<HTMLCanvasElement>(null),drawing=useRef(false),key=useRef(crypto.randomUUID()),inFlight=useRef(false),seq=useRef(0);
 useEffect(()=>{const n=++seq.current,stamp=captureSiteStamp();void api.inPersonDocument(bookingId,request.id).then(async value=>{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value.slice().buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');assertSiteStamp(stamp);if(n!==seq.current)return;if(hash!==request.documentSha256)throw new Error('Il documento non corrisponde alla versione da firmare.');setBytes(value);}).catch(e=>{if(n===seq.current)setError((e as Error).message);});return()=>{seq.current++};},[bookingId,request.id,request.documentSha256]);
 const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return{x:(event.clientX-rect.left)*800/rect.width,y:(event.clientY-rect.top)*200/rect.height};};
 const clear=()=>{canvas.current?.getContext('2d')?.clearRect(0,0,800,200);setInk(false);setConsent(false);key.current=crypto.randomUUID();};
 const submit=async()=>{if(inFlight.current||!canvas.current||!ready||!ink||!consent)return;inFlight.current=true;setBusy(true);setError('');const n=seq.current,stamp=captureSiteStamp();try{const value=await api.confirmInPerson(bookingId,{requestId:request.id,documentHash:request.documentSha256,confirmationId:key.current,signatureDataUrl:canvas.current.toDataURL('image/png'),consent:true,consentVersion:'in-person-v1'});assertSiteStamp(stamp);if(n===seq.current)onSigned(value);}catch(e){if(n===seq.current)setError((e as Error).message);}finally{if(n===seq.current){inFlight.current=false;setBusy(false);}}};
 return <div className="contract-in-person space-y-3" aria-busy={busy}>
  <p className="text-sm">Mostra questo documento a {request.signerName}. La firma sarà inserita nella copia PDF conservata.</p>
  {error?<p role="alert" className="text-destructive text-sm">{error}</p>:null}
  {bytes?<SigningPdfReader bytes={bytes} onReady={()=>setReady(true)}/>:<p role="status">Apertura del documento da firmare…</p>}
  <label className="block text-sm font-medium" htmlFor="contract-presence-signature">Firma del cliente</label>
  <canvas id="contract-presence-signature" ref={canvas} width={800} height={200} aria-label="Area firma del cliente con mouse o dito" className="w-full rounded-md border bg-white" style={{touchAction:'none'}} onPointerDown={event=>{if(busy||!ready)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drawing.current=true;const ctx=event.currentTarget.getContext('2d'),p=point(event);if(ctx){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.strokeStyle='#182438';ctx.lineWidth=2.5;ctx.lineCap='round';}}} onPointerMove={event=>{if(!drawing.current)return;const ctx=event.currentTarget.getContext('2d'),p=point(event);ctx?.lineTo(p.x,p.y);ctx?.stroke();setInk(true);}} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/>
  <p className="text-xs text-muted-foreground">Firma con il dito o il mouse. Per firmare senza disegnare, usa il codice via email.</p>
  <Button variant="outline" disabled={busy} onClick={clear}>Cancella firma</Button>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={!ready||busy} onChange={e=>setConsent(e.target.checked)}/><span>Ho letto il documento mostrato e confermo di sottoscriverlo con la firma qui acquisita.</span></label>
  <Button disabled={!ready||!consent||!ink||busy} onClick={()=>void submit()}>{busy?'Registrazione…':'Conferma firma del cliente'}</Button>
 </div>;
}
