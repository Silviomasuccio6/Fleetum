export type SignupInput = {
  tenantName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adminRole?: string;
  privacyAccepted?: boolean;
  company?: {
    legalName: string;
    tradeName?: string;
    legalForm?: string;
    vatNumber?: string;
    taxCode?: string;
    pec?: string;
    sdiCode?: string;
    rea?: string;
    legalAddress?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
    email?: string;
    website?: string;
    adminFirstName?: string;
    adminLastName?: string;
    adminEmail?: string;
    adminPhone?: string;
    adminRole?: string;
    primaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    contractFooterText?: string;
    defaultContractTerms?: string;
    termsVersion?: string;
    dpaVersion?: string;
  };
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};
