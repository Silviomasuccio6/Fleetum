import { ChevronLeft, ChevronRight, Plus, Send } from "lucide-react";
import { CalendarView } from "./calendar-types";
import { Button } from "../ui/button";
import { cn } from "../../../lib/utils";

type CalendarToolbarProps = {
  monthLabel: string;
  canWrite?:boolean;
  curView: CalendarView;
  onNavigate: (dir: -1 | 1) => void;
  onSetView: (view: CalendarView) => void;
  onCreate: () => void;
  onSendApple: () => void;
  onSendGoogle: () => void;
};

const views: Array<{ id: CalendarView; label: string }> = [
  { id: "day", label: "Giorno" },
  { id: "week", label: "Settimana" },
  { id: "month", label: "Mese" }
];

export const CalendarToolbar = ({ canWrite=true,monthLabel, curView, onNavigate, onSetView, onCreate, onSendApple, onSendGoogle }: CalendarToolbarProps) => (
  <header className="calendar-toolbar">
    <div className="calendar-toolbar__group calendar-toolbar__group--left">
      <div className="calendar-toolbar__period" aria-label="Navigazione mese">
        <Button size="icon" variant="outline" onClick={() => onNavigate(-1)} aria-label="Periodo precedente">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="calendar-toolbar__title" title={monthLabel}>
          {monthLabel}
        </h2>
        <Button size="icon" variant="outline" onClick={() => onNavigate(1)} aria-label="Periodo successivo">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div className="calendar-toolbar__group calendar-toolbar__group--right">
      <div className="calendar-toolbar__switch" role="group" aria-label="Selettore vista calendario">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={curView === view.id}
            onClick={() => onSetView(view.id)}
            className={cn("calendar-toolbar__switch-btn", curView === view.id && "is-active")}
          >
            {view.label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={onSendApple}>
        <Send className="h-4 w-4" />
        Invia ad Apple
      </Button>
      <Button size="sm" variant="outline" onClick={onSendGoogle}>
        <Send className="h-4 w-4" />
        Invia a Google
      </Button>
      <Button size="sm" disabled={!canWrite} onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Nuovo evento
      </Button>
    </div>
  </header>
);
