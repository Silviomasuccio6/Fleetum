import {WorkspacePageHeader} from "../../components/ui/workspace-ui";
import {CommerceNotice} from "../../components/ui/commerce-workspace";
import {OperationsGroup,useOperationsAccess,useOperationsTask,OperationFeedback,priorityLabel} from "../../components/operations/operations-workspace";
import { useParams,useNavigate } from "react-router-dom";
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
  const {canRead,canWrite}=useOperationsAccess();const task=useOperationsTask();const navigate=useNavigate();const[refreshTick,setRefreshTick]=useState(0);
  const { data, loading, error } = useAsync(
    () => (safeId&&canRead ? stoppagesUseCases.getById(safeId) : Promise.reject(new Error("Fermo non valido"))),
    [safeId,refreshTick,canRead]
  );
  const events = useAsync(() => (safeId&&canRead ? stoppagesUseCases.events(safeId) : Promise.resolve({ data: [] } as any)), [safeId,refreshTick,canRead]);
  const partsOrders = useAsync(
    () => (safeId&&canRead ? stoppagesUseCases.listPartsOrders(safeId) : Promise.resolve({ data: [] } as any)),
    [safeId,refreshTick,canRead]
  );
  const approvals = useAsync(
    () => (safeId&&canRead ? stoppagesUseCases.listCostApprovals(safeId) : Promise.resolve({ requests: [], decisions: [] } as any)),
    [safeId,refreshTick,canRead]
  );
  const costsVariance = useAsync(() => canRead?stoppagesUseCases.costsVariance():Promise.resolve({data:[]}), [safeId,refreshTick,canRead]);
  const escalations = useAsync(() => canRead?stoppagesUseCases.slaEscalations():Promise.resolve({data:[],kpis:{}}), [safeId,refreshTick,canRead]);
  const [nextStatus, setNextStatus] = useState("IN_PROGRESS");
  const [template, setTemplate] = useState<any>(null);
  const [partsForm, setPartsForm] = useState({ description: "", supplier: "", etaDate: "", estimatedCost: "" });
  const [approvalForm, setApprovalForm] = useState({ estimatedTotalCost: "", reason: "", note: "" });
  const [finalCost, setFinalCost] = useState("");

  const escalation = (escalations.data?.data ?? []).find((x: any) => x.id === id);
  const variance = (costsVariance.data?.data ?? []).find((x: any) => x.stoppageId === id);

  if(!canRead)return <section className="operations-workspace"><h1>Fermo</h1><p>Il tuo ruolo non consente l’accesso ai fermi.</p></section>;
  if (loading) return <FleetumBlockLoader label="Caricamento fermo" />;
  if(error||!data)return <section className="operations-workspace"><CommerceNotice>{error||"Fermo non disponibile."}</CommerceNotice><Button variant="outline" onClick={()=>setRefreshTick(x=>x+1)}>Riprova fermo</Button></section>;

  return (
    <section className="operations-workspace operations-detail">
      <WorkspacePageHeader eyebrow="SCHEDA INTERVENTO"
        title={`Dettaglio fermo ${data.vehicle.plate}`}
        description="Stato, costi, ricambi e storico. Il percorso del veicolo fino al ritorno in servizio." actions={<><Button variant="outline" onClick={()=>navigate("/fermi")}>Elenco fermi</Button>{canWrite?<Button onClick={()=>navigate("/fermi/"+encodeURIComponent(safeId)+"/modifica")}>Modifica fermo</Button>:null}</>}
      />
      <OperationFeedback error={task.error} success={task.success}/>
      <OperationsGroup title="Workflow rapido" open={true}><div className="grid gap-2 md:grid-cols-[220px_1fr]">
          <Select aria-label="Nuovo stato del fermo" disabled={!canWrite||task.busy} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
            {stoppageStatusOptions.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
                  await stoppagesUseCases.workflowTransition(safeId, { toStatus: nextStatus as any });
                setRefreshTick(x=>x+1);
              })}
            >
              Applica transizione
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={task.busy||!canRead} onClick={()=>void task.run(async()=>{if(!canRead)return;
                const res = await stoppagesUseCases.reminderTemplatePreview(safeId, "EMAIL");
                setTemplate(res.email);
              })}
            >
              Preview template email
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={task.busy||!canRead} onClick={()=>void task.run(async()=>{if(!canRead)return;
                const res = await stoppagesUseCases.reminderTemplatePreview(safeId, "WHATSAPP");
                setTemplate({ subject: "WhatsApp", body: res.whatsapp.message });
              })}
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
        </div></OperationsGroup>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
          <p><b>Targa:</b> {data.vehicle.plate}</p>
          <p><b>Veicolo:</b> {data.vehicle.brand} {data.vehicle.model}</p>
          <p><b>Sede:</b> {data.site.name}</p>
          <p><b>Officina:</b> {data.workshop.name}</p>
          <p><b>Stato:</b> <StoppageStatusBadge status={data.status} /></p>
          <p><b>Priorita:</b> {priorityLabel[data.priority]||data.priority||"—"}</p>
          <p><b>Assegnato a:</b> {data.assignedToUser?`${data.assignedToUser.firstName} ${data.assignedToUser.lastName}`:data.assignedToUserId||"Non assegnato"}</p>
          <p><b>Motivo:</b> {data.reason}</p>
          <p><b>Costo stimato/giorno:</b> {data.estimatedCostPerDay!=null ? `€ ${data.estimatedCostPerDay}` : "-"}</p>
          <p className="md:col-span-2"><b>Note:</b> {data.notes || "-"}</p>
        </CardContent>
      </Card>

      {[events.error,partsOrders.error,approvals.error,costsVariance.error,escalations.error].filter(Boolean).map((message,index)=><CommerceNotice key={index}>{message}</CommerceNotice>)}
      <div className="grid gap-4 xl:grid-cols-2">
        <OperationsGroup title="Approvazioni costo" open={false}><div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-detail-1">Importo da approvare (€)</Label>
                <Input id="stoppage-detail-1"
                  type="number"
                  min={0}
                  value={approvalForm.estimatedTotalCost}
                  onChange={(e) => setApprovalForm((s) => ({ ...s, estimatedTotalCost: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="stoppage-detail-2">Motivo</Label>
                <Textarea id="stoppage-detail-2" value={approvalForm.reason} onChange={(e) => setApprovalForm((s) => ({ ...s, reason: e.target.value }))} />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="stoppage-detail-3">Note</Label>
                <Textarea id="stoppage-detail-3" value={approvalForm.note} onChange={(e) => setApprovalForm((s) => ({ ...s, note: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
                  await stoppagesUseCases.requestCostApproval(safeId, {
                    estimatedTotalCost: Number(approvalForm.estimatedTotalCost || 0),
                    reason: approvalForm.reason,
                    note: approvalForm.note || undefined
                  });
                  snackbar.success("Richiesta approvazione inviata.");
                  setRefreshTick(x=>x+1);
                })}
              >
                Richiedi approvazione
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
                  await stoppagesUseCases.decideCostApproval(safeId, {
                    approved: true,
                    approvedCost: Number(approvalForm.estimatedTotalCost || 0),
                    reason: approvalForm.note || "Approvato"
                  });
                  snackbar.success("Costo approvato.");
                  setRefreshTick(x=>x+1);
                })}
              >
                Approva
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
                  await stoppagesUseCases.decideCostApproval(safeId, {
                    approved: false,
                    reason: approvalForm.note || "Rifiutato"
                  });
                  snackbar.success("Approvazione rifiutata.");
                  setRefreshTick(x=>x+1);
                })}
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
          </div></OperationsGroup>

        <OperationsGroup title="Costi e scostamento" open={false}><div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><b>Stimato:</b> {variance ? `€ ${variance.estimated}` : "-"}</p>
              <p><b>Consuntivo:</b> {variance ? `€ ${variance.actual}` : "-"}</p>
              <p><b>Scostamento:</b> {variance ? `€ ${variance.variance}` : "-"}</p>
              <p><b>Scost. %:</b> {variance ? `${variance.varianceRate}%` : "-"}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stoppage-detail-4">Imposta costo consuntivo (€)</Label>
              <Input id="stoppage-detail-4" type="number" min={0} value={finalCost} onChange={(e) => setFinalCost(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
                await stoppagesUseCases.setFinalCost(safeId, Number(finalCost || 0));
                snackbar.success("Costo consuntivo salvato.");
                setRefreshTick(x=>x+1);
              })}
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
          </div></OperationsGroup>
      </div>

      <OperationsGroup title="Timeline eventi" open={false}><div className="">
          <ul className="space-y-2 text-sm">
            {(events.data?.data ?? []).map((event: any) => (
              <li key={event.id} className="rounded-md border p-2">
                <p className="font-medium">{event.message}</p>
                <p className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · {event.type}</p>
              </li>
            ))}
          </ul>
        </div></OperationsGroup>

      <OperationsGroup title="Ordini ricambi" open={false}><div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="stoppage-detail-5">Descrizione</Label>
              <Input id="stoppage-detail-5" value={partsForm.description} onChange={(e) => setPartsForm((s) => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stoppage-detail-6">Fornitore</Label>
              <Input id="stoppage-detail-6" value={partsForm.supplier} onChange={(e) => setPartsForm((s) => ({ ...s, supplier: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stoppage-detail-7">ETA</Label>
              <Input id="stoppage-detail-7" type="date" value={partsForm.etaDate} onChange={(e) => setPartsForm((s) => ({ ...s, etaDate: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stoppage-detail-8">Costo stimato (€)</Label>
              <Input id="stoppage-detail-8" type="number" min={0} value={partsForm.estimatedCost} onChange={(e) => setPartsForm((s) => ({ ...s, estimatedCost: e.target.value }))} />
            </div>
          </div>
          <Button
            size="sm"
            disabled={task.busy||!canWrite} onClick={()=>void task.run(async()=>{if(!canWrite)return;
              await stoppagesUseCases.addPartsOrder(safeId, {
                description: partsForm.description,
                supplier: partsForm.supplier || undefined,
                etaDate: partsForm.etaDate || undefined,
                estimatedCost: Number(partsForm.estimatedCost || 0) || undefined
              });
              snackbar.success("Ordine ricambio registrato.");
              setRefreshTick(x=>x+1);
            })}
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
        </div></OperationsGroup>

      <OperationsGroup title="Storico reminder" open={false}><div className="">
          <ul className="space-y-2 text-sm">
            {(data.reminders || []).map((r: any) => (
              <li key={r.id} className="rounded-md border p-2">
                {new Date(r.sentAt).toLocaleString()} - {r.channel} - {r.type} - {r.success ? "OK" : "KO"}
              </li>
            ))}
          </ul>
        </div></OperationsGroup>

      <OperationsGroup title="Foto" open={false}><div className="">
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
        </div></OperationsGroup>
    </section>
  );
};
