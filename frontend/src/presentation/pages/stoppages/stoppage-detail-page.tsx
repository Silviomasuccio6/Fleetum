import { useParams } from "react-router-dom";
import { useState } from "react";
import { stoppageStatusOptions } from "../../../domain/constants/stoppage-status";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { PageHeader } from "../../components/layout/page-header";
import { StoppageStatusBadge } from "../../components/stoppages/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { useAsync } from "../../hooks/use-async";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { snackbar } from "../../../application/stores/snackbar-store";
import { AuthenticatedPhoto } from "../../components/common/authenticated-photo";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";

export const StoppageDetailPage = () => {
  const { id = "" } = useParams();
  const safeId = id.trim();
  const { data, loading, error } = useAsync(
    () => (safeId ? stoppagesUseCases.getById(safeId) : Promise.reject(new Error("Fermo non valido"))),
    [safeId]
  );
  const events = useAsync(() => (safeId ? stoppagesUseCases.events(safeId) : Promise.resolve({ data: [] } as any)), [safeId]);
  const partsOrders = useAsync(
    () => (safeId ? stoppagesUseCases.listPartsOrders(safeId) : Promise.resolve({ data: [] } as any)),
    [safeId]
  );
  const approvals = useAsync(
    () => (safeId ? stoppagesUseCases.listCostApprovals(safeId) : Promise.resolve({ requests: [], decisions: [] } as any)),
    [safeId]
  );
  const costsVariance = useAsync(() => stoppagesUseCases.costsVariance(), [safeId]);
  const escalations = useAsync(() => stoppagesUseCases.slaEscalations(), [safeId]);
  const [nextStatus, setNextStatus] = useState("IN_PROGRESS");
  const [template, setTemplate] = useState<any>(null);
  const [partsForm, setPartsForm] = useState({ description: "", supplier: "", etaDate: "", estimatedCost: "" });
  const [approvalForm, setApprovalForm] = useState({ estimatedTotalCost: "", reason: "", note: "" });
  const [finalCost, setFinalCost] = useState("");

  const escalation = (escalations.data?.data ?? []).find((x: any) => x.id === id);
  const variance = (costsVariance.data?.data ?? []).find((x: any) => x.stoppageId === id);

  if (loading) return <FleetumBlockLoader label="Caricamento fermo" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <section className="space-y-4">
      <PageHeader
        title={`Dettaglio fermo ${data.vehicle.plate}`}
        subtitle="Storico completo: stato, timeline eventi, reminder inviati e documentazione foto."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow rapido</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[220px_1fr]">
          <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
            {stoppageStatusOptions.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                  await stoppagesUseCases.workflowTransition(safeId, { toStatus: nextStatus as any });
                window.location.reload();
              }}
            >
              Applica transizione
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await stoppagesUseCases.reminderTemplatePreview(safeId, "EMAIL");
                setTemplate(res.email);
              }}
            >
              Preview template email
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await stoppagesUseCases.reminderTemplatePreview(safeId, "WHATSAPP");
                setTemplate({ subject: "WhatsApp", body: res.whatsapp.message });
              }}
            >
              Preview template WhatsApp
            </Button>
          </div>
          {template ? (
            <div className="md:col-span-2 rounded-md border p-2 text-sm">
              <p className="font-medium">{template.subject}</p>
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{template.body}</pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
          <p><b>Targa:</b> {data.vehicle.plate}</p>
          <p><b>Veicolo:</b> {data.vehicle.brand} {data.vehicle.model}</p>
          <p><b>Sede:</b> {data.site.name}</p>
          <p><b>Officina:</b> {data.workshop.name}</p>
          <p><b>Stato:</b> <StoppageStatusBadge status={data.status} /></p>
          <p><b>Priorita:</b> {data.priority || "-"}</p>
          <p><b>Assegnato a:</b> {data.assignedToUserId || "-"}</p>
          <p><b>Motivo:</b> {data.reason}</p>
          <p><b>Costo stimato/giorno:</b> {data.estimatedCostPerDay ? `€ ${data.estimatedCostPerDay}` : "-"}</p>
          <p className="md:col-span-2"><b>Note:</b> {data.notes || "-"}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approvazioni costo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Importo da approvare (€)</Label>
                <Input
                  type="number"
                  min={0}
                  value={approvalForm.estimatedTotalCost}
                  onChange={(e) => setApprovalForm((s) => ({ ...s, estimatedTotalCost: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Motivo</Label>
                <Textarea value={approvalForm.reason} onChange={(e) => setApprovalForm((s) => ({ ...s, reason: e.target.value }))} />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Note</Label>
                <Textarea value={approvalForm.note} onChange={(e) => setApprovalForm((s) => ({ ...s, note: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await stoppagesUseCases.requestCostApproval(safeId, {
                    estimatedTotalCost: Number(approvalForm.estimatedTotalCost || 0),
                    reason: approvalForm.reason,
                    note: approvalForm.note || undefined
                  });
                  snackbar.success("Richiesta approvazione inviata.");
                  window.location.reload();
                }}
              >
                Richiedi approvazione
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await stoppagesUseCases.decideCostApproval(safeId, {
                    approved: true,
                    approvedCost: Number(approvalForm.estimatedTotalCost || 0),
                    reason: approvalForm.note || "Approvato"
                  });
                  snackbar.success("Costo approvato.");
                  window.location.reload();
                }}
              >
                Approva
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  await stoppagesUseCases.decideCostApproval(safeId, {
                    approved: false,
                    reason: approvalForm.note || "Rifiutato"
                  });
                  snackbar.success("Approvazione rifiutata.");
                  window.location.reload();
                }}
              >
                Rifiuta
              </Button>
            </div>
            <div className="space-y-2">
              {(approvals.data?.requests ?? []).slice(0, 5).map((row: any) => (
                <div key={row.id} className="rounded-md border p-2 text-xs">
                  <p className="font-semibold">Richiesta € {row.estimatedTotalCost}</p>
                  <p className="text-muted-foreground">{new Date(row.createdAt).toLocaleString("it-IT")} · {row.reason}</p>
                </div>
              ))}
              {(approvals.data?.decisions ?? []).slice(0, 5).map((row: any) => (
                <div key={row.id} className="rounded-md border p-2 text-xs">
                  <p className="font-semibold">{row.approved ? "Approvato" : "Rifiutato"} {row.approvedCost ? `· € ${row.approvedCost}` : ""}</p>
                  <p className="text-muted-foreground">{new Date(row.createdAt).toLocaleString("it-IT")} · {row.reason || "-"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Costi e scostamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><b>Stimato:</b> {variance ? `€ ${variance.estimated}` : "-"}</p>
              <p><b>Consuntivo:</b> {variance ? `€ ${variance.actual}` : "-"}</p>
              <p><b>Scostamento:</b> {variance ? `€ ${variance.variance}` : "-"}</p>
              <p><b>Scost. %:</b> {variance ? `${variance.varianceRate}%` : "-"}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Imposta costo consuntivo (€)</Label>
              <Input type="number" min={0} value={finalCost} onChange={(e) => setFinalCost(e.target.value)} />
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await stoppagesUseCases.setFinalCost(safeId, Number(finalCost || 0));
                snackbar.success("Costo consuntivo salvato.");
                window.location.reload();
              }}
            >
              Salva consuntivo
            </Button>
            {escalation ? (
              <p className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                Escalation SLA attiva: <b>{escalation.escalation}</b> · {escalation.daysOpen} gg aperto (soglia {escalation.thresholdDays} gg)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Nessuna escalation SLA attiva su questo fermo.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline eventi</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(events.data?.data ?? []).map((event: any) => (
              <li key={event.id} className="rounded-md border p-2">
                <p className="font-medium">{event.message}</p>
                <p className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · {event.type}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ordini ricambi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2">
              <Label>Descrizione</Label>
              <Input value={partsForm.description} onChange={(e) => setPartsForm((s) => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Fornitore</Label>
              <Input value={partsForm.supplier} onChange={(e) => setPartsForm((s) => ({ ...s, supplier: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>ETA</Label>
              <Input type="date" value={partsForm.etaDate} onChange={(e) => setPartsForm((s) => ({ ...s, etaDate: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Costo stimato (€)</Label>
              <Input type="number" min={0} value={partsForm.estimatedCost} onChange={(e) => setPartsForm((s) => ({ ...s, estimatedCost: e.target.value }))} />
            </div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              await stoppagesUseCases.addPartsOrder(safeId, {
                description: partsForm.description,
                supplier: partsForm.supplier || undefined,
                etaDate: partsForm.etaDate || undefined,
                estimatedCost: Number(partsForm.estimatedCost || 0) || undefined
              });
              snackbar.success("Ordine ricambio registrato.");
              window.location.reload();
            }}
          >
            Aggiungi ordine ricambio
          </Button>
          <div className="space-y-2">
            {(partsOrders.data?.data ?? []).map((row: any) => (
              <div key={row.id} className="rounded-md border p-2 text-xs">
                <p className="font-semibold">{row.description}</p>
                <p className="text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString("it-IT")} · Fornitore: {row.supplier || "-"} · ETA: {row.etaDate || "-"} · Costo: {row.estimatedCost ? `€ ${row.estimatedCost}` : "-"}
                </p>
                {row.etaRiskDays && row.etaRiskDays > 0 ? (
                  <p className="text-amber-700 dark:text-amber-300">Ritardo ETA: {row.etaRiskDays} giorni</p>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storico reminder</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(data.reminders || []).map((r: any) => (
              <li key={r.id} className="rounded-md border p-2">
                {new Date(r.sentAt).toLocaleString()} - {r.channel} - {r.type} - {r.success ? "OK" : "KO"}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(data.photos || []).map((p: any) => (
              <AuthenticatedPhoto
                key={p.id}
                photoId={p.id}
                kind="stoppage"
                className="h-40 w-full rounded-md border object-cover"
                alt="foto fermo"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
