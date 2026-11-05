import { useEffect, useMemo, useRef, useState } from "react";
import { snackbar } from "../../../application/stores/snackbar-store";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { FleetumInlineLoader } from "../brand/fleetum-logo-loader";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CalendarToolbar } from "./CalendarToolbar";
import { EventPopup } from "./EventPopup";
import { CalendarEvent } from "./calendar-types";
import { useCalendar } from "./hooks/useCalendar";
import { useEvents } from "./hooks/useEvents";
import { getApiOrigin } from "../../../infrastructure/api/api-base-url";
import { DayView } from "./views/DayView";
import { MonthView } from "./views/MonthView";
import { WeekView } from "./views/WeekView";
import { addDays, formatMonthTitle, minutesToTime, toDateKey } from "./calendar-utils";

import {emptyStoppageFilters,type StoppageFilters,useOperationsAccess} from "../operations/operations-workspace";
import {CommerceDrawer} from "../ui/commerce-workspace";

type ApplePrivacyMode = "masked" | "full";
type GooglePopupMessage = {
  source?: string;
  status?: "success" | "error";
  message?: string;
  synced?: number;
  pushed?: number;
  imported?: number;
  updated?: number;
  removed?: number;
  accountEmail?: string | null;
};

const GOOGLE_POPUP_SOURCE = "gestione-fermi-google-calendar";
const GOOGLE_POPUP_NAME = "fermiGoogleCalendarOAuth";

