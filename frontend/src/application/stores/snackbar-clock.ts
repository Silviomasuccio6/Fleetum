import {visibleNotifications, type createSnackbarStore} from './snackbar-store';
type Host={now:()=>number;schedule:(callback:()=>void,delay:number)=>unknown;cancel:(id:unknown)=>void};
// Per-item remaining time survives other notifications, pauses and queue rotation.
export function createSnackbarClock(store:ReturnType<typeof createSnackbarStore>,host:Host){
 const clocks=new Map<string,{revision:number;remaining:number|null;last:number;active:boolean}>();
 const paused=new Set<string>(),itemPauses=new Map<string,Set<string>>();let timer:unknown=null,syncing=false,disposed=false;
 const sync=()=>{
  if(syncing||disposed)return;syncing=true;
  try{
   if(timer!==null)host.cancel(timer);timer=null;
   const now=host.now();
   for(const clock of clocks.values()){if(clock.active&&clock.remaining!==null)clock.remaining=Math.max(0,clock.remaining-(now-clock.last));clock.last=now;}
   let state=store.getState();
   for(const id of clocks.keys())if(!state.items.some(item=>item.id===id)){clocks.delete(id);itemPauses.delete(id);}
   for(const item of state.items){const old=clocks.get(item.id);if(!old||old.revision!==item.revision)clocks.set(item.id,{revision:item.revision,remaining:item.durationMs,last:now,active:false});}
   for(const item of state.items){const clock=clocks.get(item.id)!;if(clock.remaining===0){if(item.closing)store.getState().remove(item.id);else store.getState().dismiss(item.id);}}
   state=store.getState();
   const visible=new Set(visibleNotifications(state,now).map(item=>item.id));let next=Infinity;
   for(const item of state.items){
    let clock=clocks.get(item.id)!;
    if(clock.revision!==item.revision){clock={revision:item.revision,remaining:item.durationMs,last:now,active:false};clocks.set(item.id,clock);}
    clock.active=visible.has(item.id)&&(item.closing||(!paused.size&&!itemPauses.get(item.id)?.size));
    if(clock.active&&clock.remaining!==null)next=Math.min(next,clock.remaining);
    if(item.readyAt>now)next=Math.min(next,item.readyAt-now);
   }
   if(Number.isFinite(next))timer=host.schedule(()=>store.getState().tick(),Math.max(1,next));
  }finally{syncing=false;}
 };
 const unsubscribe=store.subscribe(sync);sync();
 return {
  pause:(reason:string,value:boolean)=>{value?paused.add(reason):paused.delete(reason);sync();},
  pauseItem:(id:string,reason:string,value:boolean)=>{const reasons=itemPauses.get(id)??new Set<string>();value?reasons.add(reason):reasons.delete(reason);itemPauses.set(id,reasons);sync();},
  dispose:()=>{disposed=true;unsubscribe();if(timer!==null)host.cancel(timer);clocks.clear();itemPauses.clear();}
 };
}
