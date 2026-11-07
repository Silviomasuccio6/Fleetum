import {AppError} from '../../shared/errors/app-error.js';
export type CollectionRow={id:string;kind:string;amountCents:number;sourceId:string|null};
const fail=(message:string)=>new AppError(message,409,'RENTAL_COLLECTION_CONFLICT');
export function exactCents(value:number){if(!Number.isSafeInteger(value)||value<0)throw fail('Importo non rappresentabile in centesimi esatti.');return value;}
export function collectionEffect(row:CollectionRow,rows:CollectionRow[]):number{
 exactCents(row.amountCents);
 if(row.kind==='RECEIPT')return row.amountCents;
 if(row.kind==='REFUND')return -row.amountCents;
 const source=rows.find(x=>x.id===row.sourceId);
 if(row.kind!=='REVERSAL'||!source||source.kind==='REVERSAL'||row.amountCents!==source.amountCents)throw fail('Storno non valido. Verifica il registro.');
 return source.kind==='RECEIPT'?-row.amountCents:row.amountCents;
}
export function collectionBalance(agreedCents:number|null,rows:CollectionRow[]){
 if(agreedCents!==null)exactCents(agreedCents);
 const receivedCents=rows.reduce((sum,row)=>{const next=sum+collectionEffect(row,rows);if(!Number.isSafeInteger(next))throw fail('Saldo non rappresentabile.');return next;},0);
 if(receivedCents<0)throw fail('Registro incoerente. Verifica gli storni prima di proseguire.');
 const delta=agreedCents===null?null:agreedCents-receivedCents;
 const state=delta===null?'UNKNOWN':delta<0?'CREDIT':delta===0?(agreedCents===0?'FREE':'PAID'):receivedCents>0?'PARTIAL':'DUE';
 return{agreedCents,receivedCents,outstandingCents:delta===null?null:Math.max(0,delta),creditCents:delta===null?0:Math.max(0,-delta),state};
}
export function validateCollectionTarget(kind:string,sourceId:string|null,amountCents:number,rows:CollectionRow[]){
 if(kind==='RECEIPT'){if(sourceId)throw fail('Un incasso non può stornare un altro movimento.');return;}
 const source=rows.find(x=>x.id===sourceId);
 if(!source||source.kind==='REVERSAL'||rows.some(x=>x.kind==='REVERSAL'&&x.sourceId===source.id))throw fail('Movimento non disponibile per questa operazione.');
 const reversed=new Set(rows.filter(x=>x.kind==='REVERSAL').map(x=>x.sourceId));
 const refunded=rows.filter(x=>x.kind==='REFUND'&&x.sourceId===source.id&&!reversed.has(x.id)).reduce((sum,x)=>sum+x.amountCents,0);
 if(kind==='REFUND'&&(source.kind!=='RECEIPT'||amountCents>source.amountCents-refunded))throw fail('Il rimborso supera l’importo ancora rimborsabile.');
 if(kind==='REVERSAL'&&(amountCents!==source.amountCents||(source.kind==='RECEIPT'&&refunded>0)))throw fail('Prima storna le registrazioni di rimborso collegate. Lo storno deve essere integrale.');
}
