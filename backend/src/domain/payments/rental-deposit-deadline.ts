// Input is the authoritative Stripe retrieve response, never unverified webhook metadata.
export function captureBeforeFromIntent(intent:{id:string;latest_charge?:unknown}):Date|null{
 const charge=intent.latest_charge;if(!charge||typeof charge!=='object')return null;
 const value=charge as {id?:string;payment_intent?:unknown;payment_method_details?:{card?:{capture_before?:unknown}}};
 const id=typeof value.payment_intent==='string'?value.payment_intent:(value.payment_intent as {id?:string}|null)?.id;
 const seconds=value.payment_method_details?.card?.capture_before;
 if(!value.id||id!==intent.id||typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<=0)return null;
 const date=new Date(seconds*1000);return Number.isFinite(date.getTime())?date:null;
}
