import {type FormEvent, useCallback, useEffect, useId, useRef, useState} from 'react';
import {Building2, MapPin, Plus, RefreshCw, Search} from 'lucide-react';
import {useAuthStore} from '../../../application/stores/auth-store';
import {Button} from '../../components/ui/button';
import {Input} from '../../components/ui/input';
import {Textarea} from '../../components/ui/textarea';
import {CommerceCollection,CommerceDrawer,CommerceField,CommerceNotice} from '../../components/ui/commerce-workspace';
import {WorkspacePageHeader} from '../../components/ui/workspace-ui';
import {DiscardDialog} from '../../components/operations/operations-workspace';
import type {PanelMotionHandle} from '../../components/ui/panel-motion';
import {createCrudListQueryCursor,createLatestRequestGuard,createSubmissionGuard} from './generic-crud-guards';

type Row={id:string;[key:string]:any};
type Field={key:string;label:string;type?:'text'|'email'|'number';placeholder?:string};
type Props={scope:'sites'|'workshops';title:string;createLabel?:string;createTitleLabel?:string;
 list:(params:Record<string,string|number|undefined>)=>Promise<{data:Row[];total:number}>;
 create:(input:Record<string,unknown>)=>Promise<unknown>;update:(id:string,input:Record<string,unknown>)=>Promise<unknown>;remove:(id:string)=>Promise<void>;fields:Field[]};
