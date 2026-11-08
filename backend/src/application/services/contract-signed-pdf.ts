import {buildProfessionalSigningAppendix} from './contract-signing-appendix-pdf.js';
import {CONTRACT_PDF_LAYOUT} from './contract-pdf-fonts.js';
import type {ContractSigningRequest} from '@prisma/client';
import sharp from 'sharp';
import {PDFDocument,rgb,StandardFonts} from 'pdf-lib';
import {buildSigningEvidencePdf} from './contract-signing-evidence-pdf.js';
import {AppError} from '../../shared/errors/app-error.js';
/** Preserve the original separately; append an evidence page to its exact pages. */
export async function buildSignedContractPdf(original:Buffer,row:ContractSigningRequest,signatureDataUrl?:string){
 const pdf=await PDFDocument.load(original);
 if(pdf.getSubject()===CONTRACT_PDF_LAYOUT){
  const evidence=row.evidence as Record<string,unknown>;
  // The caller seals this layout marker together with the immutable signing evidence.
  evidence.pdfLayoutVersion=2;
  let image:Buffer|undefined;
  if(row.method==='IN_PERSON'){
   if(!signatureDataUrl||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl)||signatureDataUrl.length>400000)throw new AppError('Acquisisci una firma PNG valida.',422,'CONTRACT_SIGNATURE_INVALID');
   try{
    image=Buffer.from(signatureDataUrl.split(',')[1],'base64');
    const stats=await sharp(image,{limitInputPixels:2880000}).flatten({background:'#ffffff'}).stats(),meta=await sharp(image,{limitInputPixels:2880000}).metadata();
    if(stats.channels.slice(0,3).every(channel=>channel.min>230)||!meta.width||!meta.height||meta.width<100||meta.height<40||meta.width>2400||meta.height>1200)throw new Error('invalid signature');
   }catch{throw new AppError('La firma non è un’immagine PNG leggibile.',422,'CONTRACT_SIGNATURE_INVALID');}
  }
  const appendix=await PDFDocument.load(await buildProfessionalSigningAppendix(row,image));
  for(const page of await pdf.copyPages(appendix,appendix.getPageIndices()))pdf.addPage(page);
  pdf.setModificationDate(row.signedAt!);return Buffer.from(await pdf.save());
 }
 // Keep the established signing output for already-frozen historical originals.
 const evidence=await PDFDocument.load(await buildSigningEvidencePdf(row));
 for(const page of await pdf.copyPages(evidence,evidence.getPageIndices()))pdf.addPage(page);
 if(row.method==='IN_PERSON'){
  if(!signatureDataUrl||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl)||signatureDataUrl.length>400000)throw new AppError('Acquisisci una firma PNG valida.',422,'CONTRACT_SIGNATURE_INVALID');
  try{
   const raw=Buffer.from(signatureDataUrl.split(',')[1],'base64');
   const stats=await sharp(raw,{limitInputPixels:2880000}).flatten({background:'#ffffff'}).stats();
   if(stats.channels.slice(0,3).every(channel=>channel.min>230))throw new Error('empty signature');
   const image=await pdf.embedPng(raw);
   if(image.width<100||image.height<40||image.width>2400||image.height>1200)throw new Error('dimensions');
   const page=pdf.addPage([595.28,841.89]),font=await pdf.embedFont(StandardFonts.Helvetica);
   page.drawText('Firma raccolta in presenza',{x:50,y:775,size:20,font});
   page.drawText(`${row.bookingCode} - versione ${row.version}`,{x:50,y:741,size:12,font});
   page.drawText(`Firmatario: ${row.signerName}`.slice(0,85),{x:50,y:715,size:11,font});
   page.drawText(`SHA-256 originale: ${row.documentSha256}`,{x:50,y:685,size:8,font});
   const scale=Math.min(495/image.width,180/image.height,1);
   page.drawImage(image,{x:50,y:480,width:image.width*scale,height:image.height*scale});
   page.drawLine({start:{x:50,y:470},end:{x:545,y:470},color:rgb(.7,.75,.8),thickness:.5});
   page.drawText(`Data e ora: ${row.signedAt!.toISOString()}`,{x:50,y:440,size:11,font});
   page.drawText('Firma riferita al documento originale conservato e alla sua impronta.',{x:50,y:410,size:10,font});
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('La firma non è un’immagine PNG leggibile.',422,'CONTRACT_SIGNATURE_INVALID');}
 }
 pdf.setModificationDate(row.signedAt!);return Buffer.from(await pdf.save());
}
