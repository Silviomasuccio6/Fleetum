import {useState} from "react";
import {safeNotificationText,useSnackbarStore} from "../../application/stores/snackbar-store";

// A finite popup is feedback, not the only record of an unresolved operation.
// Keep its explanation in the current page, never in another account or route.
export function useOperationIssue(){
 const context=useSnackbarStore(state=>state.context);
 const [record,setRecord]=useState<{scope:string;message:string}|null>(null);
 return {
  issue:record?.scope===context?record.message:null,
  remember:(message:string,scope:string)=>{if(scope===useSnackbarStore.getState().context)setRecord({scope,message:safeNotificationText(message)});},
  clear:()=>setRecord(null)
 };
}
