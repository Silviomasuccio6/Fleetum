import path from "node:path";

export function parseRehearsalOptions(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) throw new Error("Invalid rehearsal arguments.");
  const options = { run: false, sourceSha: null, evidenceDirectory: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--run", "--source-sha", "--evidence-dir"].includes(flag)) throw new Error("Unsupported rehearsal option or positional argument.");
    if (seen.has(flag)) throw new Error(`Duplicate rehearsal option: ${flag}.`);
    seen.add(flag);
    if (flag === "--run") { options.run = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    if (flag === "--source-sha") {
      if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("--source-sha must be a full lowercase 40-character commit SHA.");
      options.sourceSha = value;
    } else {
      if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value === "/" || value.endsWith("/") || path.posix.normalize(value) !== value) {
        throw new Error("--evidence-dir must be a safe canonical absolute non-root directory.");
      }
      options.evidenceDirectory = value;
    }
  }
  if (args.length && !options.run) throw new Error("Rehearsal options require explicit --run.");
  if (options.run && !options.sourceSha) throw new Error("--run requires --source-sha for release-bound evidence.");
  return options;
}
