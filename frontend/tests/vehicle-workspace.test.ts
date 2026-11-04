import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { translateText, reverseTranslateText } from "../src/presentation/i18n/fleetum-language";
import { vehicleSchema } from "../../backend/src/interfaces/http/validators/master-data-validators";
import { vehicleFormData, vehicleFieldGroups, vehicleNumber, vehicleState } from "../src/presentation/components/vehicles/vehicle-form";
import { VehicleCollection, VehicleDetails } from "../src/presentation/components/vehicles/vehicle-workspace";
const form=(values:Record<string,string>={})=>{const f=new FormData();for(const [k,v]of Object.entries({siteId:"qa-site",plate:" qa123aa ",brand:"Test",model:"City",...values}))f.set(k,v);return f;};
const fixture={id:"qa-vehicle",siteId:"qa-site",plate:"QA123AA",brand:"Test",model:"City <script>",isActive:false,currentKm:0,maintenanceIntervalKm:10000,site:{id:"qa-site",name:"Sede sintetica molto lunga",city:"Test"},booklet:{id:"qa-booklet",fileName:"libretto-fittizio.png"}};
test("optional year is omitted and the real API schema accepts the vehicle",()=>{
  const {payload,errors}=vehicleFormData(form());assert.deepEqual(errors,{});assert.equal(payload.year,undefined);assert.equal(payload.plate,"QA123AA");assert.equal(vehicleSchema.safeParse(payload).success,true);assert.equal(vehicleSchema.safeParse({...payload,year:null}).success,false);
});
test("vehicle inputs retain zero and all existing wire fields without changing active status",()=>{
  const {payload,errors}=vehicleFormData(form({year:"2024",currentKm:"0",maintenanceIntervalKm:"100",purchasePrice:"0",residualValue:"7500.50",monthlyFixedCost:"12.25",notes:"test"}));assert.deepEqual(errors,{});assert.equal(payload.currentKm,0);assert.equal(payload.purchasePrice,0);assert.equal(payload.residualValue,7500.5);assert.equal(Object.keys(payload).length,14);assert.equal("isActive" in payload,false);assert.equal(vehicleSchema.safeParse(payload).success,true);
  assert.deepEqual(vehicleFieldGroups.flatMap(group=>group.fields.map(field=>field.name)).sort(),Object.keys(payload).sort());
});
test("vehicle validation rejects fractional kilometres, wrong years and negative amounts",()=>{
  const {errors}=vehicleFormData(form({plate:"A",brand:"X",year:"1949",currentKm:"1.5",maintenanceIntervalKm:"99",purchasePrice:"-1",monthlyFixedCost:"Infinity"}));for(const key of ["plate","brand","year","currentKm","maintenanceIntervalKm","purchasePrice","monthlyFixedCost"])assert.ok(errors[key as keyof typeof errors]);
});
test("calendar-invalid dates are rejected and valid dates keep the original noon convention",()=>{
  assert.ok(vehicleFormData(form({registrationDate:"2026-02-31"})).errors.registrationDate);const {payload,errors}=vehicleFormData(form({registrationDate:"2024-02-29"}));assert.deepEqual(errors,{});assert.equal(new Date(payload.registrationDate!).getHours(),12);
});
test("missing vehicle numbers differ from zero, and active never means available",()=>{
  assert.equal(vehicleNumber(0),"0");assert.equal(vehicleNumber(null),"—");assert.equal(vehicleNumber("oops"),"—");assert.equal(vehicleState(false),"Inattivo");assert.equal(vehicleState(true),"Attivo");assert.equal(vehicleState(undefined),"Stato non disponibile");
});
test("read-only collection retains detail and booklet while omitting edits and deletion",()=>{
  const html=renderToStaticMarkup(React.createElement(VehicleCollection,{vehicles:[fixture],canWrite:false,canRoi:false,onDetail:()=>{},onEdit:()=>{},onDelete:()=>{},onBooklet:()=>{},onRoi:()=>{}}));assert.ok(html.includes("Apri veicolo QA123AA"));assert.ok(html.includes("Apri libretto QA123AA"));assert.ok(html.includes("Inattivo"));assert.ok(!html.includes("Modifica QA123AA"));assert.ok(!html.includes("Elimina QA123AA"));assert.ok(html.includes("&lt;script&gt;"));
});
test("detail retains every field group including notes, financial data and revision",()=>{
  const html=renderToStaticMarkup(React.createElement(VehicleDetails,{vehicle:{...fixture,notes:"Nota QA",purchasePrice:10000,revisionDueAt:"2026-11-30T12:00:00Z"},onBooklet:()=>{}}));for(const value of ["Nota QA","Prezzo acquisto","Libretto e prossima revisione","libretto-fittizio.png","Km attuali"])assert.ok(html.includes(value));assert.ok(!html.includes("<script>"));
});
function loader(permissions=["*"]){
  const callbacks:Array<(...args:any[])=>Promise<void>>=[],states:any[]=[];let state=0;
  const pending:Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];
  const exports:any={};const source=readFileSync(new URL("../src/presentation/pages/vehicles/vehicles-page.tsx",import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(compiled,{exports,Date,Promise,require(id:string){
    if(id==="react")return {...React,useState:(value:any)=>{const i=state++;states[i]=value;return[value,(next:any)=>{states[i]=typeof next==="function"?next(states[i]):next}]},useRef:(value:any)=>({current:value}),useCallback:(fn:any)=>{callbacks.push(fn);return fn},useMemo:(fn:any)=>fn(),useEffect:()=>{}};
    if(id==="react/jsx-runtime")return {jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:"Fragment"};
    if(id==="react-router-dom")return {useNavigate:()=>()=>{}};
    if(id.endsWith("auth-store"))return {useAuthStore:(select:any)=>select({user:{permissions}})};
    if(id.endsWith("master-data-usecases"))return {masterDataUseCases:{listVehicles:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}};
    return new Proxy({},{get:(_,key)=>String(key)});
  }});exports.VehiclesPage();return {load:callbacks[1],pending,states};
}
test("a slow old search cannot overwrite the result of the newer vehicle query",async()=>{
  const x=loader();const old=x.load(1,"old"),current=x.load(1,"new");x.pending[1].resolve({data:["new"],total:1});await current;x.pending[0].resolve({data:["old"],total:100});await old;assert.deepEqual(x.states[1],["new"]);assert.equal(x.states[2],1);assert.equal(x.states[6],false);
});
test("a stale list failure cannot replace a newer successful vehicle response",async()=>{
  const x=loader();const old=x.load(1,"old"),current=x.load(1,"new");x.pending[1].resolve({data:["new"],total:1});await current;x.pending[0].reject(Error("stale failure"));await old;assert.equal(x.states[7],null);assert.deepEqual(x.states[1],["new"]);
});
test("vehicle requests do not run when the read permission is absent",async()=>{
  const x=loader([]);await x.load(1,"");assert.equal(x.pending.length,0);
});

test("vehicle command translations preserve exact existing labels and selected plate",()=>{
  for(const field of vehicleFieldGroups.flatMap(group=>group.fields))assert.notEqual(translateText(field.label,"en"),field.label,field.label);
  for(const [it,en] of [["Modifica veicolo","Edit vehicle"],["Elimina veicolo","Delete vehicle"],["Apri veicolo QA101AA","Open vehicle QA101AA"],["Scheda QA101AA","Details QA101AA"]]){assert.equal(translateText(it,"en"),en);assert.equal(reverseTranslateText(en),it);}
});
