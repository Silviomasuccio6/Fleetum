// Test fixture only: imported by the loopback UI verifier, never by a product entrypoint.
import React,{useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useNavigate} from 'react-router-dom';
import {SnackbarViewport} from '../../frontend/src/presentation/components/ui/snackbar-viewport';
import {CommerceDrawer} from '../../frontend/src/presentation/components/ui/commerce-workspace';
import {useOperationIssue} from '../../frontend/src/presentation/hooks/use-operation-issue';
import {captureOperationContext,publishOperationFeedback} from '../../frontend/src/application/stores/operation-feedback';
import {snackbar,useSnackbarStore} from '../../frontend/src/application/stores/snackbar-store';
import {useSiteAccessStore} from '../../frontend/src/application/stores/site-access-store';
import {useAuthStore} from '../../frontend/src/application/stores/auth-store';
import {platformAuthStorage} from '../../frontend/src/infrastructure/platform/platform-auth-storage';
import {httpClient} from '../../frontend/src/infrastructure/api/http-client';
import {initTheme} from '../../frontend/src/infrastructure/theme/theme-manager';
import '../../frontend/src/presentation/styles/fonts.css';
import '../../frontend/src/presentation/styles/global.css';
import '../../frontend/src/presentation/styles/workspace.css';
import '../../frontend/src/presentation/styles/commerce-workspace.css';
if(!['127.0.0.1','localhost'].includes(location.hostname))throw Error('Synthetic notification fixture requires loopback');
initTheme();
document.cookie='fermi_csrf=synthetic-notification-qa; path=/; SameSite=Strict';
function Harness(){
 const navigate=useNavigate(),[modal,setModal]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null),operation=useRef(null);
 const {issue,remember,clear}=useOperationIssue();
 const fail=async()=>{const captured=snackbar.capture();try{await httpClient.post('/__notification_qa/fail',{});}catch(error){remember(error.message,captured);snackbar.error(error.message,{scope:captured});}};
 useEffect(()=>{window.fleetumNoticeQa={
  push:(tone,message,options)=>snackbar[tone](message,options),clear:()=>useSnackbarStore.getState().clear(),state:()=>useSnackbarStore.getState(),
  open:()=>setModal(true),close:()=>setModal(false),navigate,
  confirm:(message,tone='success')=>publishOperationFeedback(setFeedback,message,captureOperationContext(),tone),
  capture:()=>snackbar.capture(),late:(captured)=>snackbar.success('Esito tardivo',{scope:captured}),
  site:()=>useSiteAccessStore.getState().reset(),
  tenant:()=>useAuthStore.setState({user:{id:'synthetic-user-2',tenantId:'synthetic-tenant-2',roles:['ADMIN'],permissions:[],email:'qa@example.invalid'}}),
  platform:()=>platformAuthStorage.set('synthetic-notification-qa-only'),
  start:()=>{setBusy(true);operation.current=snackbar.start('Operazione in corso');},
  finish:()=>{setBusy(false);operation.current?.success('Operazione completata');},
  remember:(message)=>remember(message,snackbar.capture()),ready:true
 };return()=>{delete window.fleetumNoticeQa;};},[navigate,remember]);
 return <div className="workspace-shell" style={{minHeight:'100vh'}}>
  <header className="saas-topbar" style={{height:64,position:'fixed',top:0,left:0,right:0,zIndex:50,padding:16,background:'hsl(var(--background))'}}>Fleetum · prova sintetica notifiche</header>
  <main style={{padding:'100px 24px',maxWidth:900}}>
   <h1>Verifica notifiche</h1><p>Laboratorio locale, dati sintetici, nessun provider.</p>
   <button type="button" id="outside-focus">Controllo pagina</button>
   <button type="button" onClick={()=>setModal(true)}>Apri finestra di prova</button>
   <button type="button" onClick={()=>void fail()}>Simula esito incerto</button>
   {feedback?<p role="status" data-qa-feedback>{feedback}</p>:null}
   {busy?<p role="status" data-qa-busy>Operazione ancora in corso nella pagina</p>:null}
   {issue?<p role="alert" data-qa-issue>{issue}</p>:null}
  </main>
  {modal?<CommerceDrawer compact title="Verifica notifiche" onClose={()=>setModal(false)} footer={<button type="button" onClick={()=>setModal(false)}>Chiudi verifica</button>}>
   <label htmlFor="qa-name">Nome sintetico</label><input id="qa-name" defaultValue="Cliente di prova"/>
   <button type="button" onClick={()=>void fail()}>Simula esito incerto in finestra</button>
   {issue?<p role="alert" data-qa-dialog-issue>{issue}</p>:null}
  </CommerceDrawer>:null}
  <SnackbarViewport/>
 </div>;
}
const qaRoot=window.__fleetumNotificationQaRoot??=createRoot(document.getElementById('root'));
qaRoot.render(<React.StrictMode><BrowserRouter><Harness/></BrowserRouter></React.StrictMode>);

if(import.meta.hot)import.meta.hot.dispose(()=>{qaRoot.unmount();delete window.__fleetumNotificationQaRoot;});
