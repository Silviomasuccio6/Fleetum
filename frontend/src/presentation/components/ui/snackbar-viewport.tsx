import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {useSnackbarStore,visibleNotifications,type SnackbarItem} from '../../../application/stores/snackbar-store';
import {createSnackbarClock} from '../../../application/stores/snackbar-clock';
import {useSiteAccessStore} from '../../../application/stores/site-access-store';
import {platformAuthStorage} from '../../../infrastructure/platform/platform-auth-storage';
import {useFleetumLanguage,translateText} from '../../i18n/fleetum-language';
import {CompactNotice} from './compact-notice';
import {claimedInline} from './notification-ownership';
import './compact-notifications.css';


export const SnackbarViewport=()=>{
 const state=useSnackbarStore(),{language}=useFleetumLanguage();
 const keyboard=useRef(false),clock=useRef<ReturnType<typeof createSnackbarClock>|null>(null);
 const [target,setTarget]=useState<HTMLElement|null>(()=>typeof document==='undefined'?null:document.body);
 const [top,setTop]=useState(16);
 useLayoutEffect(()=>{
  const platform=window.location.pathname.includes('platform');
  const sync=()=>{const site=useSiteAccessStore.getState();useSnackbarStore.getState().setContext(platform?`platform:${platformAuthStorage.revision()}`:`tenant:${site.owner}:${site.revision}`);};
  sync();const site=useSiteAccessStore.subscribe(sync),admin=platformAuthStorage.subscribe(sync);
  return()=>{site();admin();};
 },[]);
 useEffect(()=>{
  const controller=createSnackbarClock(useSnackbarStore,{now:Date.now,schedule:(fn,delay)=>window.setTimeout(fn,delay),cancel:id=>window.clearTimeout(id as number)});clock.current=controller;
  const visibility=()=>controller.pause('hidden',document.hidden),key=()=>{keyboard.current=true;},pointer=()=>{keyboard.current=false;};
  visibility();document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',pointer,true);
  return()=>{controller.dispose();clock.current=null;document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',pointer,true);};
 },[]);
 useLayoutEffect(()=>{
  const measure=()=>{
   const bar=document.querySelector('.workspace-shell .saas-topbar, .platform-topbar');
   setTop(Math.max(16,Math.ceil(bar?.getBoundingClientRect().bottom??4)+12));
   const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(node=>node.getClientRects().length>0);
   setTarget(dialogs.at(-1)??document.body);
   for(const item of useSnackbarStore.getState().items)if(item.origin==='transport'&&claimedInline(item.message,language))useSnackbarStore.getState().remove(item.id);
  };
  measure();const observer=new MutationObserver(measure);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role','aria-modal']});
  const resize=new ResizeObserver(measure);const bar=document.querySelector('.workspace-shell .saas-topbar, .platform-topbar');if(bar)resize.observe(bar);
  window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
  return()=>{observer.disconnect();resize.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
 },[language]);
 useLayoutEffect(()=>{for(const item of state.items)if(item.origin==='transport'&&claimedInline(item.message,language))state.remove(item.id);},[state.items,language]);
 const visible=visibleNotifications(state),count=state.items.filter(item=>item.readyAt<=Date.now()).length-visible.length;
 if(!target||!visible.length)return null;
 return createPortal(<section className="fleetum-notices" aria-label={translateText('Notifiche operative',language)} style={{'--notice-top':`${top}px`} as CSSProperties}>
  {visible.map(item=><CompactNotice key={item.id} item={item} keyboard={keyboard} language={language} pause={(id,reason,value)=>clock.current?.pauseItem(id,reason,value)}/>)}
  {count>0?<button type="button" className="fleetum-notice-queue" onClick={()=>state.advance()}>{translateText('Altre notifiche',language)} ({count})</button>:null}
 </section>,target);
};
