import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

export const notificationsUseCases = {
  inbox: async () => {
    const base = getApiBaseUrl();
    const response = await fetch(`${base}/notifications/inbox`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error("Impossibile caricare notifiche");
    return response.json() as Promise<{ data: any[] }>;
  }
};
