import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Search, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { VehicleCollection, VehicleDetails, VehicleDrawer, VehicleEditor, VehicleOpenLinks } from "../../components/vehicles/vehicle-workspace";
import { vehicleFormData, vehicleFieldGroups, vehicleNumber, type VehicleErrors } from "../../components/vehicles/vehicle-form";
import type { PanelMotionHandle } from "../../components/ui/panel-motion";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";

type ImportVehicleResult = { totalRows: number; validRows: number; inserted: number; skipped: number; errors: Array<{ row: number; field: string; reason: string; value?: string }>; dryRun: boolean };
const PAGE_SIZE = 20;
export const VehiclesPage = () => {
  const navigate = useNavigate();
  const permissions = useAuthStore(state => state.user?.permissions) ?? [];
  const has = (key:string) => permissions.includes("*") || permissions.includes(key);
  const canRead = has("vehicles:read"), canWrite = has("vehicles:write"), canReadSites = canWrite && has("sites:read"), canRoi = has("stats:read");
  const [sites,setSites]=useState<any[]>([]), [vehicles,setVehicles]=useState<any[]>([]);
  const [totalVehicles,setTotalVehicles]=useState(0), [page,setPage]=useState(1);
  const [searchInput,setSearchInput]=useState(""), [searchQuery,setSearchQuery]=useState("");
  const [loading,setLoading]=useState(true), [listError,setListError]=useState<string|null>(null);
  const [sitesLoading,setSitesLoading]=useState(false), [sitesError,setSitesError]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null), [success,setSuccess]=useState<string|null>(null);
  const [panelOpen,setPanelOpen]=useState(false), [importPanelOpen,setImportPanelOpen]=useState(false);
  const [mode,setMode]=useState<"create"|"edit"|"view">("create"), [editingVehicle,setEditingVehicle]=useState<any|null>(null);
  const [bookletFile,setBookletFile]=useState<File|null>(null), [saving,setSaving]=useState(false);
  const [fieldErrors,setFieldErrors]=useState<VehicleErrors>({});
  const [importFile,setImportFile]=useState<File|null>(null), [importDefaultSiteId,setImportDefaultSiteId]=useState("");
  const [importDryRun,setImportDryRun]=useState(false), [importLoading,setImportLoading]=useState(false), [importResult,setImportResult]=useState<ImportVehicleResult|null>(null);
  const [deletion,setDeletion]=useState<{kind:"vehicle"|"booklet";id:string;plate:string}|null>(null), [deleting,setDeleting]=useState(false);
  const requestSequence=useRef(0), editorErrorRef=useRef<HTMLDivElement>(null);
  const panelMotion=useRef<PanelMotionHandle|null>(null), importMotion=useRef<PanelMotionHandle|null>(null), panelOrigin=useRef<HTMLElement|null>(null), animateOpen=useRef(true);
  const totalPages=useMemo(()=>Math.max(1,Math.ceil(totalVehicles/PAGE_SIZE)),[totalVehicles]);
  const loadSites=useCallback(async()=>{
    if(!canReadSites)return;
    setSitesLoading(true);setSitesError(null);
    try{const result=await masterDataUseCases.listSites({page:1,pageSize:200});setSites(result.data)}
    catch(e){setSitesError((e as Error).message)}finally{setSitesLoading(false)}
  },[canReadSites]);
  const loadVehicles=useCallback(async(targetPage:number,targetSearch:string)=>{
    if(!canRead)return;
    const sequence=++requestSequence.current;
    setLoading(true);setListError(null);
    try{
      const result=await masterDataUseCases.listVehicles({page:targetPage,pageSize:PAGE_SIZE,search:targetSearch||undefined});
      if(sequence!==requestSequence.current)return;
      const total=typeof result.total === "number" ? result.total : result.data.length;
      const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
      if(targetPage>pages){setPage(pages);return;}
      setVehicles(result.data);setTotalVehicles(total);
    }catch(e){if(sequence===requestSequence.current)setListError((e as Error).message)}
    finally{if(sequence===requestSequence.current)setLoading(false)}
  },[canRead]);
  const reloadVehicles=()=>loadVehicles(page,searchQuery);
  useEffect(()=>{void loadSites()},[loadSites]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setPage(1);setSearchQuery(searchInput.trim())},300);return()=>window.clearTimeout(timer)},[searchInput]);
  useEffect(()=>{void loadVehicles(page,searchQuery);return()=>{requestSequence.current++}},[loadVehicles,page,searchQuery]);
  useEffect(()=>{if(!importDefaultSiteId&&sites.find(site=>site.isActive!==false)?.id)setImportDefaultSiteId(String(sites.find(site=>site.isActive!==false).id))},[importDefaultSiteId,sites]);
  useEffect(()=>{if((panelOpen||importPanelOpen)&&(error||Object.keys(fieldErrors).length))editorErrorRef.current?.focus()},[error,fieldErrors,panelOpen,importPanelOpen]);
  const closePanel=()=>{if(!saving&&!deletion){const done=()=>{setPanelOpen(false);setFieldErrors({});setError(null)};if(panelMotion.current)panelMotion.current.dismiss(done);else done()}};
  const closeImport=()=>{if(!importLoading){const done=()=>{setImportPanelOpen(false);setError(null)};if(importMotion.current)importMotion.current.dismiss(done);else done()}};
  const openPanel=(next:"create"|"edit"|"view",vehicle:any=null,origin?:HTMLElement)=>{
    if(next!=="view"&&!canWrite)return;
    animateOpen.current=!panelOpen; if(!panelOpen)panelOrigin.current=origin??null;
    setMode(next);setEditingVehicle(vehicle);setBookletFile(null);setFieldErrors({});setError(null);setImportPanelOpen(false);setPanelOpen(true);
  };
  const openImportPanel=()=>{if(!canWrite)return;setPanelOpen(false);setBookletFile(null);setImportResult(null);setImportFile(null);setImportDryRun(false);setError(null);setSuccess(null);setImportPanelOpen(true)};
  const onBookletFileChange=(e:ChangeEvent<HTMLInputElement>)=>setBookletFile(e.target.files?.[0]??null);
  const onOpenBooklet=async(bookletId:string)=>{
    setError(null);
    try{const blob=await masterDataUseCases.downloadVehicleBooklet(bookletId);const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");window.setTimeout(()=>URL.revokeObjectURL(url),60_000)}catch(e){setError((e as Error).message)}
  };
  const onSubmit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!canWrite||saving)return;
    setError(null);setSuccess(null);
    const {payload,errors}=vehicleFormData(new FormData(event.currentTarget));setFieldErrors(errors);
    if(Object.keys(errors).length)return;
    setSaving(true);let savedVehicle:any=null;
    try{
      if(mode==="create")savedVehicle=await masterDataUseCases.createVehicle(payload);
      else if(editingVehicle)savedVehicle=await masterDataUseCases.updateVehicle(editingVehicle.id,payload);
      if(!savedVehicle?.id)throw Error("Risposta del salvataggio non disponibile. Ricarica l’elenco prima di riprovare.");
      if(bookletFile){
        // A failed attachment must never cause the saved vehicle to be created a second time.
        setMode("edit");setEditingVehicle(savedVehicle);
        await masterDataUseCases.uploadVehicleBooklet(savedVehicle.id,bookletFile);
      }
      setSuccess(mode==="create"?`Veicolo ${payload.plate} creato correttamente.`:`Veicolo ${payload.plate} aggiornato correttamente.`);
      setPanelOpen(false);setEditingVehicle(null);setBookletFile(null);await reloadVehicles();
    }catch(e){setError(savedVehicle?`Veicolo salvato. Caricamento libretto non riuscito: ${(e as Error).message}`:(e as Error).message)}
    finally{setSaving(false)}
  };
  const onImportSubmit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!canWrite||importLoading)return;setError(null);setSuccess(null);
    if(!importFile){setError("Seleziona un file Excel o CSV da importare.");return;}
    try{
      setImportLoading(true);
      const result=await masterDataUseCases.importVehicles({file:importFile,dryRun:importDryRun,defaultSiteId:importDefaultSiteId||undefined});
      setImportResult(result);
      if(!result.dryRun&&result.inserted>0)await reloadVehicles();
      setSuccess(result.dryRun?`Anteprima completata: ${result.validRows} righe valide su ${result.totalRows}. Nessun dato salvato.`:`Import completato: ${result.inserted} veicoli creati su ${result.totalRows} righe. Errori: ${result.errors.length}.`);
    }catch(e){setError((e as Error).message)}finally{setImportLoading(false)}
  };
  const confirmDeletion=async()=>{
    if(!canWrite||!deletion||deleting)return;
    setDeleting(true);setError(null);setSuccess(null);
    try{
      if(deletion.kind==="vehicle")await masterDataUseCases.deleteVehicle(deletion.id);
      else {await masterDataUseCases.deleteVehicleBooklet(deletion.id);setEditingVehicle((v:any)=>v?.booklet?.id===deletion.id?{...v,booklet:null}:v)}
      setSuccess(deletion.kind==="vehicle"?"Veicolo eliminato.":"Libretto rimosso.");setDeletion(null);await reloadVehicles();
    }catch(e){setError((e as Error).message)}finally{setDeleting(false)}
  };
  const panelErrors=<div ref={editorErrorRef} tabIndex={-1} className="vehicle-error" role="alert">{error?<p>{error}</p>:null}{Object.keys(fieldErrors).length?<><p>Controlla i campi indicati prima di salvare.</p><ul>{Object.entries(fieldErrors).map(([key,message])=><li key={key}><a href={`#vehicle-${key}`} onClick={e=>{e.preventDefault();document.getElementById(`vehicle-${key}`)?.focus()}}>{vehicleFieldGroups.flatMap(group=>group.fields).find(field=>field.name===key)?.label ?? "Campo"}: {message}</a></li>)}</ul></>:null}</div>;
  if(!canRead)return <section className="vehicles-workspace"><h1>Veicoli</h1><p>Il tuo ruolo non consente l’accesso ai veicoli.</p></section>;
  return <section className="vehicles-workspace" aria-label="Gestione veicoli">
    <WorkspacePageHeader eyebrow="LA TUA FLOTTA" title="Veicoli" description="Anagrafica, chilometri e documenti, con le attività operative sempre a portata di mano." actions={canWrite?<><Button variant="outline" onClick={openImportPanel}><Upload aria-hidden="true" className="h-4 w-4"/>Importa veicoli</Button><Button onClick={()=>openPanel('create')}><Plus aria-hidden="true" className="h-4 w-4"/>Nuovo veicolo</Button></>:undefined}/>
    {error&&!panelOpen&&!importPanelOpen&&!deletion?<p className="vehicle-error" role="alert">{error}</p>:null}{success?<p className="vehicle-success" role="status">{success}</p>:null}
    <VehicleOpenLinks onNavigate={navigate} canStoppages={has('stoppages:read')} canRoi={false}/>
    <p className="vehicle-availability-note">Verifica la disponibilità per il periodo scelto nel calendario prenotazioni.</p>
    <section className="vehicle-list-panel" aria-labelledby="vehicle-list-title">
      <header className="vehicle-list-header"><div><h2 id="vehicle-list-title">Elenco veicoli <span>{loading||listError?"—":vehicleNumber(totalVehicles)}</span></h2><p>Dal più recente · 20 veicoli per pagina</p></div><Button variant="ghost" size="icon" aria-label="Aggiorna elenco veicoli" disabled={loading} onClick={()=>void reloadVehicles()}><RefreshCw aria-hidden="true" className="h-4 w-4"/></Button></header>
      <div className="vehicle-search"><Label htmlFor="vehicle-search">Cerca nella flotta</Label><div><Search aria-hidden="true" className="h-4 w-4"/><Input id="vehicle-search" value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Targa, marca, modello o sede"/>{searchInput?<Button variant="ghost" size="icon" aria-label="Cancella ricerca veicoli" onClick={()=>setSearchInput('')}><X aria-hidden="true" className="h-4 w-4"/></Button>:null}</div></div>
      <div className="vehicle-list-content" aria-busy={loading}>
        {loading?<div className="vehicle-list-state"><FleetumInlineLoader label="Caricamento veicoli"/></div>:listError?<div className="vehicle-list-state"><p role="alert">{listError}</p><Button variant="outline" onClick={()=>void reloadVehicles()}>Riprova elenco</Button></div>:!vehicles.length?<div className="vehicle-list-state"><h3>{searchQuery?"Nessun veicolo trovato":"La tua flotta parte da qui"}</h3><p>{searchQuery?"Prova con un’altra targa, marca, modello o sede.":"Aggiungi un veicolo oppure importa il tuo elenco."}</p>{searchQuery?<Button variant="outline" onClick={()=>setSearchInput('')}>Azzera ricerca</Button>:canWrite?<Button onClick={()=>openPanel('create')}>Nuovo veicolo</Button>:null}</div>:<VehicleCollection vehicles={vehicles} canWrite={canWrite} canRoi={canRoi} selectedId={panelOpen?editingVehicle?.id:undefined} onDetail={(v,origin)=>openPanel('view',v,origin)} onEdit={(v,origin)=>openPanel('edit',v,origin)} onDelete={v=>{setError(null);setDeletion({kind:'vehicle',id:v.id,plate:v.plate})}} onBooklet={id=>void onOpenBooklet(id)} onRoi={id=>navigate(`/statistiche?vehicleId=${encodeURIComponent(id)}`)}/>}
      </div>
      <footer className="vehicle-pagination"><p role="status">Pagina <strong>{page}</strong> di <strong>{loading||listError?'—':totalPages}</strong> · Totale record: <strong>{loading||listError?'—':vehicleNumber(totalVehicles)}</strong></p><div><Button variant="outline" disabled={page<=1||loading} onClick={()=>setPage(n=>Math.max(1,n-1))}>Precedente</Button><Button variant="outline" disabled={page>=totalPages||loading||Boolean(listError)} onClick={()=>setPage(n=>Math.min(totalPages,n+1))}>Successiva</Button></div></footer>
    </section>
    {panelOpen?<VehicleDrawer key={`${mode}-${editingVehicle?.id||'new'}`} title={mode==='view'?`Scheda ${editingVehicle?.plate}`:mode==='create'?'Nuovo veicolo':'Modifica veicolo'} description={mode==='view'?'Dati registrati e collegamenti operativi.':'I campi con * sono obbligatori.'} onClose={closePanel} origin={panelOrigin.current} motionRef={panelMotion} animateOpen={animateOpen.current} footer={mode==='view'?<><Button variant="outline" onClick={closePanel}>Chiudi scheda</Button>{canWrite?<Button onClick={()=>openPanel('edit',editingVehicle)}>Modifica veicolo</Button>:null}</>:<><Button variant="outline" disabled={saving} onClick={closePanel}>Annulla</Button><Button type="submit" form="vehicle-editor-form" aria-busy={saving} disabled={saving}>{saving?'Salvataggio veicolo...':mode==='create'?'Crea veicolo':'Salva modifiche'}</Button></>}>
      {error||Object.keys(fieldErrors).length?panelErrors:null}
      {mode==='view'?<><VehicleDetails vehicle={editingVehicle} onBooklet={id=>void onOpenBooklet(id)}/><VehicleOpenLinks onNavigate={navigate} canStoppages={has('stoppages:read')} canRoi={canRoi} vehicleId={editingVehicle?.id}/></>:<>{sitesLoading?<p role="status">Caricamento sedi...</p>:sitesError?<div className="vehicle-error"><p role="alert">{sitesError}</p><Button variant="outline" onClick={()=>void loadSites()}>Riprova sedi</Button></div>:!canReadSites?<p className="vehicle-availability-note">Il tuo ruolo non consente di caricare altre sedi. In modifica resta disponibile la sede attuale.</p>:null}<VehicleEditor key={editingVehicle?.id||'new'} vehicle={editingVehicle} sites={sites} errors={fieldErrors} bookletFile={bookletFile} saving={saving} onSubmit={onSubmit} onBookletChange={onBookletFileChange} onOpenBooklet={id=>void onOpenBooklet(id)} onDeleteBooklet={id=>{setError(null);setDeletion({kind:'booklet',id,plate:editingVehicle.plate})}}/></>}
    </VehicleDrawer>:null}
    {importPanelOpen?<VehicleDrawer title="Importa veicoli" description="Carica un elenco Excel o CSV e controlla il risultato di ogni riga." onClose={closeImport} motionRef={importMotion} footer={<><Button variant="outline" disabled={importLoading} onClick={closeImport}>Chiudi</Button><Button type="submit" form="vehicle-import-form" aria-busy={importLoading} disabled={importLoading}>{importLoading?'Import in corso...':importDryRun?'Avvia anteprima':'Avvia import'}</Button></>}>
      {error?panelErrors:null}<form id="vehicle-import-form" onSubmit={onImportSubmit} className="vehicle-import-form"><p className="vehicle-group-description">File .xlsx o .csv. Colonne minime: targa, marca, modello. Se manca la sede, usa quella di default.</p><fieldset disabled={importLoading}><div className="vehicle-field"><Label htmlFor="vehicle-import-file">File import</Label><Input id="vehicle-import-file" type="file" accept=".xlsx,.csv" onChange={e=>setImportFile(e.target.files?.[0]??null)}/><p className="vehicle-field-hint">{importFile?`File selezionato: ${importFile.name}`:'Nessun file selezionato'}</p></div><div className="vehicle-field"><Label htmlFor="vehicle-import-site">Sede di default (opzionale)</Label><Select id="vehicle-import-site" value={importDefaultSiteId} onChange={e=>setImportDefaultSiteId(e.target.value)}><option value="">Usa la colonna site_name dal file</option>{sites.filter(s=>s.isActive!==false).map(s=><option translate="no" key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</Select></div><label className="vehicle-import-check"><input type="checkbox" checked={importDryRun} onChange={e=>setImportDryRun(e.target.checked)}/><span>Esegui anteprima (dry run, nessun salvataggio)</span></label></fieldset></form>
      {success?<p className="vehicle-success" role="status">{success}</p>:null}{importResult?<section className="vehicle-import-result" aria-label="Risultato importazione"><h3>{importResult.dryRun?'Risultato anteprima':'Risultato import'}</h3><dl>{[['Righe totali',importResult.totalRows],['Righe valide',importResult.validRows],['Inserite',importResult.inserted],['Scartate',importResult.skipped],['Errori',importResult.errors.length]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{importResult.errors.length?<ul>{importResult.errors.slice(0,50).map((item,i)=><li key={`${item.row}-${item.field}-${i}`}><strong>Riga {item.row}</strong> · {item.field} · {item.reason}{item.value?` (valore: ${item.value})`:''}</li>)}{importResult.errors.length>50?<li>Mostrati primi 50 errori su {importResult.errors.length}.</li>:null}</ul>:<p>Nessun errore rilevato.</p>}</section>:null}
    </VehicleDrawer>:null}
    {deletion?<VehicleDrawer compact title={deletion.kind==='vehicle'?'Elimina veicolo':'Rimuovi libretto'} onClose={()=>{if(!deleting){setDeletion(null);setError(null)}}} footer={<><Button variant="outline" disabled={deleting} onClick={()=>{setDeletion(null);setError(null)}}>Annulla</Button><Button variant="destructive" disabled={deleting} onClick={()=>void confirmDeletion()}>{deleting?'Rimozione in corso...':'Conferma eliminazione'}</Button></>}><p>Confermi la rimozione di {deletion.kind==='vehicle'?'questo veicolo':'questo libretto'} per <strong>{deletion.plate}</strong>?</p>{deletion.kind==='vehicle'?<p className="vehicle-field-hint">Verifica prima eventuali prenotazioni collegate.</p>:null}{error?<p className="vehicle-error" role="alert">{error}</p>:null}</VehicleDrawer>:null}
  </section>;
};
