/**
 * Single source of truth for RentalCustomer fields that must be removed or
 * replaced when a data-subject erasure request is completed.
 */
export const RENTAL_CUSTOMER_PII_FIELDS = [
  "firstName",
  "lastName",
  "drivingLicenseNumber",
  "drivingLicenseIssuedAt",
  "drivingLicenseExpiresAt",
  "drivingLicenseAuthority",
  "drivingLicenseCategory",
  "email",
  "phone",
  "dateOfBirth",
  "placeOfBirth",
  "birthCountry",
  "birthProvince",
  "birthMunicipalityCode",
  "birthCity",
  "nationality",
  "nationalityCountry",
  "residenceAddress",
  "residenceCountry",
  "residenceRegion",
  "residenceProvince",
  "residenceMunicipalityCode",
  "residenceCity",
  "residencePostalCode",
  "residenceStreetAddress",
  "taxCode",
  "documentType",
  "documentNumber",
  "documentIssuedAt",
  "documentExpiresAt",
  "documentAuthority",
  "companyName",
  "companyLegalForm",
  "companyVatNumber",
  "companyTaxCode",
  "companyLegalAddress",
  "companyCountry",
  "companyRegion",
  "companyProvince",
  "companyMunicipalityCode",
  "companyCity",
  "companyPostalCode",
  "companyStreetAddress",
  "companyPec",
  "companySdi",
  "companyRea",
  "legalRepFirstName",
  "legalRepLastName",
  "legalRepTaxCode",
  "legalRepRole",
  "legalRepEmail",
  "legalRepPhone",
  "notes"
] as const;

type RentalCustomerPiiField = (typeof RENTAL_CUSTOMER_PII_FIELDS)[number];
type RequiredRentalCustomerPiiField = "firstName" | "lastName" | "drivingLicenseNumber";
type NullableRentalCustomerPiiField = Exclude<RentalCustomerPiiField, RequiredRentalCustomerPiiField>;
type RentalCustomerAnonymizationData =
  & Record<NullableRentalCustomerPiiField, null>
  & Record<RequiredRentalCustomerPiiField, string>
  & { deletedAt: Date };

export const buildRentalCustomerAnonymizationData = (input: {
  label: string;
  deletedAt: Date;
}): RentalCustomerAnonymizationData => {
  const clearedPii = Object.fromEntries(
    RENTAL_CUSTOMER_PII_FIELDS.map((field) => [field, null])
  ) as Record<RentalCustomerPiiField, null>;

  return {
    ...clearedPii,
    // Required columns receive irreversible, non-identifying replacements.
    firstName: "Cliente",
    lastName: input.label.replace("Cliente ", ""),
    drivingLicenseNumber: "",
    deletedAt: input.deletedAt
  } as RentalCustomerAnonymizationData;
};
