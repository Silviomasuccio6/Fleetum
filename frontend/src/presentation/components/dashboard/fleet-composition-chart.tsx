import { useRef, useState } from "react";
import { chartMotionEase, useWorkspaceChartTransition } from "../../hooks/use-workspace-chart-transition";
import { fleetComposition, fleetSector, fleetShares, interpolateFleetShares } from "./fleet-composition";
import { translateText, useFleetumLanguage } from "../../i18n/fleetum-language";

type Props = { kpis?: Parameters<typeof fleetComposition>[0] };
const number = (value: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value);

export function FleetCompositionChart({ kpis }: Props) {
  const { language } = useFleetumLanguage();
  const model = fleetComposition(kpis);
  const paths = useRef<Array<SVGPathElement | null>>([]);
  const currentShares = useRef<readonly number[]>();
  const [selection, setSelection] = useState<{ index: number; pointer: boolean } | null>(null);
  const target = model.status === "ready" ? fleetShares(model.booked, model.total) : null;
  const signature = model.status === "ready" ? JSON.stringify([model.total, model.booked, model.unbooked]) : null;
  useWorkspaceChartTransition(signature, animate => {
    if (!target) { currentShares.current = undefined; return undefined; }
    const paint = (shares: readonly number[]) => {
      currentShares.current = shares;
      let start = -Math.PI / 2;
      shares.forEach((fraction, index) => {
        paths.current[index]?.setAttribute("d", fleetSector(start, fraction));
        start += fraction * Math.PI * 2;
      });
    };
    const previous = currentShares.current;
    if (!animate || !previous) { paint(target); return undefined; }
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 280);
      paint(interpolateFleetShares(previous, target, chartMotionEase(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick); else paint(target);
    };
    paint(previous);
    frame = requestAnimationFrame(tick);
    return { cancel: settle => { cancelAnimationFrame(frame); if (settle) paint(target); } };
  });

  if (model.status === "unavailable") return <p className="dashboard-empty">Ripartizione della flotta non disponibile: conteggi mancanti o non confrontabili.</p>;
  if (model.status === "empty") return <p className="dashboard-empty">Nessun veicolo di noleggio nel contesto selezionato.</p>;
  const sectors = [
    { label: "Con prenotazioni", value: model.booked, color: "var(--dashboard-blue)" },
    { label: "Senza prenotazioni", value: model.unbooked, color: "var(--dashboard-neutral)" }
  ];
  const percentages = sectors.map(sector => sector.value / model.total);
  const selected = selection ? sectors[selection.index] : null;
  let angle = -Math.PI / 2;
  return <div className="fleet-composition">
    <svg className="fleet-composition-chart" viewBox="0 0 200 200" role="img" aria-label="Ripartizione dei veicoli in base alle prenotazioni; quantità e percentuali sono elencate sotto.">
      <title>Ripartizione della flotta</title>
      <desc>{translateText(`${model.booked} con prenotazioni, ${model.unbooked} senza prenotazioni, su ${model.total} veicoli.`, language)}</desc>
      {sectors.map((sector, index) => {
        const start = angle, fraction = percentages[index], middle = start + fraction * Math.PI;
        angle += fraction * Math.PI * 2;
        const shift = selection?.pointer && selection.index === index ? 4 : 0;
        return <path key={sector.label} ref={element => { paths.current[index] = element; }} className="fleet-composition-sector" d={fleetSector(start, fraction)} fill={sector.color} fillRule="evenodd" style={{ transform: `translate(${Math.cos(middle) * shift}px,${Math.sin(middle) * shift}px)` }} />;
      })}
      <text x="100" y="101" className="fleet-composition-total">{selected ? `${number(selected.value / model.total * 100)}%` : number(model.total)}</text>
      <text x="100" y="122" className="fleet-composition-caption">{selected ? selected.label : "veicoli totali"}</text>
    </svg>
    <div className="fleet-composition-legend" role="group" aria-label="Stati rispetto alle prenotazioni">
      {sectors.map((sector, index) => <button key={sector.label} type="button" aria-pressed={selection?.index === index} onClick={event => setSelection(selection?.index === index ? null : { index, pointer: event.detail > 0 })}>
        <span><i className="fleet-composition-swatch" style={{ background: sector.color }} aria-hidden="true" />{sector.label}</span>
        <span>{number(sector.value)} · {number(sector.value / model.total * 100)}%</span>
      </button>)}
    </div>
    <p className="fleet-composition-note">Stima basata sulle prenotazioni. I fermi tecnici non sono inclusi in questa ripartizione.</p>
  </div>;
}
