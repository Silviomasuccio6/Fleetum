import { Activity, BarChart3, Building2, FileText, Globe2, LayoutDashboard, Server, ShieldCheck, SlidersHorizontal, UserRoundCheck, Users } from "lucide-react";

export const platformSections = [
  { id: "overview", label: "Panoramica", group: "Gestione", icon: LayoutDashboard },
  { id: "tenants", label: "Aziende", group: "Gestione", icon: Building2 },
  { id: "plans", label: "Licenze e piani", group: "Gestione", icon: BarChart3 },
  { id: "billing", label: "Fatture", group: "Gestione", icon: FileText },
  { id: "users", label: "Utenti", group: "Gestione", icon: Users },
  { id: "analytics", label: "Analytics sito", group: "Acquisizione", icon: Globe2 },
  { id: "leads", label: "Richieste demo", group: "Acquisizione", icon: UserRoundCheck },
  { id: "audit", label: "Eventi e audit", group: "Sistema", icon: Activity },
  { id: "health", label: "Stato servizi", group: "Sistema", icon: Server },
  { id: "security", label: "Sicurezza", group: "Sistema", icon: ShieldCheck },
  { id: "settings", label: "Impostazioni", group: "Sistema", icon: SlidersHorizontal }
] as const;

export type PlatformSectionId = (typeof platformSections)[number]["id"];
export const isPlatformSectionId = (value: unknown): value is PlatformSectionId =>
  platformSections.some((section) => section.id === value);

export const platformSectionLabel = (id: PlatformSectionId) =>
  platformSections.find((section) => section.id === id)!.label;
