import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { stoppageStatusOptions } from "../../../domain/constants/stoppage-status";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { EmptyState } from "../../components/common/table";
import { PremiumLockGate } from "../../components/common/premium-lock-gate";
import { PageHeader } from "../../components/layout/page-header";
import { StoppageQuickPanel } from "../../components/stoppages/stoppage-quick-panel";
import { StoppageStatusBadge } from "../../components/stoppages/status-badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useAsync } from "../../hooks/use-async";
import { useEntitlements } from "../../hooks/use-entitlements";

const statusOptions = [
  { value: "", label: "Tutti gli stati" },
  ...stoppageStatusOptions.map((option) =>
    option.value === "OPEN" ? { value: "OPEN_ACTIVE", label: "Fermi aperti" } : option
  )
];
const rowActionDefault = "OPEN_DETAIL";
const rowActionOptions = [
  { value: "OPEN_DETAIL", label: "Apri dettaglio" },
  { value: "EDIT", label: "Modifica fermo" },
  { value: "REMINDER_EMAIL", label: "Invia reminder email" },
  { value: "WHATSAPP", label: "Apri WhatsApp" },
  { value: "STATUS_OPEN", label: "Stato: Aperto" },
  { value: "STATUS_IN_PROGRESS", label: "Stato: In lavorazione" },
  { value: "STATUS_WAITING_PARTS", label: "Stato: In attesa ricambi" },
  { value: "STATUS_SOLICITED", label: "Stato: Sollecitato" },
  { value: "STATUS_CLOSED", label: "Stato: Chiuso" },
  { value: "STATUS_CANCELED", label: "Stato: Annullato" }
] as const;