const PAGE_SIZE=20;
const valuesFor=(fields:Field[],row?:Row|null)=>Object.fromEntries(fields.map(f=>[f.key,String(row?.[f.key]??'')]));
export const GenericCrudPage=({scope,title,createLabel='Nuovo record',createTitleLabel,list,create,update,remove,fields}:Props)=>{
 const user=useAuthStore(s=>s.user),identity=`${user?.tenantId}:${user?.id}:${scope}`;
 const has=(permission:string)=>Boolean(user?.permissions?.some(p=>p==='*'||p===permission));
 const canRead=has(scope+':read'),canWrite=has(scope+':write');
 const [rows,setRows]=useState<Row[]>([]),[total,setTotal]=useState(0),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState('');
 const [searchInput,setSearchInput]=useState(''),[searchQuery,setSearchQuery]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [editor,setEditor]=useState<{row:Row|null;initial:Record<string,string>}|null>(null),[values,setValues]=useState<Record<string,string>>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [formError,setFormError]=useState(''),[discard,setDiscard]=useState(false),[deleting,setDeleting]=useState<Row|null>(null),[deleteError,setDeleteError]=useState('');
 const origin=useRef<HTMLElement|null>(null),motion=useRef<PanelMotionHandle|null>(null),formId=useId(),summary=useRef<HTMLDivElement>(null);
 const identityRef=useRef(identity);identityRef.current=identity;
 const loadedIdentity=useRef('');
 const latestRequestGuard=useRef(createLatestRequestGuard()).current,submissionGuard=useRef(createSubmissionGuard()).current,listRef=useRef(list);listRef.current=list;
 const cursor=useRef(createCrudListQueryCursor({page,search:searchQuery})).current;cursor.update({page,search:searchQuery});
 const totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 const load=useCallback(async(targetPage:number,targetSearch:string)=>{
  if(!canRead)return;
  const request=latestRequestGuard.begin();setLoading(true);setError(null);
  try{const result=await listRef.current({page:targetPage,pageSize:PAGE_SIZE,search:targetSearch||undefined});if(!latestRequestGuard.isCurrent(request)||identity!==identityRef.current)return;
   const count=result.total??result.data.length,last=Math.max(1,Math.ceil(count/PAGE_SIZE));if(targetPage>last){setPage(last);return}
   loadedIdentity.current=identity;setRows(result.data);setTotal(count);
  }catch(e){if(latestRequestGuard.isCurrent(request))setError((e as Error).message)}finally{if(latestRequestGuard.isCurrent(request))setLoading(false)}
 },[canRead,identity,latestRequestGuard]);
 const reload=()=>{const q=cursor.read();return load(q.page,q.search)};
 useEffect(()=>{const timer=window.setTimeout(()=>{setPage(1);setSearchQuery(searchInput.trim())},300);return()=>window.clearTimeout(timer)},[searchInput]);
 useEffect(()=>{setEditor(null);setDeleting(null);setDiscard(false);setSuccess('')},[identity,canRead,canWrite]);
 useEffect(()=>{setRows([]);setTotal(0)},[identity,canRead]);
 useEffect(()=>{void load(page,searchQuery);return()=>latestRequestGuard.invalidate()},[load,page,searchQuery,latestRequestGuard]);
 const close=()=>{const done=()=>{setEditor(null);setDiscard(false)};motion.current?motion.current.dismiss(done):done()};
 const dirty=editor&&JSON.stringify(values)!==JSON.stringify(editor.initial);
 const requestClose=()=>{if(saving)return;if(dirty&&canWrite)setDiscard(true);else close()};
 const open=(trigger:HTMLElement,row:Row|null)=>{origin.current=trigger;const initial=valuesFor(fields,row);setValues(initial);setEditor({row,initial});setFieldErrors({});setFormError('')};
 const onSubmit=async(event:FormEvent)=>{
  event.preventDefault();if(!canRead||!canWrite||!editor||!submissionGuard.tryAcquire())return;
  const errors:Record<string,string>={};for(const f of fields){const v=values[f.key]?.trim()??'';
   if((f.key==='name'||(scope==='sites'&&['address','city'].includes(f.key)))&&v.length<2)errors[f.key]='Inserisci almeno 2 caratteri.';
   if(f.type==='email'&&v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))errors[f.key]='Inserisci un indirizzo email valido.';
  }
  setFieldErrors(errors);setFormError('');if(Object.keys(errors).length){submissionGuard.release();window.setTimeout(()=>summary.current?.focus(),0);return}
  const payload:Record<string,unknown>={};for(const f of fields){const v=values[f.key]??'';if(editor.row||v!=='')payload[f.key]=v}
  const context=identity;setSaving(true);setSuccess('');
  try{if(editor.row)await update(editor.row.id,payload);else await create(payload);if(context!==identityRef.current)return;setEditor(null);setSuccess('Anagrafica salvata.');await reload()}
  catch(e){if(context===identityRef.current){setFormError((e as Error).message);window.setTimeout(()=>summary.current?.focus(),0)}}finally{submissionGuard.release();setSaving(false)}
 };
 const onDelete=async()=>{if(!canRead||!canWrite||!deleting||!submissionGuard.tryAcquire())return;const context=identity;setSaving(true);setDeleteError('');setSuccess('');try{await remove(deleting.id);if(context!==identityRef.current)return;setDeleting(null);setSuccess('Anagrafica rimossa dall’elenco.');await reload()}catch(e){if(context===identityRef.current)setDeleteError((e as Error).message)}finally{submissionGuard.release();setSaving(false)}};
 const visible=loadedIdentity.current===identity?rows:[];
 const isSite=scope==='sites',Icon=isSite?MapPin:Building2;
 const group=(keys:string[],label:string)=>{const items=fields.filter(f=>keys.includes(f.key));return items.length?<fieldset className="commerce-form-group"><legend>{label}</legend><div className="commerce-field-grid">{items.map(f=><CommerceField key={f.key} id={formId+'-'+f.key} label={f.label} error={fieldErrors[f.key]}><Input name={f.key} type={f.type??'text'} value={values[f.key]??''} placeholder={f.placeholder} required={f.key==='name'||(isSite&&['address','city'].includes(f.key))} disabled={!canWrite||saving} onChange={e=>setValues(old=>({...old,[f.key]:e.target.value}))}/></CommerceField>)}</div></fieldset>:null};
 return <section className="directory-workspace commerce-workspace">
  <WorkspacePageHeader eyebrow="ANAGRAFICHE OPERATIVE" title={title} description={isSite?'Organizza le sedi della flotta e ritrova indirizzi e referenti.':'La rete di assistenza della flotta, con contatti e riferimenti sempre disponibili.'} actions={canRead&&canWrite?<Button onClick={e=>open(e.currentTarget,null)} disabled={saving}><Plus aria-hidden="true" className="h-4 w-4"/>{createLabel}</Button>:null}/>
  {!canRead?<CommerceNotice>Il tuo ruolo non consente l’accesso a questa anagrafica.</CommerceNotice>:<>
   {success?<CommerceNotice tone="success">{success}</CommerceNotice>:null}
   <div className="commerce-panel"><header className="commerce-panel-header"><div><h2>{isSite?'Sedi della flotta':'Officine di riferimento'} <span>{!loading&&!error?total:'—'}</span></h2><p>{isSite?'Le sedi sono associate ai veicoli e ai fermi.':'Le officine sono associate ai fermi; le manutenzioni conservano il nome registrato.'}</p></div>{!canWrite?<span className="directory-readonly">Sola lettura</span>:null}</header>
    <div className="directory-toolbar"><div><label htmlFor={formId+'-search'}>Cerca per nome o città</label><div className="directory-search"><Search aria-hidden="true" className="h-4 w-4"/><Input id={formId+'-search'} value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder={isSite?'Nome sede o città':'Nome officina o città'}/></div></div><Button variant="outline" onClick={()=>void reload()} disabled={loading||saving}><RefreshCw aria-hidden="true" className="h-4 w-4"/>Aggiorna</Button></div>
    {error?<div className="directory-state"><CommerceNotice>{error}</CommerceNotice><Button variant="outline" onClick={()=>void reload()}>Riprova</Button></div>:loading?<div className="directory-state" role="status">Caricamento anagrafiche…</div>:visible.length?<CommerceCollection rows={visible} caption={title} selectedId={editor?.row?.id} columns={[
     {key:'name',label:isSite?'Sede':'Officina',render:row=><button className="directory-name" onClick={e=>open(e.currentTarget,row)}><Icon aria-hidden="true"/><span><strong data-panel-origin-title translate="no">{row.name}</strong><small translate={row.city?"no":"yes"}>{row.city||'Città non indicata'}</small></span></button>},
     {key:'address',label:'Indirizzo',render:row=><span translate="no">{row.address||'—'}</span>},
     {key:'contact',label:'Referente e contatti',render:row=><div className="directory-contact" translate="no"><span>{row.contactName||'—'}</span>{row.email?<span>{row.email}</span>:null}{row.phone?<span>{row.phone}</span>:null}{row.whatsapp?<small>WhatsApp · {row.whatsapp}</small>:null}</div>},
     {key:'actions',label:'Azioni',render:row=><div className="directory-actions"><Button variant="outline" onClick={e=>open(e.currentTarget,row)} aria-label={(canWrite?'Modifica ':'Apri anagrafica ')+row.name}>{canWrite?'Modifica':'Apri scheda'}</Button>{canWrite?<Button variant="ghost" disabled={saving} onClick={()=>{setDeleting({...row});setDeleteError('')}} aria-label={'Rimuovi anagrafica '+row.name}>Rimuovi</Button>:null}</div>}
    ]}/>:<div className="directory-state"><Icon aria-hidden="true"/><h3>Nessun risultato</h3><p>{searchQuery?'Prova un altro nome o una città.':'Aggiungi la prima anagrafica per iniziare.'}</p>{searchInput?<Button variant="outline" onClick={()=>setSearchInput('')}>Azzera ricerca</Button>:null}</div>}
    <footer className="directory-pagination"><p>{!loading&&!error?`${visible.length} di ${total}`:'—'}</p><nav aria-label="Pagine anagrafiche"><Button variant="outline" disabled={page<=1||loading||saving} onClick={()=>setPage(x=>x-1)}>Precedente</Button><span>{page} / {totalPages}</span><Button variant="outline" disabled={page>=totalPages||loading||saving} onClick={()=>setPage(x=>x+1)}>Successiva</Button></nav></footer>
   </div>
  </>}
  {editor&&canRead?<CommerceDrawer translateTitle={!editor.row} title={editor.row?.name||(createTitleLabel??createLabel)} description={editor.row?'Dettagli, recapiti e note operative.':'I campi contrassegnati sono obbligatori.'} origin={origin.current} motionRef={motion} busy={saving} onClose={requestClose} footer={<><Button variant="outline" onClick={requestClose} disabled={saving}>{canWrite?'Annulla':'Chiudi'}</Button>{canWrite?<Button type="submit" form={formId} disabled={saving} aria-busy={saving}>{saving?'Salvataggio…':'Salva anagrafica'}</Button>:null}</>}>
   <form id={formId} onSubmit={onSubmit} noValidate>
    {formError||Object.keys(fieldErrors).length?<div ref={summary} tabIndex={-1} role="alert" className="commerce-notice commerce-error"><p>{formError||'Controlla i campi indicati.'}</p>{Object.entries(fieldErrors).map(([key,value])=><p key={key}><a href={'#'+formId+'-'+key} onClick={e=>{e.preventDefault();document.getElementById(formId+'-'+key)?.focus()}}>{fields.find(f=>f.key===key)?.label}: {value}</a></p>)}</div>:null}
    {group(['name','address','city'],'Identità e posizione')}{group(['contactName','email','phone','whatsapp'],'Referente e contatti')}
    <CommerceField id={formId+'-notes'} label="Note"><Textarea name="notes" rows={5} value={values.notes??''} disabled={!canWrite||saving} onChange={e=>setValues(old=>({...old,notes:e.target.value}))}/></CommerceField>
   </form>
  </CommerceDrawer>:null}
  {discard?<DiscardDialog onContinue={()=>setDiscard(false)} onDiscard={close}/>:null}
  {deleting&&canRead&&canWrite?<CommerceDrawer compact title="Rimuovi anagrafica" busy={saving} onClose={()=>setDeleting(null)} footer={<><Button variant="outline" disabled={saving} onClick={()=>setDeleting(null)}>Annulla</Button><Button variant="destructive" disabled={saving} aria-busy={saving} onClick={()=>void onDelete()}>Conferma rimozione</Button></>}><p><strong translate="no">{deleting.name}</strong></p><p>La scheda verrà rimossa dagli elenchi. I record già associati non vengono cancellati.</p>{deleteError?<CommerceNotice>{deleteError}</CommerceNotice>:null}</CommerceDrawer>:null}
 </section>;
};
