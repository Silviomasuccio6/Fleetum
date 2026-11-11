import {scopedFetch} from "../../infrastructure/api/scoped-fetch";
import {httpClient,postPrivatePdf} from "../../infrastructure/api/http-client";
import {getApiBaseUrl} from "../../infrastructure/api/api-base-url";
export type SigningView={id:string;version:number;status:"PENDING"|"SIGNED"|"REVOKED"|"EXPIRED";documentTitle:string;documentSha256:string;bookingCode:string;issuerName:string;signerName:string;method?:"EMAIL_OTP"|"IN_PERSON";signedDocumentSha256?:string|null;maskedEmail:string|null;expiresAt:string;signedAt:string|null;inviteDelivery:string|null;otpDelivery:string|null;copyDelivery:string|null;otpExpiresAt:string|null;resendAfter:string|null;codeSendsRemaining:number;attemptsRemaining:number;consent:string;consentVersion:string;sourceChanged?:boolean};
export type SigningStatus={history?:Array<{id:string;version:number;method:string;signedAt:string|null}>;documentRevision?:number;configured:boolean;emailConfigured?:boolean;issuedAt?:string|null;recipient:string;request:SigningView|null};
const path=(id:string)=>`/rental-bookings/${encodeURIComponent(id)}/contract/signing`;
export const contractSigningUseCases={
 prepareInPerson:(id:string,key:string)=>httpClient.post<SigningView>(path(id)+"/in-person",{},{headers:{"X-Idempotency-Key":key},suppressSuccessToast:true}),
 inPersonDocument:(id:string,requestId:string)=>postPrivatePdf(path(id)+"/in-person/document",{requestId}),
 confirmInPerson:(id:string,body:{requestId:string;documentHash:string;confirmationId:string;signatureDataUrl:string;consent:true;consentVersion:"in-person-v1"})=>httpClient.post<SigningView>(path(id)+"/in-person/confirm",body,{suppressSuccessToast:true}),
 startRevision:(id:string,expectedRevision:number)=>httpClient.post(path(id).replace('/signing','/revision'),{expectedRevision},{suppressSuccessToast:true}),
 version:async(id:string,requestId:string)=>{const response=await scopedFetch(`${getApiBaseUrl()}${path(id)}/versions/${encodeURIComponent(requestId)}/pdf`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('Versione conservata non disponibile');return response.blob();},
 evidence:async(id:string)=>{const response=await scopedFetch(`${getApiBaseUrl()}${path(id)}/evidence.pdf`,{credentials:"include",cache:"no-store"});if(!response.ok)throw new Error("Registrazione della firma non disponibile");return response.blob();},
 status:(id:string)=>httpClient.get<SigningStatus>(path(id)),
 invite:(id:string,recipient:string,key:string)=>httpClient.post<SigningView>(path(id),{recipient},{headers:{"X-Idempotency-Key":key},suppressSuccessToast:true}),
 revoke:(id:string)=>httpClient.post<SigningStatus>(path(id)+"/revoke",{},{suppressSuccessToast:true})
};
/** Capability goes only in the JSON body; this client never refreshes a staff session. */
export async function publicSigningRequest(action:"resolve"|"document"|"otp"|"confirm"|"evidence",token:string,body:Record<string,unknown>={},signal?:AbortSignal){
 const response=await fetch(`${getApiBaseUrl()}/contracts/signing/${action}`,{method:"POST",credentials:"include",cache:"no-store",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,...body}),signal});
 if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(typeof error?.message==="string"?error.message:"Operazione non riuscita. Riprova tra poco.");}
 return response;
}
