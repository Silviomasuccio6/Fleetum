import { readFileSync } from "node:fs";

// Public identifiers verified in the separate QA console; this file contains no secret.
export const GOOGLE_QA_BINDING = Object.freeze(JSON.parse(readFileSync(new URL("./google-qa-bindings.json", import.meta.url), "utf8")));
export const GOOGLE_QA_SYNTHETIC_SECRET = "synthetic-google-qa-offline-only";

export function verifyGoogleQa(raw) {
  const require = (condition, field) => {
    if (!condition) throw new Error(`PROVIDER_QA_GOOGLE_${field}`);
  };
  require(raw.FLEETUM_ENVIRONMENT === "provider-qa" && raw.NODE_ENV === "test" &&
    raw.DOTENV_CONFIG_PATH === "/dev/null" && raw.FLEETUM_PROVIDER_QA_MODE === "google", "ENTRYPOINT_REFUSED");
  const stage = raw.FLEETUM_PROVIDER_QA_GOOGLE_STAGE;
  require(stage === "offline-proof" || stage === "interactive", "STAGE_REFUSED");
  require(raw.GOOGLE_CLIENT_ID === GOOGLE_QA_BINDING.clientId &&
    raw.FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID === GOOGLE_QA_BINDING.clientId &&
    raw.FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID === GOOGLE_QA_BINDING.projectId, "BINDING_REFUSED");
  require(raw.GOOGLE_REDIRECT_URI === GOOGLE_QA_BINDING.redirectUri &&
    raw.OAUTH_CALLBACK_URL === GOOGLE_QA_BINDING.appCallback, "CALLBACK_REFUSED");
  require(stage === "offline-proof" ? raw.GOOGLE_CLIENT_SECRET === GOOGLE_QA_SYNTHETIC_SECRET :
    /^GOCSPX-[A-Za-z0-9_-]{20,128}$/.test(raw.GOOGLE_CLIENT_SECRET ?? ""), "SECRET_REFUSED");
  const duration = Number(raw.FLEETUM_PROVIDER_QA_MAX_SECONDS ?? "60");
  require(Number.isInteger(duration) && duration >= 15 && duration <= (stage === "offline-proof" ? 120 : 1500), "DURATION_REFUSED");
  require(!Object.keys(raw).some(name => /^(STRIPE_|APPLE_|S3_)/.test(name) && raw[name]?.trim()), "OTHER_PROVIDER_REFUSED");
  return { projectId: GOOGLE_QA_BINDING.projectId, clientId: GOOGLE_QA_BINDING.clientId,
    callback: GOOGLE_QA_BINDING.redirectUri, stage, networkMode: stage === "offline-proof" ? "offline" : "google",
    maximumDurationSeconds: duration, providerRequestsDuringPreflight: 0 };
}
