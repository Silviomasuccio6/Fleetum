import type { RentalCustomer, RentalCustomerType, RentalCustomerProfile } from "../../../application/usecases/rental-bookings-usecases";
import { countryNameFromCode, type StructuredAddressValue } from "./customer-geography-fields";

export type CustomerFormState = {
  customerType: RentalCustomerType;
  firstName: string;
  lastName: string;
  drivingLicenseNumber: string;
  drivingLicenseIssuedAt: string;
  drivingLicenseExpiresAt: string;
  drivingLicenseAuthority: string;
  drivingLicenseCategory: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  placeOfBirth: string;
  birthCountry: string;
  birthProvince: string;
  birthMunicipalityCode: string;
  birthCity: string;
  nationality: string;
  nationalityCountry: string;
  residenceAddress: string;
  residenceCountry: string;
  residenceRegion: string;
  residenceProvince: string;
  residenceMunicipalityCode: string;
  residenceCity: string;
  residencePostalCode: string;
  residenceStreetAddress: string;
  taxCode: string;
  documentType: string;
  documentNumber: string;
  documentIssuedAt: string;
  documentExpiresAt: string;
  documentAuthority: string;
  companyName: string;
  companyLegalForm: string;
  companyVatNumber: string;
  companyTaxCode: string;
  companyLegalAddress: string;
  companyCountry: string;
  companyRegion: string;
  companyProvince: string;
  companyMunicipalityCode: string;
  companyCity: string;
  companyPostalCode: string;
  companyStreetAddress: string;
  companyPec: string;
  companySdi: string;
  companyRea: string;
  legalRepFirstName: string;
  legalRepLastName: string;
  legalRepTaxCode: string;
  legalRepRole: string;
  legalRepEmail: string;
  legalRepPhone: string;
  notes: string;
};

export const toDateInput = (value?: string | Date | null) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad=(n:number)=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
};

export const defaultCustomerForm = (): CustomerFormState => ({
  customerType: "PERSONA_FISICA",
  firstName: "",
  lastName: "",
  drivingLicenseNumber: "",
  drivingLicenseIssuedAt: "",
  drivingLicenseExpiresAt: "",
  drivingLicenseAuthority: "",
  drivingLicenseCategory: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  placeOfBirth: "",
  birthCountry: "IT",
  birthProvince: "",
  birthMunicipalityCode: "",
  birthCity: "",
  nationality: countryNameFromCode("IT"),
  nationalityCountry: "IT",
  residenceAddress: "",
  residenceCountry: "IT",
  residenceRegion: "",
  residenceProvince: "",
  residenceMunicipalityCode: "",
  residenceCity: "",
  residencePostalCode: "",
  residenceStreetAddress: "",
  taxCode: "",
  documentType: "",
  documentNumber: "",
  documentIssuedAt: "",
  documentExpiresAt: "",
  documentAuthority: "",
  companyName: "",
  companyLegalForm: "",
  companyVatNumber: "",
  companyTaxCode: "",
  companyLegalAddress: "",
  companyCountry: "IT",
  companyRegion: "",
  companyProvince: "",
  companyMunicipalityCode: "",
  companyCity: "",
  companyPostalCode: "",
  companyStreetAddress: "",
  companyPec: "",
  companySdi: "",
  companyRea: "",
  legalRepFirstName: "",
  legalRepLastName: "",
  legalRepTaxCode: "",
  legalRepRole: "",
  legalRepEmail: "",
  legalRepPhone: "",
  notes: ""
});

