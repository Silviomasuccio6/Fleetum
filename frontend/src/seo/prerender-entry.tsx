import { renderToString } from "react-dom/server";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import { StaticRouter } from "react-router-dom/server";
import { SnackbarViewport } from "../presentation/components/ui/snackbar-viewport";
import { AppRoutes } from "../presentation/routes/app-routes";

export type PrerenderedPage = {
  appHtml: string;
  headHtml: string;
};

type HelmetContext = { helmet?: HelmetServerState | null };

const renderHead = (helmet: HelmetServerState) =>
  [helmet.title, helmet.meta, helmet.link, helmet.script]
    .map((entry) => entry.toString())
    .join("\n");

export const renderPublicPage = (location: string): PrerenderedPage => {
  const helmetContext: HelmetContext = {};
  const appHtml = renderToString(
    <HelmetProvider context={helmetContext}>
      <StaticRouter location={location}>
        <AppRoutes />
        <SnackbarViewport />
      </StaticRouter>
    </HelmetProvider>
  );

  if (!helmetContext.helmet) throw new Error(`Helmet did not render SEO metadata for ${location}.`);

  return {
    appHtml,
    headHtml: renderHead(helmetContext.helmet)
  };
};
