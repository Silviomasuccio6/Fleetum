type Count = number | string | null | undefined;
export type FleetComposition =
  | { status: "unavailable" }
  | { status: "empty"; total: 0 }
  | { status: "ready"; total: number; booked: number; unbooked: number };

const count = (value: Count): number | null => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/** These aggregates describe booking coverage, not rentals in progress or technical stoppages. */
export const fleetComposition = (kpis?: { totalRentalVehicles?: Count; occupiedToday?: Count; availableToday?: Count }): FleetComposition => {
  const total = count(kpis?.totalRentalVehicles), booked = count(kpis?.occupiedToday), unbooked = count(kpis?.availableToday);
  if (total === null || booked === null || unbooked === null || booked > total || unbooked > total || booked + unbooked !== total) return { status: "unavailable" };
  return total === 0 ? { status: "empty", total: 0 } : { status: "ready", total, booked, unbooked };
};

export const fleetShares = (booked: number, total: number) => [booked / total, (total - booked) / total] as const;
export const interpolateFleetShares = (from: readonly number[], to: readonly number[], progress: number) => from.map((n, i) => n + (to[i] - n) * Math.max(0, Math.min(1, progress)));

export const fleetSector = (start: number, fraction: number, outer = 78, inner = 55): string => {
  if (fraction <= 0) return "";
  if (fraction >= 1 - 1e-10) return `M 100 ${100 - outer} a ${outer} ${outer} 0 1 1 0 ${outer * 2} a ${outer} ${outer} 0 1 1 0 ${-outer * 2} M 100 ${100 - inner} a ${inner} ${inner} 0 1 0 0 ${inner * 2} a ${inner} ${inner} 0 1 0 0 ${-inner * 2} Z`;
  const polar = (angle: number, r: number) => `${100 + Math.cos(angle) * r},${100 + Math.sin(angle) * r}`;
  const end = start + fraction * Math.PI * 2, large = fraction > .5 ? 1 : 0;
  return `M ${polar(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${polar(end, outer)} L ${polar(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${polar(start, inner)} Z`;
};
