import { httpClient } from "../../infrastructure/api/http-client";
export type CargosState="DRAFT"|"SENDING"|"ACCEPTED"|"REJECTED"|"UNKNOWN"|"UNAVAILABLE"|"MANUAL_CONFIRMED";
export type CargosReceipt={id:string;protocol:string;receiptDate:string;transactionId:string;kind:"API_ACCEPTED_RECEIPT"|"PORTAL_CONFIRMED";createdAt:string;sha256:string};
export type CargosEvent={id:string;type:string;message:string;createdAt:string;details:Record<string,unknown>|null};
export type CargosPreflight={history?:CargosEvent[];historyCursor?:string|null;receipts?:CargosReceipt[];canManageReceipts?:boolean;canReconcile?:boolean;sentSourceHash?:string|null;blockingReasons?:string[];manualConfirmedAt?:string|null;validation?:{status:string|null;checkedAt:string|null;current:boolean;errorCode:string|null};bookingId:string;contractId:string;code:string;customer:string;plate:string;sourceHash:string;status:CargosState;configured:boolean;canSend:boolean;sourceChanged:boolean;message:string|null;transactionId:string|null;acceptedAt:string|null;fields:Array<{key:string;label:string;width:number;required:boolean;kind:string;value:string;editable:boolean;issue:string|null}>};
export type CargosResult={status:CargosState;transactionId?:string;errorCode?:string;duplicate?:boolean};
export type CargosAgency={id:string;name:string;placeCode:string;address:string;phone:string};
export type CargosConfiguration={encryptionReady:boolean;enabled:boolean;credentialsPresent:boolean;agencies:Record<string,CargosAgency>};
export const contractCargosUseCases={
 check:(id:string,sourceHash:string)=>httpClient.post<CargosPreflight>(`/rental-bookings/${encodeURIComponent(id)}/cargos/check`,{sourceHash}),
 history:(id:string,cursor:string)=>httpClient.get<{events:CargosEvent[];cursor:string|null}>(`/rental-bookings/${encodeURIComponent(id)}/cargos/history?cursor=${encodeURIComponent(cursor)}`),
 receipt:(id:string,form:FormData,key:string)=>httpClient.post<CargosPreflight>(`/rental-bookings/${encodeURIComponent(id)}/cargos/receipts`,form,{headers:{"X-Idempotency-Key":key},suppressSuccessToast:true}),
 preflight:(id:string)=>httpClient.get<CargosPreflight>(`/rental-bookings/${encodeURIComponent(id)}/cargos`),
 saveDraft:(id:string,record:Record<string,string>)=>httpClient.patch<CargosPreflight>(`/rental-bookings/${encodeURIComponent(id)}/cargos/draft`,{record}),
 transmit:(id:string,sourceHash:string)=>httpClient.post<CargosResult>(`/rental-bookings/${encodeURIComponent(id)}/cargos/transmit`,{sourceHash}),
 configuration:()=>httpClient.get<CargosConfiguration>("/rental-bookings/cargos/configuration"),
 saveConfiguration:(input:{enabled:boolean;agencies:Record<string,CargosAgency>;credentials?:{username:string;password:string;apiKey:string}})=>httpClient.patch<CargosConfiguration>("/rental-bookings/cargos/configuration",input)
};

export function buildCargosReceiptForm(input:{sourceHash:string;transactionId:string;protocol:string;receiptDate:string;kind:"ARCHIVE"|"CONFIRM_PORTAL";verifiedOnPortal:boolean},file:File){
 if(!/^[a-f0-9]{64}$/.test(input.sourceHash)||!input.transactionId.trim()||input.transactionId.length>250||!input.protocol.trim()||input.protocol.length>100||/[\u0000-\u001f\u007f]/u.test(input.transactionId+input.protocol))throw new Error("Verifica riferimento di invio e protocollo della ricevuta");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.receiptDate)||Number.isNaN(Date.parse(input.receiptDate+"T00:00:00Z"))||new Date(input.receiptDate+"T00:00:00Z").toISOString().slice(0,10)!==input.receiptDate)throw new Error("Inserisci una data della ricevuta valida");
 if(!input.verifiedOnPortal)throw new Error("Conferma prima la verifica sul portale");
 if(file.size>2*1024*1024||file.type!=="application/pdf")throw new Error("Seleziona una ricevuta PDF di massimo 2 MB");
 const form=new FormData();for(const[key,value]of Object.entries(input))form.set(key,String(value));form.set("file",file);return form;
}
