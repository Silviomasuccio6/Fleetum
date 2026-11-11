import { strict as assert } from "node:assert";
import { test } from "node:test";
import { serializeCargosRecord, CARGOS_FIELDS } from "../src/application/services/cargos-protocol.js";
import { CargosClient, encryptCargosToken } from "../src/infrastructure/cargos/cargos-client.js";

const synthetic = () => Object.fromEntries(CARGOS_FIELDS.map(field => [field.key,
  !field.required ? "" : field.kind === "dateTime" ? "29/10/2026 10:00" : field.kind === "date" ? "01/01/1990" : field.kind === "code" ? "100000001" : field.kind === "digit" ? "1" : field.kind === "phone" ? "05555555" : "A".repeat(Math.min(field.width,8))
]));
test("CARGOS refuses Token, Check and Send in staging and provider QA before any network request", async () => {
 for (const environment of ["staging", "provider-qa"] as const) {
  let calls = 0;
  const client = new CargosClient({username:"synthetic",password:"synthetic",apiKey:"012345678901234567890123456789010123456789012345"}, async () => {
   calls++;
   return new Response(JSON.stringify({token_type:"Bearer",access_token:"synthetic",expires_date:"2099-01-01T00:00:00Z"}));
  }, environment);
  assert.deepEqual(await client.check("x".repeat(1505)), {status:"UNAVAILABLE"});
  assert.deepEqual(await client.send("x".repeat(1505)), {status:"UNAVAILABLE"});
  assert.equal(calls, 0);
 }
});
test("official Check validates without calling Send and does not turn its transaction reference into acceptance",async()=>{
 const calls:string[]=[];const client=new CargosClient({username:"synthetic",password:"synthetic",apiKey:"012345678901234567890123456789010123456789012345"},async(url,init)=>{
  calls.push(String(url));if(String(url).endsWith("Token"))return new Response(JSON.stringify({token_type:"Bearer",access_token:"synthetic",expires_date:"2099-01-01T00:00:00Z"}));
  assert.ok(String(url).endsWith("Check"));assert.equal(JSON.parse(String(init?.body))[0].length,1505);return new Response(JSON.stringify([{esito:true,transactionid:"NOT-A-SEND-RECEIPT"}]));
 });
 assert.deepEqual(await client.check("x".repeat(1505)),{status:"VALID"});assert.equal(calls.length,2);assert.ok(!calls.some(url=>url.endsWith("Send")));
});
test("Check rejects malformed responses and does not expose provider text or credentials",async()=>{
 for(const [reply,expected]of [[[{esito:false,errore:{error_code:23,error_description:"private identity"}}],{status:"INVALID",errorCode:"23"}],[{esito:true},{status:"UNAVAILABLE"}],[[],{status:"UNAVAILABLE"}]] as const){
  const client=new CargosClient({username:"synthetic",password:"synthetic",apiKey:"012345678901234567890123456789010123456789012345"},async url=>new Response(JSON.stringify(String(url).endsWith("Token")?{token_type:"Bearer",access_token:"synthetic",expires_date:"2099-01-01T00:00:00Z"}:reply)));
  assert.deepEqual(await client.check("x".repeat(1505)),expected);
 }
});
test("CARGOS fixed record keeps official offsets and never truncates identity data", () => {
  const input = synthetic(); input.VEICOLO_TARGA = "QA001AA";
  const record = serializeCargosRecord(input);
  assert.equal(record.length, 1505); assert.equal(record.slice(897,912),"QA001AA        ");
  assert.throws(() => serializeCargosRecord({...input,CONDUCENTE_CONTRAENTE_NOME:"A".repeat(31)}),/CONDUCENTE_CONTRAENTE_NOME/);
  assert.throws(() => serializeCargosRecord({...input,CONDUCENTE_CONTRAENTE_NASCITA_DATA:"31/02/1990"}),/NASCITA_DATA/);
});
test("CARGOS rejects missing mandatory fields and incomplete second driver", () => {
  assert.throws(() => serializeCargosRecord({...synthetic(),CONTRATTO_CHECKOUT_LUOGO_COD:"Roma"}),/LUOGO_COD/);
  assert.throws(() => serializeCargosRecord({...synthetic(),CONDUCENTE2_NOME:"Anna"}),/secondo conducente/);
});
test("CARGOS AES matches CBC/PKCS7 independently and does not use deprecated 3DES", () => {
  assert.equal(encryptCargosToken("synthetic-token","012345678901234567890123456789010123456789012345"),"61iXrG5mkCuzA13LhKwY3g==");
  assert.throws(() => encryptCargosToken("test","short"),/API/);
});
test("HTTP 200 with rejected record is never accepted; unexpected success shape is uncertain", async () => {
  const calls:string[]=[];
  const client = new CargosClient({username:"synthetic",password:"synthetic",apiKey:"012345678901234567890123456789010123456789012345"},async(url,init)=>{
    calls.push(String(url));
    if(String(url).endsWith("Token"))return new Response(JSON.stringify({token_type:"Bearer",access_token:"synthetic",expires_date:"2099-01-01T00:00:00Z"}));
    assert.equal(new Headers(init?.headers).get("Organization"),"synthetic");
    return new Response(JSON.stringify([{esito:false,errore:{error_code:1,error_description:"sensitive data must not be exposed"}}]));
  });
  assert.deepEqual(await client.send("x".repeat(1505)),{status:"REJECTED",errorCode:"1"});
  assert.equal(calls.length,2);
  const malformed=new CargosClient({username:"s",password:"s",apiKey:"012345678901234567890123456789010123456789012345"},async url=>new Response(JSON.stringify(String(url).endsWith("Token")?{token_type:"Bearer",access_token:"s",expires_date:"2099-01-01T00:00:00Z"}:{})));
  assert.deepEqual(await malformed.send("x".repeat(1505)),{status:"UNKNOWN"});
});
test("CARGOS network uncertainty after send is not a retryable rejection", async () => {
  const client=new CargosClient({username:"s",password:"s",apiKey:"012345678901234567890123456789010123456789012345"},async url=>{
    if(String(url).endsWith("Token"))return new Response(JSON.stringify({token_type:"Bearer",access_token:"s",expires_date:"2099-01-01T00:00:00Z"}));
    throw new Error("network interrupted after remote processing");
  });
  assert.deepEqual(await client.send("x".repeat(1505)),{status:"UNKNOWN"});
});

test("a revoked pre-send guard prevents any Send request after token acquisition",async()=>{
 const calls:string[]=[];const client=new CargosClient({username:"s",password:"s",apiKey:"012345678901234567890123456789010123456789012345"},async url=>{
  calls.push(String(url));return new Response(JSON.stringify({token_type:"Bearer",access_token:"s",expires_date:"2099-01-01T00:00:00Z"}));
 });
 assert.deepEqual(await client.send("x".repeat(1505),async()=>{throw new Error("Permission revoked");}),{status:"UNAVAILABLE"});
 assert.equal(calls.length,1);
});
