import { isPublicRoute } from "./seo/is-public-route";
import { renderBootstrapFailure, reportUiRecovery } from "./presentation/components/errors/ui-recovery";
import "./presentation/styles/public-entry.css";

const bootstrap = isPublicRoute(window.location.pathname)
  ? import("./public-main")
  : import("./app-main");

void bootstrap.catch(() => {
  reportUiRecovery("bootstrap");
  renderBootstrapFailure();
});
