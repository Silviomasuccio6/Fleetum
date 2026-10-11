import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { AppErrorBoundary } from "./presentation/components/errors/app-error-boundary";
import { PublicRoutes } from "./presentation/routes/public-routes";

const app = (
  <React.StrictMode>
    <AppErrorBoundary scope="app">
      <HelmetProvider>
        <BrowserRouter>
          <PublicRoutes />
        </BrowserRouter>
      </HelmetProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fleetum public root element is missing.");

if (rootElement.dataset.prerendered === "true") {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
