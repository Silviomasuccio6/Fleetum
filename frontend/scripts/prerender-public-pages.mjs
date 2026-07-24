import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";

const frontendRoot = resolve(import.meta.dirname, "..");
const distRoot = join(frontendRoot, "dist");
const templatePath = join(distRoot, "index.html");
const seoHeadPattern = /<!-- SEO_HEAD_START -->[\s\S]*?<!-- SEO_HEAD_END -->/;
const rootPattern = /<div id="root"><\/div>/;

const createSpaShell = (template) =>
  template.replace(
    seoHeadPattern,
    [
      "<!-- SEO_HEAD_START -->",
      "<title>Fleetum</title>",
      '<meta name="robots" content="noindex, nofollow" />',
      "<!-- SEO_HEAD_END -->"
    ].join("\n    ")
  );

const writePrerenderedPage = async (template, route, page) => {
  const outputPath = route === "/" ? templatePath : join(distRoot, route.slice(1), "index.html");
  const html = template
    .replace(seoHeadPattern, `<!-- SEO_HEAD_START -->\n    ${page.headHtml}\n    <!-- SEO_HEAD_END -->`)
    .replace(rootPattern, `<div id="root" data-prerendered="true">${page.appHtml}</div>`);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
};

const template = await readFile(templatePath, "utf8");
if (!seoHeadPattern.test(template) || !rootPattern.test(template)) {
  throw new Error("Prerender template markers are missing from frontend/index.html.");
}

await rm(join(distRoot, "spa.html"), { force: true });
await writeFile(join(distRoot, "spa.html"), createSpaShell(template), "utf8");

const vite = await createServer({
  root: frontendRoot,
  appType: "custom",
  optimizeDeps: {
    noDiscovery: true
  },
  server: {
    middlewareMode: true,
    hmr: false,
    ws: false,
    watch: null,
    preTransformRequests: false
  }
});

try {
  const [{ publicPrerenderRoutes }, { renderPublicPage }] = await Promise.all([
    vite.ssrLoadModule("/src/seo/public-prerender-routes.ts"),
    vite.ssrLoadModule("/src/seo/prerender-entry.tsx")
  ]);

  for (const route of publicPrerenderRoutes) {
    await writePrerenderedPage(template, route, renderPublicPage(route));
  }
} finally {
  await vite.close();
}
