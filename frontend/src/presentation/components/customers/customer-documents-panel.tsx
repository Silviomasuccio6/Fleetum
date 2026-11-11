import {useEffect,useId,useRef} from 'react';
import type {RentalCustomerProfile} from '../../../application/usecases/rental-bookings-usecases';
import {FileText} from 'lucide-react';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Label} from '../ui/label';
type Props={customer:RentalCustomerProfile|null;files:File[];saving:boolean;canWrite?:boolean;onFilesChange:(files:File[])=>void;onUpload:()=>void;onOpenAttachment:(id:string)=>void;onRemoveAttachment:(id:string)=>void};
const bytes=(n:number)=>!Number.isFinite(n)||n<0?'—':n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
export const CustomerDocumentsPanel=({customer,files,saving,canWrite=true,onFilesChange,onUpload,onOpenAttachment,onRemoveAttachment}:Props)=>{
 const id=useId(),input=useRef<HTMLInputElement>(null);useEffect(()=>{if(!files.length&&input.current)input.current.value=''},[files]);
 return <section className="customer-documents" aria-labelledby={`${id}-title`}><h3 id={`${id}-title`}>Documenti cliente</h3><p className="customer-hint">File presenti nell’anagrafica, distinti dai dati di patente e documento.</p>
 {canWrite?<div className="customer-upload"><Label htmlFor={`${id}-file`}>Carica allegati (PDF/JPG/PNG/WebP)</Label><Input ref={input} id={`${id}-file`} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={saving} onChange={e=>onFilesChange(Array.from(e.target.files??[]))}/>{files.length?<p className="customer-hint" role="status">File selezionati: {files.map(f=>f.name).join(' · ')}</p>:null}<Button variant="outline" disabled={!customer?.id||!files.length||saving} onClick={onUpload}>{saving?'Caricamento...':'Salva documenti'}</Button></div>:null}
 {!(customer?.attachments??[]).length?<p className="customer-empty">Nessun allegato cliente disponibile.</p>:<ul className="customer-document-list">{customer!.attachments!.map(a=><li key={a.id}><FileText aria-hidden="true" className="h-5 w-5"/><div><strong>{a.fileName}</strong><p className="customer-hint">{a.mimeType} · {bytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleString('it-IT')}</p></div><div className="customer-document-actions"><Button size="sm" variant="outline" disabled={saving} onClick={()=>onOpenAttachment(a.id)} aria-label={`Apri documento ${a.fileName}`}>Apri</Button>{canWrite?<Button size="sm" variant="outline" disabled={saving} className="customer-remove" onClick={()=>onRemoveAttachment(a.id)} aria-label={`Rimuovi documento ${a.fileName}`}>Rimuovi</Button>:null}</div></li>)}</ul>}</section>;
};