export const StoppagesListPage = () => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [siteId, setSiteId] = useState("");
  const [workshopId, setWorkshopId] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("IN_PROGRESS");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"detail" | "edit" | "create">("detail");
  const [refreshKey, setRefreshKey] = useState(0);
  const [rowActions, setRowActions] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const { can } = useEntitlements();

  const masterData = useAsync(
    () => Promise.all([masterDataUseCases.listSites({ page: 1, pageSize: 200 }), masterDataUseCases.listWorkshops({ page: 1, pageSize: 200 })]),
    []
  );

  const { data, loading, error } = useAsync(
    () => stoppagesUseCases.list({ search, status, siteId, workshopId, page, pageSize: 10 }),
    [search, status, siteId, workshopId, page, refreshKey]
  );

  const alerts = useAsync(() => stoppagesUseCases.alerts(), [page, status, siteId, workshopId, search, refreshKey]);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const totalRows = data?.total ?? 0;
  const alertRows = useMemo(() => (alerts.data?.data ?? []) as any[], [alerts.data]);
  const sites = masterData.data?.[0]?.data ?? [];
  const workshops = masterData.data?.[1]?.data ?? [];

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  const runBulk = async (action: "SET_STATUS" | "SEND_REMINDER") => {
    if (!selectedIds.length) return;
    await stoppagesUseCases.bulkUpdate({
      ids: selectedIds,
      action,
      ...(action === "SET_STATUS" ? { status: bulkStatus as any } : {})
    });
    setSelectedIds([]);
    setRefreshKey((x) => x + 1);
  };

  const onInlineStatusChange = async (id: string, nextStatus: string) => {
    await stoppagesUseCases.updateStatus(id, nextStatus as any);
    setRefreshKey((x) => x + 1);
  };

  const resetFilters = () => {
    setSearch("");
    setStatus("");
    setSiteId("");
    setWorkshopId("");
    setPage(1);
  };

  const runRowAction = async (item: any) => {
    const action = rowActions[item.id] ?? rowActionDefault;

    if (action === "OPEN_DETAIL") {
      setPanelId(item.id);
      setPanelMode("detail");
      setPanelOpen(true);
      return;
    }

    if (action === "EDIT") {
      setPanelId(item.id);
      setPanelMode("edit");
      setPanelOpen(true);
      return;
    }

    if (action === "REMINDER_EMAIL") {
      await stoppagesUseCases.sendEmailReminder(item.id);
      setRefreshKey((x) => x + 1);
      return;
    }

    if (action === "WHATSAPP") {
      const { url } = await stoppagesUseCases.getWhatsappLink(item.id);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    if (action.startsWith("STATUS_")) {
      const nextStatus = action.replace("STATUS_", "");
      await onInlineStatusChange(item.id, nextStatus);
    }
  };

  if (loading) return <FleetumBlockLoader label="Caricamento fermi" />;
  if (error)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Riprova</Button>
      </div>
    );

  return (
    <section className="space-y-3">
      <PageHeader
        title="Fermi Tecnici"
        subtitle="Controlla stato, priorità, reminder e assegnazioni da una vista centralizzata."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/fermi/kanban")}>Vista Kanban</Button>
            <Button onClick={() => navigate("/fermi/nuovo")}>Nuovo fermo</Button>
          </>
        }
      />

      <Card className="saas-surface">
        <CardContent className="py-6">
          <div className="mx-auto flex min-h-[68px] w-full max-w-[1180px] flex-nowrap items-center justify-center gap-2">
            <Input
              className="h-9 w-[300px] min-w-[220px]"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cerca targa, sede, officina, motivo..."
            />

            <Select
              className="h-9 w-[150px]"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>

            <Select
              className="h-9 w-[150px]"
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Sedi: tutte</option>
              {sites.map((site: any) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </Select>

            <Select
              className="h-9 w-[165px]"
              value={workshopId}
              onChange={(e) => {
                setWorkshopId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Officine: tutte</option>
              {workshops.map((workshop: any) => (
                <option key={workshop.id} value={workshop.id}>{workshop.name}</option>
              ))}
            </Select>

            <Button variant="outline" size="sm" className="h-9 shrink-0 px-3" onClick={resetFilters}>
              Reset
            </Button>

            <div className="ml-1 flex shrink-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>{rows.length}/{totalRows} fermi</span>
              <span>{alertRows.length} alert</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nessun fermo trovato" />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((item) => (
              <Card key={item.id} className="shadow-sm">
                <CardContent className="space-y-2 pt-4">
                  <p className="text-sm"><span className="text-muted-foreground">Targa: </span><span className="font-semibold">{item.vehicle?.plate}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Veicolo: </span>{item.vehicle?.brand} {item.vehicle?.model}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Sede: </span>{item.site?.name}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Officina: </span>{item.workshop?.name}</p>
                  <div><StoppageStatusBadge status={item.status} /></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />Seleziona</label>
                  <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
                    <Select
                      value={rowActions[item.id] ?? rowActionDefault}
                      onChange={(e) => setRowActions((current) => ({ ...current, [item.id]: e.target.value }))}
                      className="h-9 text-xs"
                    >
                      {rowActionOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                    <Button variant="outline" size="sm" className="h-9 px-3" onClick={() => void runRowAction(item)}>
                      Esegui
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="table-fixed text-[12px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[48px]">Sel.</TableHead>
                  <TableHead className="w-[22%]">Veicolo</TableHead>
                  <TableHead className="w-[24%]">Sede / Officina</TableHead>
                  <TableHead className="w-[22%]">Motivo</TableHead>
                  <TableHead className="w-[18%]">Stato</TableHead>
                  <TableHead className="w-[14%] text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />
                    </TableCell>

                    <TableCell className="py-2">
                      <p className="truncate text-xs font-semibold">{item.vehicle?.plate}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.vehicle?.brand} {item.vehicle?.model}</p>
                    </TableCell>

                    <TableCell className="py-2">
                      <p className="truncate text-xs">{item.site?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.workshop?.name}</p>
                    </TableCell>

                    <TableCell className="py-2">
                      <p className="line-clamp-2 text-xs" title={item.reason}>{item.reason}</p>
                    </TableCell>

                    <TableCell className="py-2">
                      <StoppageStatusBadge status={item.status} />
                    </TableCell>

                    <TableCell className="py-2">
                      <div className="grid grid-cols-[1fr_auto] gap-1.5">
                        <Select
                          value={rowActions[item.id] ?? rowActionDefault}
                          onChange={(e) => setRowActions((current) => ({ ...current, [item.id]: e.target.value }))}
                          className="h-7 text-[11px]"
                        >
                          {rowActionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void runRowAction(item)}>
                          Esegui
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prec.</Button>
        <span className="text-sm text-muted-foreground">Pagina {page}</span>
        <Button variant="outline" size="sm" disabled={(data?.total ?? 0) <= page * 10} onClick={() => setPage((p) => p + 1)}>Succ.</Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card className="saas-surface">
          <CardHeader className="pb-3"><CardTitle className="text-base">Azioni Massive</CardTitle></CardHeader>
          {can("bulk_actions") ? (
            <CardContent className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Selezionati: {selectedIds.length}</span>
              <Select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                {statusOptions
                  .filter((x) => x.value)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </Select>
              <Button variant="outline" onClick={() => runBulk("SET_STATUS")} disabled={!selectedIds.length}>
                Applica stato
              </Button>
              <Button variant="secondary" onClick={() => runBulk("SEND_REMINDER")} disabled={!selectedIds.length}>
                Reminder bulk
              </Button>
            </CardContent>
          ) : (
            <PremiumLockGate feature="bulk_actions" title="Azioni massive bloccate" description="Bulk status e reminder bulk richiedono almeno il piano PRO.">
              <CardContent className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Selezionati: {selectedIds.length}</span>
                <Select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                  {statusOptions
                    .filter((x) => x.value)
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </Select>
                <Button variant="outline" disabled>
                  Applica stato
                </Button>
                <Button variant="secondary" disabled>
                  Reminder bulk
                </Button>
              </CardContent>
            </PremiumLockGate>
          )}
        </Card>

        <Card className="saas-surface">
          <CardHeader className="pb-3"><CardTitle className="text-base">Centro Alert</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alertRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun alert operativo aperto.</p>
            ) : (
              alertRows.slice(0, 5).map((alert: any) => (
                <div key={alert.id} className="rounded-md border p-2 text-sm">
                  <p className="font-medium">{alert.plate} - {alert.message}</p>
                  <p className="text-muted-foreground">{alert.site} / {alert.workshop} · {alert.daysOpen} giorni</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <StoppageQuickPanel
        open={panelOpen}
        stoppageId={panelId}
        mode={panelMode}
        onClose={() => setPanelOpen(false)}
        onSaved={() => setRefreshKey((x) => x + 1)}
      />
    </section>
  );
};
