import { createCipheriv } from "node:crypto";
export type CargosCredentials={username:string;password:string;apiKey:string};
export type CargosOutcome={status:"ACCEPTED";transactionId:string}|{status:"REJECTED";errorCode:string}|{status:"UNKNOWN"}|{status:"UNAVAILABLE"};
export type CargosCheckOutcome={status:"VALID"}|{status:"INVALID";errorCode:string}|{status:"UNAVAILABLE"};
export const encryptCargosToken=(token:string,apiKey:string)=>{
 if(!/^[\x21-\x7e]{48,}$/.test(apiKey))throw new Error("API key CARGOS non valida per AES");
 const cipher=createCipheriv("aes-256-cbc",Buffer.from(apiKey.slice(0,32)),Buffer.from(apiKey.slice(32,48)));
 return Buffer.concat([cipher.update(token,"utf8"),cipher.final()]).toString("base64");
};
// Endpoint is code-owned: tenant configuration cannot redirect credentials/PII.
const endpoint="https://cargos.poliziadistato.it/CARGOS_API/api/";
type Fetch=typeof fetch;
export type CargosSendGuard=(start:()=>Promise<unknown>)=>Promise<unknown>;
export class CargosClient {
 constructor(private readonly credentials:CargosCredentials,private readonly request:Fetch=fetch){}
 private async json(path:string,headers:Record<string,string>,body?:unknown){
  const response=await this.request(endpoint+path,{method:body===undefined?"GET":"POST",headers:{Accept:"application/json","Content-Type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("CARGOS request failed");
  const reader=response.body?.getReader();if(!reader)throw new Error("Missing response");let bytes=0;const chunks:Uint8Array[]=[];
  try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024*1024)throw new Error("Oversized response");chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
 }
 private async authorization(){
  if(this.credentials.username.includes(":"))throw new Error("Invalid organization");
  const token=await this.json("Token",{Authorization:"Basic "+Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString("base64")}) as Record<string,unknown>;
  if(token?.token_type!=="Bearer"||typeof token.access_token!=="string"||!token.access_token||typeof token.expires_date!=="string"||!(Date.parse(token.expires_date)>Date.now()))throw new Error("Invalid temporary token");
  return{Authorization:"Bearer "+encryptCargosToken(token.access_token,this.credentials.apiKey),Organization:this.credentials.username};
 }
 async check(record:string,guard:CargosSendGuard=start=>start()):Promise<CargosCheckOutcome>{
  try{
   if(record.length!==1505)return{status:"UNAVAILABLE"};
   const headers=await this.authorization(),data=await guard(()=>this.json("Check",headers,[record]));
   if(!Array.isArray(data)||data.length!==1||!data[0]||typeof data[0]!=="object")return{status:"UNAVAILABLE"};
   const row=data[0] as Record<string,unknown>;
   if(row.esito===true)return{status:"VALID"};
   if(row.esito===false&&row.errore&&typeof row.errore==="object"){
    const code=(row.errore as Record<string,unknown>).error_code;
    return{status:"INVALID",errorCode:typeof code==="number"&&Number.isSafeInteger(code)?String(code):"CHECK_REJECTED"};
   }
  }catch{/* Validation never constitutes an accepted transmission. */}
  return{status:"UNAVAILABLE"};
 }
 async send(record:string,guard:CargosSendGuard=start=>start()):Promise<CargosOutcome>{
  let headers:Record<string,string>;
  try{
   if(record.length!==1505||this.credentials.username.includes(":"))return{status:"UNAVAILABLE"};
   const token=await this.json("Token",{Authorization:"Basic "+Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString("base64")}) as Record<string,unknown>;
   if(token.token_type!=="Bearer"||typeof token.access_token!=="string"||!token.access_token||typeof token.expires_date!=="string"||!(Date.parse(token.expires_date)>Date.now()))return{status:"UNAVAILABLE"};
   headers={Authorization:"Bearer "+encryptCargosToken(token.access_token,this.credentials.apiKey),Organization:this.credentials.username};
  }catch{return{status:"UNAVAILABLE"};}
  let initiated=false;
  try{
   const data=await guard(()=>{initiated=true;return this.json("Send",headers,[record]);});
   if(!Array.isArray(data)||data.length!==1||!data[0]||typeof data[0]!=="object")return{status:"UNKNOWN"};
   const row=data[0] as Record<string,unknown>;
   if(row.esito===true&&typeof row.transactionid==="string"&&row.transactionid.trim()&&row.transactionid.length<=250)return{status:"ACCEPTED",transactionId:row.transactionid};
   if(row.esito===false&&row.errore&&typeof row.errore==="object"){
    const code=(row.errore as Record<string,unknown>).error_code;
    return{status:"REJECTED",errorCode:typeof code==="number"&&Number.isSafeInteger(code)?String(code):"RECORD_REJECTED"};
   }
   return{status:"UNKNOWN"};
  }catch{return{status:initiated?"UNKNOWN":"UNAVAILABLE"};}
 }
}
