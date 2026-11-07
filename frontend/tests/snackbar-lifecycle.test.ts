import test from "node:test";
import assert from "node:assert/strict";
import {createSnackbarStore,visibleNotifications,safeNotificationText} from "../src/application/stores/snackbar-store";
import {createSnackbarClock} from "../src/application/stores/snackbar-clock";
function laboratory(){
 const original=Date.now;let now=0,serial=0;Date.now=()=>now;
 const timers=new Map<number,{at:number;run:()=>void}>(),store=createSnackbarStore();
 const clock=createSnackbarClock(store,{now:()=>now,schedule:(run,delay)=>{const id=++serial;timers.set(id,{at:now+delay,run});return id},cancel:id=>{timers.delete(id as number)}});
 return {store,clock,advance(ms:number){const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].run()}now=end;},close(){clock.dispose();Date.now=original;assert.equal(timers.size,0)}};
}
for(const [tone,duration]of [["success",3000],["info",4000],["warning",6000],["error",8000],["loading",10000]] as const){
 test(`${tone} closes automatically after its own finite visible lifetime, with or without an action`,()=>{
  for(const action of [undefined,{label:"Apri dettaglio",run:()=>{}}]){const h=laboratory();try{
   h.store.getState().push(tone,"Messaggio sintetico",{action});assert.equal(h.store.getState().items[0].durationMs,duration);
   h.advance(duration-1);assert.equal(h.store.getState().items[0].closing,false);
   h.advance(1);assert.equal(h.store.getState().items[0].closing,true);h.advance(120);assert.equal(h.store.getState().items.length,0);
  }finally{h.close()}}
 });
}
test("new notifications and duplicate events do not restart an existing timer",()=>{const h=laboratory();try{
 const id=h.store.getState().push("success","Prima");h.advance(1000);h.store.getState().push("info","Seconda");assert.equal(h.store.getState().push("success","Prima"),id);
 h.advance(2000);assert.equal(h.store.getState().items.find(x=>x.id===id)?.closing,true);h.advance(120);assert.equal(h.store.getState().items.some(x=>x.id===id),false);
}finally{h.close()}});
test("a fresh action callback with identical copy updates the callback without extending lifetime",()=>{const h=laboratory();try{
 let called=0;const id=h.store.getState().push("info","Pronta",{key:"same",action:{label:"Apri",run:()=>{called=1}}});h.advance(3000);
 assert.equal(h.store.getState().push("info","Pronta",{key:"same",action:{label:"Apri",run:()=>{called=2}}}),id);
 h.store.getState().items[0].action?.run();assert.equal(called,2);h.advance(1000);assert.equal(h.store.getState().items[0].closing,true);
}finally{h.close()}});
test("hover and focus pause independently and resume the remaining time",()=>{const h=laboratory();try{
 const id=h.store.getState().push("success","Sintetica");h.advance(2000);h.clock.pauseItem(id,"hover",true);h.clock.pauseItem(id,"focus",true);h.advance(10000);
 h.clock.pauseItem(id,"hover",false);h.advance(10000);assert.equal(h.store.getState().items[0].closing,false);h.clock.pauseItem(id,"focus",false);
 h.advance(999);assert.equal(h.store.getState().items[0].closing,false);h.advance(121);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("hidden-tab time is not consumed",()=>{const h=laboratory();try{
 h.store.getState().push("info","Sintetica");h.advance(2000);h.clock.pause("hidden",true);h.advance(60000);assert.equal(h.store.getState().items[0].closing,false);
 h.clock.pause("hidden",false);h.advance(1999);assert.equal(h.store.getState().items[0].closing,false);h.advance(121);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("a fourth message waits until a visible slot opens and receives its full lifetime",()=>{const h=laboratory();try{
 for(let i=0;i<3;i++)h.store.getState().push("error","Errore "+i);const id=h.store.getState().push("success","In coda");
 assert.equal(visibleNotifications(h.store.getState()).length,3);h.advance(8000);assert.equal(h.store.getState().items.find(x=>x.id===id)?.closing,false);
 h.advance(120);assert.ok(visibleNotifications(h.store.getState()).some(x=>x.id===id));h.advance(2999);assert.equal(h.store.getState().items[0].closing,false);
 h.advance(121);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("rotation cannot leave a notification permanently paused by a former hover",()=>{const h=laboratory();try{
 for(let i=0;i<4;i++)h.store.getState().push("error","Errore "+i);const id=h.store.getState().items[2].id;
 h.clock.pauseItem(id,"hover",true);h.store.getState().advance();h.store.getState().advance();h.advance(20000);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("manual dismissal of a queued or hovered item always finishes",()=>{const h=laboratory();try{
 for(let i=0;i<4;i++)h.store.getState().push("error","Errore "+i);const id=h.store.getState().items[3].id;
 h.clock.pauseItem(id,"focus",true);h.store.getState().dismiss(id);h.advance(120);assert.equal(h.store.getState().items.some(x=>x.id===id),false);
}finally{h.close()}});
test("the queue is bounded even under a flood of distinct messages",()=>{const h=laboratory();try{
 for(let i=0;i<1000;i++)h.store.getState().push("error","Sintetico "+i);
 assert.ok(h.store.getState().items.length<=20);assert.ok(visibleNotifications(h.store.getState()).length<=3);h.advance(120000);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("a loading popup expires without inventing an outcome and a later verified outcome can still appear",()=>{const h=laboratory();try{
 h.store.getState().push("loading","Preparazione",{key:"operation"});h.advance(10120);assert.equal(h.store.getState().items.length,0);
 h.store.getState().push("success","PDF pronto",{key:"operation"});assert.equal(h.store.getState().items[0].tone,"success");h.advance(3120);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("an actual outcome updates a still visible loading notification in place",()=>{const h=laboratory();try{
 const id=h.store.getState().push("loading","Preparazione",{key:"job"});h.advance(2000);assert.equal(h.store.getState().push("error","Esito da verificare",{key:"job"}),id);
 assert.equal(h.store.getState().items.length,1);h.advance(8120);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("returning to an earlier context never revives a captured late message",()=>{const h=laboratory();try{
 h.store.getState().setContext("tenant-a:roma:booking");const scope=h.store.getState().context;h.store.getState().push("error","Vecchia sede");
 h.store.getState().setContext("tenant-b:milano");h.store.getState().setContext("tenant-a:roma:booking");assert.equal(h.store.getState().items.length,0);
 assert.equal(h.store.getState().push("success","Esito tardivo",{scope}),"");assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("transport feedback remains deferred while all timers have a finite end",()=>{const h=laboratory();try{
 h.store.getState().push("error","Sintetica",{origin:"transport"});assert.equal(visibleNotifications(h.store.getState()).length,0);
 h.advance(120);assert.equal(visibleNotifications(h.store.getState()).length,1);h.advance(8120);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
test("different tones and operation keys remain distinct; clear permits an identical new attempt",()=>{const h=laboratory();try{
 h.store.getState().push("error","Sintetica");h.store.getState().push("success","Sintetica");h.store.getState().push("error","Sintetica",{key:"other"});assert.equal(h.store.getState().items.length,3);
 h.store.getState().clear();h.store.getState().push("error","Sintetica");assert.equal(h.store.getState().items.length,1);
}finally{h.close()}});
test("credentials and raw implementation details do not reach popup copy",()=>{
 assert.equal(safeNotificationText("Bearer synthetic-only"),"[riservato]");assert.equal(safeNotificationText("token=synthetic-only"),"token=[riservato]");
 assert.doesNotMatch(safeNotificationText("PrismaClient error /Users/synthetic/private"),/Prisma|Users/);assert.equal(safeNotificationText("Cliente salvato."),"Cliente salvato.");
});
test("an HTTP fallback and its page handler share one error popup without resetting its clock",()=>{const h=laboratory();try{
 const id=h.store.getState().push("error","Verifica necessaria",{origin:"transport",key:"request"});h.advance(120);
 assert.equal(h.store.getState().push("error","Verifica necessaria"),id);assert.equal(h.store.getState().items.length,1);
 h.advance(8000);assert.equal(h.store.getState().items[0].closing,true);h.advance(120);assert.equal(h.store.getState().items.length,0);
}finally{h.close()}});
