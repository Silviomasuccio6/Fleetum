import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, useLocation } from "react-router-dom";
import { initTheme } from "./infrastructure/theme/theme-manager";
import { SnackbarViewport } from "./presentation/components/ui/snackbar-viewport";
import { PlatformRoutes } from "./presentation/routes/platform-routes";
import "./presentation/styles/global.css";
import "./presentation/styles/platform-satin.css";

initTheme();

const LoginNotifications = () => {
  const location = useLocation();
  return location.pathname.startsWith("/console") ? null : <SnackbarViewport />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <PlatformRoutes />
      <LoginNotifications />
    </HashRouter>
  </React.StrictMode>
);
