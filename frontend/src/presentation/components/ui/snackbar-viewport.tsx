import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useSnackbarStore,visibleNotifications} from '../../../application/stores/snackbar-store';
import {createSnackbarClock} from '../../../application/stores/snackbar-clock';
import {useSiteAccessStore} from '../../../application/stores/site-access-store';
import {platformAuthStorage} from '../../../infrastructure/platform/platform-auth-storage';
import {useFleetumLanguage,translateText} from '../../i18n/fleetum-language';
import {CompactNotice} from './compact-notice';
import {claimedInline} from './notification-ownership';
import './compact-notifications.css';

// Fixed descendants otherwise inherit the containing block of a transformed
// dialog. Native popovers escape painting/clipping without leaving its focus DOM.
function placeFallback(node:HTMLElement,top:number){
 node.style.left='';node.style.right='';node.style.top='';node.style.transform='';
 for(let ancestor=node.parentElement;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement){
  const style=getComputedStyle(ancestor);
  if(style.transform==='none'&&style.perspective==='none'&&style.filter==='none'&&style.backdropFilter==='none'&&!/paint|layout|strict|content/.test(style.contain))continue;
  const rect=ancestor.getBoundingClientRect(),sx=rect.width/ancestor.offsetWidth||1,sy=rect.height/ancestor.offsetHeight||1;
  const right=window.innerWidth<=480?12:16,width=Math.min(370,window.innerWidth-(right*2));
  node.style.left=`${(window.innerWidth-right-width-rect.left)/sx-ancestor.clientLeft+ancestor.scrollLeft}px`;
  node.style.right='auto';node.style.top=`${(top-rect.top)/sy-ancestor.clientTop+ancestor.scrollTop}px`;
  node.style.transform=`scale(${1/sx},${1/sy})`;node.style.transformOrigin='top left';return;
 }
}
export const SnackbarViewport=()=>{
 const state=useSnackbarStore(),{language}=useFleetumLanguage(),location=useLocation();
 const keyboard=useRef(false),clock=useRef<ReturnType<typeof createSnackbarClock>|null>(null),region=useRef<HTMLElement>(null);
 const [target,setTarget]=useState<HTMLElement|null>(()=>typeof document==='undefined'?null:document.body);
 const [top,setTop]=useState(16);
 const [inlineOwners,setInlineOwners]=useState<Record<string,boolean>>({});
 const nativePopover=typeof HTMLElement!=='undefined'&&typeof HTMLElement.prototype.showPopover==='function';
 const visible=visibleNotifications(state),hasVisible=visible.length>0;
 const pause=useCallback((id:string,reason:string,value:boolean)=>clock.current?.pauseItem(id,reason,value),[]);
 useLayoutEffect(()=>{
  const platform=window.location.pathname.includes('platform');
  const sync=()=>{const site=useSiteAccessStore.getState();const route=`${location.pathname}${location.hash}`;useSnackbarStore.getState().setContext(platform?`platform:${platformAuthStorage.revision()}:${route}`:`tenant:${site.owner}:${site.revision}:${route}`);};
  sync();const site=useSiteAccessStore.subscribe(sync),admin=platformAuthStorage.subscribe(sync);
  return()=>{site();admin();};
 },[location.pathname,location.hash]);
 useEffect(()=>{
  const controller=createSnackbarClock(useSnackbarStore,{now:Date.now,schedule:(fn,delay)=>window.setTimeout(fn,delay),cancel:id=>window.clearTimeout(id as number)});clock.current=controller;
  const visibility=()=>controller.pause('hidden',document.hidden),key=()=>{keyboard.current=true;},pointer=()=>{keyboard.current=false;};
  visibility();document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',pointer,true);
  return()=>{controller.dispose();clock.current=null;document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',pointer,true);};
 },[]);
 useLayoutEffect(()=>{
  const measure=()=>{
   const bar=document.querySelector('.workspace-shell .saas-topbar, .platform-topbar');
   const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(node=>node.getClientRects().length>0);
   const dialog=dialogs.at(-1),header=dialog?.querySelector<HTMLElement>('.commerce-drawer-header, .customer-dialog-header, .booking-editor-header');
   const edge=header?.getBoundingClientRect();
   const measured=Math.max(16,Math.ceil(bar?.getBoundingClientRect().bottom??4)+12,edge&&edge.top<120?Math.ceil(edge.bottom)+12:0);
   setTop(measured);setTarget(dialog??document.body);
   const owners=Object.fromEntries(useSnackbarStore.getState().items.map(item=>[item.id,claimedInline(item.message,language)]));
   setInlineOwners(previous=>Object.keys(previous).length===Object.keys(owners).length&&Object.keys(owners).every(id=>previous[id]===owners[id])?previous:owners);
   if(region.current&&!nativePopover)placeFallback(region.current,measured);
  };
  measure();const observer=new MutationObserver(measure);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role','aria-modal']});
  const resize=new ResizeObserver(measure);const bar=document.querySelector('.workspace-shell .saas-topbar, .platform-topbar');if(bar)resize.observe(bar);
  window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);window.visualViewport?.addEventListener('resize',measure);
  return()=>{observer.disconnect();resize.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);window.visualViewport?.removeEventListener('resize',measure);};
 },[target,hasVisible,nativePopover,language]);
 useLayoutEffect(()=>{
  const node=region.current;if(!node)return;
  if(!nativePopover){placeFallback(node,top);return;}
  node.setAttribute('popover','manual');
  node.showPopover();
  return()=>{if(node.matches(':popover-open'))node.hidePopover();};
 },[target,hasVisible,nativePopover]);
 const count=state.items.filter(item=>item.readyAt<=Date.now()).length-visible.length;
 if(!target||!hasVisible)return null;
 return createPortal(<section ref={region} className="fleetum-notices" aria-label={translateText('Notifiche operative',language)} style={{'--notice-top':`${top}px`} as CSSProperties}>
  {visible.map(item=><CompactNotice key={item.id} item={item} keyboard={keyboard} language={language} pause={pause} announce={!inlineOwners[item.id]}/>)}
  {count>0?<button type="button" className="fleetum-notice-queue" onClick={()=>state.advance()}>{translateText('Altre notifiche',language)} ({count})</button>:null}
  {state.omitted>0?<p className="fleetum-notice-overflow">{translateText('Altri esiti sono disponibili nelle rispettive pagine.',language)}</p>:null}
 </section>,target);
};
