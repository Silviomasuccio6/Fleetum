import test from 'node:test';import assert from 'node:assert/strict';import axios,{AxiosError} from 'axios';
import {useSnackbarStore} from '../src/application/stores/snackbar-store';
const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'fermi_csrf=synthetic-only'}});Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hostname:'localhost',pathname:'/booking',search:'',hash:'',replace:()=>{}}}});
let outcome:'ok'|'network'|'validation'|'late'='ok';
let entered:()=>void=()=>{},rejectLate:()=>void=()=>{};
axios.defaults.adapter=async config=>{if(outcome==='late')return new Promise((_resolve,reject)=>{rejectLate=()=>reject(new AxiosError('Synthetic late network','ERR_NETWORK',config));entered();});if(outcome==='network')throw new AxiosError('Synthetic network','ERR_NETWORK',config);if(outcome==='validation')throw new AxiosError('Synthetic validation','ERR_BAD_REQUEST',config,undefined,{data:{error:'VALIDATION_ERROR',details:{fieldErrors:{name:['obbligatorio']}}},status:400,statusText:'Bad request',headers:{},config});return{data:{status:'QUEUED'},status:202,statusText:'Accepted',headers:{},config}};
const {httpClient}=await import('../src/infrastructure/api/http-client');
test('an accepted queued request does not claim business completion or generate a second generic confirmation',async()=>{outcome='ok';useSnackbarStore.getState().clear();assert.deepEqual(await httpClient.post('/synthetic/jobs',{}),{status:'QUEUED'});assert.equal(useSnackbarStore.getState().items.length,0)});
test('network failure on a write does not say that the mutation failed or encourage blind resubmission',async()=>{outcome='network';useSnackbarStore.getState().clear();await assert.rejects(httpClient.patch('/synthetic/record',{}),/Esito da verificare/);assert.equal(useSnackbarStore.getState().items.length,1);assert.equal(useSnackbarStore.getState().items[0].origin,'transport');assert.equal(useSnackbarStore.getState().items[0].durationMs,8000)});
test('validation remains available to the field handler without a duplicate global alert',async()=>{outcome='validation';useSnackbarStore.getState().clear();await assert.rejects(httpClient.post('/synthetic/record',{}),/obbligatorio/);assert.equal(useSnackbarStore.getState().items.length,0)});
test('Platform session revision notifies the feedback bridge without exposing credentials',async()=>{const {platformAuthStorage}=await import('../src/infrastructure/platform/platform-auth-storage');const seen:number[]=[];const start=platformAuthStorage.revision();const stop=platformAuthStorage.subscribe(()=>seen.push(platformAuthStorage.revision()));try{platformAuthStorage.set('synthetic-ephemeral');platformAuthStorage.clear();assert.deepEqual(seen,[start+1,start+2]);}finally{stop();platformAuthStorage.clear();}});

test('a delayed transport error cannot appear after navigating away and back',async()=>{
 useSnackbarStore.getState().setContext('booking');outcome='late';
 const started=new Promise<void>(resolve=>{entered=resolve});
 const request=httpClient.patch('/synthetic/record',{});const rejected=assert.rejects(request,/Esito da verificare/);
 await started;useSnackbarStore.getState().setContext('customers');useSnackbarStore.getState().setContext('booking');rejectLate();
 await rejected;assert.equal(useSnackbarStore.getState().items.length,0);outcome='ok';
});
