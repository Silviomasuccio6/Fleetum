import { useId, useRef, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from "react";
import { Car, ChevronRight, FileText, Pencil, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { useDialogFocus } from "../../hooks/use-dialog-focus";
import { usePanelMotion } from "../../hooks/use-panel-motion";
import type { PanelMotionHandle } from "../ui/panel-motion";
import { vehicleDate, vehicleDateInput, vehicleFieldGroups, vehicleNumber, vehicleState, type VehicleErrors } from "./vehicle-form";

type Vehicle = Record<string, any>;
export function VehicleDrawer({ title, description, onClose, children, footer, compact = false, origin = null, motionRef, animateOpen = true }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; compact?: boolean; origin?: HTMLElement | null; motionRef?: RefObject<PanelMotionHandle | null>; animateOpen?: boolean }) {
  const ref = useRef<HTMLElement>(null), frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  usePanelMotion(ref, frame, origin, !compact, 'vehicle', motionRef, animateOpen);
  useDialogFocus(true, ref, onClose);
  return <div className="vehicle-overlay">
    <div className="vehicle-scrim" aria-hidden="true" onClick={onClose}/>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`vehicle-drawer ${compact ? "vehicle-drawer-compact" : ""}`}>
      <div className="vehicle-drawer-frame" ref={frame}>
      <header className="vehicle-drawer-header"><div><p className="vehicle-eyebrow" data-panel-eyebrow>FLOTTA</p><h2 id={titleId} data-panel-title>{title}</h2>{description ? <p>{description}</p> : null}</div><Button data-panel-close variant="ghost" size="icon" aria-label="Chiudi pannello veicolo" onClick={onClose}><X aria-hidden="true" className="h-5 w-5"/></Button></header>
      <div className="vehicle-drawer-content" data-panel-content>{children}</div>
      {footer ? <footer className="vehicle-drawer-footer" data-panel-footer>{footer}</footer> : null}
      </div>
    </section>
  </div>;
}
export const VehicleStatus = ({active}:{active:unknown}) => <span className={`vehicle-state ${active === false ? "vehicle-state-inactive" : ""}`}>{vehicleState(active)}</span>;

