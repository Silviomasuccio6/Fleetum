import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import {BlockList,isIP} from "node:net";
import {AppError} from "../../shared/errors/app-error.js";

const MAX_BYTES=2*1024*1024,TIMEOUT_MS=12000;
const blocked=new BlockList(),globalV6=new BlockList();
for(const[address,prefix]of[["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]]as const)blocked.addSubnet(address,prefix,"ipv4");
globalV6.addSubnet("2000::",3,"ipv6");
for(const[address,prefix]of[["2001::",23],["2001:db8::",32],["2002::",16]]as const)blocked.addSubnet(address,prefix,"ipv6");
export const publicCalendarFeedAddress=(address:string)=>{
  const family=isIP(address);return family===4?!blocked.check(address,"ipv4"):family===6&&globalV6.check(address,"ipv6")&&!blocked.check(address,"ipv6");
};
type Address={address:string;family:number};
type RequestFactory=(url:URL,options:http.RequestOptions,callback:(response:http.IncomingMessage)=>void)=>http.ClientRequest;
const defaults={resolve:(host:string)=>dns.lookup(host,{all:true,verbatim:true})as Promise<Address[]>,request:((url,options,callback)=>(url.protocol==="https:"?https:http).request(url,options,callback))as RequestFactory};
const error=(message:string,status=400,code="EXTERNAL_FEED_INVALID")=>new AppError(message,status,code);

// Validation and connection share the same resolved address. No redirect,
// ambient agent, cookie, bearer header or second DNS resolution is allowed.
export const readSafeExternalCalendarFeed=async(rawUrl:string,dependencies=defaults)=>{
  let url:URL;try{url=new URL(rawUrl.trim().replace(/^webcal:/i,"https:"));}catch{throw error("URL feed non valida");}
  const host=url.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password||!host||host==="localhost"||host.endsWith(".local"))throw error("URL feed non consentita");
  let active=true,request:http.ClientRequest|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{active=false;const failure=error("Timeout download feed",504,"EXTERNAL_FEED_TIMEOUT");request?.destroy(failure);reject(failure);},TIMEOUT_MS);});
  const operation=(async()=>{
    let addresses:Address[];
    try{addresses=isIP(host)?[{address:host,family:isIP(host)}]:await dependencies.resolve(host);}catch{throw error("Host feed non risolvibile");}
    if(!addresses.length||addresses.some(row=>!publicCalendarFeedAddress(row.address)||(row.family!==4&&row.family!==6)))throw error("Host feed non consentito");
    if(!active)throw error("Timeout download feed",504,"EXTERNAL_FEED_TIMEOUT");
    const pinned=addresses[0];
    return new Promise<string>((resolve,reject)=>{
      let settled=false;
      const fail=(failure:Error)=>{if(settled)return;settled=true;request?.destroy();reject(failure);};
      request=dependencies.request(url,{
        method:"GET",agent:false,family:pinned.family,
        lookup:((_host:string,options:any,callback:any)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family))as any,
        headers:{Accept:"text/calendar, text/plain", "User-Agent":"Fleetum-Calendar/1.0"}
      },response=>{
        if(!active){response.destroy();return fail(error("Download feed annullato"));}
        if(!response.statusCode||response.statusCode<200||response.statusCode>=300){response.destroy();return fail(error("Risposta feed non valida",502,"EXTERNAL_FEED_RESPONSE_INVALID"));}
        const type=String(response.headers["content-type"]??"").split(";")[0].trim().toLowerCase();
        if(type&&!["text/calendar","text/plain","application/octet-stream"].includes(type)){response.destroy();return fail(error("Content-Type feed non supportato"));}
        if(Number(response.headers["content-length"]??0)>MAX_BYTES){response.destroy();return fail(error("Feed troppo grande",413,"EXTERNAL_FEED_TOO_LARGE"));}
        const chunks:Buffer[]=[];let length=0;
        response.on("data",(chunk:Buffer|string)=>{
          if(settled)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
          if(length>MAX_BYTES){response.destroy();fail(error("Feed troppo grande",413,"EXTERNAL_FEED_TOO_LARGE"));return;}chunks.push(bytes);
        });
        response.once("error",()=>fail(error("Lettura feed non riuscita",502)));
        response.once("aborted",()=>fail(error("Feed incompleto",502)));
        response.once("end",()=>{if(!settled){settled=true;resolve(Buffer.concat(chunks,length).toString("utf8"));}});
      });
      request.once("error",()=>fail(error("Connessione feed non riuscita",502,"EXTERNAL_FEED_NETWORK_ERROR")));
      request.end();
    });
  })();
  try{return await Promise.race([operation,timeout]);}
  finally{active=false;if(timer)clearTimeout(timer);request?.destroy();}
};
