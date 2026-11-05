import assert from "node:assert/strict";
import test from "node:test";
import {PDFParse} from "pdf-parse";
import {PDFDocument} from "pdf-lib";
import {buildEnterpriseContractPdf} from "../src/application/services/enterprise-contract-pdf-service.js";
import {syntheticTerms} from "./helpers/contract-rental-terms.js";
test("long party identities and rental conditions retain their final lines on subsequent pages",async()=>{
 const marker="FINE-CONDIZIONI-987654",addressMarker="FINE-INDIRIZZO-123456";
 const bytes=await buildEnterpriseContractPdf({contract:{title:"Contratto sintetico con condizioni articolate e riferimento completo conservato nel documento",content:"Clausole sintetiche.",rentalTerms:{...syntheticTerms,insuranceSummary:Array.from({length:35},()=>"Condizione di copertura sintetica molto lunga con esclusioni e riferimenti da verificare.").join(" ")+marker}},booking:{code:"SYNTHETIC-LONG-FIELDS",status:"CONFIRMED",contractStatus:"READY",customerName:"Anna Test",pickupAt:new Date("2026-11-01T10:00:00Z"),returnAt:new Date("2026-11-02T10:00:00Z"),customer:{firstName:"Anna",lastName:"Test",residenceAddress:"Indirizzo sintetico ".repeat(90)+addressMarker}},branding:{companyName:"Noleggio sintetico"}});
 const parser=new PDFParse({data:bytes});try{const text=(await parser.getText()).text;assert.ok(text.includes(marker));assert.ok(text.includes(addressMarker));assert.ok(text.includes("riferimento completo conservato nel documento"));}finally{await parser.destroy();}
});
test("party card preserves the sixth identity item, including the complete driving licence",async()=>{
 const bytes=await buildEnterpriseContractPdf({contract:{title:"Bozza sintetica",content:"Condizioni sintetiche."},booking:{code:"SYNTHETIC-LICENCE",status:"CONFIRMED",contractStatus:"READY",customerName:"Anna Test",pickupAt:new Date("2026-10-29T10:00:00Z"),returnAt:new Date("2026-10-30T10:00:00Z"),customer:{firstName:"Anna",lastName:"Test",drivingLicenseNumber:"LICENZA-SINTETICA-VERIFICA-987654",drivingLicenseCategory:"B",drivingLicenseExpiresAt:new Date("2035-10-01")}},branding:{companyName:"Noleggio sintetico"}});
 const parser=new PDFParse({data:bytes});try{assert.ok((await parser.getText()).text.includes("LICENZA-SINTETICA-VERIFICA-987654"));}finally{await parser.destroy();}
});
test("contract PDF includes every agreed clause and paginates a long paragraph without losing its end",async()=>{
 const content=Array.from({length:90},(_,i)=>`CLAUSOLA ${i+1}: Condizioni concordate integralmente con il locatore sintetico. Importi, durata e responsabilità di prova.`).join("\n")+"\nULTIMA CLAUSOLA VERIFICATA 987654";
 const bytes=await buildEnterpriseContractPdf({contract:{title:"Contratto sintetico",content},booking:{code:"SYNTHETIC-FULL-TEXT",status:"CONFIRMED",contractStatus:"READY",customerName:"Cliente sintetico",pickupAt:new Date("2026-10-29T10:00:00Z"),returnAt:new Date("2026-10-30T10:00:00Z")},branding:{companyName:"Noleggio sintetico"}});
 const parser=new PDFParse({data:bytes.slice()});try{const text=(await parser.getText()).text;for(let n=1;n<=90;n++)assert.ok(text.includes(`CLAUSOLA ${n}:`),`Clause ${n} missing`);assert.ok(text.includes("ULTIMA CLAUSOLA VERIFICATA 987654"));}finally{await parser.destroy();}
 const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>3);
});
