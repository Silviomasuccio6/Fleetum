import fs from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,type PDFFont} from 'pdf-lib';
import {AppError} from '../../shared/errors/app-error.js';

/** Self-contained print fonts: no system fonts, remote fetches or silent lost glyphs. */
export async function contractPdfFonts(doc:PDFDocument){
 doc.registerFontkit(fontkit);
 let regular:PDFFont,bold:PDFFont;
 try{[regular,bold]=await Promise.all(['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf'].map(async name=>doc.embedFont(await fs.readFile(new URL(`../../../assets/invoice/${name}`,import.meta.url)),{subset:true})));}
 catch{throw new AppError('Caratteri del contratto temporaneamente non disponibili.',503,'CONTRACT_PDF_ASSETS');}
 const boldSupported=new Set(bold.getCharacterSet());
 const supported=new Set(regular.getCharacterSet().filter(code=>boldSupported.has(code)));
 const validate=(value:unknown):void=>{
  if(typeof value==='string'){
   if([...value].some(char=>!['\n','\r','\t'].includes(char)&&!supported.has(char.codePointAt(0)!)))throw new AppError('Il contratto contiene caratteri non rappresentabili nel PDF. Verifica nomi, indirizzi e condizioni prima di emetterlo.',422,'CONTRACT_PDF_TEXT_UNSUPPORTED');
  }else if(Array.isArray(value)){value.forEach(validate);}else if(value&&typeof value==='object'&&!(value instanceof Date)){Object.values(value).forEach(validate);}
 };
 return{regular,bold,validate};
}
export const CONTRACT_PDF_LAYOUT='Fleetum contract layout v2';
