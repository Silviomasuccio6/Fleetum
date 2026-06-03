# Fleetum Storage Migration Strategy

Fleetum keeps uploaded documents private by default. The app supports `STORAGE_PROVIDER=local` and `STORAGE_PROVIDER=s3` for AWS S3, Cloudflare R2, Backblaze B2 or another S3-compatible provider.

## Safety rules

- Do not make buckets public.
- Do not expose document URLs directly to tenants.
- Downloads must pass through authenticated Fleetum routes or short-lived signed URLs.
- Keep `/opt/fleetum/uploads` backed up until a restore drill has passed after migration.
- Run the migration first in staging.

## Environment

```txt
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<provider-endpoint>
S3_BUCKET=fleetum-private-documents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
S3_SIGNED_URL_EXPIRES_SECONDS=300
```

Provider examples:

- AWS S3: `S3_ENDPOINT=https://s3.eu-south-1.amazonaws.com`, `S3_REGION=eu-south-1`.
- Cloudflare R2: `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
- Backblaze B2: `S3_ENDPOINT=https://s3.<region>.backblazeb2.com`, `S3_REGION=<region>`.

## Controlled migration

1. Keep production on `STORAGE_PROVIDER=local`.
2. Run `npm run storage:migration-plan -w backend -- --json` and archive the output.
3. Backup PostgreSQL and `/opt/fleetum/uploads`.
4. Create a private bucket with versioning if the provider supports it.
5. Copy local files preserving their `storageKey` path.
6. Configure staging with `STORAGE_PROVIDER=s3` and run upload/download/delete smoke tests.
7. Switch production env to `STORAGE_PROVIDER=s3` only after staging succeeds.
8. Keep local uploads read-only as rollback backup until the monthly restore test passes.

## Rollback

- Set `STORAGE_PROVIDER=local` again.
- Restart backend.
- Verify `/api/ready` and authenticated document downloads.
- Do not delete S3 objects during rollback.

## Privacy notes

Stored files include contracts, IDs, driving licenses, damage photos, invoices and customer documents. Treat object keys, file names and metadata as personal data.
