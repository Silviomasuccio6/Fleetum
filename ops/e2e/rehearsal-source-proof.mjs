import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export function verifyRehearsalSourceProof(sourceRoot, sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("Local rehearsal source SHA must be a full lowercase Git commit SHA.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" });
  const git = (...args) => {
    try {
      return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], {
        cwd: sourceRoot, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      throw new Error("Unable to verify local rehearsal Git source.");
    }
  };
  let canonicalRoot;
  try { canonicalRoot = realpathSync(sourceRoot); }
  catch { throw new Error("Unable to verify local rehearsal Git source."); }
  const gitRoot = git("rev-parse", "--show-toplevel").trim();
  if (realpathSync(gitRoot) !== canonicalRoot) throw new Error("Local rehearsal Git source must be the repository root.");
  const head = git("rev-parse", "--verify", "HEAD").trim();
  if (head !== sourceSha) throw new Error("Local rehearsal source SHA does not match the checkout HEAD.");
  const tree = git("rev-parse", "--verify", `${head}^{tree}`).trim();
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error("Unable to verify local rehearsal Git source tree.");
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  if (status) throw new Error("Local rehearsal requires a clean checkout, including tracked and untracked source files.");
  if (git("rev-parse", "--verify", "HEAD").trim() !== head) throw new Error("Local rehearsal source SHA changed during verification.");
  return { head, tree, status: { clean: true, trackedChanges: 0, untrackedChanges: 0 }, scope: "Git HEAD/tree and non-ignored checkout status before rehearsal allocation" };
}
