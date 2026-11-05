export const parseTiers = (raw: string) => {
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return rows.map((row, idx) => {
    const cleaned = row.replace(/\s+/g, "");
    const [range, ratePart] = cleaned.includes(":") ? cleaned.split(":") : cleaned.split("=");
    if (!range || !ratePart) throw new Error(`Formato scaglione non valido alla riga ${idx + 1}. Usa 1-100:0.40`);

    const [fromRaw, toRaw] = range.split("-");
    const fromKm = Number(fromRaw);
    if (!Number.isFinite(fromKm) || fromKm < 1) throw new Error(`fromKm non valido alla riga ${idx + 1}`);

    const toKm = toRaw === "*" || toRaw === undefined ? null : Number(toRaw);
    if (toKm !== null && (!Number.isFinite(toKm) || toKm < fromKm)) {
      throw new Error(`toKm non valido alla riga ${idx + 1}`);
    }

    const ratePerKm = Number(ratePart.replace(",", "."));
    if (!Number.isFinite(ratePerKm) || ratePerKm < 0) {
      throw new Error(`ratePerKm non valido alla riga ${idx + 1}`);
    }

    return { fromKm, toKm, ratePerKm, sortOrder: idx };
  });
};

export function validatePricing(kind:'list'|'package'|'policy',input:object):Record<string,string>{
 const f=input as Record<string,any>,errors:Record<string,string>={};
 const maxName=kind==='list'?150:120;
 if(!f.name?.trim()||f.name.trim().length<2||f.name.trim().length>maxName)errors.name=`Inserisci un nome tra 2 e ${maxName} caratteri.`;
 const number=(key:string,min:number,max=Infinity,integer=false)=>{const value=Number(f[key]);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))errors[key]=integer?'Inserisci un numero intero valido.':'Inserisci un importo o una percentuale valida.'};
 if(kind==='list'){
  number('baseRateAmount',0);if(f.baseRateAmount==='')errors.baseRateAmount='Inserisci la tariffa base, anche se pari a zero.';
  number('vatRate',0,100);number('discountPercent',0,100);number('priority',0,10000,true);
  if(f.scope==='SITE'&&!f.siteId)errors.siteId='Seleziona una sede.';
  if(f.scope==='VEHICLE'&&!f.vehicleId)errors.vehicleId='Seleziona un veicolo.';
  if(f.scope==='VEHICLE_CATEGORY'&&!f.vehicleCategory?.trim())errors.vehicleCategory='Indica una categoria.';
  for(const key of ['validFrom','validTo'])if(f[key]){const d=new Date(`${f[key]}T12:00:00`);if(!/^\d{4}-\d{2}-\d{2}$/.test(f[key])||Number.isNaN(d.getTime())||d.getFullYear()!==Number(f[key].slice(0,4))||d.getMonth()+1!==Number(f[key].slice(5,7))||d.getDate()!==Number(f[key].slice(8,10)))errors[key]='Inserisci una data valida.';}
  if(f.validFrom&&f.validTo&&f.validTo<f.validFrom)errors.validTo='La data finale deve seguire quella iniziale.';
 }else{
  number('sortOrder',0,10000,true);
  if(kind==='package'&&f.type==='LIMITED')number('kmIncluded',1,Infinity,true);
  if(kind==='policy'){
   if(f.type==='FLAT')number('flatRatePerKm',0);
   else try{const tiers=parseTiers(f.tiersText);if(!tiers.length||tiers.some(t=>!Number.isInteger(t.fromKm)||(t.toKm!==null&&!Number.isInteger(t.toKm))))errors.tiersText='Indica scaglioni validi con chilometri interi.';}catch(e){errors.tiersText=(e as Error).message;}
  }
 }
 return errors;
}
