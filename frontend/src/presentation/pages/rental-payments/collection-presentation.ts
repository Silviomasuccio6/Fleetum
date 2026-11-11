import type {CollectionEntry,CollectionState,CollectionMethod} from '../../../application/usecases/rental-collections-usecases';
export const collectionStateLabels:Record<CollectionState,string>={UNKNOWN:'Totale da definire',DUE:'Da incassare',PARTIAL:'Incasso parziale',PAID:'Saldo ricevuto',FREE:'Gratuito',CREDIT:'Credito da restituire'};
export const collectionMethodLabels:Record<CollectionMethod,string>={CASH:'Contanti',BANK_TRANSFER:'Bonifico ricevuto',EXTERNAL_POS:'POS esterno'};
export const collectionKindLabels:Record<CollectionEntry['kind'],string>={RECEIPT:'Incasso manuale registrato',REFUND:'Rimborso manuale registrato',REVERSAL:'Storno di registrazione'};
export function parseCollectionCents(value:string){const match=value.trim().match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);if(!match)return null;const cents=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'));return Number.isSafeInteger(cents)&&cents>0&&cents<=100000000?cents:null;}
export function receiptRemaining(entry:CollectionEntry,entries:CollectionEntry[]){
 const reversed=new Set(entries.filter(x=>x.kind==='REVERSAL').map(x=>x.sourceId));
 return reversed.has(entry.id)?0:entry.amountCents-entries.filter(x=>x.kind==='REFUND'&&x.sourceId===entry.id&&!reversed.has(x.id)).reduce((sum,x)=>sum+x.amountCents,0);
}
export function canReverseEntry(entry:CollectionEntry,entries:CollectionEntry[]){return entry.kind!=='REVERSAL'&&!entries.some(x=>x.kind==='REVERSAL'&&x.sourceId===entry.id)&&(entry.kind==='REFUND'||receiptRemaining(entry,entries)===entry.amountCents);}
export function collectionHref(id:string,returnTo:string){return '/pagamenti-garanzie?'+new URLSearchParams({bookingId:id,returnTo}).toString();}
