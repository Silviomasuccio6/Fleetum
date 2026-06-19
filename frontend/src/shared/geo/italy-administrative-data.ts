export type ItalianProvince = { code: string; name: string; region: string };
export type ItalianMunicipality = {
  code: string;
  name: string;
  province: string;
  provinceName: string;
  region: string;
  istatCode: string;
  cadastralCode?: string | null;
  postalCodes: string[];
};

export type ItalyAdministrativeData = {
  source: string;
  generatedFor: string;
  regions: string[];
  provinces: ItalianProvince[];
  municipalities: ItalianMunicipality[];
};

let italyAdministrativeDataPromise: Promise<ItalyAdministrativeData> | null = null;

const assertItalyAdministrativeData = (data: unknown): ItalyAdministrativeData => {
  const value = data as Partial<ItalyAdministrativeData> | null;
  if (!value || !Array.isArray(value.regions) || !Array.isArray(value.provinces) || !Array.isArray(value.municipalities)) {
    throw new Error("Dati geografici italiani non validi");
  }
  return value as ItalyAdministrativeData;
};

export const loadItalyAdministrativeData = () => {
  if (!italyAdministrativeDataPromise) {
    italyAdministrativeDataPromise = fetch("/data/italy-administrative-data.json", {
      headers: { Accept: "application/json" }
    })
      .then((response) => {
        if (!response.ok) throw new Error("Impossibile caricare comuni e province italiane");
        return response.json() as Promise<unknown>;
      })
      .then(assertItalyAdministrativeData);
  }
  return italyAdministrativeDataPromise;
};
