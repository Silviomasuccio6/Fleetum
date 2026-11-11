import {z} from "zod";

const text=z.string().trim().max(4000).nullable();
const cents=z.number().int().min(0).max(999999999).nullable();
export const rentalTermsSchema=z.object({
 version:z.literal(1),primaryDriverId:z.string().min(1).max(128).nullable(),
 additionalDriverIds:z.array(z.string().min(1).max(128)).max(1),
 depositCents:cents,damageDeductibleCents:cents,theftDeductibleCents:cents,
 paymentTerms:text,insuranceSummary:text,fuelPolicy:text,territory:text,assistance:text,
 cancellation:text,lateReturn:text,damageProcedure:text,
 annexes:z.array(z.string().trim().min(1).max(200)).max(12)
}).strict().superRefine((value,ctx)=>{
 const ids=[value.primaryDriverId,...value.additionalDriverIds].filter(Boolean);
 if(new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",path:["additionalDriverIds"],message:"Ogni conducente deve essere indicato una sola volta"});
});
export type RentalTerms=z.infer<typeof rentalTermsSchema>;
export const emptyRentalTerms=():RentalTerms=>({version:1,primaryDriverId:null,additionalDriverIds:[],depositCents:null,damageDeductibleCents:null,theftDeductibleCents:null,paymentTerms:null,insuranceSummary:null,fuelPolicy:null,territory:null,assistance:null,cancellation:null,lateReturn:null,damageProcedure:null,annexes:[]});
export const rentalTermLabels={depositCents:"Cauzione concordata",damageDeductibleCents:"Franchigia danni",theftDeductibleCents:"Franchigia furto",paymentTerms:"Modalità di pagamento",insuranceSummary:"Coperture ed esclusioni",fuelPolicy:"Carburante e ricarica",territory:"Territorio consentito",assistance:"Assistenza e sinistri",cancellation:"Annullamento e mancato ritiro",lateReturn:"Ritardo e proroga",damageProcedure:"Consegna, riconsegna e danni"} as const;
export function rentalTermsIssues(raw:unknown):string[]{
 const parsed=rentalTermsSchema.safeParse(raw);if(!parsed.success)return["Completa e salva le condizioni specifiche del noleggio"];
 const value=parsed.data,issues:string[]=[];if(!value.primaryDriverId)issues.push("Seleziona il conducente principale");
 for(const [key,label]of Object.entries(rentalTermLabels))if(value[key as keyof typeof rentalTermLabels]===null||value[key as keyof typeof rentalTermLabels]==="")issues.push(`${label}: da definire (indica zero se non prevista)`);
 return issues;
}
