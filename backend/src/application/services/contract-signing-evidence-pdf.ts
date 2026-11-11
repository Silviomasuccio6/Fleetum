import {buildProfessionalSigningAppendix} from './contract-signing-appendix-pdf.js';
import type {ContractSigningRequest} from "@prisma/client";
import {PDFDocument,StandardFonts,rgb} from "pdf-lib";
import {AppError} from "../../shared/errors/app-error.js";

/** Human-readable receipt. The original signed document is never rewritten. */
export async function buildSigningEvidencePdf(row:ContractSigningRequest){
 if((row.evidence as Record<string,unknown>|null)?.pdfLayoutVersion===2)return buildProfessionalSigningAppendix(row);
 if(!row.signedAt||!row.evidence)throw new AppError("Registrazione non disponibile",409,"CONTRACT_NOT_SIGNED");
 const evidence=row.evidence as Record<string,unknown>,pdf=await PDFDocument.create();
 pdf.setTitle(`Registrazione firma email — ${row.bookingCode}`);pdf.setAuthor(row.issuerName);pdf.setCreationDate(row.signedAt);pdf.setModificationDate(row.signedAt);
 const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let page=pdf.addPage([595.28,841.89]),y=790;
 const text=(value:string,size=11,strong=false)=>{
  const font=strong?bold:regular;
  const words=value.split(/\s+/),lines:string[]=[];let line="";
  for(const word of words){const candidate=line?line+" "+word:word;if(font.widthOfTextAtSize(candidate,size)>495&&line){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);
  for(const part of lines){if(y<65){page=pdf.addPage([595.28,841.89]);y=790;}page.drawText(part,{x:50,y,size,font,color:rgb(.12,.16,.23)});y-=size*1.5;}
  y-=8;
 };
 text(row.issuerName,12,true);y-=12;text(row.method==="IN_PERSON"?"Registrazione della firma in presenza":"Registrazione della firma tramite email",20,true);
 text(`Contratto ${row.bookingCode} — versione documento ${row.version}`,12,true);
 text(`Firmatario: ${row.signerName}`);if(row.method!=="IN_PERSON")text(`Email: ${row.recipient}`);
 text(`Data e ora registrata: ${row.signedAt.toISOString()} (UTC)`);
 text("Documento sottoscritto:",11,true);text(row.documentTitle);
 text(`Impronta SHA-256: ${row.documentSha256}`,9);
 text(`Riferimento richiesta: ${row.id}`,9);
 text(`Modalità: ${row.method==="IN_PERSON"?"firma grafica raccolta in presenza":"codice monouso inviato per email"}; versione consenso ${String(evidence.consentVersion??"")}.`);
 text("Dichiarazione confermata:",11,true);text(String(evidence.consent??""));
 text("Questa registrazione è collegata al PDF originale mediante la sua impronta. Il PDF originale è conservato senza modifiche. Il presente riepilogo documenta il processo di sottoscrizione e non è una certificazione di firma qualificata.",10);
 page.drawLine({start:{x:50,y:48},end:{x:545,y:48},thickness:.5,color:rgb(.82,.85,.89)});
 page.drawText("Documento predisposto con Fleetum",{x:50,y:32,size:9,font:regular,color:rgb(.4,.45,.52)});
 return Buffer.from(await pdf.save());
}
