export const GOOGLE_QA_BINDING: Readonly<{projectId: string; clientId: string; clientName: string; redirectUri: string; appCallback: string; testEmail: string; scopes: string[]}>;
export const GOOGLE_QA_SYNTHETIC_SECRET: string;
export function verifyGoogleQa(raw: Record<string, string | undefined>): {
  projectId: string; clientId: string; callback: string; stage: "offline-proof" | "interactive";
  networkMode: "offline" | "google"; maximumDurationSeconds: number; providerRequestsDuringPreflight: number;
};
