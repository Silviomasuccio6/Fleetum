import { httpClient } from "../../infrastructure/api/http-client";

export type TenantCompanyProfilePayload = {
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

export type TenantCompanyProfileResponse = {
  profile: Record<string, any> | null;
  branding: Record<string, any> | null;
  legalSettings: Record<string, any> | null;
  completeness: {
    percentage: number;
    completed: boolean;
    missing: string[];
  };
};

export const tenantProfileUseCases = {
  getProfile: () => httpClient.get<TenantCompanyProfileResponse>("/tenant/profile"),
  completeness: () => httpClient.get<TenantCompanyProfileResponse["completeness"]>("/tenant/profile/completeness"),
  updateProfile: (input: TenantCompanyProfilePayload) =>
    httpClient.patch<TenantCompanyProfileResponse>("/tenant/profile", input),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return httpClient.post<TenantCompanyProfileResponse>("/tenant/branding/logo", formData, {
      suppressSuccessToast: true
    });
  },
  removeLogo: () => httpClient.delete("/tenant/branding/logo")
};
