import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus } from "lucide-react";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { CardStat } from "../../components/common/table";
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

type DeadlineRow = {
  vehicleId: string;
  plate: string;
  brand: string;
  model: string;
  siteName: string;
  currentKm: number | null;
  maintenanceIntervalKm: number | null;
  remainingKm: number | null;
  lastRevisionAt: string | null;
  revisionDueAt: string | null;
  daysToRevision: number | null;
  dueByKm: boolean;
  dueSoonByKm: boolean;
  dueByRevision: boolean;
  dueSoonByRevision: boolean;
  status: "SCADUTA" | "IN_SCADENZA" | "OK";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  actions: string[];
};

type DeadlineResponse = {
  kpis: {
    total: number;
    dueNowKm: number;
    dueSoonKm: number;
    dueNowRevision: number;
    dueSoonRevision: number;
    critical: number;
  };
  data: DeadlineRow[];
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT");
};

const formatMonthYear = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};

const formatKm = (value?: number | null) => (typeof value === "number" ? value.toLocaleString("it-IT") : "-");

const severityBadgeVariant = (severity: DeadlineRow["severity"]) => {
  if (severity === "CRITICAL" || severity === "HIGH") return "destructive";
  if (severity === "MEDIUM") return "warning";
  return "secondary";
};

export const VehicleDeadlinesPage = () => {
  const [rows, setRows] = useState<DeadlineRow[]>([]);
  const [kpis, setKpis] = useState<DeadlineResponse["kpis"]>({
    total: 0,
    dueNowKm: 0,
    dueSoonKm: 0,
    dueNowRevision: 0,
    dueSoonRevision: 0,
    critical: 0
  });
  const [kmWarning, setKmWarning] = useState("1000");
  const [revisionWarningDays, setRevisionWarningDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingVehicleId, setSyncingVehicleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await masterDataUseCases.listVehicleDeadlines({
        kmWarning: Number(kmWarning) || 1000,
        revisionWarningDays: Number(revisionWarningDays) || 30
      })) as DeadlineResponse;
      setRows(result.data ?? []);
      setKpis(result.kpis ?? kpis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSyncAll = async () => {
    setSyncingAll(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await masterDataUseCases.syncVehicleDeadlinesCalendar({
        includeSoon: true,
        kmWarning: Number(kmWarning) || 1000,
        revisionWarningDays: Number(revisionWarningDays) || 30
      });
      setSuccess(`Calendario aggiornato: ${result.created} creati, ${result.updated} aggiornati, ${result.removed} rimossi.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncingAll(false);
    }
  };

  const onSyncSingle = async (vehicleId: string) => {
    setSyncingVehicleId(vehicleId);
    setError(null);
    setSuccess(null);
    try {
      const result = await masterDataUseCases.syncVehicleDeadlinesCalendar({
        vehicleIds: [vehicleId],
        includeSoon: true,
        kmWarning: Number(kmWarning) || 1000,
        revisionWarningDays: Number(revisionWarningDays) || 30
      });
      setSuccess(`Veicolo sincronizzato: ${result.created} creati, ${result.updated} aggiornati, ${result.removed} rimossi.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncingVehicleId(null);
    }
  };

  const activeAlerts = useMemo(() => rows.filter((row) => row.status !== "OK"), [rows]);

  return (
    <section className="space-y-3">
      <PageHeader
        title="Scadenziario Veicoli"
        subtitle="Alert su manutenzione chilometrica e revisione con sincronizzazione task nel calendario."
        actions={
          <Button onClick={() => void onSyncAll()} disabled={syncingAll || loading}>
            <CalendarPlus className="h-4 w-4" />
            {syncingAll ? "Sincronizzazione..." : "Sincronizza tutto nel calendario"}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <div className="g-stats-grid grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <CardStat title="Alert totali" value={kpis.total} className="h-full" />
        <CardStat title="KM scaduti" value={kpis.dueNowKm} className="h-full" />
        <CardStat title="KM in scadenza" value={kpis.dueSoonKm} className="h-full" />
        <CardStat title="Revisioni scadute" value={kpis.dueNowRevision} className="h-full" />
        <CardStat title="Revisioni in scadenza" value={kpis.dueSoonRevision} className="h-full" />
        <CardStat title="Critici" value={kpis.critical} className="h-full" />
      </div>

      <Card className="saas-surface shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configurazione alert</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-[220px_220px_auto]">
            <Input
              type="number"
              min={0}
              value={kmWarning}
              onChange={(event) => setKmWarning(event.target.value)}
              placeholder="Soglia km avviso"
            />
            <Input
              type="number"
              min={0}
              value={revisionWarningDays}
              onChange={(event) => setRevisionWarningDays(event.target.value)}
              placeholder="Giorni avviso revisione"
            />
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <FleetumInlineLoader label="Aggiornamento" /> : "Aggiorna scadenziario"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeAlerts.length === 0 && !loading ? (
        <Card className="saas-surface border-dashed">
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Nessuna scadenza attiva con i parametri correnti.
          </CardContent>
        </Card>
      ) : null}

      <Card className="saas-surface shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Elenco scadenze</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <FleetumInlineLoader label="Caricamento scadenziario" /> : null}

          <div className="space-y-3 md:hidden">
            {activeAlerts.map((row) => (
              <Card key={row.vehicleId} className="border-dashed">
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{row.plate}</p>
                    <Badge variant={severityBadgeVariant(row.severity)}>{row.severity}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.brand} {row.model} · {row.siteName}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">KM residui: </span>
                    {row.remainingKm == null ? "-" : row.remainingKm.toLocaleString("it-IT")}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Revisione: </span>
                    {formatMonthYear(row.revisionDueAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">Ultima revisione: {formatDate(row.lastRevisionAt)}</p>
                  <p className="text-xs text-muted-foreground">{row.actions.join(" · ")}</p>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onSyncSingle(row.vehicleId)}
                      disabled={syncingVehicleId === row.vehicleId}
                    >
                      {syncingVehicleId === row.vehicleId ? "Sync..." : "Segna nel calendario"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="[&_th]:py-1.5 [&_td]:py-1.5 [&_td]:text-[12px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Veicolo</TableHead>
                  <TableHead>Sede</TableHead>
                  <TableHead>Km attuali</TableHead>
                  <TableHead>Intervallo</TableHead>
                  <TableHead>Km residui</TableHead>
                  <TableHead>Revisione</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Azione</TableHead>
                  <TableHead className="text-right">Calendario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAlerts.map((row) => (
                  <TableRow key={row.vehicleId}>
                    <TableCell className="font-medium leading-tight">
                      {row.plate}
                      <p className="text-[11px] text-muted-foreground">{row.brand} {row.model}</p>
                    </TableCell>
                    <TableCell className="leading-tight">{row.siteName}</TableCell>
                    <TableCell>{formatKm(row.currentKm)}</TableCell>
                    <TableCell>{formatKm(row.maintenanceIntervalKm)}</TableCell>
                    <TableCell>{row.remainingKm == null ? "-" : row.remainingKm.toLocaleString("it-IT")}</TableCell>
                    <TableCell className="leading-tight">
                      {formatMonthYear(row.revisionDueAt)}
                      <p className="text-[11px] text-muted-foreground">Ultima: {formatDate(row.lastRevisionAt)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={severityBadgeVariant(row.severity)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="line-clamp-2 text-xs text-muted-foreground">{row.actions.join(" · ")}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void onSyncSingle(row.vehicleId)}
                        disabled={syncingVehicleId === row.vehicleId}
                      >
                        {syncingVehicleId === row.vehicleId ? "Sync..." : "Segna"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
