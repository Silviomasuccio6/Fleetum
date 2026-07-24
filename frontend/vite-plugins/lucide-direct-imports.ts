import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const lucidePackageRoot = dirname(require.resolve("lucide-react/package.json"));
const lucideEsmEntry = readFileSync(resolve(lucidePackageRoot, "dist/esm/lucide-react.js"), "utf8");

const lucideIconPaths = new Map<string, string>();
const lucideExportPattern = /export \{([^}]+)\} from '\.\/icons\/([^']+)'/g;

for (const exportMatch of lucideEsmEntry.matchAll(lucideExportPattern)) {
  const [, exportedNames, iconPath] = exportMatch;

  for (const nameMatch of exportedNames.matchAll(/default as ([A-Za-z0-9_$]+)/g)) {
    lucideIconPaths.set(nameMatch[1], iconPath);
  }
}

if (lucideIconPaths.size === 0) {
  throw new Error("Unable to read the lucide-react icon export map.");
}

const lucideNamedImportPattern = /import\s*\{([^{}]+)\}\s*from\s*(["'])lucide-react\2;?/g;

const toDirectLucideImports = (rawSpecifiers: string, moduleId: string) =>
  rawSpecifiers
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const [importedName, localName = importedName] = specifier.split(/\s+as\s+/);
      const iconPath = lucideIconPaths.get(importedName);

      if (!iconPath) {
        throw new Error(`Unsupported lucide-react import "${importedName}" in ${moduleId}.`);
      }

      return `import ${localName} from "lucide-react/dist/esm/icons/${iconPath}";`;
    })
    .join("\n");

/**
 * The lucide barrel exports every icon, forcing Rolldown to transform thousands
 * of unused modules. Keep source imports ergonomic while building only the
 * icons that Fleetum actually uses.
 */
export const lucideDirectImports = (): Plugin => ({
  name: "fleetum-lucide-direct-imports",
  apply: "build",
  enforce: "pre",
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, "/");
    if (!normalizedId.includes("/src/") || !code.includes("lucide-react")) return null;

    const transformedCode = code.replace(
      lucideNamedImportPattern,
      (_fullImport, rawSpecifiers: string) => toDirectLucideImports(rawSpecifiers, normalizedId)
    );

    if (transformedCode === code) return null;
    return { code: transformedCode, map: null };
  }
});
