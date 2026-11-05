export type SectionEntry = { label: string; to: string; group: string };
const readPermission: Record<string, string> = {
  "/dashboard": "stats:read", "/booking": "vehicles:read", "/booking/contratti": "vehicles:read",
  "/booking/listini": "vehicles:read", "/anagrafiche/veicoli": "vehicles:read", "/anagrafiche/clienti": "vehicles:read",
  "/anagrafiche/scadenziario": "vehicles:read", "/anagrafiche/manutenzioni": "vehicles:read",
  "/fermi": "stoppages:read", "/fermi/kanban": "stoppages:read", "/fermi/calendario": "stoppages:read",
  "/anagrafiche/sedi": "sites:read", "/anagrafiche/officine": "workshops:read", "/statistiche": "stats:read",
  "/utenti": "users:read", "/profilo/azienda": "users:read"
};
export function allowedSearchSections(entries: SectionEntry[], permissions: string[], billing: boolean, company: boolean) {
  return entries.filter(entry => {
    if (entry.to === "/upgrade") return billing;
    if (entry.to === "/profilo/azienda" && !company) return false;
    const permission = readPermission[entry.to];
    return permission ? permissions.includes("*") || permissions.includes(permission) : entry.to === "/profilo";
  });
}
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
export function matchSections(entries: SectionEntry[], query: string) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter(entry => words.every(word => normalize(`${entry.label} ${entry.group}`).includes(word)));
}
