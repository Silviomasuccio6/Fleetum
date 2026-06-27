import assert from "node:assert/strict";
import test from "node:test";
import { getBillingStatusNotice } from "../src/presentation/pages/profile/billing-status-copy";

test("billing status copy guides past due users to update payment without promising access", () => {
  const notice = getBillingStatusNotice("PAST_DUE");

  assert.equal(notice?.tone, "warning");
  assert.match(notice?.title ?? "", /Pagamento non riuscito/i);
  assert.match(notice?.body ?? "", /resta bloccato/i);
  assert.equal(notice?.actionLabel, "Sostituisci carta");
});

test("billing status copy covers suspended and canceled accounts", () => {
  const suspended = getBillingStatusNotice("SUSPENDED");
  const canceled = getBillingStatusNotice("CANCELED");

  assert.equal(suspended?.tone, "danger");
  assert.match(suspended?.body ?? "", /finestra prevista/i);
  assert.equal(canceled?.tone, "danger");
  assert.match(canceled?.body ?? "", /riattivare un piano/i);
});

test("active and trial statuses do not show billing warning banners", () => {
  assert.equal(getBillingStatusNotice("ACTIVE"), null);
  assert.equal(getBillingStatusNotice("TRIAL"), null);
});
