import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { initTheme } from "./infrastructure/theme/theme-manager";
import { SnackbarViewport } from "./presentation/components/ui/snackbar-viewport";
import { AppRoutes } from "./presentation/routes/app-routes";
import "./presentation/styles/global.css";

initTheme();

const app = (
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <AppRoutes />
        <SnackbarViewport />
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fleetum root element is missing.");

if (rootElement.dataset.prerendered === "true") {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
