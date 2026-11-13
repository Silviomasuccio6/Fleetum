export type ProviderQaMode = "offline" | "stripe" | "google" | "both";
export function assertQaDestination(input: string | URL, mode: ProviderQaMode): void;
export function installQaNetworkPolicy(mode: ProviderQaMode): () => void;
