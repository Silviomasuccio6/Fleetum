// Wire layout: CEN Ca.R.G.O.S. API manual Rev.01, 06/02/2024, pp.15–18.
// Keep the original identity intact: invalid values are reported, never truncated.
export type CargosField = {key:string;label:string;width:number;required:boolean;kind:"text"|"name"|"plate"|"code"|"digit"|"phone"|"date"|"dateTime"};
const f=(key:string,label:string,width:number,required=true,kind:CargosField["kind"]="text"):CargosField=>({key,label,width,required,kind});
export const CARGOS_FIELDS:CargosField[]=[
 f("CONTRATTO_ID","Riferimento contratto",50),f("CONTRATTO_DATA","Data stipula",16,true,"dateTime"),f("CONTRATTO_TIPOP","Codice pagamento",1,true,"digit"),
 f("CONTRATTO_CHECKOUT_DATA","Data ritiro",16,true,"dateTime"),f("CONTRATTO_CHECKOUT_LUOGO_COD","Codice luogo ritiro",9,true,"code"),f("CONTRATTO_CHECKOUT_INDIRIZZO","Indirizzo ritiro",150),
 f("CONTRATTO_CHECKIN_DATA","Data restituzione",16,true,"dateTime"),f("CONTRATTO_CHECKIN_LUOGO_COD","Codice luogo restituzione",9,true,"code"),f("CONTRATTO_CHECKIN_INDIRIZZO","Indirizzo restituzione",150),
 f("OPERATORE_ID","Identificativo operatore",50),f("AGENZIA_ID","Codice agenzia",30),f("AGENZIA_NOME","Denominazione agenzia",70),f("AGENZIA_LUOGO_COD","Codice luogo agenzia",9,true,"code"),f("AGENZIA_INDIRIZZO","Indirizzo agenzia",150),f("AGENZIA_RECAPITO_TEL","Telefono agenzia",20,true,"phone"),
 f("VEICOLO_TIPO","Codice tipo veicolo",1,true,"digit"),f("VEICOLO_MARCA","Marca",50),f("VEICOLO_MODELLO","Modello",100),f("VEICOLO_TARGA","Targa",15,true,"plate"),f("VEICOLO_COLORE","Colore",50,false,"name"),f("VEICOLO_GPS","GPS",1,false,"digit"),f("VEICOLO_BLOCCOM","Blocco motore",1,false,"digit"),
 f("CONDUCENTE_CONTRAENTE_COGNOME","Cognome contraente/conducente",50,true,"name"),f("CONDUCENTE_CONTRAENTE_NOME","Nome contraente/conducente",30,true,"name"),f("CONDUCENTE_CONTRAENTE_NASCITA_DATA","Data nascita",10,true,"date"),f("CONDUCENTE_CONTRAENTE_NASCITA_LUOGO_COD","Codice luogo nascita",9,true,"code"),f("CONDUCENTE_CONTRAENTE_CITTADINANZA_COD","Codice cittadinanza",9,true,"code"),f("CONDUCENTE_CONTRAENTE_RESIDENZA_LUOGO_COD","Codice luogo residenza",9,false,"code"),f("CONDUCENTE_CONTRAENTE_RESIDENZA_INDIRIZZO","Indirizzo residenza",150,false),f("CONDUCENTE_CONTRAENTE_DOCIDE_TIPO_COD","Codice tipo documento",5),f("CONDUCENTE_CONTRAENTE_DOCIDE_NUMERO","Numero documento",20),f("CONDUCENTE_CONTRAENTE_DOCIDE_LUOGORIL_COD","Codice rilascio documento",9,true,"code"),f("CONDUCENTE_CONTRAENTE_PATENTE_NUMERO","Numero patente",20),f("CONDUCENTE_CONTRAENTE_PATENTE_LUOGORIL_COD","Codice rilascio patente",9,true,"code"),f("CONDUCENTE_CONTRAENTE_RECAPITO","Telefono conducente",20,false,"phone"),
 f("CONDUCENTE2_COGNOME","Cognome secondo conducente",50,false,"name"),f("CONDUCENTE2_NOME","Nome secondo conducente",30,false,"name"),f("CONDUCENTE2_NASCITA_DATA","Data nascita secondo conducente",10,false,"date"),f("CONDUCENTE2_NASCITA_LUOGO_COD","Codice luogo nascita secondo conducente",9,false,"code"),f("CONDUCENTE2_CITTADINANZA_COD","Codice cittadinanza secondo conducente",9,false,"code"),f("CONDUCENTE2_DOCIDE_TIPO_COD","Codice documento secondo conducente",5,false),f("CONDUCENTE2_DOCIDE_NUMERO","Numero documento secondo conducente",20,false),f("CONDUCENTE2_DOCIDE_LUOGORIL_COD","Codice rilascio documento secondo conducente",9,false,"code"),f("CONDUCENTE2_PATENTE_NUMERO","Patente secondo conducente",20,false),f("CONDUCENTE2_PATENTE_LUOGORIL_COD","Codice rilascio patente secondo conducente",9,false,"code"),f("CONDUCENTE2_RECAPITO","Telefono secondo conducente",20,false,"phone")
];
const validDate=(value:string,time:boolean)=>{
 const match=/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value);if(!match||Boolean(match[4])!==time)return false;
 const [,d,m,y,h="0",minute="0"]=match;const date=new Date(Date.UTC(+y,+m-1,+d));return +y>=1900&&+y<=2200&&date.getUTCFullYear()===+y&&date.getUTCMonth()===+m-1&&date.getUTCDate()===+d&&+h<24&&+minute<60;
};
export const cargosFieldIssue=(field:CargosField,value:string):string|null=>{
 if(!value)return field.required?"Dato obbligatorio":null;
 if(value.length>field.width)return `Massimo ${field.width} caratteri`;
 if(field.key.endsWith("_INDIRIZZO")&&value.length<4)return "Indirizzo di almeno 4 caratteri";
 if(/[\u0000-\u001f\u007f]/u.test(value))return "Caratteri di controllo non ammessi";
 if(field.kind==="code"&&!/^\d{9}$/.test(value))return "Usa il codice di 9 cifre della tabella ufficiale";
 if(field.kind==="digit"&&!/^\d$/.test(value))return "Usa il codice di una cifra della tabella ufficiale";
 if(field.kind==="phone"&&!/^\d{4,20}$/.test(value))return "Inserisci da 4 a 20 cifre";
 if(field.kind==="name"&&!/^[a-zàèìòùäöüß' ]+$/iu.test(value))return "Verifica i caratteri ammessi dal tracciato CARGOS";
 if(field.kind==="plate"&&!/^[a-z0-9. -]{4,15}$/iu.test(value))return "Verifica la targa nel formato CARGOS";
 if((field.kind==="date"||field.kind==="dateTime")&&!validDate(value,field.kind==="dateTime"))return "Data non valida nel formato richiesto";
 return null;
};
export const cargosRecordIssues=(record:Record<string,string>):Record<string,string>=>{
 const issues:Record<string,string>={};for(const field of CARGOS_FIELDS){const issue=cargosFieldIssue(field,(record[field.key]??"").normalize("NFC").trim());if(issue)issues[field.key]=issue;}
 const second=CARGOS_FIELDS.filter(field=>field.key.startsWith("CONDUCENTE2_"));
 if(second.some(field=>record[field.key]?.trim()))for(const field of second)if(!record[field.key]?.trim())issues[field.key]="Dati incompleti del secondo conducente";
 if(record.CONDUCENTE_CONTRAENTE_RESIDENZA_LUOGO_COD?.trim()&&!record.CONDUCENTE_CONTRAENTE_RESIDENZA_INDIRIZZO?.trim())issues.CONDUCENTE_CONTRAENTE_RESIDENZA_INDIRIZZO="Indirizzo residenza obbligatorio con il luogo";
 return issues;
};
export const serializeCargosRecord=(record:Record<string,string>):string=>{
 const errors=Object.entries(cargosRecordIssues(record));if(errors.length)throw new Error(`${errors[0][0]}: ${errors[0][1]}`);
 return CARGOS_FIELDS.map(field=>(record[field.key]??"").normalize("NFC").trim().padEnd(field.width," ")).join("");
};
