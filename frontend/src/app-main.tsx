import React from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { initTheme } from "./infrastructure/theme/theme-manager";
import { SnackbarViewport } from "./presentation/components/ui/snackbar-viewport";
import { AppRoutes } from "./presentation/routes/app-routes";
import "./presentation/styles/fonts.css";
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

// The SPA fallback can contain prerendered public markup; tenant/auth routes
// must replace it rather than trying to hydrate a different React tree.
rootElement.replaceChildren();
delete rootElement.dataset.prerendered;
createRoot(rootElement).render(app);
