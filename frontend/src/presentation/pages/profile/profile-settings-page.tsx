import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { settingsUseCases } from "../../../application/usecases/settings-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { PAID_FEATURES, FEATURE_LABELS } from "../../../domain/constants/feature-labels";
import { FeatureKey } from "../../../domain/constants/entitlements";
import { ThemeMode, getStoredTheme, setTheme } from "../../../infrastructure/theme/theme-manager";
import { PremiumLockGate } from "../../components/common/premium-lock-gate";
import { PageHeader } from "../../components/layout/page-header";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
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
  const { can, requiredPlan } = useEntitlements();
  const canScheduledReports = can("scheduled_reports");
  const canIntegrations = can("integrations_basic");
  const canWebhooks = can("webhooks");
  const premiumFeatureList = useMemo(
    () =>
      PAID_FEATURES.map((feature) => ({
        feature,
        label: FEATURE_LABELS[feature as FeatureKey],
        enabled: can(feature as FeatureKey),
        required: requiredPlan(feature as FeatureKey)
      })),
    [can, requiredPlan]
  );
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
  const [integrations, setIntegrations] = useState<any>({ erpWebhookUrl: "", telematicsWebhookUrl: "", ticketingWebhookUrl: "" });

  const initialSettings = useMemo<SettingsState>(() => {
    try {
      const raw = localStorage.getItem(settingsStorageKey);
      if (!raw) return defaultSettings;
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed, theme: (parsed.theme === "dark" ? "dark" : parsed.theme === "light" ? "light" : getStoredTheme()) as ThemeMode };
    } catch {
      return { ...defaultSettings, theme: getStoredTheme() };
    }
  }, []);
  const [settings, setSettings] = useState<SettingsState>(initialSettings);

  useEffect(() => {
    Promise.all([
      settingsUseCases.getSla(),
      settingsUseCases.getPlaybooks(),
      settingsUseCases.getReports(),
      settingsUseCases.getIntegrations(),
      authUseCases.sessions()
    ])
      .then(([slaRes, playbooksRes, reportsRes, integrationsRes, sessionsRes]) => {
        setSla(slaRes);
        setPlaybooks(playbooksRes);
        setReports(reportsRes);
        setIntegrations(integrationsRes);
        setSessions((sessionsRes.data ?? []).filter((x) => !x.revokedAt));
      })
      .catch(() => {
        // ignore init errors
      });
  }, []);

  const currentSessionId = null;

  const reloadSessions = async () => {
    const result = await authUseCases.sessions();
    setSessions((result.data ?? []).filter((x) => !x.revokedAt));
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
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);
    try {
      const updated = await authUseCases.updateProfile({
        firstName: String(form.get("firstName") || "").trim(),
        lastName: String(form.get("lastName") || "").trim()
      });
      setUser(updated);
      setSuccess("Profilo aggiornato correttamente.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (newPassword !== confirmPassword) {
      setError("La conferma password non coincide.");
      return;
    }

    try {
      await authUseCases.changePassword({
        currentPassword: String(form.get("currentPassword") || ""),
        newPassword,
        logoutAllDevices
      });
      setSuccess(
        logoutAllDevices
          ? "Password aggiornata. Tutte le sessioni sono state revocate: effettuo il logout."
          : "Password aggiornata correttamente."
      );
      formEl.reset();
      if (logoutAllDevices) {
        await logoutAndRedirect();
        return;
      }
      await reloadSessions();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onSaveSettings = () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    setTheme(settings.theme);
    setSuccess("Impostazioni salvate.");
    setError(null);
  };

  return (
    <section className="space-y-4">
      <PageHeader
        title="Profilo e Impostazioni"
        subtitle="Gestisci i tuoi dati account e le preferenze operative del gestionale."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dati profilo</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={onProfileSubmit}>
              <div className="grid gap-1.5">
                <Label>Nome</Label>
                <Input name="firstName" defaultValue={user?.firstName ?? ""} required />
              </div>
              <div className="grid gap-1.5">
                <Label>Cognome</Label>
                <Input name="lastName" defaultValue={user?.lastName ?? ""} required />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled />
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Salva profilo</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sicurezza</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={onPasswordSubmit}>
              <div className="grid gap-1.5">
                <Label>Password attuale</Label>
                <Input name="currentPassword" type="password" required />
              </div>
              <div className="grid gap-1.5">
                <Label>Nuova password</Label>
                <Input name="newPassword" type="password" required />
              </div>
              <div className="grid gap-1.5">
                <Label>Conferma nuova password</Label>
                <Input name="confirmPassword" type="password" required />
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
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessioni attive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  setError(null);
                  await reloadSessions();
                  setSuccess("Sessioni aggiornate.");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Aggiorna elenco
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  setError(null);
                  await authUseCases.revokeAllSessions();
                  setSuccess("Tutte le sessioni revocate. Effettuo il logout.");
                  await logoutAndRedirect();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Revoca tutte le sessioni
            </Button>
          </div>

          <div className="space-y-2 md:hidden">
            {sessions.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna sessione attiva.</p> : null}
            {sessions.map((session) => {
              const isCurrent = session.id === currentSessionId;
              return (
                <Card key={session.id} className={isCurrent ? "border-primary/60" : ""}>
                  <CardContent className="space-y-2 pt-4">
                    <p className="text-sm font-medium">{isCurrent ? "Questo dispositivo" : "Altro dispositivo"}</p>
                    <p className="text-xs text-muted-foreground">{session.userAgent || "Device non disponibile"}</p>
                    <p className="text-xs text-muted-foreground">IP: {session.ipAddress || "-"}</p>
                    <p className="text-xs text-muted-foreground">Login: {new Date(session.createdAt).toLocaleString("it-IT")}</p>
                    <p className="text-xs text-muted-foreground">Scadenza: {new Date(session.expiresAt).toLocaleString("it-IT")}</p>
                    <Button
                      size="sm"
                      variant={isCurrent ? "destructive" : "outline"}
                      onClick={async () => {
                        try {
                          setError(null);
                          await authUseCases.revokeSession(session.id);
                          if (isCurrent) {
                            setSuccess("Sessione corrente revocata. Logout in corso.");
                            await logoutAndRedirect();
                            return;
                          }
                          setSuccess("Sessione revocata.");
                          await reloadSessions();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {isCurrent ? "Disconnetti questo dispositivo" : "Revoca sessione"}
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
                    const isCurrent = session.id === currentSessionId;
                    return (
                      <TableRow key={session.id}>
                        <TableCell className="leading-tight">
                          <div>
                            <p className="font-medium">{isCurrent ? "Questo dispositivo" : "Altro dispositivo"}</p>
                            <p className="text-xs text-muted-foreground">{session.userAgent || "Device non disponibile"}</p>
                          </div>
                        </TableCell>
                        <TableCell>{session.ipAddress || "-"}</TableCell>
                        <TableCell>{new Date(session.createdAt).toLocaleString("it-IT")}</TableCell>
                        <TableCell>{new Date(session.expiresAt).toLocaleString("it-IT")}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={isCurrent ? "destructive" : "outline"}
                            className="h-7 px-2 text-[11px]"
                            onClick={async () => {
                              try {
                                setError(null);
                                await authUseCases.revokeSession(session.id);
                                if (isCurrent) {
                                  setSuccess("Sessione corrente revocata. Logout in corso.");
                                  await logoutAndRedirect();
                                  return;
                                }
                                setSuccess("Sessione revocata.");
                                await reloadSessions();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            {isCurrent ? "Disconnetti questo dispositivo" : "Revoca sessione"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferenze interfaccia</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Filtro stato predefinito</Label>
            <Select value={settings.defaultStatusFilter} onChange={(e) => setSettings((s) => ({ ...s, defaultStatusFilter: e.target.value }))}>
              <option value="">Tutti gli stati</option>
              <option value="OPEN">Aperto</option>
              <option value="IN_PROGRESS">In lavorazione</option>
              <option value="WAITING_PARTS">In attesa ricambi</option>
              <option value="SOLICITED">Sollecitato</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Righe per pagina</Label>
            <Select value={settings.defaultPageSize} onChange={(e) => setSettings((s) => ({ ...s, defaultPageSize: e.target.value }))}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Card compatte su mobile</Label>
            <Select value={settings.compactCards} onChange={(e) => setSettings((s) => ({ ...s, compactCards: e.target.value }))}>
              <option value="NO">No</option>
              <option value="SI">Sì</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Tema</Label>
            <Select value={settings.theme} onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value as ThemeMode }))}>
              <option value="light">Chiaro</option>
              <option value="dark">Scuro</option>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Button onClick={onSaveSettings}>Salva impostazioni</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">SLA e Playbook</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((key) => (
            <div key={key} className="grid gap-1.5">
              <Label>SLA {key} (giorni)</Label>
              <Input type="number" min={1} value={sla[key] ?? ""} onChange={(e) => setSla((s: any) => ({ ...s, [key]: Number(e.target.value) }))} />
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label>Playbook Attesa Ricambi (giorni)</Label>
            <Input
              type="number"
              min={1}
              value={playbooks?.WAITING_PARTS?.reminderEveryDays ?? 3}
              onChange={(e) =>
                setPlaybooks((p: any) => ({ ...p, WAITING_PARTS: { ...(p.WAITING_PARTS ?? {}), enabled: true, reminderEveryDays: Number(e.target.value) } }))
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Playbook Sollecitato (giorni)</Label>
            <Input
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
              onClick={async () => {
                await settingsUseCases.updateSla(sla);
                await settingsUseCases.updatePlaybooks(playbooks);
                setSuccess("SLA e playbook salvati.");
              }}
            >
              Salva SLA/Playbook
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {canScheduledReports ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Report schedulati</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Abilita report schedulati</Label>
                <Select value={reports.enabled ? "SI" : "NO"} onChange={(e) => setReports((r: any) => ({ ...r, enabled: e.target.value === "SI" }))}>
                  <option value="NO">No</option>
                  <option value="SI">Sì</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Frequenza</Label>
                <Select value={reports.frequency ?? "weekly"} onChange={(e) => setReports((r: any) => ({ ...r, frequency: e.target.value }))}>
                  <option value="daily">Giornaliera</option>
                  <option value="weekly">Settimanale</option>
                  <option value="monthly">Mensile</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Stile report</Label>
                <Select value={reports.reportStyle ?? "EXECUTIVE"} onChange={(e) => setReports((r: any) => ({ ...r, reportStyle: e.target.value }))}>
                  <option value="EXECUTIVE">Executive</option>
                  <option value="BASIC">Basic</option>
                </Select>
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Destinatari report (email separate da virgola)</Label>
                <Input
                  value={(reports.recipients ?? []).join(",")}
                  onChange={(e) => setReports((r: any) => ({ ...r, recipients: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  onClick={async () => {
                    await settingsUseCases.updateReports(reports);
                    setSuccess("Report schedulati salvati.");
                  }}
                >
                  Salva report schedulati
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <PremiumLockGate
            feature="scheduled_reports"
            title="Report schedulati bloccati"
            description="Automazione invio report disponibile dal piano PRO."
          >
            <Card>
              <CardHeader><CardTitle className="text-base">Report schedulati</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Abilita report schedulati</Label>
                  <Select value="NO" disabled>
                    <option value="NO">No</option>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Frequenza</Label>
                  <Select value="weekly" disabled>
                    <option value="weekly">Settimanale</option>
                  </Select>
                </div>
                <div className="grid gap-1.5 md:col-span-2">
                  <Label>Destinatari report</Label>
                  <Input value="" placeholder="nome@azienda.it" disabled />
                </div>
                <div className="md:col-span-2">
                  <Button disabled>Salva report schedulati</Button>
                </div>
              </CardContent>
            </Card>
          </PremiumLockGate>
        )}

        {canIntegrations ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Integrazioni</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Connettori base attivi. Per configurazioni webhook avanzate serve il piano ENTERPRISE.
              </div>

              <PremiumLockGate
                feature="webhooks"
                compact
                title="Webhook bloccati"
                description="Configurazione webhook disponibile dal piano ENTERPRISE."
              >
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label>ERP Webhook URL</Label>
                    <Input value={integrations.erpWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, erpWebhookUrl: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Telematics Webhook URL</Label>
                    <Input value={integrations.telematicsWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, telematicsWebhookUrl: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Ticketing Webhook URL</Label>
                    <Input value={integrations.ticketingWebhookUrl ?? ""} onChange={(e) => setIntegrations((i: any) => ({ ...i, ticketingWebhookUrl: e.target.value }))} />
                  </div>
                  <Button
                    onClick={async () => {
                      await settingsUseCases.updateIntegrations(integrations);
                      setSuccess("Integrazioni salvate.");
                    }}
                  >
                    Salva integrazioni
                  </Button>
                </div>
              </PremiumLockGate>
            </CardContent>
          </Card>
        ) : (
          <PremiumLockGate
            feature="integrations_basic"
            title="Integrazioni bloccate"
            description="Le integrazioni base sono disponibili dal piano PRO."
          >
            <Card>
              <CardHeader><CardTitle className="text-base">Integrazioni</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1.5">
                  <Label>ERP Webhook URL</Label>
                  <Input value="" placeholder="https://..." disabled />
                </div>
                <div className="grid gap-1.5">
                  <Label>Telematics Webhook URL</Label>
                  <Input value="" placeholder="https://..." disabled />
                </div>
                <div className="grid gap-1.5">
                  <Label>Ticketing Webhook URL</Label>
                  <Input value="" placeholder="https://..." disabled />
                </div>
                <Button disabled>Salva integrazioni</Button>
              </CardContent>
            </Card>
          </PremiumLockGate>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matrice funzionalità premium</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {premiumFeatureList.map((entry) =>
            entry.enabled ? (
              <div key={entry.feature} className="rounded-xl border bg-card p-3">
                <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">Attiva nel tuo piano corrente.</p>
              </div>
            ) : (
              <PremiumLockGate
                key={entry.feature}
                feature={entry.feature as FeatureKey}
                compact
                title={entry.label}
                description={`Disponibile dal piano ${entry.required ?? "PRO"}.`}
              >
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Modulo premium in anteprima.</p>
                </div>
              </PremiumLockGate>
            )
          )}
        </CardContent>
      </Card>

      {error ? <Alert className="border-destructive/50 bg-destructive/10 text-destructive">{error}</Alert> : null}
      {success ? <Alert className="border-emerald-500/50 bg-emerald-50 text-emerald-700">{success}</Alert> : null}
    </section>
  );
};
