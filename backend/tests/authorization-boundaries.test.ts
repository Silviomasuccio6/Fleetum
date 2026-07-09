import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express, { Express, NextFunction, Request, Response } from "express";
import { billingRoutes } from "../src/interfaces/http/routes/billing-routes.js";
import { gdprRoutes } from "../src/interfaces/http/routes/gdpr-routes.js";
import { privacyComplianceRoutes } from "../src/interfaces/http/routes/privacy-compliance-routes.js";
import { statsRoutes } from "../src/interfaces/http/routes/stats-routes.js";

const controller = {
  createCheckoutSession: async (_req: Request, res: Response) => res.status(201).json({ action: "checkout" }),
  createPaymentMethodSession: async (_req: Request, res: Response) => res.status(201).json({ action: "payment-method" }),
  createCustomerPortalSession: async (_req: Request, res: Response) => res.status(201).json({ action: "customer-portal" }),
  localComplete: async (_req: Request, res: Response) => res.json({ action: "local-complete" }),
  invoices: async (_req: Request, res: Response) => res.json({ action: "invoices" }),
  invoice: async (_req: Request, res: Response) => res.json({ action: "invoice" }),
  invoicePdf: async (_req: Request, res: Response) => res.status(200).send("pdf"),
  createErasureRequest: async (_req: Request, res: Response) => res.status(202).json({ action: "erasure" }),
  exportCustomerData: async (_req: Request, res: Response) => res.json({ action: "customer-export" }),
  anonymizeCustomer: async (_req: Request, res: Response) => res.json({ action: "anonymize" }),
  previewRetention: async (_req: Request, res: Response) => res.json({ action: "retention-preview" }),
  runRetention: async (_req: Request, res: Response) => res.json({ action: "retention-run" }),
  vehicleProfitability: async (_req: Request, res: Response) => res.json({ action: "profitability" }),
  vehicleProfitabilityExport: async (_req: Request, res: Response) => res.send("report"),
  vehicleProfitabilityById: async (_req: Request, res: Response) => res.json({ action: "profitability" }),
  analyticsCsv: async (_req: Request, res: Response) => res.send("csv"),
  analyticsXlsx: async (_req: Request, res: Response) => res.send("xlsx"),
  dashboard: async (_req: Request, res: Response) => res.json({}),
  analytics: async (_req: Request, res: Response) => res.json({}),
  workshopsHealth: async (_req: Request, res: Response) => res.json({}),
  workshopsCapacity: async (_req: Request, res: Response) => res.json({}),
  teamPerformance: async (_req: Request, res: Response) => res.json({}),
  aiSuggestions: async (_req: Request, res: Response) => res.json({})
};

const createApp = () => {
  const app = express();
  app.use((req, _res, next) => {
    const permissions = String(req.header("x-permissions") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const roles = String(req.header("x-roles") ?? "TEST")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    req.auth = { userId: "user-1", tenantId: "tenant-1", roles, permissions, tokenType: "access" };
    next();
  });

  app.use("/billing", billingRoutes(controller as never));
  app.use("/gdpr", gdprRoutes(controller as never));
  app.use("/privacy", privacyComplianceRoutes(controller as never));
  app.use("/stats", statsRoutes(controller as never, () => (_req, _res, next) => next()));
  app.use((error: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR" });
  });
  return app;
};

const request = async (
  app: Express,
  method: string,
  path: string,
  permissions: string[],
  roles: string[] = ["TEST"]
) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { "x-permissions": permissions.join(","), "x-roles": roles.join(",") }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

test("billing management requires billing:manage and invoices require billing:read", async () => {
  const app = createApp();

  assert.equal((await request(app, "POST", "/billing/checkout-session", ["vehicles:read"])).status, 403);
  assert.equal((await request(app, "GET", "/billing/invoices", ["vehicles:read"])).status, 403);
  assert.equal((await request(app, "POST", "/billing/checkout-session", ["billing:manage"])).status, 201);
  assert.equal((await request(app, "GET", "/billing/invoices", ["billing:read"])).status, 200);
});

test("tenant ADMIN keeps billing self-service access when an older session lacks a newly granted permission", async () => {
  const app = createApp();

  assert.equal((await request(app, "POST", "/billing/payment-method-session", [], ["ADMIN"])).status, 201);
  assert.equal((await request(app, "POST", "/billing/customer-portal-session", [], ["ADMIN"])).status, 201);
  assert.equal((await request(app, "POST", "/billing/payment-method-session", [], ["MANAGER"])).status, 403);
});

test("privacy exports and destructive privacy actions require dedicated permissions", async () => {
  const app = createApp();

  assert.equal((await request(app, "GET", "/gdpr/data-export/customer-1", ["vehicles:read"])).status, 403);
  assert.equal((await request(app, "GET", "/privacy/data-subjects/customers/customer-1/export", ["vehicles:read"])).status, 403);
  assert.equal((await request(app, "GET", "/gdpr/data-export/customer-1", ["privacy:export"])).status, 200);
  assert.equal((await request(app, "POST", "/gdpr/erasure-request", ["privacy:export"])).status, 403);
  assert.equal((await request(app, "POST", "/gdpr/erasure-request", ["privacy:manage"])).status, 202);
});

test("vehicle economics and report exports require finance-specific permissions", async () => {
  const app = createApp();
  const operationalRead = ["stats:read", "vehicles:read"];
  const economicsRead = [...operationalRead, "vehicle:economics:read"];

  assert.equal((await request(app, "GET", "/stats/vehicles/profitability", operationalRead)).status, 403);
  assert.equal((await request(app, "GET", "/stats/vehicles/profitability", economicsRead)).status, 200);
  assert.equal((await request(app, "GET", "/stats/vehicles/profitability/export.csv", economicsRead)).status, 403);
  assert.equal((await request(app, "GET", "/stats/vehicles/profitability/export.csv", [...economicsRead, "reports:export"])).status, 200);
});
