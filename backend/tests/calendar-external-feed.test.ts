import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {Readable} from "node:stream";
import {describe,it,mock} from "node:test";
import {publicCalendarFeedAddress,readSafeExternalCalendarFeed} from "../src/infrastructure/calendar/safe-external-feed.js";

const fixture=(input:{status?:number;headers?:Record<string,string>;chunks?:Buffer[]}={})=>{
  let lookups=0,requests=0;const seen:any[]=[];
  const dependencies={resolve:async()=>{lookups++;return[{address:"8.8.8.8",family:4}];},request:(url:URL,options:any,callback:any)=>{
    requests++;seen.push({url,options});const request=new EventEmitter()as any;request.destroy=()=>request;request.end=()=>{
      queueMicrotask(()=>{const response=Readable.from(input.chunks??[Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")])as any;response.statusCode=input.status??200;response.headers=input.headers??{"content-type":"text/calendar"};callback(response);});
    };return request;
  }};
  return{dependencies:dependencies as any,seen,state:()=>({lookups,requests})};
};
describe("external calendar feed transport",()=>{
  it("rejects private/reserved IPv4, mapped IPv6 and non-public IPv6",()=>{
    for(const address of["127.0.0.1","10.0.0.1","169.254.169.254","100.100.100.200","192.168.1.1","0.0.0.0","224.0.0.1","::1","fd00::1","fe80::1","::ffff:127.0.0.1","::ffff:7f00:1","2002:7f00:1::","2001:db8::1"])assert.equal(publicCalendarFeedAddress(address),false,address);
    for(const address of["8.8.8.8","1.1.1.1","2001:4860:4860::8888"])assert.equal(publicCalendarFeedAddress(address),true,address);
  });
  it("pins the validated address while retaining the original HTTPS host",async()=>{
    const h=fixture();assert.match(await readSafeExternalCalendarFeed("https://calendar.example.invalid/feed.ics",h.dependencies),/BEGIN:VCALENDAR/);
    assert.deepEqual(h.state(),{lookups:1,requests:1});const request=h.seen[0];assert.equal(request.url.hostname,"calendar.example.invalid");assert.equal(request.options.agent,false);
    let result:any;request.options.lookup("rebound-host",{all:true},(_error:any,addresses:any)=>result=addresses);assert.deepEqual(result,[{address:"8.8.8.8",family:4}]);
  });
  it("rejects mixed public/private DNS answers before opening a connection",async()=>{
    const h=fixture();h.dependencies.resolve=async()=>[{address:"8.8.8.8",family:4},{address:"127.0.0.1",family:4}];
    await assert.rejects(readSafeExternalCalendarFeed("https://calendar.example.invalid/feed.ics",h.dependencies));assert.equal(h.state().requests,0);
  });
  it("rejects credentials, local hosts and unsupported protocols",async()=>{
    for(const url of["file:///etc/passwd","http://localhost/calendar","https://user:password@calendar.example.invalid/feed","http://[::1]/feed"]){const h=fixture();await assert.rejects(readSafeExternalCalendarFeed(url,h.dependencies));assert.equal(h.state().requests,0);}
  });
  it("never follows redirects or accepts unexpected content",async()=>{
    for(const input of[{status:302,headers:{location:"http://127.0.0.1/private"}},{headers:{"content-type":"text/html"}}]){const h=fixture(input);await assert.rejects(readSafeExternalCalendarFeed("https://calendar.example.invalid/feed",h.dependencies));assert.equal(h.state().requests,1);}
  });
  it("bounds both declared and streamed body size",async()=>{
    for(const input of[{headers:{"content-length":String(3*1024*1024)}},{chunks:[Buffer.alloc(1024*1024),Buffer.alloc(1024*1024),Buffer.alloc(1)]}]){const h=fixture(input);await assert.rejects(readSafeExternalCalendarFeed("https://calendar.example.invalid/feed",h.dependencies),error=>(error as any).statusCode===413);}
  });
  it("enforces an absolute timeout before a slow DNS answer can open a connection",async()=>{
    mock.timers.enable({apis:["setTimeout"]});const h=fixture();let release!:(value:any)=>void;
    h.dependencies.resolve=()=>new Promise(resolve=>{release=resolve;});
    try{const pending=readSafeExternalCalendarFeed("https://calendar.example.invalid/feed",h.dependencies);mock.timers.tick(12000);await assert.rejects(pending,error=>(error as any).statusCode===504);release([{address:"8.8.8.8",family:4}]);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(h.state().requests,0);}
    finally{mock.timers.reset();}
  });
});
