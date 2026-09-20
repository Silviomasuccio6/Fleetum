import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { metrics, normalizeMetricPath } from "../src/infrastructure/observability/metrics.js";

const contractToken = "ZXlKMFpXNWhiblJKWkNJNkltUmxiVzhpZlE.signature987654321ABCDEFGHIJ";
const contractTokenFragments = [
  contractToken,
  encodeURIComponent(contractToken),
  ...contractToken.split(".").flatMap((part) =>
    Array.from({ length: Math.max(1, part.length - 11) }, (_unused, index) => part.slice(index, index + 12))
  )
];

const assertContractTokenAbsent = (value: string) => {
  for (const fragment of new Set(contractTokenFragments)) {
    assert.equal(value.includes(fragment), false, `Sensitive contract token fragment leaked: ${fragment}`);
  }
};

describe("observability metrics", () => {
  it("normalizes metric paths to avoid leaking identifiers", () => {
    assert.equal(normalizeMetricPath("/api/rental-bookings/cmb12345678901234567890abcd?email=test@example.com"), "/api/rental-bookings/:id");
    assert.equal(normalizeMetricPath("/api/vehicles/123/photos"), "/api/vehicles/:id/photos");
    const normalizedContractPath = normalizeMetricPath(`/api/contracts/public/${contractToken}?source=whatsapp`);
    assert.equal(normalizedContractPath, "/api/contracts/public/:token");
    assertContractTokenAbsent(normalizedContractPath);
  });

  it("renders prometheus metrics without raw query strings", () => {
    metrics.observeHttpRequest({
      method: "GET",
      path: "/api/customers/cmb12345678901234567890abcd?email=test@example.com",
      statusCode: 200,
      durationMs: 123
    });
    metrics.observeHttpRequest({
      method: "GET",
      path: `/api/contracts/public/${contractToken}`,
      statusCode: 200,
      durationMs: 42
    });
    metrics.observePrismaOperation({ model: "RentalBooking", action: "findMany", durationMs: 620, slow: true });
    metrics.observeExactMoneyRead({
      model: "Invoice",
      mode: "compare",
      recordsChecked: 3,
      mismatchCount: 1,
      fallbackCount: 0
    });
    metrics.setDbAvailable(true);

    const rendered = metrics.renderPrometheus();
    assert.match(rendered, /fleetum_http_requests_total/);
    assert.match(rendered, /path="\/api\/customers\/:id"/);
    assert.match(rendered, /path="\/api\/contracts\/public\/:token"/);
    assert.match(rendered, /fleetum_prisma_slow_operations_total/);
    assert.match(rendered, /fleetum_exact_money_records_checked_total\{mode="compare",model="Invoice"\} 3/);
    assert.match(rendered, /fleetum_exact_money_mismatches_total\{mode="compare",model="Invoice"\} 1/);
    assert.match(rendered, /fleetum_db_available 1/);
    assert.doesNotMatch(rendered, /test@example\.com/);
    assertContractTokenAbsent(rendered);
  });
});
