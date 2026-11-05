import {useSiteAccessStore} from "../../../application/stores/site-access-store";
import {useCompanySiteView} from "../../components/layout/site-context";
import {reloadSiteAccess} from "../../../application/usecases/site-access-usecases";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, Search, RefreshCw } from "lucide-react";
import { useAuthStore } from "../../../application/stores/auth-store";
import { usersUseCases } from "../../../application/usecases/users-usecases";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { CommerceCollection, CommerceDrawer, CommerceField, CommerceNotice } from "../../components/ui/commerce-workspace";
import { DiscardDialog } from "../../components/operations/operations-workspace";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";

type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
type Status = "ACTIVE" | "INVITED" | "SUSPENDED";
type Member = { id: string; firstName: string; lastName: string; email: string; roles: Role[]; status: Status; assignedSite?: {id:string;name:string;isActive:boolean}|null };
type Change = { member: Member; kind: "role" | "status" | "remove" | "site"; value?: string };
const ruoloLabel: Record<string, string> = { ADMIN: "Amministratore", MANAGER: "Manager", OPERATOR: "Operatore", VIEWER: "Consultazione" };
const statoLabel: Record<string, string> = { ACTIVE: "Attivo", INVITED: "Invitato", SUSPENDED: "Sospeso" };

export const UsersPage = () => {
  const user = useAuthStore(state => state.user);
  const siteState=useSiteAccessStore(),companyView=useCompanySiteView();
  const canAssignSites=Boolean(siteState.context?.canAssignSites && companyView);
  const canRead = Boolean(user?.permissions.some(p => p === "*" || p === "users:read"));
  const canWrite = companyView && Boolean(user?.permissions.some(p => p === "*" || p === "users:write"));
  const identity = `${user?.tenantId}:${user?.id}:${siteState.revision}`;
  const [dataOwner, setDataOwner] = useState(identity);
  const [users, setUsers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<"invite" | "create" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  const lock = useRef(false), request = useRef(0), origin = useRef<HTMLElement | null>(null);
  const activeIdentity = useRef(identity); activeIdentity.current = identity;

  const loadData = async () => {
    if (!canRead) return;
    const sequence = ++request.current, owner = identity;
    setLoading(true); setError(null);
    try {
      const [members, availableRoles] = await Promise.all([usersUseCases.list(), usersUseCases.listRoles()]);
      if (sequence !== request.current || activeIdentity.current !== owner) return;
      setDataOwner(owner); setUsers(members.data); setRoles(availableRoles.data); setLoaded(true);
    } catch (e) {
      if (sequence === request.current && activeIdentity.current === owner) setError((e as Error).message);
    } finally {
      if (sequence === request.current && activeIdentity.current === owner) setLoading(false);
    }
  };
  useEffect(() => {
    setUsers([]); setRoles([]); setLoaded(false); setEditor(null); setChange(null); setDirty(false); setDiscardOpen(false); setSuccess(null);
    void loadData();
    return () => { ++request.current; };
  }, [identity, canRead]);

  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (!canWrite || lock.current) return;
    lock.current = true; setBusy(true); setError(null); setSuccess(null);
    const owner = identity;
    try {
      await action();
      if (activeIdentity.current !== owner) return;
      setEditor(null); setChange(null); setDirty(false); setDiscardOpen(false); setSuccess(message);
      await loadData();
    } catch (e) {
      if (activeIdentity.current === owner) setError((e as Error).message);
    } finally { lock.current = false; setBusy(false); }
  };
  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canWrite || lock.current) return;
    const form = new FormData(event.currentTarget);
    await mutate(() => usersUseCases.create({ firstName: String(form.get("firstName") || "").trim(), lastName: String(form.get("lastName") || "").trim(), email: String(form.get("email") || "").trim(), password: String(form.get("password") || ""), roleKey: String(form.get("roleKey") || "OPERATOR") }), "Utente creato correttamente.");
  };
  const onInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canWrite || lock.current) return;
    const form = new FormData(event.currentTarget);
    await mutate(() => usersUseCases.invite({ firstName: String(form.get("firstName") || "").trim(), lastName: String(form.get("lastName") || "").trim(), email: String(form.get("email") || "").trim(), roleKey: String(form.get("roleKey") || "OPERATOR") }), "Invito registrato. Email in coda per l’invio.");
  };
  const onDelete = async (id: string) => mutate(() => usersUseCases.remove(id), "Utente disattivato.");
  const confirmChange = async () => {
    if (!change) return;
    if(change.kind==="site"){if(!canAssignSites)return;await mutate(async()=>{await usersUseCases.assignSite(change.member.id,change.value||null);if(change.member.id===user?.id)await reloadSiteAccess();},"Sede aggiornata.");return;}
    if (change.kind === "remove") { await onDelete(change.member.id); return; }
    if (change.kind === "role") await mutate(() => usersUseCases.updateRole(change.member.id, change.value as Role), "Ruolo aggiornato.");
    else await mutate(() => usersUseCases.update(change.member.id, { status: change.value as Status }), "Stato aggiornato.");
  };
  const visible = useMemo(() => (dataOwner === identity ? users : []).filter(member => (!status || member.status === status) && `${member.firstName} ${member.lastName} ${member.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [users, search, status, dataOwner, identity]);
  const openChange = (member: Member, kind: Change["kind"], value: string | undefined, target: HTMLElement) => { origin.current = target; setError(null); setChange({ member, kind, value }); };
  const defaultRole = roles.includes("OPERATOR") ? "OPERATOR" : roles[0];

  return <section className="administration-workspace">
    <WorkspacePageHeader eyebrow="AMMINISTRAZIONE" title="Utenti e ruoli" description="Organizza il team e controlla chi può accedere ai dati aziendali." actions={canWrite && loaded && dataOwner === identity ? <><Button variant="outline" onClick={e => { origin.current = e.currentTarget; setError(null); setDirty(false); setEditor("create"); }}>Crea utente</Button><Button onClick={e => { origin.current = e.currentTarget; setError(null); setDirty(false); setEditor("invite"); }}><UserPlus aria-hidden="true" className="h-4 w-4"/>Invita utente</Button></> : null}/>
    {!canRead ? <CommerceNotice>Il tuo ruolo non consente di consultare gli utenti.</CommerceNotice> : <>
      {success ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
      {error && !editor && !change ? <CommerceNotice>{error} <Button variant="outline" disabled={loading || busy} onClick={() => void loadData()}>Riprova</Button></CommerceNotice> : null}
      {!canWrite ? <p className="admin-context">{!companyView ? siteState.context?.canViewAllSites ? "Accesso in sola lettura per questa sede. Per gestire gli utenti torna alla vista Tutte le sedi." : "Accesso in sola lettura per la sede assegnata." : "Accesso in sola lettura. Le modifiche agli utenti richiedono un ruolo autorizzato."}</p> : null}
      <Card><CardHeader className="admin-section-heading"><div><h2>Team aziendale</h2><p className="admin-context">{loaded && dataOwner === identity ? `${visible.length} di ${users.length} utenti` : loading ? "Caricamento dell’elenco" : "Elenco non disponibile"}</p></div><Button variant="outline" aria-label="Aggiorna utenti" disabled={loading || busy} onClick={() => void loadData()}><RefreshCw aria-hidden="true" className="h-4 w-4"/></Button></CardHeader>
        <CardContent className="space-y-4">
          <div className="admin-filter-grid"><CommerceField id="users-search" label="Cerca nel team"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome o email"/></CommerceField><CommerceField id="users-status" label="Stato"><Select value={status} onChange={e => setStatus(e.target.value)}><option value="">Tutti gli stati</option>{Object.entries(statoLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select></CommerceField></div>
          {loading || dataOwner !== identity ? <FleetumBlockLoader label="Caricamento utenti"/> : loaded && !visible.length ? <div className="admin-empty"><Search aria-hidden="true" className="h-5 w-5"/><h2>{users.length ? "Nessun risultato" : "Nessun utente"}</h2><p>{users.length ? "Modifica la ricerca o il filtro di stato." : "Il team non contiene utenti da mostrare."}</p></div> : loaded ? <CommerceCollection caption="Utenti aziendali" rows={visible} columns={[
            {key:"member",label:"Persona",render:member => <div className="admin-person"><span aria-hidden="true" className="admin-avatar">{member.firstName.slice(0,1)}{member.lastName.slice(0,1)}</span><div><p className="font-medium">{member.firstName} {member.lastName}{member.id === user?.id ? " · Tu" : ""}</p><p className="admin-context break-all">{member.email}</p></div></div>},
            {key:"role",label:"Ruolo",render:member => canWrite ? <Select aria-label={`Ruolo di ${member.firstName} ${member.lastName}`} value={member.roles[0] ?? "OPERATOR"} disabled={busy} onChange={e => openChange(member,"role",e.target.value,e.currentTarget)}>{roles.map(role => <option key={role} value={role}>{ruoloLabel[role]}</option>)}</Select> : ruoloLabel[member.roles[0]] ?? member.roles[0]},
            {key:"site",label:"Sede operativa",render:member => <div className="site-member-assignment"><span>{member.roles.some(role=>role==="ADMIN"||role==="MANAGER")?"Vista aziendale":member.assignedSite?`${member.assignedSite.name}${member.assignedSite.isActive?"":" · Non disponibile"}`:"Non assegnata"}</span>{canAssignSites && !member.roles.some(role=>role==="ADMIN"||role==="MANAGER")?<Button variant="outline" disabled={busy} onClick={e=>openChange(member,"site",member.assignedSite?.id??"",e.currentTarget)} aria-label={`Assegna sede a ${member.firstName} ${member.lastName}`}>Assegna sede</Button>:null}</div>},
            {key:"status",label:"Stato",render:member => canWrite ? <Select aria-label={`Stato di ${member.firstName} ${member.lastName}`} value={member.status} disabled={busy} onChange={e => openChange(member,"status",e.target.value,e.currentTarget)}>{Object.entries(statoLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select> : <span className="admin-status" data-status={member.status}>{statoLabel[member.status] ?? member.status}</span>},
            {key:"actions",label:"Azioni",render:member => canWrite ? <Button variant="ghost" className="text-destructive" disabled={busy} onClick={e => openChange(member,"remove",undefined,e.currentTarget)} aria-label={`Disattiva ${member.firstName} ${member.lastName}`}>Disattiva</Button> : <span className="admin-context">Sola lettura</span>}
          ]}/> : null}
        </CardContent>
      </Card>
    </>}
    {editor && canWrite && dataOwner === identity ? <CommerceDrawer title={editor === "invite" ? "Invita nel team" : "Crea un utente"} description={editor === "invite" ? "La persona riceverà le istruzioni per attivare il proprio account." : "Imposta l’accesso iniziale e assegna il ruolo appropriato."} origin={origin.current} busy={busy} onClose={() => dirty ? setDiscardOpen(true) : setEditor(null)} footer={<Button form="user-editor" type="submit" disabled={busy}>{busy ? "Salvataggio…" : editor === "invite" ? "Invia invito" : "Crea utente"}</Button>}>
      {error ? <CommerceNotice>{error}</CommerceNotice> : null}
      <form id="user-editor" onChange={() => setDirty(true)} onSubmit={editor === "invite" ? onInvite : onCreate} className="grid gap-4">
        <fieldset disabled={busy} className="grid gap-4"><CommerceField id="user-first-name" label="Nome"><Input name="firstName" autoComplete="given-name" required/></CommerceField><CommerceField id="user-last-name" label="Cognome"><Input name="lastName" autoComplete="family-name" required/></CommerceField><CommerceField id="user-email" label="Email"><Input name="email" type="email" autoComplete="email" required/></CommerceField>
        {editor === "create" ? <CommerceField id="user-password" label="Password iniziale"><Input name="password" type="password" autoComplete="new-password" minLength={8} required/></CommerceField> : null}
        <CommerceField id="user-role" label="Ruolo" hint="Il ruolo determina le operazioni disponibili nel gestionale."><Select name="roleKey" defaultValue={defaultRole} required>{roles.map(role => <option key={role} value={role}>{ruoloLabel[role]}</option>)}</Select></CommerceField></fieldset>
      </form>
    </CommerceDrawer> : null}
    {discardOpen ? <DiscardDialog onContinue={() => setDiscardOpen(false)} onDiscard={() => { setDiscardOpen(false); setEditor(null); setDirty(false); }}/> : null}
    {change && canWrite && dataOwner === identity ? <CommerceDrawer compact title={change.kind === "site" ? "Assegna la sede operativa" : change.kind === "remove" ? "Disattivare l’utente?" : change.kind === "role" ? "Confermare il nuovo ruolo?" : "Confermare il nuovo stato?"} description={`${change.member.firstName} ${change.member.lastName} · ${change.member.email}`} origin={origin.current} busy={busy} onClose={() => setChange(null)} footer={<><Button variant="outline" onClick={() => setChange(null)} disabled={busy}>Annulla</Button><Button variant={change.kind === "remove" ? "destructive" : "default"} disabled={busy} onClick={() => void confirmChange()}>{busy ? "Aggiornamento…" : "Conferma modifica"}</Button></>}>
      {error ? <CommerceNotice>{error}</CommerceNotice> : null}
      {change.kind==="site"?<CommerceField id="member-site" label="Sede operativa" hint="Scegli una sede attiva. Senza assegnazione, l’utente non ha un perimetro operativo di sede."><Select value={change.value??""} disabled={busy} onChange={e=>setChange({...change,value:e.target.value})}><option value="">Nessuna sede assegnata</option>{siteState.context?.sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}</Select></CommerceField>:null}
      <p>{change.kind === "remove" ? "L’utente perderà l’accesso al gestionale." : change.kind === "role" ? `Nuovo ruolo: ${ruoloLabel[change.value!]}. I permessi verranno aggiornati dal server.` : change.kind === "site" ? siteState.context?.enforced ? "L’operatore lavorerà sui dati della sede assegnata. L’anagrafica clienti resta condivisa tra le sedi." : "Puoi salvare l’assegnazione. Il filtro dei dati per sede sarà disponibile dopo l’attivazione; per ora la vista resta aziendale." : `Nuovo stato: ${statoLabel[change.value!]}. Lo stato controlla l’accesso dell’utente.`}</p>
    </CommerceDrawer> : null}
  </section>;
};
