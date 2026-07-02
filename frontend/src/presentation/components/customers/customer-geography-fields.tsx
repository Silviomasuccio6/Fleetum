import { useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "../../../shared/geo/countries";
import {
  ItalyAdministrativeData,
  ItalianMunicipality,
  loadItalyAdministrativeData
} from "../../../shared/geo/italy-administrative-data";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

export type StructuredAddressValue = {
  country: string;
  region: string;
  province: string;
  municipalityCode: string;
  city: string;
  postalCode: string;
  streetAddress: string;
};

export const emptyStructuredAddress = (country = "IT"): StructuredAddressValue => ({
  country,
  region: "",
  province: "",
  municipalityCode: "",
  city: "",
  postalCode: "",
  streetAddress: ""
});

export const countryNameFromCode = (code?: string | null) =>
  COUNTRIES.find((country) => country.code === code)?.name ?? code ?? "";

type CountrySelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholderLabel?: string;
  required?: boolean;
};

export const CountrySelect = ({ id, value, onChange, placeholderLabel = "Seleziona nazione", required }: CountrySelectProps) => (
  <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholderLabel={placeholderLabel} required={required}>
    {COUNTRIES.map((country) => (
      <option key={country.code} value={country.code}>
        {country.name}
      </option>
    ))}
  </Select>
);

type CustomerAddressFieldsProps = {
  idPrefix: string;
  title: string;
  value: StructuredAddressValue;
  onChange: (value: StructuredAddressValue) => void;
  streetLabel?: string;
  className?: string;
};

export const CustomerAddressFields = ({
  idPrefix,
  title,
  value,
  onChange,
  streetLabel = "Indirizzo",
  className = ""
}: CustomerAddressFieldsProps) => {
  const [italyData, setItalyData] = useState<ItalyAdministrativeData | null>(null);
  const [italyDataError, setItalyDataError] = useState<string | null>(null);
  const isItaly = value.country === "IT";

  useEffect(() => {
    if (!isItaly || italyData) return;
    let active = true;
    loadItalyAdministrativeData()
      .then((data) => {
        if (active) {
          setItalyData(data);
          setItalyDataError(null);
        }
      })
      .catch((error) => {
        if (active) setItalyDataError(error instanceof Error ? error.message : "Dati geografici non disponibili");
      });
    return () => {
      active = false;
    };
  }, [isItaly, italyData]);

  const provinceOptions = useMemo(() => {
    const provinces = italyData?.provinces ?? [];
    return value.region ? provinces.filter((province) => province.region === value.region) : provinces;
  }, [italyData, value.region]);

  const municipalityOptions = useMemo(() => {
    const municipalities = italyData?.municipalities ?? [];
    if (!value.province) return [];
    return municipalities.filter((municipality) => municipality.province === value.province);
  }, [italyData, value.province]);

  const selectedMunicipality = useMemo(
    () => municipalityOptions.find((municipality) => municipality.code === value.municipalityCode) ?? null,
    [municipalityOptions, value.municipalityCode]
  );

  const update = (patch: Partial<StructuredAddressValue>) => onChange({ ...value, ...patch });

  const handleCountryChange = (country: string) => {
    onChange({
      ...emptyStructuredAddress(country),
      streetAddress: value.streetAddress
    });
  };

  const handleRegionChange = (region: string) => {
    update({ region, province: "", municipalityCode: "", city: "", postalCode: "" });
  };

  const handleProvinceChange = (provinceCode: string) => {
    const province = italyData?.provinces.find((item) => item.code === provinceCode);
    update({
      region: province?.region ?? value.region,
      province: provinceCode,
      municipalityCode: "",
      city: "",
      postalCode: ""
    });
  };

  const handleMunicipalityChange = (municipalityCode: string) => {
    const municipality = municipalityOptions.find((item) => item.code === municipalityCode);
    if (!municipality) {
      update({ municipalityCode: "", city: "", postalCode: "" });
      return;
    }

    update({
      region: municipality.region,
      province: municipality.province,
      municipalityCode: municipality.code,
      city: municipality.name,
      postalCode:
        municipality.postalCodes.length === 1 || !municipality.postalCodes.includes(value.postalCode)
          ? municipality.postalCodes[0] ?? ""
          : value.postalCode
    });
  };

  const postalCodes = selectedMunicipality?.postalCodes ?? [];

  return (
    <div className={`md:col-span-4 rounded-2xl border border-border/70 bg-muted/25 p-3 ${className}`}>
      <div className="mb-3 flex flex-col gap-1">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">
          Per l'Italia usa la selezione guidata; per l'estero resta disponibile il fallback manuale controllato.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor={`${idPrefix}-street`}>{streetLabel}</Label>
          <Input
            id={`${idPrefix}-street`}
            value={value.streetAddress}
            onChange={(event) => update({ streetAddress: event.target.value })}
            placeholder="Via, numero civico, interno"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor={`${idPrefix}-country`}>Nazione</Label>
          <CountrySelect id={`${idPrefix}-country`} value={value.country} onChange={handleCountryChange} />
        </div>

        {isItaly ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-region`}>Regione</Label>
              <Select
                id={`${idPrefix}-region`}
                value={value.region}
                onChange={(event) => handleRegionChange(event.target.value)}
                placeholderLabel="Seleziona regione"
              >
                {(italyData?.regions ?? []).map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-province`}>Provincia</Label>
              <Select
                id={`${idPrefix}-province`}
                value={value.province}
                onChange={(event) => handleProvinceChange(event.target.value)}
                placeholderLabel="Seleziona provincia"
                disabled={!italyData}
              >
                {provinceOptions.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name} ({province.code})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-municipality`}>Comune</Label>
              <Select
                id={`${idPrefix}-municipality`}
                value={value.municipalityCode}
                onChange={(event) => handleMunicipalityChange(event.target.value)}
                placeholderLabel="Seleziona comune"
                disabled={!value.province || !italyData}
              >
                {municipalityOptions.map((municipality: ItalianMunicipality) => (
                  <option key={municipality.code} value={municipality.code}>
                    {municipality.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-postal-code`}>CAP</Label>
              {postalCodes.length > 1 ? (
                <Select
                  id={`${idPrefix}-postal-code`}
                  value={value.postalCode}
                  onChange={(event) => update({ postalCode: event.target.value })}
                  placeholderLabel="Seleziona CAP"
                >
                  {postalCodes.map((postalCode) => (
                    <option key={postalCode} value={postalCode}>
                      {postalCode}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={`${idPrefix}-postal-code`}
                  value={value.postalCode}
                  onChange={(event) => update({ postalCode: event.target.value })}
                  placeholder="CAP"
                />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-city`}>Città</Label>
              <Input id={`${idPrefix}-city`} value={value.city} onChange={(event) => update({ city: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-province`}>Provincia / Stato</Label>
              <Input
                id={`${idPrefix}-province`}
                value={value.province}
                onChange={(event) => update({ province: event.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-postal-code`}>CAP / ZIP</Label>
              <Input id={`${idPrefix}-postal-code`} value={value.postalCode} onChange={(event) => update({ postalCode: event.target.value })} />
            </div>
          </>
        )}
      </div>

      {italyDataError ? <p className="mt-2 text-xs text-destructive">{italyDataError}</p> : null}
    </div>
  );
};
