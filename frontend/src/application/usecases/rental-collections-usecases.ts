import {httpClient} from '../../infrastructure/api/http-client';
export type CollectionState='UNKNOWN'|'DUE'|'PARTIAL'|'PAID'|'FREE'|'CREDIT';
export type CollectionMethod='CASH'|'BANK_TRANSFER'|'EXTERNAL_POS';
export type CollectionEntry={id:string;kind:'RECEIPT'|'REFUND'|'REVERSAL';method:CollectionMethod;amountCents:number;currency:string;occurredAt:string;reference:string;reason:string;sourceId:string|null;createdAt:string;createdBy:{id:string;firstName:string;lastName:string}};
export type CollectionBooking={id:string;code:string;customerId:string|null;customerName:string;pickupAt:string;returnAt:string;siteId:string|null;siteName:string|null;plate:string;brand:string;model:string;archived:boolean;agreedCents:number|null;receivedCents:number;outstandingCents:number|null;creditCents:number;authorizedGuaranteeCents:number;state:CollectionState};
export type CollectionWorkspace={data:CollectionBooking[];total:number;page:number;pageSize:number;summary:{agreedCents:number;receivedCents:number;outstandingCents:number;creditCents:number;authorizedGuaranteeCents:number;unknownTotalCount:number}};
export type CollectionDetail={booking:CollectionBooking;entries:CollectionEntry[];pricing:{id:string;priceListName:string|null;pricePackageName:string|null;unitRateAmount:string|null;unit:string|null;discountPercent:number|null;recordedAt:string;discountProvenance:{status:string;actor:null;reason:null}}|null;onlineCollection:{enabled:false;reason:string}};
export type CollectionInput={amountCents?:number;method?:CollectionMethod;occurredAt:string;reference:string;reason:string};
export const rentalCollectionsUseCases={
 list:(query:Record<string,string|number|undefined>)=>httpClient.get<CollectionWorkspace>('/rental-payments/workspace',query),
 detail:(id:string)=>httpClient.get<CollectionDetail>(`/rental-payments/bookings/${encodeURIComponent(id)}/collections`),
 record:(bookingId:string,kind:CollectionEntry['kind'],input:CollectionInput,key:string,sourceId?:string)=>httpClient.post<{id:string;replayed:boolean}>(`/rental-payments/bookings/${encodeURIComponent(bookingId)}/collections`+(kind==='RECEIPT'?'':`/${encodeURIComponent(sourceId!)}/${kind==='REFUND'?'refund':'reverse'}`),input,{headers:{'Idempotency-Key':key}})
};
