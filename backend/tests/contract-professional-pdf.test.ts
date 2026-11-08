import assert from 'node:assert/strict';
import test from 'node:test';
import {PDFParse} from 'pdf-parse';
import {PDFDocument} from 'pdf-lib';
import {buildEnterpriseContractPdf} from '../src/application/services/enterprise-contract-pdf-service.js';
import {professionalContractFixture} from './helpers/contract-pdf-fixture.js';
const extract=async(bytes:Buffer)=>{const parser=new PDFParse({data:bytes});try{return(await parser.getText()).text;}finally{await parser.destroy();}};
test('professional contract retains Greek and Cyrillic party identities',async()=>{
 const fixture=professionalContractFixture();fixture.branding.companyName='Νοικιάσεις QA';fixture.booking.customer.firstName='Анна';fixture.booking.customer.lastName='Тест';
 const text=await extract(await buildEnterpriseContractPdf(fixture));assert.match(text,/Νοικιάσεις QA/);assert.match(text,/Анна Тест/);
});
test('overridden gross price never presents stale tax figures as agreed tax',async()=>{
 const text=await extract(await buildEnterpriseContractPdf(professionalContractFixture()));assert.match(text,/80,00/);assert.match(text,/Dettaglio IVA/);assert.match(text,/non disponibile/i);assert.doesNotMatch(text,/18,03/);
});
test('document revision and section pagination are explicit',async()=>{
 const fixture=professionalContractFixture();fixture.contract.documentRevision=2;
 const bytes=await buildEnterpriseContractPdf(fixture),text=await extract(bytes),pdf=await PDFDocument.load(bytes);
 assert.match(text,/Revisione 3/);assert.ok(text.includes(`Contratto - pagina 1 di ${pdf.getPageCount()}`));
});
test('unknown glyphs are rejected with an actionable error instead of replaced identity',async()=>{
 const fixture=professionalContractFixture();fixture.booking.customer.firstName='漢字';
 await assert.rejects(buildEnterpriseContractPdf(fixture),(error:any)=>error.code==='CONTRACT_PDF_TEXT_UNSUPPORTED'&&error.statusCode===422);
});
test('draft does not claim issuance or signature and retains separate real collection amounts',async()=>{
 const fixture=professionalContractFixture();fixture.contract.issuedAt=null as any;
 const text=await extract(await buildEnterpriseContractPdf(fixture));assert.match(text,/BOZZA - NON EMESSO/);assert.doesNotMatch(text,/Firma registrata/);assert.match(text,/50,00/);assert.match(text,/30,00/);assert.match(text.replace(/\s+/g,' '),/Cauzione e preautorizzazioni non costituiscono pagamento/);
});
test('incoherent gross agreement blocks the PDF instead of printing conflicting totals',async()=>{
 const fixture=professionalContractFixture();fixture.booking.priceAgreement.agreedCents=7000;
 await assert.rejects(buildEnterpriseContractPdf(fixture),(error:any)=>error.code==='CONTRACT_PRICE_INCONSISTENT');
});
test('long discount descriptions remain inside their own paginated table rows',async()=>{
 const fixture=professionalContractFixture();fixture.booking.priceAgreement.reason='Condizione economica sintetica '.repeat(180)+'ULTIMO-DETTAGLIO-SCONTO';
 const text=await extract(await buildEnterpriseContractPdf(fixture));assert.match(text,/ULTIMO-DETTAGLIO-SCONTO/);
});
test('matching stored tax breakdown is included without recalculating a tax rate',async()=>{
 const fixture=professionalContractFixture();fixture.booking.pricingSnapshot={expectedSubtotal:65.57,expectedTaxAmount:14.43,expectedTotal:80,vatRate:22};
 const text=await extract(await buildEnterpriseContractPdf(fixture));assert.match(text,/65,57/);assert.match(text,/14,43/);assert.doesNotMatch(text,/non disponibile per questo importo/);
});
test('a light brand colour cannot make contract text disappear on white paper',async()=>{
 const fixture=professionalContractFixture();Object.assign(fixture.branding,{brandPrimary:'#ffffff'});
 const pdf=await PDFDocument.load(await buildEnterpriseContractPdf(fixture));
 const {PDFArray,PDFRawStream,decodePDFRawStream}=await import('pdf-lib');
 for(const page of pdf.getPages()){
  const contents=page.node.Contents(),refs=contents instanceof PDFArray?contents.asArray():contents?[contents]:[];
  for(const ref of refs){const stream=pdf.context.lookup(ref);assert.ok(stream instanceof PDFRawStream);assert.doesNotMatch(Buffer.from(decodePDFRawStream(stream).decode()).toString(),/BT\s+1 1 1 rg/);}
 }
});
test('short terms can follow the delivery section without an unconditional blank page break',async()=>{
 const fixture=professionalContractFixture();fixture.contract.rentalTerms=null as any;
 const parser=new PDFParse({data:await buildEnterpriseContractPdf(fixture)});
 try{const result=await parser.getText();assert.ok(result.pages.some(page=>page.text.includes('CONSEGNA E RICONSEGNA')&&page.text.includes('CONDIZIONI CONTRATTUALI INTEGRALI')));}finally{await parser.destroy();}
});
