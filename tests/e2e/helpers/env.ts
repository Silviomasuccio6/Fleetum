export const e2eEnv = {
  baseUrl: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
  apiUrl: process.env.E2E_API_URL ?? "http://127.0.0.1:4000/api",
  email: process.env.E2E_TENANT_EMAIL ?? "",
  password: process.env.E2E_TENANT_PASSWORD ?? "",
  otherEmail: process.env.E2E_OTHER_TENANT_EMAIL ?? "",
  otherPassword: process.env.E2E_OTHER_TENANT_PASSWORD ?? ""
};

export const hasTenantCredentials = () => Boolean(e2eEnv.email && e2eEnv.password);
export const hasOtherTenantCredentials = () => Boolean(e2eEnv.otherEmail && e2eEnv.otherPassword);
