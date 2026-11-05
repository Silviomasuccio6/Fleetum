import {SigningPdfReader} from "../../components/contracts/signing-pdf-reader";
import {useEffect,useRef,useState} from "react";
import {publicSigningRequest,type SigningView} from "../../../application/usecases/contract-signing-usecases";
import "./contract-signing-page.css";
const date=(value:string)=>new Date(value).toLocaleString("it-IT");
const download=(url:string,name:string)=>{const link=document.createElement("a");link.href=url;link.download=name;link.click();};
export function ContractSigningPage(){
 const[documentBytes,setDocumentBytes]=useState<Uint8Array|null>(null);
 const token=useRef(new URLSearchParams(window.location.hash.slice(1)).get("token")??"");
 const[view,setView]=useState<SigningView|null>(null),[documentUrl,setDocumentUrl]=useState(""),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[code,setCode]=useState(""),[consent,setConsent]=useState(false),[notice,setNotice]=useState("");
 const[now,setNow]=useState(Date.now());
 useEffect(()=>{if(!view?.resendAfter)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[view?.resendAfter]);
 const confirmation=useRef(crypto.randomUUID()),mounted=useRef(false),pending=useRef(false),documentRef=useRef(""),epoch=useRef(0);
 useEffect(()=>{mounted.current=true;const generation=++epoch.current,controller=new AbortController();const meta=document.createElement("meta");meta.name="referrer";meta.content="no-referrer";document.head.append(meta);const robots=document.createElement("meta");robots.name="robots";robots.content="noindex, nofollow";document.head.append(robots);document.title="Firma contratto · Fleetum";
  // Keep the capability out of subsequent navigation and browser history entries.
  if(token.current)window.history.replaceState(null,"",window.location.pathname+window.location.search);
  void(async()=>{try{
   if(!/^[A-Za-z0-9_-]{43}$/.test(token.current))throw new Error("Apri il collegamento ricevuto dal noleggiatore per leggere il tuo contratto.");
   const summary=await(await publicSigningRequest("resolve",token.current,{},controller.signal)).json() as SigningView;
   const pdf=await publicSigningRequest("document",token.current,{},controller.signal),blob=await pdf.blob();
   const data=new Uint8Array(await blob.arrayBuffer());
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),b=>b.toString(16).padStart(2,"0")).join("");
   if(hash!==summary.documentSha256)throw new Error("Il documento non supera la verifica di integrità. Contatta il noleggiatore.");
   if(controller.signal.aborted||generation!==epoch.current)return;const url=URL.createObjectURL(blob);documentRef.current=url;setDocumentUrl(url);setDocumentBytes(data);setView(summary);
  }catch(e){if(!controller.signal.aborted&&generation===epoch.current)setError((e as Error).message);}})();
  return()=>{mounted.current=false;controller.abort();meta.remove();robots.remove();if(documentRef.current){URL.revokeObjectURL(documentRef.current);documentRef.current="";}};
 },[]);
 useEffect(()=>{if(!view||!((view.status==="PENDING"&&view.otpDelivery==="PENDING")||(view.status==="SIGNED"&&view.copyDelivery==="PENDING")))return;let disposed=false;const started=Date.now();let running=false;const timer=window.setInterval(()=>{if(running||pending.current||Date.now()-started>120000)return;running=true;const version=epoch.current;void publicSigningRequest("resolve",token.current).then(r=>r.json()).then(next=>{if(!disposed&&version===epoch.current)setView(next);}).catch(()=>{}).finally(()=>{running=false;});},5000);return()=>{disposed=true;window.clearInterval(timer);};},[view?.id,view?.status,view?.otpDelivery,view?.copyDelivery]);
 const run=async(action:"otp"|"confirm"|"evidence")=>{if(!view||pending.current)return;pending.current=true;epoch.current++;setBusy(true);setError("");try{
  const response=await publicSigningRequest(action,token.current,action==="otp"?{documentHash:view.documentSha256}:action==="confirm"?{documentHash:view.documentSha256,code,confirmationId:confirmation.current,consent,consentVersion:view.consentVersion}:{});
  if(!mounted.current)return;
  if(action==="evidence"){const url=URL.createObjectURL(await response.blob());download(url,"Registrazione_firma_email.pdf");window.setTimeout(()=>URL.revokeObjectURL(url),60000);}else{const next=await response.json() as SigningView;setView(next);setNotice(action==="otp"?"Codice richiesto. Attendi la conferma di invio.":"Firma registrata. Puoi scaricare i tuoi documenti.");if(action==="otp"){setCode("");confirmation.current=crypto.randomUUID();}}
 }catch(e){if(mounted.current)setError((e as Error).message);}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 return <main className="contract-signing" translate="no" lang="it"><header className="signing-header"><span className="signing-wordmark">Fleetum<span> / Contratti</span></span><span>Documento riservato</span></header>
  <div className="signing-intro"><p className="signing-eyebrow">{view?.issuerName??"Il tuo contratto di noleggio"}</p><h1>{view?.status==="SIGNED"?"Firma completata":"Leggi. Verifica. Firma."}</h1><p>{view?`${view.bookingCode} · ${view.signerName}`:"Il documento e la conferma della firma, in un unico spazio."}</p></div>
  {error?<div className="signing-alert" role="alert">{error}</div>:null}
  <div className="signing-grid"><section className="signing-document" aria-label="Documento da sottoscrivere"><div className="signing-document-head"><div><h2>{view?.documentTitle??"Contratto"}</h2>{view?<p>Versione {view.version} · PDF conservato</p>:null}</div>{documentUrl?<button type="button" onClick={()=>download(documentUrl,`Contratto_${view?.bookingCode}.pdf`)}>Scarica PDF</button>:null}</div>
   {documentUrl?<>{documentBytes?<SigningPdfReader bytes={documentBytes} onReady={()=>setReady(true)}/>:null}<a href={documentUrl} target="_blank" rel="noreferrer">Apri il PDF in una nuova scheda</a></>:<div className="signing-placeholder" role="status">{error?"Documento non disponibile":"Verifica e caricamento del documento…"}</div>}
  </section><aside className="signing-card" aria-busy={busy}><p className="signing-step">{view?.status==="SIGNED"?"Completato":"La tua conferma"}</p><h2>{view?.status==="SIGNED"?"Contratto sottoscritto":"Firma tramite email"}</h2>
   {view?.status==="SIGNED"?<><p>La firma è stata registrata il {date(view.signedAt!)}.</p><p>{view.copyDelivery==="SENT"?"La copia è stata accettata dal servizio email.":view.copyDelivery==="FAILED"?"Invio della copia non riuscito. Puoi scaricarla qui e contattare il noleggiatore.":"La copia del documento e la registrazione della firma sono in coda per la tua email."}</p><button disabled={busy} type="button" onClick={()=>void run("evidence")}>Scarica registrazione della firma</button></>:<><p>Leggi tutte le pagine del documento. Il codice sarà inviato a <strong>{view?.maskedEmail??"…"}</strong>.</p><button type="button" disabled={!ready||busy||!view||view.status!=="PENDING"||view.codeSendsRemaining===0||Boolean(view.resendAfter&&Date.parse(view.resendAfter)>now)} onClick={()=>void run("otp")}>{view?.otpExpiresAt?"Richiedi un nuovo codice":"Invia codice email"}</button>
   {view?.otpDelivery?<p className="signing-hint" role="status">{view.otpDelivery==="SENT"?"Invio del codice accettato dal servizio email. Controlla anche la posta indesiderata.":view.otpDelivery==="FAILED"?"Invio non riuscito. Richiedi un nuovo codice dopo un minuto.":"Codice in coda. Questa pagina controlla l’esito dell’invio."}</p>:null}
   <form onSubmit={e=>{e.preventDefault();void run("confirm");}}><label htmlFor="signing-code">Codice ricevuto per email</label><input id="signing-code" name="one-time-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} required disabled={!ready||busy}/><p className="signing-hint">6 cifre · valido 10 minuti dalla richiesta. Puoi incollare il codice.</p><label className="signing-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={!ready||busy}/><span>{view?.consent??"Confermo di aver letto il documento."}</span></label><button className="signing-primary" type="submit" disabled={!ready||busy||!consent||code.length!==6||view?.otpDelivery!=="SENT"||view.attemptsRemaining===0}>{busy?"Verifica in corso…":"Conferma e firma contratto"}</button></form>{view?<p className="signing-hint">Collegamento valido fino al {date(view.expiresAt)}. Per correggere i dati, contatta il noleggiatore prima di firmare.</p>:null}</>}
   {notice?<p role="status" className="signing-notice">{notice}</p>:null}
  </aside></div><footer className="signing-footer">Documento di {view?.issuerName??"noleggio"} · Gestito con Fleetum</footer>
 </main>;
}
