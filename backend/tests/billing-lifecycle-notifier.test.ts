import assert from "node:assert/strict";
import test from "node:test";
import { BillingLifecycleNotifier } from "../src/application/services/billing-lifecycle-notifier.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { EmailQueueService, type QueueEmailInput } from "../src/infrastructure/email/email-queue-service.js";
import { env } from "../src/shared/config/env.js";

test("billing reminder keeps the company name readable in HTML and plain text", async (t) => {
  const companyName = "Città & Figli <Roma> \"Centro\" d'Oro";
  const tenant = prisma.tenant as unknown as { findUnique: (input: unknown) => Promise<unknown> };
  const originalFindUnique = tenant.findUnique;
  t.after(() => { tenant.findUnique = originalFindUnique; });
  tenant.findUnique = async () => ({
    name: "Autonoleggio",
    tenantProfile: { tradeName: companyName, adminEmail: "billing@example.test" },
    users: []
  });
  const emailQueue = new EmailQueueService();
  const enqueue = t.mock.method(emailQueue, "enqueue", async (_input: QueueEmailInput) => ({ id: "synthetic-email" }));

  await new BillingLifecycleNotifier(emailQueue).notifyCardExpiring({ tenantId: "synthetic-tenant", expMonth: 7, expYear: 2030 });

  assert.equal(enqueue.mock.callCount(), 1);
  const email = enqueue.mock.calls[0].arguments[0];
  assert.ok(email.body.includes(companyName));
  assert.equal(typeof email.meta?.html, "string");
  const html = email.meta.html as string;
  assert.ok(html.includes("Città &amp; Figli &lt;Roma&gt; &quot;Centro&quot; d&#39;Oro"));
  assert.ok(html.includes(`href="${env.APP_URL}/upgrade?billing=card_expiring"`));
});