export const toForm = (customer: RentalCustomerProfile): CustomerFormState => ({
  customerType: (customer.customerType as RentalCustomerType) || "PERSONA_FISICA",
  firstName: customer.firstName ?? "",
  lastName: customer.lastName ?? "",
  drivingLicenseNumber: customer.drivingLicenseNumber ?? "",
  drivingLicenseIssuedAt: toDateInput(customer.drivingLicenseIssuedAt),
  drivingLicenseExpiresAt: toDateInput(customer.drivingLicenseExpiresAt),
  drivingLicenseAuthority: customer.drivingLicenseAuthority ?? "",
  drivingLicenseCategory: customer.drivingLicenseCategory ?? "",
  email: customer.email ?? "",
  phone: customer.phone ?? "",
  dateOfBirth: toDateInput(customer.dateOfBirth),
  placeOfBirth: customer.placeOfBirth ?? "",
  birthCountry: customer.birthCountry ?? "IT",
  birthProvince: customer.birthProvince ?? "",
  birthMunicipalityCode: customer.birthMunicipalityCode ?? "",
  birthCity: customer.birthCity ?? "",
  nationality: customer.nationality ?? countryNameFromCode(customer.nationalityCountry),
  nationalityCountry: customer.nationalityCountry ?? "IT",
  residenceAddress: customer.residenceAddress ?? "",
  residenceCountry: customer.residenceCountry ?? "IT",
  residenceRegion: customer.residenceRegion ?? "",
  residenceProvince: customer.residenceProvince ?? "",
  residenceMunicipalityCode: customer.residenceMunicipalityCode ?? "",
  residenceCity: customer.residenceCity ?? "",
  residencePostalCode: customer.residencePostalCode ?? "",
  residenceStreetAddress: customer.residenceStreetAddress ?? customer.residenceAddress ?? "",
  taxCode: customer.taxCode ?? "",
  documentType: customer.documentType ?? "",
  documentNumber: customer.documentNumber ?? "",
  documentIssuedAt: toDateInput(customer.documentIssuedAt),
  documentExpiresAt: toDateInput(customer.documentExpiresAt),
  documentAuthority: customer.documentAuthority ?? "",
  companyName: customer.companyName ?? "",
  companyLegalForm: customer.companyLegalForm ?? "",
  companyVatNumber: customer.companyVatNumber ?? "",
  companyTaxCode: customer.companyTaxCode ?? "",
  companyLegalAddress: customer.companyLegalAddress ?? "",
  companyCountry: customer.companyCountry ?? "IT",
  companyRegion: customer.companyRegion ?? "",
  companyProvince: customer.companyProvince ?? "",
  companyMunicipalityCode: customer.companyMunicipalityCode ?? "",
  companyCity: customer.companyCity ?? "",
  companyPostalCode: customer.companyPostalCode ?? "",
  companyStreetAddress: customer.companyStreetAddress ?? customer.companyLegalAddress ?? "",
  companyPec: customer.companyPec ?? "",
  companySdi: customer.companySdi ?? "",
  companyRea: customer.companyRea ?? "",
  legalRepFirstName: customer.legalRepFirstName ?? "",
  legalRepLastName: customer.legalRepLastName ?? "",
  legalRepTaxCode: customer.legalRepTaxCode ?? "",
  legalRepRole: customer.legalRepRole ?? "",
  legalRepEmail: customer.legalRepEmail ?? "",
  legalRepPhone: customer.legalRepPhone ?? "",
  notes: customer.notes ?? ""
});

export const residenceAddressValueFromForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.residenceCountry,
  region: form.residenceRegion,
  province: form.residenceProvince,
  municipalityCode: form.residenceMunicipalityCode,
  city: form.residenceCity,
  postalCode: form.residencePostalCode,
  streetAddress: form.residenceStreetAddress
});

export const companyAddressValueFromForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.companyCountry,
  region: form.companyRegion,
  province: form.companyProvince,
  municipalityCode: form.companyMunicipalityCode,
  city: form.companyCity,
  postalCode: form.companyPostalCode,
  streetAddress: form.companyStreetAddress
});


