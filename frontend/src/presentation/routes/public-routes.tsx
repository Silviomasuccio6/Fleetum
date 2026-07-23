import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { CookieConsentBanner } from "../components/privacy/cookie-consent-banner";
import { publicRouteElements } from "./public-route-elements";

const ContinueInFleetumApp = () => {
  useEffect(() => {
    // Public links to auth intentionally cross into the separately bundled app shell.
    window.location.replace(window.location.href);
  }, []);

  return null;
};

export const PublicRoutes = () => (
  <>
    <CookieConsentBanner />
    <Routes>
      {publicRouteElements()}
      <Route path="*" element={<ContinueInFleetumApp />} />
    </Routes>
  </>
);
