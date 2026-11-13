import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { getCrudFieldId, useAccessibleDialog } from "../../components/ui/accessible-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  createCrudListQueryCursor,
  createLatestRequestGuard,
  createSubmissionGuard
} from "./generic-crud-guards";

type Props = {
  title: string;
  createLabel?: string;
  createTitleLabel?: string;
  list: (params: Record<string, string | number | undefined>) => Promise<{ data: any[]; total: number }>;
  create: (input: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, input: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  fields: Array<{
    key: string;
    label: string;
    type?: "text" | "email" | "number";
    placeholder?: string;
  }>;
};

const PAGE_SIZE = 20;

export const GenericCrudPage = ({
  title,
  createLabel = "Nuovo record",
  createTitleLabel,
  list,
  create,
  update,
  remove,
  fields
}: Props) => {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dialogTitleId = useId();
  const dialogErrorId = useId();
  const dialogFormId = useId();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const { dialogRef, rememberOpener, onKeyDown: onDialogKeyDown } = useAccessibleDialog({
    open: panelOpen,
    saving,
    onClose: closePanel,
    fallbackFocusRef: createTriggerRef
  });
  const latestRequestGuard = useRef(createLatestRequestGuard()).current;
  const submissionGuard = useRef(createSubmissionGuard()).current;
  const listRef = useRef(list);
  listRef.current = list;
  const listQueryCursor = useRef(createCrudListQueryCursor({ page, search: searchQuery })).current;
  listQueryCursor.update({ page, search: searchQuery });

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const load = useCallback(async (targetPage: number, targetSearch: string) => {
    const requestId = latestRequestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const result = await listRef.current({
        page: targetPage,
        pageSize: PAGE_SIZE,
        search: targetSearch || undefined
      });
      if (!latestRequestGuard.isCurrent(requestId)) return;
      const nextTotal = typeof result.total === "number" ? result.total : result.data.length;
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      if (targetPage > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      setRows(result.data);
      setTotal(nextTotal);
    } catch (e) {
      if (latestRequestGuard.isCurrent(requestId)) setError((e as Error).message);
    } finally {
      if (latestRequestGuard.isCurrent(requestId)) setLoading(false);
    }
  }, [latestRequestGuard]);

  const reload = useCallback(async () => {
    const current = listQueryCursor.read();
    await load(current.page, current.search);
  }, [listQueryCursor, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void load(page, searchQuery);
    return () => latestRequestGuard.invalidate();
  }, [latestRequestGuard, load, page, searchQuery]);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submissionGuard.tryAcquire()) return;
    setSaving(true);
    setError(null);
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    const payload: Record<string, unknown> = {};
    fields.forEach((field) => {
      const value = data.get(field.key);
      if (value !== null && value !== "") payload[field.key] = value;
    });

    try {
      await create(payload);
      formEl.reset();
      setPanelOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submissionGuard.release();
      setSaving(false);
    }
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;
    if (!submissionGuard.tryAcquire()) return;
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    fields.forEach((field) => {
      const value = data.get(field.key);
      if (value !== null) payload[field.key] = value;
    });

    try {
      await update(editingId, payload);
      setEditingId(null);
      setPanelOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submissionGuard.release();
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!submissionGuard.tryAcquire()) return;
    setSaving(true);
    setError(null);
    try {
      await remove(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submissionGuard.release();
      setSaving(false);
    }
  };

  const editingRow = editingId ? rows.find((x) => x.id === editingId) : null;

  const openPanel = (trigger: HTMLElement, nextEditingId: string | null) => {
    rememberOpener(trigger);
    setError(null);
    setEditingId(nextEditingId);
    setPanelOpen(true);
  };

  return (
    <section className="space-y-3">
      <PageHeader
        title={title}
        subtitle="Gestione anagrafica con inserimento rapido, ricerca e cancellazione record."
        actions={
          <Button
            ref={createTriggerRef}
            disabled={saving}
            onClick={(event) => openPanel(event.currentTarget, null)}
          >
            {createLabel}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card className="saas-surface shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Elenco</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Ricerca..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />

          {loading ? <FleetumInlineLoader label="Caricamento in corso" /> : null}

          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <Card key={row.id} className="border-dashed">
                <CardContent className="space-y-2 pt-4">
                  {fields.map((f) => (
                    <p key={f.key} className="text-sm">
                      <span className="text-muted-foreground">{f.label}: </span>
                      <span className="font-medium">{String(row[f.key] ?? "-")}</span>
                    </p>
                  ))}
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={(event) => openPanel(event.currentTarget, row.id)}
                    >
                      Modifica
                    </Button>
                    <Button size="sm" variant="destructive" disabled={saving} onClick={() => void onDelete(row.id)}>
                      Elimina
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow>
                  {fields.map((f) => (
                    <TableHead key={f.key}>{f.label}</TableHead>
                  ))}
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {fields.map((f) => (
                      <TableCell key={f.key}>{String(row[f.key] ?? "")}</TableCell>
                    ))}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          disabled={saving}
                          onClick={(event) => openPanel(event.currentTarget, row.id)}
                        >
                          Modifica
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => void onDelete(row.id)}>
                          Elimina
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
            <p className="text-muted-foreground">
              Pagina <span className="font-medium text-foreground">{page}</span> di <span className="font-medium text-foreground">{totalPages}</span> · Totale record: <span className="font-medium text-foreground">{total}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Precedente
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Successiva
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {panelOpen ? (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm"
            onClick={() => {
              if (!saving) closePanel();
            }}
          />
          <aside
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={error ? dialogErrorId : undefined}
            aria-busy={saving}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
            className="fixed z-[80] right-0 top-0 h-full w-full max-w-xl border-l bg-card shadow-2xl max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[88vh] max-sm:rounded-t-2xl max-sm:border-t max-sm:border-l-0"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 id={dialogTitleId} className="text-sm font-semibold">{editingId ? "Modifica record" : createTitleLabel ?? createLabel}</h2>
              <Button aria-label="Chiudi pannello" variant="outline" size="icon" disabled={saving} onClick={closePanel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-64px)] overflow-auto px-4 py-4">
              <form className="grid gap-3 sm:grid-cols-2" aria-busy={saving} onSubmit={editingId ? onUpdate : onCreate}>
                {error ? (
                  <p id={dialogErrorId} role="alert" className="sm:col-span-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                {fields.map((field, index) => {
                  const fieldId = getCrudFieldId(dialogFormId, index);
                  return (
                    <div key={field.key} className="grid gap-1.5">
                      <Label htmlFor={fieldId}>{field.label}</Label>
                      <Input
                        id={fieldId}
                        data-dialog-initial-focus={index === 0 ? "true" : undefined}
                        name={field.key}
                        type={field.type ?? "text"}
                        disabled={saving}
                        defaultValue={editingRow ? String(editingRow[field.key] ?? "") : ""}
                        placeholder={field.placeholder}
                      />
                    </div>
                  );
                })}
                <div className="sm:col-span-2 flex gap-2">
                  <Button type="submit" disabled={saving} aria-live="polite">
                    {saving
                      ? "Salvataggio..."
                      : editingId
                        ? "Salva modifiche"
                        : `Crea ${createLabel.toLowerCase().replace(/^nuov[oa]\s+/i, "")}`}
                  </Button>
                  <Button type="button" variant="outline" disabled={saving} onClick={closePanel}>
                    Annulla
                  </Button>
                </div>
              </form>
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
};
