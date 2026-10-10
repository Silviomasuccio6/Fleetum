import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Link, Outlet, Route, Routes, StaticRouter, useParams } from "react-router-dom";

const render = (pathname: string, routes: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(StaticRouter, { location: pathname }, routes));

test("nested tenant routes keep parameter matching and absolute internal links", () => {
  const Detail = () => createElement("main", null, useParams().id,
    createElement(Link, { to: "/app/vehicles?status=active" }, "Vehicles"));
  const routes = createElement(Routes, null,
    createElement(Route, { path: "/app", element: createElement(Outlet) },
      createElement(Route, { path: "vehicles/:id", element: createElement(Detail) })));
  const html = render("/app/vehicles/synthetic-vehicle", routes);
  assert.match(html, /synthetic-vehicle/);
  assert.match(html, /href="\/app\/vehicles\?status=active"/);
});

test("Platform console index and public auth routes remain separate route branches", () => {
  const routes = createElement(Routes, null,
    createElement(Route, { path: "/console", element: createElement(Outlet) },
      createElement(Route, { index: true, element: createElement("main", null, "Synthetic console") })),
    createElement(Route, { path: "/login", element: createElement("main", null, "Synthetic login") }),
    createElement(Route, { path: "/password-recovery", element: createElement("main", null, "Synthetic recovery") }));
  assert.match(render("/console", routes), /Synthetic console/);
  assert.match(render("/login", routes), /Synthetic login/);
  assert.match(render("/password-recovery", routes), /Synthetic recovery/);
});
