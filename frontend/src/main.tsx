import { isPublicRoute } from "./seo/is-public-route";
import "./presentation/styles/public-entry.css";

const bootstrap = isPublicRoute(window.location.pathname)
  ? import("./public-main")
  : import("./app-main");

void bootstrap.catch((error: unknown) => {
  console.error("Fleetum bootstrap failed.", error);
});
