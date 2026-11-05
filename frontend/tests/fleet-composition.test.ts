import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fleetComposition, fleetSector, fleetShares, interpolateFleetShares } from "../src/presentation/components/dashboard/fleet-composition";
import { FleetCompositionChart } from "../src/presentation/components/dashboard/fleet-composition-chart";
import { chartMotionAllowed, chartMotionEase } from "../src/presentation/hooks/use-workspace-chart-transition";

test("fleet composition uses only complete, consistent source aggregates", () => {
  assert.deepEqual(fleetComposition({ totalRentalVehicles: "12", occupiedToday: 8, availableToday: 4 }), { status: "ready", total: 12, booked: 8, unbooked: 4 });
  for (const value of [undefined, null, "", "x", -1, Infinity, .5]) assert.equal(fleetComposition({ totalRentalVehicles: value, occupiedToday: 8, availableToday: 4 }).status, "unavailable");
  assert.equal(fleetComposition({ totalRentalVehicles: 12, occupiedToday: 13, availableToday: 0 }).status, "unavailable");
  assert.equal(fleetComposition({ totalRentalVehicles: 12, occupiedToday: 6, availableToday: 4 }).status, "unavailable");
});
test("zero vehicles and a single full sector remain honest and renderable", () => {
  assert.deepEqual(fleetComposition({ totalRentalVehicles: 0, occupiedToday: 0, availableToday: 0 }), { status: "empty", total: 0 });
  assert.equal(fleetSector(0, 0), "");
  assert.doesNotMatch(fleetSector(0, 1), /NaN|Infinity/);
  const html = renderToStaticMarkup(React.createElement(FleetCompositionChart, { kpis: { totalRentalVehicles: 12, occupiedToday: 12, availableToday: 0 } }));
  assert.ok(html.includes("100%")); assert.ok(html.includes("0%")); assert.ok(html.includes("I fermi tecnici non sono inclusi"));
});
test("inconsistent or unavailable data never become fabricated zero percentages", () => {
  const html = renderToStaticMarkup(React.createElement(FleetCompositionChart, {}));
  assert.ok(html.includes("conteggi mancanti o non confrontabili")); assert.ok(!html.includes("0%")); assert.ok(!html.includes("<svg"));
});
test("interpolating fleet shares preserves the whole for changes in fleet size too", () => {
  for (const from of [fleetShares(0, 12), fleetShares(12, 12), fleetShares(6, 12)]) for (const to of [fleetShares(0, 8), fleetShares(8, 8), fleetShares(3, 8)]) {
    for (const t of [0, .1, .25, .5, .75, .9, 1]) {
      const shares = interpolateFleetShares(from, to, chartMotionEase(t));
      assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-10);
      assert.ok(shares.every(value => value >= 0 && value <= 1));
    }
  }
});
test("data animation excludes first paint, identical refreshes, keyboard and hidden or reduced views", () => {
  assert.equal(chartMotionAllowed("old", "new", true, false, true), true);
  assert.equal(chartMotionAllowed(null, "new", true, false, true), false);
  assert.equal(chartMotionAllowed("old", null, true, false, true), false);
  assert.equal(chartMotionAllowed("same", "same", true, false, true), false);
  assert.equal(chartMotionAllowed("old", "new", false, false, true), false);
  assert.equal(chartMotionAllowed("old", "new", true, true, true), false);
  assert.equal(chartMotionAllowed("old", "new", true, false, false), false);
});
