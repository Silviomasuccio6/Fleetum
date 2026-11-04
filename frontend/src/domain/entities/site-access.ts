export type SiteOption = { id: string; name: string };
export type SiteAccessSnapshot = {
  tenantId: string; userId: string; revision: string;
  enforced: boolean; canViewAllSites: boolean; canAssignSites: boolean;
  assignedSite: (SiteOption & {isActive: boolean}) | null;
  sites: SiteOption[];
};
