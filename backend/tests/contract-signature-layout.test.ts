import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {PDFDocument,PDFRawStream,PDFName,PDFArray} from 'pdf-lib';
import {PDFParse} from 'pdf-parse';
import {buildEnterpriseContractPdf} from '../src/application/services/enterprise-contract-pdf-service.js';
import {buildSignedContractPdf} from '../src/application/services/contract-signed-pdf.js';
import {buildSigningEvidencePdf} from '../src/application/services/contract-signing-evidence-pdf.js';
import {professionalContractFixture} from './helpers/contract-pdf-fixture.js';
const row=(method='EMAIL_OTP')=>({id:'synthetic-request',method,bookingCode:'QA-PRO-001',version:7,contractRevision:2,signerName:'Анна Тест',issuerName:'Νοικιάσεις QA',recipient:'signer@example.invalid',documentTitle:'Contratto sintetico',documentSha256:'a'.repeat(64),signedAt:new Date('2030-11-02T10:00:00Z'),evidence:{consent:'Ho letto il documento sintetico e confermo questa prova.',consentVersion:'qa-v1'}} as any);
const text=async(bytes:Buffer)=>{const parser=new PDFParse({data:bytes});try{return(await parser.getText()).text;}finally{await parser.destroy();}};
test('new OTP appendix keeps original pages and uses separate complete section numbering',async()=>{
 const original=await buildEnterpriseContractPdf(professionalContractFixture()),request=row(),before=Buffer.from(original);
 const final=await buildSignedContractPdf(original,request),pdf=await PDFDocument.load(final),originalPdf=await PDFDocument.load(original);
 assert.deepEqual(original,before);assert.equal(pdf.getPageCount(),originalPdf.getPageCount()+1);assert.equal(request.evidence.pdfLayoutVersion,2);
 const actual=await text(final);assert.match(actual,/Registrazione firma - pagina 1 di 1/);assert.match(actual,/revisione 3 - richiesta di firma 7/);assert.match(actual,/Анна Тест/);assert.match(actual,/non certifica una firma qualificata/);
 for(let i=0;i<originalPdf.getPageCount();i++){
  const contents=(doc:PDFDocument,index:number)=>{
   const object=doc.getPage(index).node.Contents();
   const refs=object instanceof PDFArray?object.asArray():object?[object]:[];
   return refs.map(ref=>{const stream=doc.context.lookup(ref);assert.ok(stream instanceof PDFRawStream);return Buffer.from(stream.getContents());});
  };
  assert.deepEqual(contents(pdf,i),contents(originalPdf,i));
 }
 assert.ok(actual.includes(`Contratto - pagina 1 di ${originalPdf.getPageCount()}`));
});
test('in-person graphic signature belongs to a single evidence section',async()=>{
 const original=await buildEnterpriseContractPdf(professionalContractFixture()),request=row('IN_PERSON');
 const png=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><path d="M20 100 Q90 20 130 120 T300 100 L500 90" fill="none" stroke="#172232" stroke-width="4"/></svg>')).png().toBuffer();
 const final=await buildSignedContractPdf(original,request,'data:image/png;base64,'+png.toString('base64'));
 const pdf=await PDFDocument.load(final);assert.equal(pdf.getPageCount(),(await PDFDocument.load(original)).getPageCount()+1);
 const images=pdf.context.enumerateIndirectObjects().filter(([,v])=>v instanceof PDFRawStream&&v.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'));assert.ok(images.length>0);
 const actual=await text(final);assert.match(actual,/Firma grafica raccolta in presenza/);assert.doesNotMatch(actual,/Recapito del codice monouso/);
});
test('receipt wraps very long unbroken names and includes the final character',async()=>{
 const request=row();request.evidence.pdfLayoutVersion=2;request.signerName='N'.repeat(1800)+'FINE-NOME';
 const actual=await text(await buildSigningEvidencePdf(request));assert.match(actual,/FINE-NOME/);assert.match(actual,/Registrazione firma - pagina 2 di 2/);
});
test('historical frozen originals keep their established appendix path',async()=>{
 const original=await PDFDocument.create();original.addPage();const request=row();request.signerName='Anna Test';request.issuerName='Autonoleggio sintetico';
 const final=await buildSignedContractPdf(Buffer.from(await original.save()),request);assert.equal(request.evidence.pdfLayoutVersion,undefined);assert.equal((await PDFDocument.load(final)).getPageCount(),2);
});