export function customerPayload(form: CustomerFormState): Partial<RentalCustomer> {
return {
        customerType: form.customerType,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        drivingLicenseNumber: form.drivingLicenseNumber.trim().toUpperCase() || undefined,
        drivingLicenseIssuedAt: form.drivingLicenseIssuedAt ? new Date(`${form.drivingLicenseIssuedAt}T00:00:00`).toISOString() : undefined,
        drivingLicenseExpiresAt: form.drivingLicenseExpiresAt ? new Date(`${form.drivingLicenseExpiresAt}T00:00:00`).toISOString() : undefined,
        drivingLicenseAuthority: form.drivingLicenseAuthority.trim() || undefined,
        drivingLicenseCategory: form.drivingLicenseCategory.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth ? new Date(`${form.dateOfBirth}T00:00:00`).toISOString() : undefined,
        placeOfBirth: form.placeOfBirth.trim() || undefined,
        birthCountry: form.birthCountry || undefined,
        birthProvince: form.birthProvince.trim().toUpperCase() || undefined,
        birthMunicipalityCode: form.birthMunicipalityCode.trim() || undefined,
        birthCity: form.birthCity.trim() || undefined,
        nationality: form.nationality.trim() || undefined,
        nationalityCountry: form.nationalityCountry || undefined,
        residenceAddress: form.residenceAddress.trim() || undefined,
        residenceCountry: form.residenceCountry || undefined,
        residenceRegion: form.residenceRegion.trim() || undefined,
        residenceProvince: form.residenceProvince.trim().toUpperCase() || undefined,
        residenceMunicipalityCode: form.residenceMunicipalityCode.trim() || undefined,
        residenceCity: form.residenceCity.trim() || undefined,
        residencePostalCode: form.residencePostalCode.trim() || undefined,
        residenceStreetAddress: form.residenceStreetAddress.trim() || undefined,
        taxCode: form.taxCode.trim() || undefined,
        documentType: form.documentType.trim() || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        documentIssuedAt: form.documentIssuedAt ? new Date(`${form.documentIssuedAt}T00:00:00`).toISOString() : undefined,
        documentExpiresAt: form.documentExpiresAt ? new Date(`${form.documentExpiresAt}T00:00:00`).toISOString() : undefined,
        documentAuthority: form.documentAuthority.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        companyLegalForm: form.companyLegalForm.trim() || undefined,
        companyVatNumber: form.companyVatNumber.replace(/\s+/g, "") || undefined,
        companyTaxCode: form.companyTaxCode.trim() || undefined,
        companyLegalAddress: form.companyLegalAddress.trim() || undefined,
        companyCountry: form.companyCountry || undefined,
        companyRegion: form.companyRegion.trim() || undefined,
        companyProvince: form.companyProvince.trim().toUpperCase() || undefined,
        companyMunicipalityCode: form.companyMunicipalityCode.trim() || undefined,
        companyCity: form.companyCity.trim() || undefined,
        companyPostalCode: form.companyPostalCode.trim() || undefined,
        companyStreetAddress: form.companyStreetAddress.trim() || undefined,
        companyPec: form.companyPec.trim() || undefined,
        companySdi: form.companySdi.trim().toUpperCase() || undefined,
        companyRea: form.companyRea.trim() || undefined,
        legalRepFirstName: form.legalRepFirstName.trim() || undefined,
        legalRepLastName: form.legalRepLastName.trim() || undefined,
        legalRepTaxCode: form.legalRepTaxCode.trim() || undefined,
        legalRepRole: form.legalRepRole.trim() || undefined,
        legalRepEmail: form.legalRepEmail.trim() || undefined,
        legalRepPhone: form.legalRepPhone.trim() || undefined,
        notes: form.notes.trim() || undefined
      };
}

