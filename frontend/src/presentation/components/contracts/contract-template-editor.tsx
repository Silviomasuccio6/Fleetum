import { CommerceField } from '../ui/commerce-workspace';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select } from '../ui/select';
import { Button } from '../ui/button';

export type ContractTemplateEditorValue={name:string;content:string;emailSubject:string;emailBody:string;companyName:string;companyAddress:string;companyVat:string;companyEmail:string;companyPhone:string;brandPrimary:string;brandAccent:string;brandFont:string};
const placeholders=['booking.code','booking.pickupAt','booking.returnAt','booking.pickupKm','booking.returnKm','booking.kmDriven','customer.firstName','customer.lastName','customer.type','customer.email','company.name','company.vat','company.taxCode','company.address','company.pec','company.sdi','company.rea','company.legalRepFullName','company.legalRepTaxCode','vehicle.plate','vehicle.brand','vehicle.model','pricing.expectedTotal'];
export function ContractTemplateEditor({value,onChange,busy,logoUrl,logoName,onUpload,onRemove,preview}:{value:ContractTemplateEditorValue;onChange:(patch:Partial<ContractTemplateEditorValue>)=>void;busy:boolean;logoUrl:string|null;logoName:string;onUpload:(file:File)=>void;onRemove:()=>void;preview:{content:string;emailSubject:string;emailBody:string}|null}){
 const field=(key:keyof ContractTemplateEditorValue,label:string,type='text')=><CommerceField id={`contract-template-${key}`} label={label}><Input type={type} value={value[key]} onChange={event=>onChange({[key]:event.target.value})}/></CommerceField>;
 return <div className="contract-template-editor"><fieldset className="commerce-form-fields" disabled={busy}>
  <section className="commerce-form-group"><h3>Identità del documento</h3><p className="commerce-hint">Aspetto e intestazione del PDF aziendale.</p>{field('name','Nome template')}
   <CommerceField id="contract-template-logo" label="Logo intestazione" hint="Il caricamento e la rimozione del logo vengono salvati subito."><Input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={event=>{const file=event.target.files?.[0];if(file)onUpload(file);event.target.value=''}}/></CommerceField>
   <div className="contract-template-logo"><span>{logoName||'Nessun logo caricato'}</span>{logoUrl?<><img src={logoUrl} alt="Logo contratto"/><Button variant="outline" onClick={onRemove}>Rimuovi logo</Button></>:null}</div>
   <div className="commerce-field-grid">{field('brandPrimary','Colore primario')}{field('brandAccent','Colore accento')}<CommerceField id="contract-template-brandFont" label="Font documento"><Select value={value.brandFont} onChange={event=>onChange({brandFont:event.target.value})}><option value="helvetica">Helvetica Modern</option><option value="times">Times Classic</option></Select></CommerceField></div>
  </section>
  <section className="commerce-form-group"><h3>Dati aziendali</h3><div className="commerce-field-grid">{field('companyName','Azienda')}{field('companyVat','Partita IVA')}{field('companyAddress','Indirizzo azienda')}{field('companyEmail','Email azienda','email')}{field('companyPhone','Telefono azienda')}</div></section>
  <section className="commerce-form-group"><h3>Email del contratto</h3>{field('emailSubject','Oggetto email default')}<CommerceField id="contract-template-emailBody" label="Body email default"><Textarea rows={5} value={value.emailBody} onChange={event=>onChange({emailBody:event.target.value})}/></CommerceField></section>
  <section className="commerce-form-group"><h3>Clausole del contratto</h3><CommerceField id="contract-template-content" label="Contenuto contratto"><Textarea rows={12} value={value.content} onChange={event=>onChange({content:event.target.value})}/></CommerceField></section>
 </fieldset>
 <details className="commerce-placeholder-list"><summary>Placeholder supportati</summary><div>{placeholders.map(key=><code key={key}>{'{{'+key+'}}'}</code>)}</div></details>
 {preview?<section className="contract-template-preview" aria-label="Anteprima compilata"><h3>Anteprima compilata</h3><p><strong>Oggetto:</strong> {preview.emailSubject}</p><pre>{preview.emailBody}</pre><pre>{preview.content}</pre></section>:<p className="commerce-hint">Seleziona una prenotazione e usa Anteprima compilata per vedere il testo con i dati inseriti.</p>}
 </div>;
}
