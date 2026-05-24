export type CompanyBranding = {
  tenantId: string;
  companyLogo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  legalName: string;
  vatNumber?: string;
  taxCode?: string;
  address?: string;
  pec?: string;
  email?: string;
  phone?: string;
  website?: string;
  footerText?: string;
  legalRepresentative?: string;
  privacyContact?: string;
  dpoContact?: string;
  termsUrl?: string;
  privacyUrl?: string;
};

export const defaultFleetumFooter = 'Powered by Fleetum';
