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

export const CalendarShell = () => {
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
    error,
    visibleEvents,
    calendars,
    loadRange,
    refresh,
    addEvent,
    updateEvent,
    deleteEvent
  } = useEvents();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [popupState, setPopupState] = useState<{ eventId: string; anchorRect: DOMRect } | null>(null);
  const [createDraft, setCreateDraft] = useState<{ event: CalendarEvent; anchorRect: DOMRect | null } | null>(null);
  const [appleDialogOpen, setAppleDialogOpen] = useState(false);
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
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
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
    if (event.start === nextStart && event.end === nextEnd) return;
    setPopupState(null);
    setCreateDraft(null);
    void updateEvent(event.id, { start: nextStart, end: nextEnd });
  };

  const handleEventMoveEnd = (event: CalendarEvent, nextDate: string, nextStart: string, nextEnd: string) => {
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
          monthLabel={monthLabel}
          curView={curView}
          onNavigate={navigate}
          onSetView={setView}
          onSendApple={() => setAppleDialogOpen(true)}
          onSendGoogle={confirmSendGoogle}
          onCreate={() => openCreateEventPopup(selDay, 9 * 60)}
        />

        {error ? <p className="calendar-error">{error}</p> : null}

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

          <EventPopup
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
        <div className="calendar-apple-dialog" role="dialog" aria-modal="true" aria-label="Invio calendario esterno">
          <div
            className="calendar-apple-dialog__backdrop"
            onClick={() => {
              if (!appleSubmitting && !googleSubmitting && !appleImporting) setAppleDialogOpen(false);
            }}
          />
          <div className="calendar-apple-dialog__panel">
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
                disabled={appleSubmitting || googleSubmitting || appleImporting}
              >
                Dati minimizzati (consigliato)
              </button>
              <button
                type="button"
                className={`calendar-apple-dialog__privacy-btn ${applePrivacyMode === "full" ? "is-active" : ""}`}
                onClick={() => setApplePrivacyMode("full")}
                disabled={appleSubmitting || googleSubmitting || appleImporting}
              >
                Dettagli completi
              </button>
            </div>

            <p className="calendar-apple-dialog__hint">
              {applePrivacyMode === "masked"
                ? "Compliance attiva: descrizione e luogo vengono esclusi dal feed Apple."
                : "Compliance standard: invio con dettagli completi dell'evento."}
            </p>

            <Input
              value={appleImportUrl}
              onChange={(event) => setAppleImportUrl(event.target.value)}
              placeholder="https://.../calendar.ics (import Apple -> Gestionale)"
              disabled={appleSubmitting || googleSubmitting || appleImporting}
            />

            <div className="calendar-apple-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setAppleDialogOpen(false)}
                disabled={appleSubmitting || googleSubmitting || appleImporting}
              >
                Annulla
              </Button>
              <Button variant="outline" onClick={confirmImportAppleFeed} disabled={appleSubmitting || googleSubmitting || appleImporting}>
                {appleImporting ? "Import Apple..." : "Importa da Apple"}
              </Button>
              <Button variant="outline" onClick={confirmSendGoogle} disabled={appleSubmitting || googleSubmitting || appleImporting}>
                {googleSubmitting ? "Connessione Google..." : "Invia a Google"}
              </Button>
              <Button onClick={confirmSendApple} disabled={appleSubmitting || googleSubmitting || appleImporting}>
                {appleSubmitting ? "Invio Apple..." : "Invia ad Apple"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
