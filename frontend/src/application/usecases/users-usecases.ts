import { httpClient } from "../../infrastructure/api/http-client";

export const usersUseCases = {
  list: () => httpClient.get<{ data: any[] }>("/users"),
  listRoles: () => httpClient.get<{ data: Array<"ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"> }>("/users/roles"),
  invite: (input: { email: string; firstName: string; lastName: string; roleKey: string }) =>
    httpClient.post("/users/invite", input),
  create: (input: { email: string; firstName: string; lastName: string; password: string; roleKey: string }) =>
    httpClient.post("/users", input),
  update: (id: string, input: { firstName?: string; lastName?: string; status?: "ACTIVE" | "INVITED" | "SUSPENDED" }) =>
    httpClient.patch(`/users/${id}`, input),
  updateRole: (id: string, roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER") =>
    httpClient.patch(`/users/${id}/role`, { roleKey }),
  assignSite: (id: string, siteId: string | null) => httpClient.patch(`/users/${id}/site`, {siteId}),
  remove: (id: string) => httpClient.delete(`/users/${id}`)
};
