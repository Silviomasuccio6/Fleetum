# Fleetum Pull Request

## Summary

Describe what this PR changes and why.

- 

## Change Type

- [ ] Feature
- [ ] Bug fix
- [ ] UI/UX
- [ ] Refactor
- [ ] Documentation
- [ ] Security hardening
- [ ] DevOps/CI/CD
- [ ] Database migration
- [ ] Billing/Stripe
- [ ] Other: 

## Impacted Areas

- [ ] Backend API
- [ ] Frontend app
- [ ] Platform Console
- [ ] Landing/public site
- [ ] Prisma schema/migrations
- [ ] Auth/session/CSRF
- [ ] Multi-tenant data access
- [ ] Billing/Stripe/license policy
- [ ] Email/Resend/SMTP
- [ ] PDF/contracts/documents
- [ ] Upload/storage
- [ ] Docker/deploy/Caddy
- [ ] GitHub Actions
- [ ] Documentation only

## Files / Modules Touched

List the main paths and why they changed.

- `path/to/file`: reason

## Tests Executed

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test -w backend`
- [ ] Frontend smoke test
- [ ] Backend/API smoke test
- [ ] Not executed, reason: 

## Security Review

- [ ] No secrets added
- [ ] No sensitive data in logs
- [ ] Auth/authorization checked
- [ ] CSRF behavior checked where relevant
- [ ] Rate limits/public endpoints reviewed
- [ ] File upload/download safety reviewed where relevant
- [ ] Error messages do not leak sensitive data
- [ ] Not applicable, reason: 

## Multi-Tenant Review

- [ ] Tenant isolation checked
- [ ] Queries filter by `tenantId` where required
- [ ] Tenant A cannot read/write Tenant B resources
- [ ] Platform-only endpoints remain founder/admin-only
- [ ] Public routes do not expose tenant data
- [ ] Not applicable, reason: 

## Database Review

- [ ] No DB changes
- [ ] Prisma migration included
- [ ] Migration tested locally/staging
- [ ] Backfill/compatibility considered
- [ ] Rollback considered
- [ ] Data retention/privacy impact reviewed

## Billing / Stripe Review

- [ ] No billing impact
- [ ] Webhook signature verification preserved
- [ ] Idempotency considered
- [ ] Subscription/license state persistence considered
- [ ] Stripe test mode validated where relevant
- [ ] Audit log written for billing actions where relevant

## Deployment / Env Review

- [ ] No deploy impact
- [ ] Safe for staging
- [ ] Safe for production
- [ ] Requires new env variables
- [ ] Requires manual server action
- [ ] Requires DNS/Caddy change
- [ ] Requires background job/cron change

If env/manual action is required, document it here:

```txt
ENV_OR_ACTION_NAME=placeholder-only
```

## Rollback Plan

Describe exactly how to rollback if something goes wrong.

- Code rollback:
- Database rollback:
- Config/env rollback:
- Verification after rollback:

## Screenshots / Evidence

Attach screenshots, logs, or links to test evidence when useful.

## Production Checklist

- [ ] CI green
- [ ] Health checks considered
- [ ] Monitoring/logs considered
- [ ] Backup needed before deploy
- [ ] Customer-facing impact understood
- [ ] Documentation updated
