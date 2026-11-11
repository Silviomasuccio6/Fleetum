import {snackbar} from "./snackbar-store";

export const captureOperationContext=()=>snackbar.capture();

// Called only where a domain handler already records an actual result. The
// message is unchanged: queued, requested and verified are different outcomes.
export function publishOperationFeedback<T extends string|null>(
 update:(message:T)=>void,message:T,scope:string,tone:"success"|"info"="success"
){
 if(scope!==snackbar.capture())return;
 update(message);
 if(message)snackbar[tone](message,{scope});
}
