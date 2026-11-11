import {httpClient} from "../../infrastructure/api/http-client";
export const conditionLabels={paymentTerms:"Modalità di pagamento",insuranceSummary:"Coperture ed esclusioni",fuelPolicy:"Carburante e ricarica",territory:"Territorio consentito",assistance:"Assistenza e sinistri",cancellation:"Annullamento e mancato ritiro",lateReturn:"Ritardo e proroga",damageProcedure:"Consegna, riconsegna e danni"} as const;
export const amountLabels={depositCents:"Cauzione concordata",damageDeductibleCents:"Franchigia danni",theftDeductibleCents:"Franchigia furto"} as const;
export type RentalTerms={version:1;primaryDriverId:string|null;additionalDriverIds:string[];annexes:string[]}&Record<keyof typeof conditionLabels,string|null>&Record<keyof typeof amountLabels,number|null>;
export type DriverOption={id:string;name:string};
export type RentalDetails={terms:RentalTerms;revision:number;frozen:boolean;drivers:DriverOption[];issues:string[]};
const path=(id:string)=>`/rental-bookings/${encodeURIComponent(id)}/contract/rental-details`;
export const contractRentalDetailsUseCases={
 read:(id:string)=>httpClient.get<RentalDetails>(path(id)),
 candidates:(id:string,search:string)=>httpClient.get<DriverOption[]>(path(id)+"/drivers?search="+encodeURIComponent(search)),
 save:(id:string,revision:number,terms:RentalTerms)=>httpClient.patch<RentalDetails>(path(id),{revision,terms})
};
export function parseContractCents(value:string):number|null{
 if(!value.trim())return null;
 if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))throw new Error("Usa un importo positivo con massimo due decimali, oppure zero se non previsto.");
 const[whole,fraction=""]=value.trim().replace(",",".").split(".");return Number(whole)*100+Number(fraction.padEnd(2,"0"));
}