export function VehicleCollection({vehicles, canWrite, canRoi, onDetail, onEdit, onDelete, onBooklet, onRoi, selectedId}: {vehicles:Vehicle[];canWrite:boolean;canRoi:boolean;onDetail:(v:Vehicle,origin?:HTMLElement)=>void;onEdit:(v:Vehicle,origin?:HTMLElement)=>void;onDelete:(v:Vehicle)=>void;onBooklet:(id:string)=>void;onRoi:(id:string)=>void;selectedId?:string}) {
  const name = (v:Vehicle) => <button type="button" className="vehicle-name" onClick={event=>onDetail(v,event.currentTarget)} aria-haspopup="dialog" aria-expanded={selectedId===v.id} aria-label={`Apri veicolo ${v.plate}`}><span className="vehicle-avatar" aria-hidden="true"><Car/></span><span><strong data-panel-origin-title translate="no">{v.plate}</strong><span>{v.brand} {v.model}{v.year ? ` · ${v.year}` : ""}</span></span></button>;
  const actions = (v:Vehicle) => <div className="vehicle-row-actions">
    {v.booklet?.id ? <Button size="sm" variant="ghost" aria-label={`Apri libretto ${v.plate}`} onClick={()=>onBooklet(v.booklet.id)}><FileText aria-hidden="true" className="h-4 w-4"/><span>Libretto</span></Button> : null}
    {canRoi ? <Button size="sm" variant="ghost" aria-label={`ROI ${v.plate}`} onClick={()=>onRoi(v.id)}>ROI</Button> : null}
    {canWrite ? <><Button size="sm" variant="outline" aria-label={`Modifica ${v.plate}`} onClick={event=>onEdit(v,event.currentTarget)}><Pencil aria-hidden="true" className="h-4 w-4"/>Modifica</Button><Button size="icon" variant="ghost" className="vehicle-delete-action" aria-label={`Elimina ${v.plate}`} onClick={()=>onDelete(v)}><Trash2 aria-hidden="true" className="h-4 w-4"/></Button></> : null}
  </div>;
  return <>
    <div className="vehicle-desktop-list vehicle-table-scroll"><table className="vehicle-table"><caption className="sr-only">Veicoli ordinati dal più recente</caption><thead><tr>{["Veicolo","Sede","Stato","Chilometri","Revisione","Azioni"].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{vehicles.map(v=><tr key={v.id} data-panel-origin data-selected={selectedId===v.id}>
      <td>{name(v)}</td><td><span className="vehicle-site">{v.site?.name || "—"}</span><small>{v.site?.city || ""}</small></td><td><VehicleStatus active={v.isActive}/></td>
      <td><strong>{vehicleNumber(v.currentKm)} km</strong><small>Intervallo: {vehicleNumber(v.maintenanceIntervalKm)} km</small></td>
      <td><strong>{vehicleDate(v.revisionDueAt,true)}</strong><small>Ultima: {vehicleDate(v.lastRevisionAt)}</small></td><td>{actions(v)}</td>
    </tr>)}</tbody></table></div>
    <ul className="vehicle-mobile-list">{vehicles.map(v=><li key={v.id} className="vehicle-mobile-card" data-panel-origin data-selected={selectedId===v.id}><header>{name(v)}<VehicleStatus active={v.isActive}/></header><p className="vehicle-mobile-site">{v.site?.name || "—"}{v.site?.city ? ` · ${v.site.city}` : ""}</p><dl><div><dt>Km attuali</dt><dd>{vehicleNumber(v.currentKm)}</dd></div><div><dt>Intervallo km</dt><dd>{vehicleNumber(v.maintenanceIntervalKm)}</dd></div><div><dt>Prossima revisione</dt><dd>{vehicleDate(v.revisionDueAt,true)}</dd></div><div><dt>Libretto</dt><dd>{v.booklet?.id ? "Presente" : "Non presente"}</dd></div></dl>{actions(v)}</li>)}</ul>
  </>;
}
export function VehicleDetails({vehicle,onBooklet}:{vehicle:Vehicle;onBooklet:(id:string)=>void}) {
  const value = (name:string,type?:string) => {
    if(name === "siteId") return [vehicle.site?.name,vehicle.site?.city].filter(Boolean).join(" · ") || "—";
    if(type === "date") return vehicleDate(vehicle[name]);
    if(["purchasePrice","residualValue","monthlyFixedCost"].includes(name))return vehicleNumber(vehicle[name],true);
    if(type === "number")return vehicleNumber(vehicle[name]);
    return vehicle[name] || "—";
  };
  return <div className="vehicle-details"><div className="vehicle-detail-identity"><span className="vehicle-avatar" aria-hidden="true"><Car/></span><div><strong>{vehicle.brand} {vehicle.model}</strong><p>{vehicle.plate}</p></div><VehicleStatus active={vehicle.isActive}/></div>
    {vehicleFieldGroups.map(group=><section className="vehicle-detail-group" key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(field=><div key={field.name} className={field.name === "notes" ? "vehicle-full-field" : ""}><dt>{field.label}</dt><dd>{value(field.name,field.type)}</dd></div>)}</dl></section>)}
    <section className="vehicle-detail-group"><h3>Libretto e prossima revisione</h3><dl><div><dt>Prossima revisione (auto)</dt><dd>{vehicleDate(vehicle.revisionDueAt,true)}</dd></div><div><dt>Libretto</dt><dd>{vehicle.booklet?.fileName || "Non presente"}</dd></div></dl>{vehicle.booklet?.id ? <Button variant="outline" onClick={()=>onBooklet(vehicle.booklet.id)}><FileText aria-hidden="true" className="h-4 w-4"/>Apri libretto</Button> : null}</section>
  </div>;
}
export function VehicleEditor({vehicle,sites,errors,bookletFile,saving,onSubmit,onBookletChange,onOpenBooklet,onDeleteBooklet}: {vehicle:Vehicle|null;sites:Vehicle[];errors:VehicleErrors;bookletFile:File|null;saving:boolean;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onBookletChange:(e:ChangeEvent<HTMLInputElement>)=>void;onOpenBooklet:(id:string)=>void;onDeleteBooklet:(id:string)=>void}) {
  const currentSiteId = vehicle?.siteId ?? vehicle?.site?.id ?? "";
  const allSites = [...sites.filter(site=>site.isActive !== false || site.id === currentSiteId)];
  if(currentSiteId && !allSites.some(site=>site.id === currentSiteId)) allSites.unshift(vehicle?.site ?? {id:currentSiteId,name:"Sede attuale"});
  return <form id="vehicle-editor-form" className="vehicle-editor" noValidate onSubmit={onSubmit}>
    {vehicleFieldGroups.map(group=><fieldset key={group.title} disabled={saving}><legend>{group.title}</legend><p className="vehicle-group-description">{group.description}</p><div className="vehicle-field-grid">{group.fields.map(field=>{
      const id=`vehicle-${field.name}`,hint=field.hint,invalid=errors[field.name];
      const described=[hint?`${id}-hint`:null,invalid?`${id}-error`:null].filter(Boolean).join(" ") || undefined;
      const shared={id,name:field.name,required:field.required,"aria-invalid":Boolean(invalid),"aria-describedby":described};
      const initial=field.type === "date" ? vehicleDateInput(vehicle?.[field.name]) : vehicle?.[field.name] ?? "";
      return <div key={field.name} className={`vehicle-field ${field.type === "textarea" ? "vehicle-full-field" : ""}`}><Label htmlFor={id}>{field.label}{field.required ? <span aria-hidden="true"> *</span>:null}</Label>
        {field.type === "site" ? <Select {...shared} defaultValue={currentSiteId || allSites[0]?.id || ""}><option value="">Seleziona sede</option>{allSites.map(site=><option value={site.id} key={site.id}>{site.name}{site.city ? ` · ${site.city}`:""}{site.isActive === false ? " (inattiva)":""}</option>)}</Select> : field.type === "textarea" ? <textarea {...shared} className="vehicle-textarea" defaultValue={initial} rows={4}/> : <Input {...shared} type={field.type || "text"} defaultValue={initial} min={field.min} max={field.max} step={field.step || (field.type === "number" ? "1" : undefined)} autoCapitalize={field.name === "plate" ? "characters":undefined}/>}
        {hint ? <p id={`${id}-hint`} className="vehicle-field-hint">{hint}</p> : null}{invalid ? <p id={`${id}-error`} className="vehicle-field-error">{invalid}</p> : null}
      </div>;
    })}</div></fieldset>)}
    <fieldset disabled={saving}><legend>Libretto e prossima revisione</legend><p className="vehicle-group-description">Carica il documento e consulta la scadenza calcolata dal gestionale.</p><div className="vehicle-field-grid"><div className="vehicle-field vehicle-full-field"><Label htmlFor="vehicle-booklet">Libretto veicolo (PDF o immagine)</Label><Input id="vehicle-booklet" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" onChange={onBookletChange}/><p className="vehicle-field-hint" role="status">{bookletFile ? `Nuovo file selezionato: ${bookletFile.name}` : "Nessun nuovo file selezionato"}</p>
    {vehicle?.booklet?.id ? <div className="vehicle-booklet-current"><span>{vehicle.booklet.fileName}<small>{vehicleNumber(Number(vehicle.booklet.sizeBytes)/1024)} KB</small></span><Button type="button" variant="outline" onClick={()=>onOpenBooklet(vehicle.booklet.id)}>Apri libretto</Button><Button type="button" variant="ghost" className="vehicle-delete-action" onClick={()=>onDeleteBooklet(vehicle.booklet.id)}>Rimuovi libretto</Button></div> : null}</div><div className="vehicle-field"><Label htmlFor="vehicle-next-revision">Prossima revisione (auto)</Label><Input id="vehicle-next-revision" value={vehicleDate(vehicle?.revisionDueAt,true)} readOnly/><p className="vehicle-field-hint">La scadenza viene ricalcolata al salvataggio.</p></div></div></fieldset>
  </form>;
}
export const VehicleOpenLinks = ({onNavigate,canStoppages,canRoi,vehicleId}:{onNavigate:(to:string)=>void;canStoppages:boolean;canRoi:boolean;vehicleId?:string}) => <nav className="vehicle-open-links" aria-label="Collegamenti operativi flotta">
  <Button variant="outline" onClick={()=>onNavigate('/booking')}>Prenotazioni<ChevronRight aria-hidden="true" className="h-4 w-4"/></Button>
  {canStoppages ? <Button variant="outline" onClick={()=>onNavigate('/fermi')}>Fermi tecnici<ChevronRight aria-hidden="true" className="h-4 w-4"/></Button> : null}
  <Button variant="outline" onClick={()=>onNavigate('/anagrafiche/manutenzioni')}>Manutenzioni<ChevronRight aria-hidden="true" className="h-4 w-4"/></Button>
  <Button variant="outline" onClick={()=>onNavigate('/anagrafiche/scadenziario')}>Scadenziario<ChevronRight aria-hidden="true" className="h-4 w-4"/></Button>
  {canRoi && vehicleId ? <Button variant="outline" onClick={()=>onNavigate(`/statistiche?vehicleId=${encodeURIComponent(vehicleId)}`)}>ROI del veicolo<ChevronRight aria-hidden="true" className="h-4 w-4"/></Button> : null}
</nav>;
