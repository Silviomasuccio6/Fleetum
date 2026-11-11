export type VehicleFieldName = "siteId" | "plate" | "brand" | "model" | "year" | "currentKm" | "maintenanceIntervalKm" | "registrationDate" | "lastRevisionAt" | "purchasePrice" | "purchaseDate" | "residualValue" | "monthlyFixedCost" | "notes";
export type VehicleErrors = Partial<Record<VehicleFieldName, string>>;
type Field = { name: VehicleFieldName; label: string; type?: "number" | "date" | "site" | "textarea"; required?: boolean; min?: number; max?: number; step?: string; hint?: string };
export const vehicleFieldGroups: Array<{ title: string; description: string; fields: Field[] }> = [
  { title: "Identità e sede", description: "I dati che identificano il veicolo nella flotta.", fields: [
    { name: "siteId", label: "Sede", type: "site", required: true },
    { name: "plate", label: "Targa", required: true },
    { name: "brand", label: "Marca", required: true },
    { name: "model", label: "Modello", required: true },
    { name: "year", label: "Anno", type: "number", min: 1950, max: 2100, hint: "Facoltativo. In modifica, un anno vuoto mantiene il valore già salvato." }
  ] },
  { title: "Chilometri e revisioni", description: "Valori operativi e date utilizzati dalle scadenze esistenti.", fields: [
    { name: "currentKm", label: "Km attuali", type: "number", min: 0 },
    { name: "maintenanceIntervalKm", label: "Intervallo manutenzione (km)", type: "number", min: 100 },
    { name: "registrationDate", label: "Data immatricolazione (libretto)", type: "date" },
    { name: "lastRevisionAt", label: "Ultima revisione effettuata", type: "date", hint: "Prima revisione a 4 anni dall’immatricolazione, poi ogni 2 anni dall’ultima revisione." }
  ] },
  { title: "Acquisto e costi", description: "Importi facoltativi in euro per le analisi del veicolo.", fields: [
    { name: "purchasePrice", label: "Prezzo acquisto", type: "number", min: 0, step: "0.01" },
    { name: "purchaseDate", label: "Data acquisto", type: "date" },
    { name: "residualValue", label: "Valore residuo stimato", type: "number", min: 0, step: "0.01" },
    { name: "monthlyFixedCost", label: "Costi fissi mensili", type: "number", min: 0, step: "0.01" }
  ] },
  { title: "Note operative", description: "Informazioni utili a chi gestisce il veicolo.", fields: [
    { name: "notes", label: "Note", type: "textarea" }
  ] }
];

/** Same wire fields as the existing form; no availability or active-state mutation. */
export function vehicleFormData(form: FormData) {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const errors: VehicleErrors = {};
  const number = (name: VehicleFieldName, min: number, integer = false, max = Infinity) => {
    const raw = value(name);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
      errors[name] = integer ? "Inserisci un numero intero nel limite indicato." : "Inserisci un importo valido, uguale o maggiore di zero.";
    }
    return parsed;
  };
  const date = (name: VehicleFieldName) => {
    const raw = value(name);
    if (!raw) return null;
    const parsed = new Date(`${raw}T12:00:00`);
    const localDay = Number.isNaN(parsed.getTime()) ? "" : `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || localDay !== raw) { errors[name] = "Inserisci una data valida."; return null; }
    return parsed.toISOString();
  };
  for (const [name, minimum] of [["siteId", 1], ["plate", 2], ["brand", 2], ["model", 1]] as const) {
    if (value(name).length < minimum) errors[name] = minimum === 2 ? "Inserisci almeno 2 caratteri." : "Compila questo campo.";
  }
  const payload = {
    siteId: value("siteId"), plate: value("plate").toUpperCase(), brand: value("brand"), model: value("model"),
    // The existing API allows an omitted year, but rejects null.
    year: value("year") ? number("year", 1950, true, 2100) : undefined,
    currentKm: number("currentKm", 0, true), maintenanceIntervalKm: number("maintenanceIntervalKm", 100, true),
    registrationDate: date("registrationDate"), lastRevisionAt: date("lastRevisionAt"),
    purchasePrice: number("purchasePrice", 0), purchaseDate: date("purchaseDate"),
    residualValue: number("residualValue", 0), monthlyFixedCost: number("monthlyFixedCost", 0), notes: value("notes")
  };
  return { payload, errors };
}
export const vehicleDateInput = (value?: string | Date | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
export const vehicleDate = (value?: string | Date | null, month = false) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Date(value).toLocaleDateString("it-IT", month ? { month: "long", year: "numeric" } : {});
};
export const vehicleNumber = (value: unknown, money = false) => value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("it-IT", money ? { style: "currency", currency: "EUR" } : {}).format(Number(value));
export const vehicleState = (value: unknown) => value === true ? "Attivo" : value === false ? "Inattivo" : "Stato non disponibile";
