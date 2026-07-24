import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { PublicRoutes } from "./presentation/routes/public-routes";

const app = (
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <PublicRoutes />
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fleetum public root element is missing.");

if (rootElement.dataset.prerendered === "true") {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
