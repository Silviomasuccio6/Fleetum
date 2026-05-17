import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { initTheme } from "./infrastructure/theme/theme-manager";
import { SnackbarViewport } from "./presentation/components/ui/snackbar-viewport";
import { PlatformRoutes } from "./presentation/routes/platform-routes";
import "./presentation/styles/global.css";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <PlatformRoutes />
      <SnackbarViewport />
    </HashRouter>
  </React.StrictMode>
);
