import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { publicPrerenderRoutes } from "./src/seo/public-prerender-routes";
import { lucideDirectImports } from "./vite-plugins/lucide-direct-imports";

const publicPreviewRoutes = new Set(publicPrerenderRoutes.filter((route) => route !== "/"));

const prerenderPreviewFallback = {
  name: "fleetum-prerender-preview-fallback",
  configurePreviewServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((request, _response, next) => {
      const requestUrl = request.url ?? "";
      const queryIndex = requestUrl.indexOf("?");
      const pathname = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);

      // Vite preview does not resolve /route to /route/index.html like Caddy does.
      if (publicPreviewRoutes.has(pathname)) {
        const search = queryIndex === -1 ? "" : requestUrl.slice(queryIndex);
        request.url = `${pathname}/${search}`;
      }

      next();
    });
  }
};

const manualChunkGroups: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom", "react-router-dom"],
  "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"],
  "vendor-http": ["axios"]
};

const manualChunks = (id: string) => {
  if (!id.includes("node_modules")) return undefined;
  const normalized = id.split("node_modules/").pop()?.replace(/\\/g, "/") ?? id;

  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (
      packages.some((packageName) => normalized === packageName || normalized.startsWith(`${packageName}/`))
    ) {
      return chunkName;
    }
  }

  return undefined;
};

export default defineConfig(({ mode }) => ({
  plugins: [
    lucideDirectImports(),
    react(),
    prerenderPreviewFallback,
    ...(process.env.ANALYZE === "true"
      ? [
          visualizer({
            filename: "dist/bundle-stats.html",
            gzipSize: true,
            brotliSize: true,
            template: "treemap"
          })
        ]
      : [])
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    target: "es2020",
    sourcemap: mode === "production" ? false : "inline",
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        platform: resolve(__dirname, "platform.html")
      },
      output: {
        manualChunks
      }
    }
  }
}));
