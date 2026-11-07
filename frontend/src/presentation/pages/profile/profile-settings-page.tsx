import {captureOperationContext,publishOperationFeedback} from "../../../application/stores/operation-feedback";
import { useCompanySiteView } from "../../components/layout/site-context";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { settingsUseCases } from "../../../application/usecases/settings-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { ThemeMode, getStoredTheme, setTheme } from "../../../infrastructure/theme/theme-manager";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { CommerceDrawer, CommerceNotice } from "../../components/ui/commerce-workspace";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useEntitlements } from "../../hooks/use-entitlements";

const settingsStorageKey = "fermi_user_settings_v1";

type SettingsState = {
  defaultStatusFilter: string;
  defaultPageSize: string;
  compactCards: string;
  theme: ThemeMode;
};

const defaultSettings: SettingsState = {
  defaultStatusFilter: "",
  defaultPageSize: "10",
  compactCards: "NO",
  theme: "light"
};

export const ProfileSettingsPage = () => {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuthStore();
  const companyView=useCompanySiteView();
  const { can } = useEntitlements();
  const canReadSettings = companyView && Boolean(user?.permissions.some(p => p === "*" || p === "stats:read"));
  const canWriteSettings = companyView && Boolean(user?.permissions.some(p => p === "*" || p === "users:write"));
  const identity = `${user?.tenantId}:${user?.id}`;
  const [tab, setTab] = useState("account");
  const [busy, setBusy] = useState<string | null>(null);
  const [sectionOwner, setSectionOwner] = useState(identity);
  const [sectionState, setSectionState] = useState<Record<string, "loading" | "ready" | "error">>({});
  const currentSectionState = (key: string) => sectionOwner === identity ? sectionState[key] : undefined;
  const [reloadKey, setReloadKey] = useState(0);
  const [revocation, setRevocation] = useState<string | null>(null);
  const lock = useRef(false), activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const runTask = async (key: string, action: () => Promise<unknown>, message?: string) => {
    const notificationScope=captureOperationContext();
    if (lock.current) return;
    lock.current = true; setBusy(key); setError(null); setSuccess(null);
    const owner = identity;
    try { await action(); if (activeIdentity.current === owner && message) publishOperationFeedback(setSuccess, message, notificationScope); }
    catch (e) { if (activeIdentity.current === owner) setError((e as Error).message); }
    finally { lock.current = false; setBusy(null); }
  };
  const canScheduledReports = can("scheduled_reports");
  const canIntegrations = can("integrations_basic");
  const canWebhooks = can("webhooks");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoutAllDevices, setLogoutAllDevices] = useState(false);
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      userAgent?: string | null;
      ipAddress?: string | null;
      createdAt: string;
      expiresAt: string;
      revokedAt?: string | null;
    }>
  >([]);
  const [sla, setSla] = useState<any>({ LOW: 15, MEDIUM: 10, HIGH: 5, CRITICAL: 2 });
  const [playbooks, setPlaybooks] = useState<any>({
    WAITING_PARTS: { enabled: true, reminderEveryDays: 3 },
    SOLICITED: { enabled: true, reminderEveryDays: 2 }
  });
  const [reports, setReports] = useState<any>({ enabled: false, recipients: [], frequency: "weekly", hour: 8, minute: 0, reportStyle: "EXECUTIVE" });
  const [reportRecipients, setReportRecipients] = useState("");
  const [integrations, setIntegrations] = useState<any>({ erpWebhookUrl: "", telematicsWebhookUrl: "", ticketingWebhookUrl: "" });

  const initialSettings = useMemo<SettingsState>(() => {
    try {
      const raw = localStorage.getItem(settingsStorageKey);
      if (!raw) return { ...defaultSettings, theme: getStoredTheme() };
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed, theme: (parsed.theme === "dark" ? "dark" : parsed.theme === "light" ? "light" : getStoredTheme()) as ThemeMode };
    } catch {
      return { ...defaultSettings, theme: getStoredTheme() };
    }
  }, []);
  const [settings, setSettings] = useState<SettingsState>(initialSettings);

  useEffect(() => {
    let cancelled = false;
    setError(null); setSuccess(null); setSessions([]); setRevocation(null); setSectionOwner(identity); setSectionState({});
    const load = async (key: string, action: () => Promise<unknown>, apply: (value: any) => void) => {
      setSectionState(current => ({ ...current, [key]: "loading" }));
      try {
        const result = await action();
        if (cancelled) return;
        apply(result); setSectionState(current => ({ ...current, [key]: "ready" }));
      } catch {
        if (!cancelled) setSectionState(current => ({ ...current, [key]: "error" }));
      }
    };
    void load("sessions", authUseCases.sessions, result => setSessions((result.data ?? []).filter((x: any) => !x.revokedAt)));
    if (canReadSettings) {
      void load("automation", async () => Promise.all([settingsUseCases.getSla(), settingsUseCases.getPlaybooks()]), ([nextSla, nextPlaybooks]) => { setSla(nextSla); setPlaybooks(nextPlaybooks); });
      if (canScheduledReports) void load("reports", settingsUseCases.getReports, result => { setReports(result); setReportRecipients((result.recipients ?? []).join(", ")); });
      if (canWebhooks) void load("integrations", settingsUseCases.getIntegrations, setIntegrations);
    }
    return () => { cancelled = true; };
  }, [identity, canReadSettings, canScheduledReports, canWebhooks, reloadKey]);

  const reloadSessions = async () => {
    try {
      const result = await authUseCases.sessions();
      if (activeIdentity.current !== identity) return;
      setSessions((result.data ?? []).filter(x => !x.revokedAt));
      setSectionState(current => ({ ...current, sessions: "ready" }));
    } catch (e) { setSectionState(current => ({ ...current, sessions: "error" })); throw e; }
  };

  const logoutAndRedirect = async () => {
    try {
      await authUseCases.logout();
    } catch {
      // Force local logout even if API is temporarily unreachable.
    }
    logout();
    navigate("/login");
  };

  const onProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await runTask("profile", async () => {
      const updated = await authUseCases.updateProfile({ firstName: String(form.get("firstName") || "").trim(), lastName: String(form.get("lastName") || "").trim() });
      if (activeIdentity.current === identity) setUser(updated);
    }, "Profilo aggiornato correttamente.");
  };
  const onPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const formEl = event.currentTarget, form = new FormData(formEl);
    const newPassword = String(form.get("newPassword") || "");
    if (newPassword !== String(form.get("confirmPassword") || "")) { setSuccess(null); setError("La conferma password non coincide."); return; }
    await runTask("password", async () => {
      await authUseCases.changePassword({ currentPassword: String(form.get("currentPassword") || ""), newPassword, logoutAllDevices });
      if (activeIdentity.current !== identity) return;
      formEl.reset();
      if (logoutAllDevices) { await logoutAndRedirect(); return; }
      try { await reloadSessions(); } catch { setError("Password aggiornata. L’elenco delle sessioni non è disponibile: aggiorna l’elenco."); }
    }, "Password aggiornata correttamente.");
  };
  const onSaveSettings = () => {
    try { localStorage.setItem(settingsStorageKey, JSON.stringify(settings)); setTheme(settings.theme); setSuccess("Preferenze salvate su questo dispositivo."); setError(null); }
    catch { setSuccess(null); setError("Il browser non permette di salvare le preferenze. Riprova dopo aver abilitato l’archiviazione locale."); }
  };
  const saveAutomation = async () => {
    if (!canReadSettings || !canWriteSettings || currentSectionState("automation") !== "ready") return;
    await runTask("automation", async () => {
      await settingsUseCases.updateSla(sla);
      try { await settingsUseCases.updatePlaybooks(playbooks); }
      catch { throw Error("SLA salvati. I playbook non sono stati aggiornati: riprova il salvataggio."); }
    }, "SLA e playbook salvati.");
  };
  const saveReports = async () => {
    if (!canReadSettings || !canWriteSettings || !canScheduledReports || currentSectionState("reports") !== "ready") return;
    const payload={...reports,recipients:reportRecipients.split(",").map(value=>value.trim()).filter(Boolean)};delete payload.siteConfirmationRequired;
    await runTask("reports",async()=>{await settingsUseCases.updateReports(payload);setReports((current:any)=>({...current,siteConfirmationRequired:false}));},"Report schedulati salvati.");
  };
  const saveIntegrations = async () => {
    if (!canReadSettings || !canWriteSettings || !canWebhooks || currentSectionState("integrations") !== "ready") return;
    await runTask("integrations", () => settingsUseCases.updateIntegrations(integrations), "Integrazioni salvate.");
  };
  const revokeConfirmed = async () => {
    if (!revocation || currentSectionState("sessions") !== "ready") return;
    await runTask("sessions", async () => {
      if (revocation === "all") { await authUseCases.revokeAllSessions(); if (activeIdentity.current === identity) await logoutAndRedirect(); }
      else { await authUseCases.revokeSession(revocation); setRevocation(null); await reloadSessions(); }
    }, "Revoca completata.");
  };
  const loadNotice = (key: string) => currentSectionState(key) === "ready" ? null : <div className="admin-load-state" role={currentSectionState(key) === "error" ? "alert" : "status"}>{currentSectionState(key) === "error" ? <>Questa sezione non è disponibile. I valori non sono stati caricati. <Button variant="outline" onClick={() => setReloadKey(key => key + 1)}>Riprova</Button></> : "Caricamento della sezione…"}</div>;

  return (
    <section className="administration-workspace" key={identity}>
      <WorkspacePageHeader eyebrow="IL TUO ACCOUNT" title="Profilo e impostazioni" description="I tuoi dati, la sicurezza dell’accesso e le preferenze di lavoro."/>
      <nav className="admin-section-nav" aria-label="Sezioni del profilo">{[["account","Dati personali"],["security","Sicurezza"],["preferences","Preferenze"],["company","Impostazioni aziendali"]].map(([key,label]) => <button type="button" key={key} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); setError(null); setSuccess(null); }}>{label}</button>)}</nav>
      {error ? <CommerceNotice>{error}</CommerceNotice> : null}
      {success ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
      <div className="admin-profile-sections">
        <Card hidden={tab !== "account"}>
          <CardHeader>
            <h2 className="text-base">Dati profilo</h2>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={onProfileSubmit}><fieldset disabled={Boolean(busy)} className="contents">
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-1">Nome</Label>
                <Input id="profile-field-1" name="firstName" defaultValue={user?.firstName ?? ""} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-2">Cognome</Label>
                <Input id="profile-field-2" name="lastName" defaultValue={user?.lastName ?? ""} required />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="profile-field-3">Email</Label>
                <Input id="profile-field-3" value={user?.email ?? ""} disabled />
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Salva profilo</Button>
              </div>
            </fieldset></form>
          </CardContent>
        </Card>

        <Card hidden={tab !== "security"}>
          <CardHeader>
            <h2 className="text-base">Sicurezza</h2>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={onPasswordSubmit}><fieldset disabled={Boolean(busy)} className="contents">
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-4">Password attuale</Label>
                <Input id="profile-field-4" name="currentPassword" type="password" autoComplete="current-password" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-5">Nuova password</Label>
                <Input id="profile-field-5" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-6">Conferma nuova password</Label>
                <Input id="profile-field-6" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={logoutAllDevices}
                  onChange={(e) => setLogoutAllDevices(e.target.checked)}
                />
                Disconnetti tutti i dispositivi dopo il cambio password
              </label>
              <Button type="submit" variant="secondary">Aggiorna password</Button>
            </fieldset></form>
          </CardContent>
        </Card>
      </div>

      <Card hidden={tab !== "security"}>
        <CardHeader>
          <h2 className="text-base">Sessioni attive</h2>
        </CardHeader>
        <CardContent className="space-y-3">{loadNotice("sessions")}<fieldset disabled={Boolean(busy) || currentSectionState("sessions") !== "ready"} hidden={currentSectionState("sessions") !== "ready"} className="contents">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void runTask("sessions", reloadSessions, "Sessioni aggiornate.")}
            >
              Aggiorna elenco
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRevocation("all")}
            >
              Revoca tutte le sessioni
            </Button>
          </div>

          <div className="space-y-2 md:hidden">
            {sessions.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna sessione attiva.</p> : null}
            {sessions.map((session) => {
              return (
                <Card key={session.id}>
                  <CardContent className="space-y-2 pt-4">
                    <p className="text-sm font-medium">Sessione attiva</p>
                    <p className="text-xs text-muted-foreground">{session.userAgent || "Device non disponibile"}</p>
                    <p className="text-xs text-muted-foreground">IP: {session.ipAddress || "-"}</p>
                    <p className="text-xs text-muted-foreground">Login: {new Date(session.createdAt).toLocaleString("it-IT")}</p>
                    <p className="text-xs text-muted-foreground">Scadenza: {new Date(session.expiresAt).toLocaleString("it-IT")}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRevocation(session.id)}
                    >
                      Revoca sessione
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden md:block">
            <Table className="[&_th]:py-1.5 [&_td]:py-1.5 [&_td]:text-[12px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Nessuna sessione attiva.
                    </TableCell>
                  </TableRow>
                ) : (
                  sessions.map((session) => {
                          return (
                      <TableRow key={session.id}>
                        <TableCell className="leading-tight">
                          <div>
                            <p className="font-medium">Sessione attiva</p>
                            <p className="text-xs text-muted-foreground">{session.userAgent || "Device non disponibile"}</p>
                          </div>
                        </TableCell>
                        <TableCell>{session.ipAddress || "-"}</TableCell>
                        <TableCell>{new Date(session.createdAt).toLocaleString("it-IT")}</TableCell>
                        <TableCell>{new Date(session.expiresAt).toLocaleString("it-IT")}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setRevocation(session.id)}
                          >
                            Revoca sessione
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </fieldset></CardContent>
      </Card>

      <Card hidden={tab !== "preferences"}>
        <CardHeader>
          <h2 className="text-base">Preferenze interfaccia</h2>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-7">Filtro stato predefinito</Label>
            <Select id="profile-field-7" value={settings.defaultStatusFilter} onChange={(e) => setSettings((s) => ({ ...s, defaultStatusFilter: e.target.value }))}>
              <option value="">Tutti gli stati</option>
              <option value="OPEN">Aperto</option>
              <option value="IN_PROGRESS">In lavorazione</option>
              <option value="WAITING_PARTS">In attesa ricambi</option>
              <option value="SOLICITED">Sollecitato</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-8">Righe per pagina</Label>
            <Select id="profile-field-8" value={settings.defaultPageSize} onChange={(e) => setSettings((s) => ({ ...s, defaultPageSize: e.target.value }))}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-9">Card compatte su mobile</Label>
            <Select id="profile-field-9" value={settings.compactCards} onChange={(e) => setSettings((s) => ({ ...s, compactCards: e.target.value }))}>
              <option value="NO">No</option>
              <option value="SI">Sì</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-10">Tema</Label>
            <Select id="profile-field-10" value={settings.theme} onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value as ThemeMode }))}>
              <option value="light">Chiaro</option>
              <option value="dark">Scuro</option>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Button onClick={onSaveSettings}>Salva impostazioni</Button>
          </div>
        </CardContent>
      </Card>

      <Card hidden={tab !== "company" || !canReadSettings}>
        <CardHeader><h2 className="text-base">SLA e Playbook</h2></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">{loadNotice("automation")}<fieldset disabled={Boolean(busy) || !canWriteSettings || currentSectionState("automation") !== "ready"} hidden={currentSectionState("automation") !== "ready"} className="contents">
          {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((key) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`profile-sla-${key}`}>SLA {({ LOW: "Bassa", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Critica" } as Record<string, string>)[key]} (giorni)</Label>
              <Input id={`profile-sla-${key}`} type="number" min={1} value={sla[key] ?? ""} onChange={(e) => setSla((s: any) => ({ ...s, [key]: Number(e.target.value) }))} />
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-12">Playbook Attesa Ricambi (giorni)</Label>
            <Input id="profile-field-12"
              type="number"
              min={1}
              value={playbooks?.WAITING_PARTS?.reminderEveryDays ?? 3}
              onChange={(e) =>
                setPlaybooks((p: any) => ({ ...p, WAITING_PARTS: { ...(p.WAITING_PARTS ?? {}), enabled: true, reminderEveryDays: Number(e.target.value) } }))
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-field-13">Playbook Sollecitato (giorni)</Label>
            <Input id="profile-field-13"
              type="number"
              min={1}
              value={playbooks?.SOLICITED?.reminderEveryDays ?? 2}
              onChange={(e) =>
                setPlaybooks((p: any) => ({ ...p, SOLICITED: { ...(p.SOLICITED ?? {}), enabled: true, reminderEveryDays: Number(e.target.value) } }))
              }
            />
          </div>
          <div className="md:col-span-4">
            <Button
              onClick={() => void saveAutomation()}
            >
              Salva SLA/Playbook
            </Button>
          </div>
        </fieldset></CardContent>
      </Card>

      <div hidden={tab !== "company" || !canReadSettings} className="admin-profile-sections">
        {canScheduledReports ? (
          <Card>
            <CardHeader><h2 className="text-base">Report schedulati</h2></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">{loadNotice("reports")}{currentSectionState("reports")==="ready"&&reports.siteConfirmationRequired?<div className="md:col-span-2"><CommerceNotice>Gli invii di questa configurazione sono sospesi. Un responsabile autorizzato deve verificare i destinatari e salvare di nuovo i report nella vista Tutte le sedi.</CommerceNotice></div>:null}<fieldset disabled={Boolean(busy) || !canWriteSettings || currentSectionState("reports") !== "ready"} hidden={currentSectionState("reports") !== "ready"} className="contents">
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-14">Abilita report schedulati</Label>
                <Select id="profile-field-14" value={reports.enabled ? "SI" : "NO"} onChange={(e) => setReports((r: any) => ({ ...r, enabled: e.target.value === "SI" }))}>
                  <option value="NO">No</option>
                  <option value="SI">Sì</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-15">Frequenza</Label>
                <Select id="profile-field-15" value={reports.frequency ?? "weekly"} onChange={(e) => setReports((r: any) => ({ ...r, frequency: e.target.value }))}>
                  <option value="daily">Giornaliera</option>
                  <option value="weekly">Settimanale</option>
                  <option value="monthly">Mensile</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-field-16">Stile report</Label>
                <Select id="profile-field-16" value={reports.reportStyle ?? "EXECUTIVE"} onChange={(e) => setReports((r: any) => ({ ...r, reportStyle: e.target.value }))}>
                  <option value="EXECUTIVE">Executive</option>
                  <option value="BASIC">Basic</option>
                </Select>
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="profile-field-17">Destinatari report (email separate da virgola)</Label>
                <Input id="profile-field-17"
                  value={reportRecipients}
                  onChange={(e) => setReportRecipients(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  onClick={() => void saveReports()}
                >
                  Salva report schedulati
                </Button>
              </div>
            </fieldset></CardContent>
          </Card>
        ) : null}

        {canIntegrations ? (
          <Card>
            <CardHeader><h2 className="text-base">Integrazioni</h2></CardHeader>
            <CardContent className="space-y-3">{loadNotice("integrations")}<fieldset disabled={Boolean(busy) || !canWriteSettings || currentSectionState("integrations") !== "ready"} hidden={currentSectionState("integrations") !== "ready"} className="contents">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Connettori base attivi. Per configurazioni webhook avanzate serve il piano ENTERPRISE.
              </div>

              {canWebhooks ? (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="profile-field-18">ERP Webhook URL</Label>
                    <Input id="profile-field-18" value={integrations.erpWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, erpWebhookUrl: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="profile-field-19">Telematics Webhook URL</Label>
                    <Input id="profile-field-19" value={integrations.telematicsWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, telematicsWebhookUrl: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="profile-field-20">Ticketing Webhook URL</Label>
                    <Input id="profile-field-20" value={integrations.ticketingWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, ticketingWebhookUrl: e.target.value }))} />
                  </div>
                  <Button
                    onClick={() => void saveIntegrations()}
                  >
                    Salva integrazioni
                  </Button>
                </div>
              ) : null}
            </fieldset></CardContent>
          </Card>
        ) : null}
      </div>

      {tab === "company" ? <p className="admin-context">{canReadSettings ? canWriteSettings ? "Queste impostazioni sono condivise da tutta l’azienda." : "Accesso in sola lettura alle impostazioni aziendali." : "Il tuo ruolo non consente di consultare le impostazioni aziendali."}</p> : null}
      {revocation ? <CommerceDrawer compact title={revocation === "all" ? "Revocare tutte le sessioni?" : "Revocare questa sessione?"} description="La revoca impedisce nuovi accessi da questa sessione. Potrebbe includere il dispositivo che stai usando." busy={Boolean(busy)} onClose={() => setRevocation(null)} footer={<><Button variant="outline" onClick={() => setRevocation(null)} disabled={Boolean(busy)}>Annulla</Button><Button variant="destructive" onClick={() => void revokeConfirmed()} disabled={Boolean(busy)}>Conferma revoca</Button></>}>{error ? <CommerceNotice>{error}</CommerceNotice> : null}<p>{revocation === "all" ? "Uscirai anche da questo dispositivo e dovrai accedere nuovamente." : "Per accedere nuovamente da quel dispositivo servirà una nuova autenticazione."}</p></CommerceDrawer> : null}
    </section>
  );
};