const getGooglePopupFeatures = () => {
  const width = 560;
  const height = 700;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`;
};

export const CalendarShell = ({filters=emptyStoppageFilters}:{filters?:StoppageFilters}) => {
  const {canRead,canWrite}=useOperationsAccess();
  const {
    viewDate,
    selDay,
    curView,
    goToday,
    navigate,
    setView,
    pickDay,
    stepDay
  } = useCalendar("week");

  const {
    loading,
    mutating,
    error,
    visibleEvents:loadedEvents,
    calendars,
    loadRange,
    refresh,
    addEvent,
    updateEvent,
    deleteEvent
  } = useEvents(filters);
  const visibleEvents=useMemo(()=>loadedEvents.map(e=>canWrite&&!mutating?e:{...e,readonly:true}),[loadedEvents,canWrite,mutating]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [popupState, setPopupState] = useState<{ eventId: string; anchorRect: DOMRect } | null>(null);
  const [createDraft, setCreateDraft] = useState<{ event: CalendarEvent; anchorRect: DOMRect | null } | null>(null);
  const [appleDialogOpen, setAppleDialogOpen] = useState(false);
  const [feedsRevoking,setFeedsRevoking]=useState(false);
  const [feedRevocationArmed,setFeedRevocationArmed]=useState(false);
  const feedRevocationOrigin=useRef<HTMLButtonElement>(null);
  const [applePrivacyMode, setApplePrivacyMode] = useState<ApplePrivacyMode>("masked");
  const [appleSubmitting, setAppleSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [appleImporting, setAppleImporting] = useState(false);
  const [appleImportUrl, setAppleImportUrl] = useState("");
  const apiOrigin = useMemo(() => getApiOrigin(), []);

  const range = useMemo(() => {
    if (curView === "day") {
      return { from: selDay, to: selDay };
    }

    if (curView === "week") {
      const day = new Date(viewDate);
      const offset = (day.getDay() + 6) % 7;
      const start = addDays(day, -offset);
      const end = addDays(start, 6);
      return { from: start, to: end };
    }

    const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const monthEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    return { from: monthStart, to: monthEnd };
  }, [curView, selDay, viewDate]);

  const visibleWeekRange = useMemo(() => {
    const day = new Date(viewDate);
    const offset = (day.getDay() + 6) % 7;
    const from = addDays(day, -offset);
    const to = addDays(from, 6);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [viewDate]);

  const rangeKey = `${toDateKey(range.from)}-${toDateKey(range.to)}-${curView}`;

  useEffect(() => {
    void loadRange(range.from, range.to);
  }, [loadRange, rangeKey]);

  useEffect(() => {
    setPopupState(null);
    setCreateDraft(null);
  }, [rangeKey]);

  useEffect(() => {
    if (curView !== "day" && curView !== "week") return;
    if (!scrollerRef.current) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const target = Math.max(0, Math.round((minute / 1440) * 1200) - 180);

    scrollerRef.current.scrollTo({ top: target, behavior: prefersReduced ? "auto" : "smooth" });
  }, [curView, rangeKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if(event.altKey||event.ctrlKey||event.metaKey||document.querySelector('[role="dialog"]'))return;
      if (target && (target.closest("button,a,[role=tab]") || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepDay(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepDay(1);
        return;
      }

      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        goToday();
        return;
      }

      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        setView("week");
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setView("month");
        return;
      }

      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        setView("day");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToday, setView, stepDay]);

  const openCreateEventPopup = (day: Date, minute: number, anchorRect: DOMRect | null = null) => {
    if(!canWrite||mutating)return;
    const clamped = Math.max(0, Math.min(1439, minute));
    const start = minutesToTime(clamped);
    const end = minutesToTime(Math.min(1439, clamped + 60));

    setPopupState(null);
    setCreateDraft({
      event: {
        id: `draft:${Date.now()}`,
        title: "",
        date: toDateKey(day),
        start,
        end,
        calendarId: 0,
        location: "",
        description: "",
        source: "custom"
      },
      anchorRect
    });
  };

  const popupEvent = useMemo(() => {
    if (!popupState) return null;
    return visibleEvents.find((event) => String(event.id) === popupState.eventId) ?? null;
  }, [popupState, visibleEvents]);
  const monthLabel = useMemo(() => formatMonthTitle(viewDate), [viewDate]);
  const weeklyCustomEvents = useMemo(() => {
    const fromTs = visibleWeekRange.from.getTime();
    const toTs = visibleWeekRange.to.getTime();

    return visibleEvents.filter((event) => {
      if (event.source !== "custom") return false;
      const start = new Date(`${event.date}T${event.start}:00`);
      const end = new Date(`${event.date}T${event.end}:00`);
      const normalizedEnd = end > start ? end : new Date(start.getTime() + 60 * 60 * 1000);
      return normalizedEnd.getTime() >= fromTs && start.getTime() <= toTs;
    });
  }, [visibleEvents, visibleWeekRange.from, visibleWeekRange.to]);

  const weeklyAllDayCount = useMemo(() => weeklyCustomEvents.filter((event) => Boolean(event.allDay)).length, [weeklyCustomEvents]);

  const handleEventResizeEnd = (event: CalendarEvent, nextStart: string, nextEnd: string) => {
    if(!canWrite||mutating)return;
    if (event.start === nextStart && event.end === nextEnd) return;
    setPopupState(null);
    setCreateDraft(null);
    void updateEvent(event.id, { start: nextStart, end: nextEnd });
  };

  const handleEventMoveEnd = (event: CalendarEvent, nextDate: string, nextStart: string, nextEnd: string) => {
    if(!canWrite||mutating)return;
    if (event.date === nextDate && event.start === nextStart && event.end === nextEnd) return;
    setPopupState(null);
    setCreateDraft(null);
    void updateEvent(event.id, { date: nextDate, start: nextStart, end: nextEnd });
  };

  const openGoogleOAuthPopup = (authUrl: string, preparedPopup?: Window | null) =>
    new Promise<GooglePopupMessage>((resolve, reject) => {
      const popup = preparedPopup ?? window.open(authUrl, GOOGLE_POPUP_NAME, getGooglePopupFeatures());

      if (!popup) {
        reject(new Error("Popup Google bloccato dal browser. Consenti i popup e riprova."));
        return;
      }

      if (preparedPopup) {
        try {
          popup.location.href = authUrl;
        } catch {
          reject(new Error("Impossibile aprire la finestra OAuth Google."));
          return;
        }
      }

      let settled = false;
      let closeWatcher: number | undefined;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        if (closeWatcher) window.clearInterval(closeWatcher);
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== apiOrigin) return;
        const payload = (event.data ?? {}) as GooglePopupMessage;
        if (payload.source !== GOOGLE_POPUP_SOURCE) return;
        settled = true;
        cleanup();
        if (payload.status === "success") resolve(payload);
        else reject(new Error(payload.message || "Connessione Google Calendar non riuscita"));
      };

      window.addEventListener("message", onMessage);
      closeWatcher = window.setInterval(() => {
        if (!popup.closed || settled) return;
        cleanup();
        reject(new Error("Autorizzazione Google annullata."));
      }, 400);
    });

  const confirmRevokeFeeds=async()=>{
    if(!feedRevocationArmed||feedsRevoking)return;
    setFeedsRevoking(true);
    try{await stoppagesUseCases.revokeCalendarFeeds();setFeedRevocationArmed(false);snackbar.success("Link di lettura revocati. Gli eventi già copiati in altri calendari restano disponibili lì.");}
    catch(error){snackbar.error(error instanceof Error?error.message:"Revoca dei link non riuscita. Riprova.");}
    finally{setFeedsRevoking(false);window.requestAnimationFrame(()=>feedRevocationOrigin.current?.focus());}
  };

  const confirmSendApple = async () => {
    setAppleSubmitting(true);
    try {
      const response = await stoppagesUseCases.getAppleCalendarFeed({
        dateFrom: visibleWeekRange.from.toISOString(),
        dateTo: visibleWeekRange.to.toISOString(),
        privacy: applePrivacyMode
      });

      const httpUrl = response?.data?.httpUrl;
      const webcalUrl = response?.data?.webcalUrl;
      if (!httpUrl) throw new Error("Link Apple Calendar non disponibile");

      window.open(httpUrl, "_blank", "noopener,noreferrer");

      let copied = false;
      if (webcalUrl && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(webcalUrl);
          copied = true;
        } catch {
          copied = false;
        }
      }

      snackbar.success(
        copied
          ? "Invio completato. Solo eventi calendario della settimana visualizzata. Link copiato."
          : "Solo la settimana visualizzata è stata inviata ad Apple Calendar."
      );
      setAppleDialogOpen(false);
    } catch (error) {
      snackbar.error(error instanceof Error ? error.message : "Invio Apple Calendar non riuscito");
    } finally {
      setAppleSubmitting(false);
    }
  };

  const confirmSendGoogle = async () => {
    setGoogleSubmitting(true);
    const preparedPopup = window.open("about:blank", GOOGLE_POPUP_NAME, getGooglePopupFeatures());
    try {
      const response = await stoppagesUseCases.syncGoogleCalendar({
        dateFrom: visibleWeekRange.from.toISOString(),
        dateTo: visibleWeekRange.to.toISOString(),
        privacy: applePrivacyMode
      });
      const payload = response?.data;

      if (payload?.requiresOAuth) {
        const authUrl = payload.authUrl;
        if (!authUrl) throw new Error("Link autorizzazione Google non disponibile");
        const popupResult = await openGoogleOAuthPopup(authUrl, preparedPopup);
        if (preparedPopup && !preparedPopup.closed) preparedPopup.close();
        const pushed = Number(popupResult.pushed ?? popupResult.synced ?? 0);
        const imported = Number(popupResult.imported ?? 0);
        const updated = Number(popupResult.updated ?? 0);
        const removed = Number(popupResult.removed ?? 0);
        snackbar.success(
          `Google Calendar collegato${popupResult.accountEmail ? ` (${popupResult.accountEmail})` : ""}. Push ${pushed}, import ${imported}, aggiornati ${updated}, rimossi ${removed}.`
        );
      } else {
        if (preparedPopup && !preparedPopup.closed) preparedPopup.close();
        const pushed = Number(payload?.pushed ?? payload?.synced ?? 0);
        const imported = Number(payload?.imported ?? 0);
        const updated = Number(payload?.updated ?? 0);
        const removed = Number(payload?.removed ?? 0);
        snackbar.success(`Google Calendar bidirezionale OK: push ${pushed}, import ${imported}, aggiornati ${updated}, rimossi ${removed}.`);
      }

      await refresh();
      setAppleDialogOpen(false);
    } catch (error) {
      if (preparedPopup && !preparedPopup.closed) preparedPopup.close();
      snackbar.error(error instanceof Error ? error.message : "Sync Google Calendar non riuscita");
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const confirmImportAppleFeed = async () => {
    if(!canWrite)return;
    const feedUrl = appleImportUrl.trim();
    if (!feedUrl) {
      snackbar.error("Inserisci il link feed .ics di Apple Calendar");
      return;
    }

    setAppleImporting(true);
    try {
      const response = await stoppagesUseCases.importAppleCalendarFeed({
        feedUrl,
        dateFrom: visibleWeekRange.from.toISOString(),
        dateTo: visibleWeekRange.to.toISOString()
      });
      const imported = Number(response?.data?.imported ?? 0);
      const updated = Number(response?.data?.updated ?? 0);
      const scanned = Number(response?.data?.scanned ?? 0);
      snackbar.success(`Import Apple completato: ${imported} nuovi, ${updated} aggiornati, ${scanned} letti.`);
      await refresh();
    } catch (error) {
      snackbar.error(error instanceof Error ? error.message : "Import Apple non riuscito");
    } finally {
      setAppleImporting(false);
    }
  };

  return (
    <section className="calendar-shell">
      <div className="calendar-main">
        <CalendarToolbar
          canWrite={canWrite&&!mutating}
          monthLabel={monthLabel}
          curView={curView}
          onNavigate={navigate}
          onSetView={setView}
          onSendApple={() => {setFeedRevocationArmed(false);setAppleDialogOpen(true);}}
          onSendGoogle={confirmSendGoogle}
          onCreate={() => openCreateEventPopup(selDay, 9 * 60)}
        />

        {error ? <div className="calendar-error" role="alert">{error}<Button variant="outline" disabled={loading} onClick={()=>void refresh()}>Riprova calendario</Button></div> : null}
        {!loading&&!error&&!visibleEvents.length?<p className="operations-hint" role="status">Nessun evento nel periodo selezionato.</p>:null}

        <div className="calendar-surface" ref={scrollerRef}>
          {curView === "week" ? (
            <WeekView
              viewDate={viewDate}
              selDay={selDay}
              events={visibleEvents}
              calendars={calendars}
              onPickDay={pickDay}
              onCreateAt={(day, minute, anchorRect) => openCreateEventPopup(day, minute, anchorRect ?? null)}
              onEventResizeEnd={handleEventResizeEnd}
              onEventMoveEnd={handleEventMoveEnd}
              onEventClick={(event, anchorRect) => {
                setCreateDraft(null);
                setPopupState({ eventId: String(event.id), anchorRect });
              }}
            />
          ) : null}

          {curView === "day" ? (
            <DayView
              viewDate={selDay}
              events={visibleEvents}
              calendars={calendars}
              onCreateAt={(day, minute, anchorRect) => openCreateEventPopup(day, minute, anchorRect ?? null)}
              onEventResizeEnd={handleEventResizeEnd}
              onEventMoveEnd={handleEventMoveEnd}
              onEventClick={(event, anchorRect) => {
                setCreateDraft(null);
                setPopupState({ eventId: String(event.id), anchorRect });
              }}
            />
          ) : null}

          {curView === "month" ? (
            <MonthView
              viewDate={viewDate}
              selDay={selDay}
              events={visibleEvents}
              calendars={calendars}
              onPickDay={pickDay}
            />
          ) : null}

          {loading ? <div className="calendar-loading"><FleetumInlineLoader label="Sync live" /></div> : null}
          {loading && !visibleEvents.length ? (
            <div className="calendar-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}

          <EventPopup canWrite={canWrite}
            event={popupEvent}
            draftEvent={createDraft?.event ?? null}
            anchorRect={popupState?.anchorRect ?? createDraft?.anchorRect ?? null}
            containerRef={scrollerRef}
            calendars={calendars}
            onClose={() => {
              setPopupState(null);
              setCreateDraft(null);
            }}
            onCreate={(draft) => addEvent(draft)}
            onUpdate={updateEvent}
            onDelete={deleteEvent}
          />
        </div>
      </div>

      {appleDialogOpen ? (
        <CommerceDrawer compact title="Invio calendario" busy={appleSubmitting||googleSubmitting||appleImporting||feedsRevoking} onClose={()=>setAppleDialogOpen(false)}>

          <div className="operations-calendar-integrations">
            <h3 className="calendar-apple-dialog__title">Invio Calendario</h3>
            <p className="calendar-apple-dialog__meta">
              Settimana: {visibleWeekRange.from.toLocaleDateString("it-IT")} - {visibleWeekRange.to.toLocaleDateString("it-IT")}
            </p>
            <p className="calendar-apple-dialog__meta">
              Eventi calendario da inviare: <strong>{weeklyCustomEvents.length}</strong> {weeklyAllDayCount ? `· Intera giornata: ${weeklyAllDayCount}` : ""}
            </p>

            <div className="calendar-apple-dialog__privacy">
              <button
                type="button"
                className={`calendar-apple-dialog__privacy-btn ${applePrivacyMode === "masked" ? "is-active" : ""}`}
                onClick={() => setApplePrivacyMode("masked")}
                disabled={appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}
              >
                Dati minimizzati (consigliato)
              </button>
              <button
                type="button"
                className={`calendar-apple-dialog__privacy-btn ${applePrivacyMode === "full" ? "is-active" : ""}`}
                onClick={() => setApplePrivacyMode("full")}
                disabled={appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}
              >
                Dettagli completi
              </button>
            </div>

            <p className="calendar-apple-dialog__hint">
              {applePrivacyMode === "masked"
                ? "Compliance attiva: descrizione e luogo vengono esclusi dal feed Apple."
                : "Compliance standard: invio con dettagli completi dell'evento."}
            </p>

            <p className="calendar-apple-dialog__hint">I collegamenti creati prima dell’aggiornamento vanno rigenerati. Puoi disattivare i tuoi link di lettura; gli eventi già copiati negli altri calendari rimangono lì.</p>
            <div role="group" aria-label="Gestione link calendario" className="space-y-3">
              {feedRevocationArmed?<p>Disattivare tutti i tuoi link di lettura attuali?</p>:null}
              <div className="flex flex-wrap gap-3">
                <Button ref={feedRevocationOrigin} variant="outline" onClick={()=>setFeedRevocationArmed(value=>!value)} disabled={appleSubmitting||googleSubmitting||appleImporting||feedsRevoking}>{feedRevocationArmed?"Mantieni i link":"Revoca i miei link di lettura"}</Button>
                {feedRevocationArmed?<Button variant="destructive" onClick={()=>void confirmRevokeFeeds()} disabled={feedsRevoking}>{feedsRevoking?"Revoca in corso…":"Conferma revoca link"}</Button>:null}
              </div>
            </div>

            <Input
              aria-label="Link feed Apple Calendar"
              value={appleImportUrl}
              onChange={(event) => setAppleImportUrl(event.target.value)}
              placeholder="https://.../calendar.ics (import Apple -> Gestionale)"
              disabled={!canWrite||appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}
            />

            <div className="calendar-apple-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setAppleDialogOpen(false)}
                disabled={appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}
              >
                Annulla
              </Button>
              <Button variant="outline" onClick={confirmImportAppleFeed} disabled={!canWrite||appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}>
                {appleImporting ? "Import Apple..." : "Importa da Apple"}
              </Button>
              <Button variant="outline" onClick={confirmSendGoogle} disabled={appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}>
                {googleSubmitting ? "Connessione Google..." : "Invia a Google"}
              </Button>
              <Button onClick={confirmSendApple} disabled={appleSubmitting || googleSubmitting || appleImporting || feedsRevoking}>
                {appleSubmitting ? "Invio Apple..." : "Invia ad Apple"}
              </Button>
            </div>
          </div>
        </CommerceDrawer>
      ) : null}
    </section>
  );
};