export function mergeCustomerScan(current: CustomerFormState, draft: Partial<RentalCustomer>): CustomerFormState {
return ({
      ...current,
      customerType: (draft.customerType as RentalCustomerType) ?? current.customerType,
      firstName: draft.firstName ?? current.firstName,
      lastName: draft.lastName ?? current.lastName,
      drivingLicenseNumber: draft.drivingLicenseNumber ?? current.drivingLicenseNumber,
      drivingLicenseIssuedAt: toDateInput(draft.drivingLicenseIssuedAt) || current.drivingLicenseIssuedAt,
      drivingLicenseExpiresAt: toDateInput(draft.drivingLicenseExpiresAt) || current.drivingLicenseExpiresAt,
      drivingLicenseAuthority: draft.drivingLicenseAuthority ?? current.drivingLicenseAuthority,
      drivingLicenseCategory: draft.drivingLicenseCategory ?? current.drivingLicenseCategory,
      email: draft.email ?? current.email,
      phone: draft.phone ?? current.phone,
      dateOfBirth: toDateInput(draft.dateOfBirth) || current.dateOfBirth,
      placeOfBirth: draft.placeOfBirth ?? current.placeOfBirth,
      nationality: draft.nationality ?? current.nationality,
      residenceAddress: draft.residenceAddress ?? current.residenceAddress,
      taxCode: draft.taxCode ?? current.taxCode,
      documentType: draft.documentType ?? current.documentType,
      documentNumber: draft.documentNumber ?? current.documentNumber,
      documentIssuedAt: toDateInput(draft.documentIssuedAt) || current.documentIssuedAt,
      documentExpiresAt: toDateInput(draft.documentExpiresAt) || current.documentExpiresAt,
      documentAuthority: draft.documentAuthority ?? current.documentAuthority,
      companyName: draft.companyName ?? current.companyName,
      companyLegalForm: draft.companyLegalForm ?? current.companyLegalForm,
      companyVatNumber: draft.companyVatNumber ?? current.companyVatNumber,
      companyTaxCode: draft.companyTaxCode ?? current.companyTaxCode,
      companyLegalAddress: draft.companyLegalAddress ?? current.companyLegalAddress,
      companyPec: draft.companyPec ?? current.companyPec,
      companySdi: draft.companySdi ?? current.companySdi,
      companyRea: draft.companyRea ?? current.companyRea,
      legalRepFirstName: draft.legalRepFirstName ?? current.legalRepFirstName,
      legalRepLastName: draft.legalRepLastName ?? current.legalRepLastName,
      legalRepTaxCode: draft.legalRepTaxCode ?? current.legalRepTaxCode,
      legalRepRole: draft.legalRepRole ?? current.legalRepRole,
      legalRepEmail: draft.legalRepEmail ?? current.legalRepEmail,
      legalRepPhone: draft.legalRepPhone ?? current.legalRepPhone
    });
}

