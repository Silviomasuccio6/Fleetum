import type {ContractSigningRequest} from '@prisma/client';
import {PDFDocument,rgb} from 'pdf-lib';
import {contractPdfFonts} from './contract-pdf-fonts.js';
import {AppError} from '../../shared/errors/app-error.js';

/** Own section numbering preserves the original's pages and their original footer. */
export async function buildProfessionalSigningAppendix(row:ContractSigningRequest,signature?:Uint8Array){
 if(!row.signedAt||!row.evidence)throw new AppError('Registrazione non disponibile',409,'CONTRACT_NOT_SIGNED');
 const evidence=row.evidence as Record<string,unknown>,pdf=await PDFDocument.create();
 const {regular,bold,validate}=await contractPdfFonts(pdf);
 const fields=[row.issuerName,row.bookingCode,row.signerName,row.recipient,row.documentTitle,String(evidence.consent??'')];validate(fields);
 pdf.setTitle(`Registrazione della firma - ${row.bookingCode}`);pdf.setAuthor(row.issuerName);pdf.setCreationDate(row.signedAt);pdf.setModificationDate(row.signedAt);
 const W=595.28,H=841.89,M=46,CW=W-M*2,ink=rgb(.12,.18,.26),muted=rgb(.35,.41,.49),lineColor=rgb(.83,.87,.91);
 let page=pdf.addPage([W,H]),y=H-100;
 const pages=[page];
 const wrap=(value:string,size:number,strong=false)=>{
  const font=strong?bold:regular,lines:string[]=[];let line='';
  for(const word of value.replace(/\s+/gu,' ').trim().split(' ')){
   if(font.widthOfTextAtSize(line?line+' '+word:word,size)<=CW){line=line?line+' '+word:word;continue;}
   if(line){lines.push(line);line='';}
   for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>CW){lines.push(line);line='';}line+=char;}
  }
  if(line)lines.push(line);return lines;
 };
 const header=()=>{page.drawRectangle({x:0,y:H-4,width:W,height:4,color:ink});page.drawText('REGISTRAZIONE DELLA FIRMA',{x:M,y:H-53,size:18,font:bold,color:ink});page.drawText('Allegato al documento originale conservato',{x:M,y:H-72,size:9,font:regular,color:muted});};
 header();
 const next=()=>{if(pages.length>=15)throw new AppError('La registrazione supera la dimensione prevista. Verifica i dati.',422,'CONTRACT_EVIDENCE_TOO_LONG');page=pdf.addPage([W,H]);pages.push(page);y=H-100;header();};
 const ensure=(height:number)=>{if(y-height<65)next();};
 const text=(value:string,size=10,strong=false)=>{for(const line of wrap(value,size,strong)){ensure(size*1.5);page.drawText(line,{x:M,y,size,font:strong?bold:regular,color:ink});y-=size*1.5;}y-=5;};
 const field=(label:string,value:string)=>{ensure(50);text(label.toUpperCase(),7.5,true);text(value);y-=3;};
 field('Locatore',row.issuerName);
 field('Contratto',`${row.bookingCode} - revisione ${row.contractRevision+1} - richiesta di firma ${row.version}`);
 field('Documento sottoscritto',row.documentTitle);
 field('Firmatario',row.signerName);
 if(row.method!=='IN_PERSON')field('Recapito del codice monouso',row.recipient);
 field('Modalità',row.method==='IN_PERSON'?'Firma grafica raccolta in presenza':'Codice monouso inviato per email');
 field('Data e ora di conferma',`${new Intl.DateTimeFormat('it-IT',{dateStyle:'long',timeStyle:'long',timeZone:'Europe/Rome'}).format(row.signedAt)} / ${row.signedAt.toISOString()} (UTC)`);
 if(signature){
  const image=await pdf.embedPng(signature),scale=Math.min(CW/image.width,100/image.height,1),height=image.height*scale;
  ensure(height+45);text('FIRMA GRAFICA ACQUISITA',7.5,true);
  page.drawImage(image,{x:M,y:y-height,width:image.width*scale,height});y-=height+12;
 }
 field('Dichiarazione confermata',String(evidence.consent??''));
 field('Versione della dichiarazione',String(evidence.consentVersion??''));
 field('SHA-256 del PDF originale',row.documentSha256);
 field('Riferimento della richiesta',row.id);
 text('La firma è collegata all’impronta del PDF originale conservato. Il contratto e questa registrazione hanno numerazioni di pagina separate. Questo riepilogo documenta il processo di sottoscrizione e non certifica una firma qualificata.',9);
 pages.forEach((p,index)=>{
  p.drawLine({start:{x:M,y:45},end:{x:W-M,y:45},color:lineColor,thickness:.6});
  p.drawText('Predisposto con Fleetum',{x:M,y:29,size:8,font:regular,color:muted});
  const number=`Registrazione firma - pagina ${index+1} di ${pages.length}`;
  p.drawText(number,{x:W-M-regular.widthOfTextAtSize(number,8),y:29,size:8,font:regular,color:muted});
 });
 return Buffer.from(await pdf.save());
}
