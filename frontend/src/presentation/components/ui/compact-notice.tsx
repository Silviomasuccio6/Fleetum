import React,{useEffect,useRef,type MutableRefObject} from 'react';
import {Check,Info,Loader2,TriangleAlert,CircleAlert,X} from 'lucide-react';
import {useSnackbarStore,type SnackbarItem} from '../../../application/stores/snackbar-store';
import {translateText} from '../../i18n/fleetum-language';
const icons={success:Check,error:CircleAlert,warning:TriangleAlert,info:Info,loading:Loader2};
export function CompactNotice({item,pause,keyboard,language}:{item:SnackbarItem;pause:(id:string,reason:string,value:boolean)=>void;keyboard:MutableRefObject<boolean>;language:'it'|'en'}){
 const ref=useRef<HTMLElement>(null),Icon=icons[item.tone];
 const t=(text:string)=>translateText(text,language);
 useEffect(()=>{
  if(keyboard.current||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const animation=ref.current?.animate([{opacity:.6,transform:'translateX(10px)'},{opacity:1,transform:'translateX(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
  return()=>animation?.cancel();
 },[item.id,keyboard]);
 const compact=(item.tone==='success'||item.tone==='info')&&!item.description&&!item.action&&item.title.length<=90;
 return <article ref={ref} className={`fleetum-notice fleetum-notice--${item.tone}${compact?' fleetum-notice--compact':''}${item.closing?' is-closing':''}`}
  role={item.closing?undefined:item.tone==='error'?'alert':'status'} aria-atomic="true" aria-hidden={item.closing||undefined}
  onMouseEnter={()=>pause(item.id,'hover',true)} onMouseLeave={()=>pause(item.id,'hover',false)}
  onFocusCapture={()=>pause(item.id,'focus',true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))pause(item.id,'focus',false);}}>
  <span className="fleetum-notice-icon"><Icon aria-hidden="true" className={item.tone==='loading'?'fleetum-notice-spinner':undefined}/></span>
  <div className="fleetum-notice-copy"><p className="fleetum-notice-title">{t(item.title)}</p>{item.description?<p className="fleetum-notice-description">{t(item.description)}</p>:null}
   {item.action?<button type="button" className="fleetum-notice-action" disabled={item.closing} onClick={()=>item.action?.run()}>{t(item.action.label)}</button>:null}
  </div>
  <button type="button" className="fleetum-notice-close" aria-label={t('Chiudi notifica')} disabled={item.closing} onClick={()=>useSnackbarStore.getState().dismiss(item.id)}><X aria-hidden="true"/></button>
 </article>;
}
