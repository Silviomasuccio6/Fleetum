# Minimal security alignment for main

The runner correction exposed an existing production-dependency audit failure on
main. The installed staging candidate 195742b already uses the corrected versions.
This alignment backports only body-parser 1.20.9, follow-redirects 1.16.2,
qs 6.16.1 and Zod 4.6.7; the lockfile change is limited to those four package
records and the two workspace dependency declarations.

Zod's existing payment-mandate validator now uses the supported error option.
The consent requirement, Italian validation message, normalized terms and
validation-error shape are preserved. Regression tests cover accepted, missing,
declined, non-boolean consent and missing terms. No new payment flow is added.

The public analytics record supplies an explicit string-key schema for Zod 4
and checks the existing twenty-field bound before visiting record values.
Its existing size/field restrictions remain in place. Company-profile
refinement uses a typed string-field output constraint instead of an
unconstrained generic; fiscal validation logic is unchanged.

The high-severity advisories are GHSA-27r3-jxmh-p828,
GHSA-mrwp-f3q8-3g9p and GHSA-mrhx-c7xc-m3w5. Qs also resolves
GHSA-6pq8-jhm2-2vcw and its Express dependency-chain entry. Keep the existing
zero-high/critical audit gate; do not suppress package findings.

This change does not integrate #156, alter the application candidate selected
for staging, or deploy production. Validate backend/frontend compilation and
tests, production audit and tenant/database checks before merge.

Zod 4 evaluates nested defaults in optional object properties. Partial rental
booking, customer and pricing updates use the existing staging adapter to
preserve missing fields and explicit undefined values. Creation defaults and
explicit false values are retained. The existing customer-lock regression
continues to reject an invalid company update after the fresh locked read.
Missing settings flags explicitly retain the prior false result of coercion.
No customer, price, booking or notification rule is added.
