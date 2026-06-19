# Privacy Publication Gate

**Status:** blocked pending legal/privacy review and remaining operational facts.
**Last reviewed:** 2026-06-19.
**Scope:** Fleetum public website, SaaS account data and processing performed for rental-company tenants.

> This is an internal operational record, not a public privacy notice and not legal advice. Do not mark the public Privacy Policy, Cookie Policy or DPA as final until every required item below is confirmed by legal/privacy counsel.

## Verified operational facts

| Area | Current fact | Publication wording constraint |
|---|---|---|
| Google OAuth | Active for Fleetum login and signup. The authorization scope is `openid email profile`. | List Google OAuth as an active authentication provider. Do not combine it with Google Calendar unless Calendar is enabled. |
| Apple OAuth | Not offered in the current signup UI. | Do not list it as an active provider. |
| Website analytics | Fleetum internal page/event analytics run only after explicit analytics consent version `2026-06-19`. | State that consent is required and that analytics are disabled by default. |
| Marketing tags | No confirmed marketing tag is enabled. | Do not name a marketing provider until one is deployed and added to the banner/policy. |
| Application document storage | The deployment template remains `STORAGE_PROVIDER=local`. | Do not state that uploaded documents are already stored in AWS S3 or served by signed URLs unless production is switched and verified. |
| Offsite backups | AWS S3 bucket is used for Fleetum backups in `eu-north-1` (Stockholm). | Describe it as backup storage, not as live document storage. |
| Email | Resend sends transactional/operational email. | Verify the applicable DPA and transfer safeguards before final publication. |
| Billing | Stripe is used for subscriptions and payment events. Fleetum does not store full card details. | Describe the role by actual payment flow; legal review must confirm controller/processor wording. |
| Hosting | Fleetum runs on OVH infrastructure. | Confirm the exact datacenter/region and applicable OVH DPA before final publication. |

## Release blockers

- [ ] Insert Fleetum legal name, legal address, VAT/tax code, privacy email and PEC into the public notice.
- [ ] Decide and document whether a DPO is appointed.
- [ ] Complete and have counsel approve the Fleetum/customer DPA, including Art. 28 instructions, deletion/return, assistance, audit and subprocessor clauses.
- [ ] Publish a current subprocessor list and define a customer notification/objection process for material changes.
- [ ] Confirm retention periods for contracts, driving licences, identity documents, damage photos, email content, audit logs and backups.
- [ ] Approve the DSAR workflow: requester identity verification, tenant-controller instruction, legal-hold exceptions and response templates.
- [ ] Complete DPIA screening for the scale and risk of identity documents, driving licences, contracts and vehicle-damage evidence.
- [ ] Complete the data-breach procedure, contacts, escalation and evidence log.
- [ ] Perform a production cookie/tracker scan after every new analytics, advertising, OAuth or payment integration.
- [ ] Archive the applicable DPA/transfer documentation for OVH, AWS, Stripe, Resend and Google, where applicable.

## Required evidence before publication

1. Screenshot/export of the production cookie scan and the final cookie inventory.
2. Versioned public Privacy Policy and Cookie Policy with no unresolved placeholders.
3. DPA version, acceptance mechanism and accepted-version audit evidence for every tenant.
4. Supplier DPA/transfer evidence and current subprocessor list.
5. Retention configuration and a tested deletion/anonymization report.
6. Backup/restore drill record and security review sign-off.

## References to verify during counsel review

- GDPR: Arts. 13, 28, 30, 32, 33 and Chapter V.
- Garante Privacy cookie and tracking guidance.
- AWS GDPR DPA, Stripe DPA/Data Transfers Addendum, Resend DPA and the applicable OVH DPA.

TODO_LEGAL_REVIEW: approve roles, legal bases, retention periods, DPA and public wording.
TODO_PRIVACY_REVIEW: approve tracker classification, supplier transfers, DSAR and DPIA screening.
TODO_SECURITY_REVIEW: verify actual production storage, encryption, backup and access-control evidence.
