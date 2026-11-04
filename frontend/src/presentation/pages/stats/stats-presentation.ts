/** Presentation only: backend calculations and report parameters remain authoritative. */
export function validateReportPeriod(from:string,to:string):Record<string,string>{
 const errors:Record<string,string>={};
 const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(new Date(v+'T00:00:00').getTime())&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 if(!valid(from))errors.dateFrom='Inserisci una data iniziale valida.';
 if(!valid(to))errors.dateTo='Inserisci una data finale valida.';
 if(!Object.keys(errors).length&&from>to)errors.dateTo='La data finale deve essere successiva o uguale a quella iniziale.';
 return errors;
}
export function reportDelta(current:number,previous:number):number|null{
 if(!Number.isFinite(current)||!Number.isFinite(previous))return null;
 if(previous===0)return current===0?0:null;
 return(current-previous)/Math.abs(previous)*100;
}
export function saveReportBlob(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
