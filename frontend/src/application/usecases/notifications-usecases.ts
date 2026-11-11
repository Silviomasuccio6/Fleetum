import { scopedFetch } from "../../infrastructure/api/scoped-fetch";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

export const notificationsUseCases = {
  inbox: async () => {
    const base = getApiBaseUrl();
    const response = await scopedFetch(`${base}/notifications/inbox`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error("Impossibile caricare notifiche");
    return response.json() as Promise<{ data: any[] }>;
  }
};