export type CustomerErrors = Partial<Record<keyof CustomerFormState, string>>;
export type CustomerField = { name:keyof CustomerFormState; label:string; type?:'date'|'email'|'tel'|'country'; required?:boolean };
export const customerGroups: Array<{title:string; description:string; audience:'person'|'company'|'all'; fields:CustomerField[]}> = [
 {title:'Identità personale',description:'I dati dell’intestatario del noleggio.',audience:'person',fields:[{name:'firstName',label:'Nome',required:true},{name:'lastName',label:'Cognome',required:true},{name:'dateOfBirth',label:'Data nascita',type:'date'},{name:'placeOfBirth',label:'Luogo nascita'},{name:'nationalityCountry',label:'Nazionalità',type:'country'},{name:'taxCode',label:'Codice fiscale'}]},
 {title:'Dati della società',description:'Intestazione e identificativi fiscali della persona giuridica.',audience:'company',fields:[{name:'companyName',label:'Ragione sociale',required:true},{name:'companyLegalForm',label:'Forma giuridica'},{name:'companyVatNumber',label:'Partita IVA',required:true},{name:'companyTaxCode',label:'CF società'}]},
 {title:'Recapiti',description:'Per le società serve almeno un recapito fra email e telefono.',audience:'all',fields:[{name:'email',label:'Email',type:'email'},{name:'phone',label:'Telefono',type:'tel'}]},
 {title:'Patente',description:'Numero e dettagli della patente già utilizzati dal gestionale.',audience:'person',fields:[{name:'drivingLicenseNumber',label:'Numero patente',required:true},{name:'drivingLicenseCategory',label:'Categoria patente'},{name:'drivingLicenseIssuedAt',label:'Rilascio patente',type:'date'},{name:'drivingLicenseExpiresAt',label:'Scadenza patente',type:'date'},{name:'drivingLicenseAuthority',label:'Autorità patente'}]},
 {title:'Documento d’identità',description:'Dati del documento associato alla persona.',audience:'person',fields:[{name:'documentType',label:'Documento tipo'},{name:'documentNumber',label:'Documento numero'},{name:'documentIssuedAt',label:'Rilascio documento',type:'date'},{name:'documentExpiresAt',label:'Scadenza documento',type:'date'},{name:'documentAuthority',label:'Autorità documento'}]},
 {title:'Fatturazione elettronica',description:'Recapiti e codici già previsti per la società.',audience:'company',fields:[{name:'companyPec',label:'PEC',type:'email'},{name:'companySdi',label:'Codice SDI'},{name:'companyRea',label:'REA'}]},
 {title:'Legale rappresentante',description:'Dati e recapiti del rappresentante della società.',audience:'company',fields:[{name:'legalRepFirstName',label:'Nome legale rappr.'},{name:'legalRepLastName',label:'Cognome legale rappr.'},{name:'legalRepTaxCode',label:'CF legale rappr.'},{name:'legalRepRole',label:'Ruolo'},{name:'legalRepEmail',label:'Email legale rappr.',type:'email'},{name:'legalRepPhone',label:'Telefono legale rappr.',type:'tel'}]}
];
export function validateCustomerForm(form:CustomerFormState):CustomerErrors {
 const errors:CustomerErrors={};
 const company=form.customerType==='PERSONA_GIURIDICA';
 if(company){
  if(form.companyName.trim().length<2)errors.companyName='Inserisci almeno 2 caratteri.';
  if(!/^\d{11}$/.test(form.companyVatNumber.replace(/\s+/g,'')))errors.companyVatNumber='Partita IVA non valida (11 cifre).';
  if(!form.email.trim()&&!form.phone.trim())errors.email='Per società serve almeno un contatto (email o telefono).';
 }else{
  if(form.firstName.trim().length<2)errors.firstName='Inserisci almeno 2 caratteri.';
  if(form.lastName.trim().length<2)errors.lastName='Inserisci almeno 2 caratteri.';
  if(form.drivingLicenseNumber.trim().length<5)errors.drivingLicenseNumber='Inserisci almeno 5 caratteri per la patente.';
 }
 for(const name of ['email','companyPec','legalRepEmail'] as const)if(form[name].trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form[name].trim()))errors[name]='Inserisci un indirizzo email valido.';
 if(form.companySdi.trim()&&!/^[A-Za-z0-9]{7}$/.test(form.companySdi.trim()))errors.companySdi='Codice SDI non valido (7 caratteri alfanumerici).';
 for(const name of ['dateOfBirth','drivingLicenseIssuedAt','drivingLicenseExpiresAt','documentIssuedAt','documentExpiresAt'] as const){
  const v=form[name];if(!v)continue;const d=new Date(`${v}T00:00:00`);const day=Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||day!==v)errors[name]='Inserisci una data valida.';
 }
 return errors;
}
export const customerName=(customer?:Partial<RentalCustomer>|null)=>!customer?'—':customer.customerType==='PERSONA_GIURIDICA'?(customer.companyName?.trim()||[customer.firstName,customer.lastName].filter(Boolean).join(' ')||'Società'):([customer.firstName,customer.lastName].filter(Boolean).join(' ')||customer.companyName?.trim()||'Cliente');
export const customerDate=(value?:string|null)=>!value||Number.isNaN(new Date(value).getTime())?'—':new Date(value).toLocaleDateString('it-IT');
export const customerNumber=(value?:number|null)=>value==null||!Number.isFinite(value)?'—':new Intl.NumberFormat('it-IT').format(value);
