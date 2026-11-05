import {useEffect,useRef,useState,type RefObject} from 'react';
import {Link} from 'react-router-dom';
import {CalendarEvent,CalendarItem} from './calendar-types';
import {CommerceDrawer,CommerceField,CommerceNotice} from '../ui/commerce-workspace';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Textarea} from '../ui/textarea';
import {Select} from '../ui/select';
import {DiscardDialog} from '../operations/operations-workspace';
import type {PanelMotionHandle} from '../ui/panel-motion';
type Props={event:CalendarEvent|null;draftEvent?:CalendarEvent|null;anchorRect:DOMRect|null;containerRef:RefObject<HTMLDivElement>;calendars:CalendarItem[];onClose:()=>void;onCreate?:(draft:Partial<CalendarEvent>)=>Promise<CalendarEvent|null>;onUpdate:(id:CalendarEvent['id'],patch:Partial<CalendarEvent>)=>Promise<boolean>;onDelete:(id:CalendarEvent['id'])=>Promise<boolean>;canWrite?:boolean};
const editable=(e:CalendarEvent)=>({title:e.title,date:e.date,start:e.start,end:e.end,location:e.location??'',description:e.description??'',calendarId:e.calendarId,allDay:!!e.allDay});
export const EventPopup=({event,draftEvent=null,calendars,onClose,onCreate,onUpdate,onDelete,canWrite=true}:Props)=>{
 const source=event??draftEvent,creating=!!draftEvent&&!event;
 const[draft,setDraft]=useState<ReturnType<typeof editable>|null>(null),[editing,setEditing]=useState(false),[dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
 const lock=useRef(false),motion=useRef<PanelMotionHandle|null>(null),origin=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(!source){setDraft(null);return}origin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setDraft(editable(source));setEditing(creating);setDirty(false);setError('');setConfirmDelete(false)},[source?.id,creating]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 const finish=()=>{if(motion.current)motion.current.dismiss(onClose);else onClose()};
 const close=()=>{if(lock.current)return;if(dirty){setDiscard(true);return}finish()};
 if(!source||!draft)return null;
 const readonly=!canWrite||!!source.readonly||source.source==='stoppage';
 const change=(key:keyof typeof draft,value:any)=>{setDraft(old=>old?{...old,[key]:value}:old);setDirty(true)};
 const save=async()=>{if(readonly||lock.current)return;lock.current=true;setSaving(true);setError('');try{const result=creating?await onCreate?.(draft):await onUpdate(source.id,draft);if(result){setDirty(false);finish()}else setError('Salvataggio non riuscito. I dati inseriti sono conservati.')}catch(e){setError((e as Error).message)}finally{lock.current=false;setSaving(false)}};
 const remove=async()=>{if(readonly||lock.current)return;lock.current=true;setSaving(true);setError('');try{if(await onDelete(source.id)){setConfirmDelete(false);setDirty(false);finish()}else setError('Eliminazione non riuscita. Riprova.')}catch(e){setError((e as Error).message)}finally{lock.current=false;setSaving(false)}};
 return <><CommerceDrawer title={creating?'Nuovo evento':source.title} description={source.source==='stoppage'?'Fermo tecnico · dettagli e operazioni nella scheda del fermo':'Evento operativo · calendario Fleetum'} onClose={close} origin={origin.current} motionRef={motion} busy={saving} footer={<>{source.source==='stoppage'?<Link className="operations-file-link" to={'/fermi/'+encodeURIComponent(source.remoteId??String(source.id).replace(/^stoppage:/,''))}>Apri scheda fermo</Link>:readonly?<p className="operations-hint">Evento di sola lettura</p>:editing?<><Button variant="outline" disabled={saving} onClick={()=>{if(creating)close();else if(dirty)setDiscard(true);else setEditing(false)}}>Annulla</Button><Button type="submit" form="calendar-event-form" disabled={saving}>{saving?'Salvataggio...':creating?'Crea evento':'Salva evento'}</Button></>:<><Button variant="outline" onClick={()=>setEditing(true)}>Modifica evento</Button><Button variant="destructive" onClick={()=>setConfirmDelete(true)}>Elimina evento</Button></>}</>}>
 {error?<CommerceNotice>{error}</CommerceNotice>:null}
 {editing&&!readonly?<form id="calendar-event-form" className="operations-form" onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={saving}>
 <CommerceField id="calendar-event-title" label="Titolo evento"><Input required value={draft.title} onChange={e=>change('title',e.target.value)}/></CommerceField>
 <CommerceField id="calendar-event-date" label="Data evento"><Input required type="date" value={draft.date} onChange={e=>change('date',e.target.value)}/></CommerceField>
 <label className="operations-check"><input type="checkbox" checked={draft.allDay} onChange={e=>change('allDay',e.target.checked)}/>Intera giornata</label>
 {!draft.allDay?<div className="operations-form-pair"><CommerceField id="calendar-event-start" label="Ora inizio"><Input required type="time" value={draft.start} onChange={e=>change('start',e.target.value)}/></CommerceField><CommerceField id="calendar-event-end" label="Ora fine"><Input required type="time" value={draft.end} onChange={e=>change('end',e.target.value)}/></CommerceField></div>:null}
 <CommerceField id="calendar-event-location" label="Luogo"><Input value={draft.location} onChange={e=>change('location',e.target.value)}/></CommerceField>
 <CommerceField id="calendar-event-calendar" label="Calendario"><Select value={draft.calendarId} onChange={e=>change('calendarId',Number(e.target.value))}>{calendars.map(c=><option translate="no" key={c.id} value={c.id}>{c.name}</option>)}</Select></CommerceField>
 <CommerceField id="calendar-event-notes" label="Note operative"><Textarea rows={5} value={draft.description} onChange={e=>change('description',e.target.value)}/></CommerceField>
 </fieldset></form>:<dl className="operations-facts"><div><dt>Data</dt><dd>{draft.date}</dd></div><div><dt>Orario</dt><dd>{draft.allDay?'Intera giornata':draft.start+' – '+draft.end}</dd></div><div><dt>Luogo</dt><dd>{draft.location||'Non specificato'}</dd></div><div><dt>Calendario</dt><dd>{calendars.find(c=>c.id===draft.calendarId)?.name||'—'}</dd></div><div><dt>Note operative</dt><dd>{draft.description||'Nessuna nota disponibile.'}</dd></div></dl>}
 </CommerceDrawer>{discard?<DiscardDialog onContinue={()=>setDiscard(false)} onDiscard={()=>{setDiscard(false);setDirty(false);finish()}}/>:null}{confirmDelete?<CommerceDrawer compact level={150} title="Elimina evento" busy={saving} onClose={()=>setConfirmDelete(false)} footer={<><Button variant="outline" disabled={saving} onClick={()=>setConfirmDelete(false)}>Annulla</Button><Button variant="destructive" disabled={saving} onClick={()=>void remove()}>Conferma eliminazione</Button></>}><p>Vuoi eliminare questo evento dal calendario Fleetum?</p>{error?<CommerceNotice>{error}</CommerceNotice>:null}</CommerceDrawer>:null}</>;
};
