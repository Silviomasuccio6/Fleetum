import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { guardedNotificationStream, NOTIFICATION_POLL_MS, NOTIFICATION_READ_TIMEOUT_MS } from "../src/interfaces/http/utils/guarded-notification-stream.js";

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve!:(value:unknown)=>void;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const harness=()=>{
  const req=new EventEmitter(),res=new EventEmitter() as any;
  const writes:string[]=[],headers:Record<string,string>={};
  let poll:(()=>void)|undefined,deadline:(()=>void)|undefined,ended=0;
  res.writableEnded=false;res.destroyed=false;
  res.setHeader=(key:string,value:string)=>{headers[key]=value;};
  res.flushHeaders=()=>{};res.write=(text:string)=>{writes.push(text);return true;};
  res.end=()=>{ended++;res.writableEnded=true;res.emit("close");};
  const scheduling={every:(callback:()=>void)=>{poll=callback;return()=>{poll=undefined;};},deadline:(callback:()=>void)=>{deadline=callback;return()=>{deadline=undefined;};}};
  return{req,res,writes,headers,scheduling,tick:()=>poll?.(),expire:()=>deadline?.(),state:()=>({poll:!!poll,deadline:!!deadline,ended})};
};

describe("notification stream lifecycle",()=>{
  it("defines a 20 second refresh and a 10 second read bound",()=>{assert.equal(NOTIFICATION_POLL_MS,20000);assert.equal(NOTIFICATION_READ_TIMEOUT_MS,10000);});
  it("validates the initial read before headers and leaves no timers on failure",async()=>{
    const h=harness();await assert.rejects(guardedNotificationStream(h.req as any,h.res,async()=>{throw new Error("denied");},h.scheduling),/denied/);
    assert.deepEqual(h.headers,{});assert.deepEqual(h.state(),{poll:false,deadline:false,ended:0});assert.equal(h.req.listenerCount("aborted"),0);
  });
  it("keeps the message contract, private cache policy and idempotent cleanup",async()=>{
    const h=harness(),stop=await guardedNotificationStream(h.req as any,h.res,async()=>[{id:"synthetic"}],h.scheduling);
    assert.deepEqual(JSON.parse(h.writes[0].slice(6)),{data:[{id:"synthetic"}]});assert.equal(h.headers["Cache-Control"],"private, no-store");
    h.res.emit("close");stop();assert.deepEqual(h.state(),{poll:false,deadline:false,ended:0});assert.equal(h.res.listenerCount("close"),0);
  });
  it("never overlaps polls even when a read is slow",async()=>{
    const h=harness(),pending=deferred();let reads=0;
    const stop=await guardedNotificationStream(h.req as any,h.res,async()=>++reads===1?[]:pending.promise,h.scheduling);
    h.tick();h.tick();h.tick();assert.equal(reads,2);pending.resolve([{id:"next"}]);await settle();assert.equal(h.writes.length,2);stop();
  });
  it("clears the current inbox and closes after a later authorization/read failure",async()=>{
    const h=harness();let reads=0;
    await guardedNotificationStream(h.req as any,h.res,async()=>{if(++reads>1)throw new Error("revoked");return[{id:"old"}];},h.scheduling);
    h.tick();await settle();assert.deepEqual(JSON.parse(h.writes[1].slice(6)),{data:[],reset:true});assert.deepEqual(h.state(),{poll:false,deadline:false,ended:1});
  });
  it("discards an in-flight result after the connection closes",async()=>{
    const h=harness(),pending=deferred();let reads=0;
    await guardedNotificationStream(h.req as any,h.res,async()=>++reads===1?[]:pending.promise,h.scheduling);
    h.tick();h.res.destroyed=true;h.res.emit("close");pending.resolve([{id:"must-not-publish"}]);await settle();
    assert.equal(h.writes.length,1);assert.deepEqual(h.state(),{poll:false,deadline:false,ended:0});
  });
  it("times out a hung poll without late publication or unhandled rejection",async()=>{
    const h=harness(),pending=deferred();let reads=0;
    await guardedNotificationStream(h.req as any,h.res,async()=>++reads===1?[]:pending.promise,h.scheduling);
    h.tick();h.expire();await settle();assert.equal(h.state().ended,1);pending.resolve([{id:"late"}]);await settle();assert.equal(h.writes.length,2);
  });
  it("releases an aborted initial read even if its query never resolves",async()=>{
    const h=harness();const start=guardedNotificationStream(h.req as any,h.res,()=>new Promise(()=>{}),h.scheduling);
    h.req.emit("aborted");await start;assert.equal(h.writes.length,0);assert.deepEqual(h.state(),{poll:false,deadline:false,ended:0});
  });
  it("closes safely if the response becomes unwritable",async()=>{
    const h=harness();await guardedNotificationStream(h.req as any,h.res,async()=>[],h.scheduling);
    h.res.write=()=>{throw new Error("broken pipe");};h.tick();await settle();assert.equal(h.state().ended,1);assert.equal(h.state().poll,false);
  });
});
