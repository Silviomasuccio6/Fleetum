import {Check,CircleAlert} from "lucide-react";
import { cloneElement, useId, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { Label } from './label';
import { useDialogFocus } from '../../hooks/use-dialog-focus';
import { usePanelMotion } from '../../hooks/use-panel-motion';
import type { PanelMotionHandle } from './panel-motion';

export function CommerceDrawer({title,description,onClose,children,footer,origin=null,motionRef,compact=false,busy=false,level=90,translateTitle=true,translateDescription=true}:{title:string;translateTitle?:boolean;translateDescription?:boolean;description?:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;origin?:HTMLElement|null;motionRef?:RefObject<PanelMotionHandle|null>;compact?:boolean;busy?:boolean;level?:number}){
 const ref=useRef<HTMLElement>(null),frame=useRef<HTMLDivElement>(null),id=useId();
 const close=()=>{if(!busy)onClose()};
 usePanelMotion(ref,frame,origin,!compact,id,motionRef);useDialogFocus(true,ref,close);
 return <div className="commerce-overlay" style={{zIndex:level}}><div className="commerce-scrim" aria-hidden="true" onClick={close}/><section ref={ref} className={`commerce-drawer${compact?' commerce-drawer-compact':''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} aria-busy={busy}>
  <div className="commerce-drawer-frame" ref={frame}><header className="commerce-drawer-header"><div><p data-panel-eyebrow className="commerce-eyebrow">FLEETUM</p><h2 id={id} data-panel-title translate={translateTitle?"yes":"no"}>{title}</h2>{description?<p translate={translateDescription?"yes":"no"}>{description}</p>:null}</div><Button data-panel-close variant="ghost" size="icon" aria-label="Chiudi pannello" onClick={close} disabled={busy}><X aria-hidden="true" className="h-5 w-5"/></Button></header>
  <div data-panel-content className="commerce-drawer-content">{children}</div>{footer?<footer data-panel-footer className="commerce-drawer-footer">{footer}</footer>:null}</div>
 </section></div>;
}
export function CommerceField({id,label,error,children,hint}:{id:string;label:string;error?:string;children:ReactElement<any>;hint?:string}){
 const described=[hint?`${id}-hint`:null,error?`${id}-error`:null].filter(Boolean).join(' ')||undefined;
 return <div className="commerce-field"><Label htmlFor={id}>{label}{children.props.required?<span aria-hidden="true"> *</span>:null}</Label>{cloneElement(children,{id,'aria-invalid':Boolean(error),'aria-describedby':described})}{hint?<p id={`${id}-hint`} className="commerce-hint">{hint}</p>:null}{error?<p id={`${id}-error`} className="commerce-field-error">{error}</p>:null}</div>;
}
export function CommerceNotice({children,tone='error'}:{children:ReactNode;tone?:'error'|'success'}){return <div className={`commerce-notice commerce-${tone} fleetum-inline-feedback`} role={tone==='error'?'alert':'status'}><span aria-hidden="true">{tone==='error'?<CircleAlert/>:<Check/>}</span><div>{children}</div></div>}
export type CommerceColumn<T>={key:string;label:string;render:(row:T)=>ReactNode};
export function CommerceCollection<T extends {id:string}>({rows,columns,caption,selectedId}:{rows:T[];columns:CommerceColumn<T>[];caption:string;selectedId?:string|null}){
 return <><div className="commerce-desktop"><table className="commerce-table"><caption className="sr-only">{caption}</caption><thead><tr>{columns.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} data-panel-origin data-selected={selectedId===row.id}>{columns.map(c=><td key={c.key}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>
 <ul className="commerce-mobile" aria-label={caption}>{rows.map(row=><li key={row.id} className="commerce-mobile-card" data-panel-origin data-selected={selectedId===row.id}><header>{columns[0]?.render(row)}</header><dl>{columns.slice(1).filter(c=>c.key!=='actions').map(c=><div key={c.key}><dt>{c.label}</dt><dd>{c.render(row)}</dd></div>)}</dl>{columns.find(c=>c.key==='actions')?<footer>{columns.find(c=>c.key==='actions')!.render(row)}</footer>:null}</li>)}</ul></>;
}
