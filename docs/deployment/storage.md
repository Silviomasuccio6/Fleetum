# Fleetum Storage

Fleetum stores private operational documents such as vehicle photos, maintenance attachments, customer documents, company logos and contract signatures.

## Current production mode

Production currently uses local private storage:

```txt
STORAGE_PROVIDER=local
UPLOAD_DIR=uploads
```

Files are stored in the backend container volume mounted by Docker Compose. Access to files must keep going through authenticated API routes; uploaded files are not intended to be served as public static assets.

## Upload optimization

Fleetum validates every uploaded file before it is persisted:

- checks MIME allowlists at upload time;
- checks file magic bytes after upload;
- blocks the EICAR test signature;
- strips image EXIF metadata;
- resizes oversized operational images;
- recompresses JPEG, WebP and PNG images with configurable quality;
- stores checksum and private metadata in `StoredFileObject` where supported.

Runtime knobs:

```txt
FILE_MAX_IMAGE_MB=5
FILE_MAX_DOCUMENT_MB=12
FILE_MAX_LOGO_MB=4
IMAGE_MAX_WIDTH_PX=1920
IMAGE_COMPRESSION_QUALITY=82
IMAGE_PNG_COMPRESSION_LEVEL=9
```

PDFs, contracts and company documents are not recompressed automatically because altering document bytes can affect auditability and legal review. They are still validated and stored privately.

## Storage abstraction

The backend exposes a small storage provider layer in:

```txt
backend/src/infrastructure/storage/storage-provider.ts
```

The local provider centralizes:

- safe key generation under `UPLOAD_DIR`;
- path traversal protection;
- file existence checks;
- file writes;
- file deletion.

This keeps existing local storage behavior stable while preparing a future S3-compatible backend.

## S3 / R2 preparation

The env example includes S3-compatible placeholders:

```txt
STORAGE_PROVIDER=local
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=
S3_PUBLIC_BASE_URL=
S3_SIGNED_URL_EXPIRES_SECONDS=300
```

Do not set `STORAGE_PROVIDER=s3` in production until S3/R2 upload, download, delete and restore tests pass in staging. Secrets must stay in GitHub Secrets or VPS env files, never in the repository.

## Production rules

- Keep private documents behind authenticated API routes.
- Do not expose `/uploads` directly via Caddy.
- Keep backups enabled for local uploads while `STORAGE_PROVIDER=local`.
- Run restore tests for both database and uploaded documents before considering storage production-ready.
- When migrating to S3/R2, test upload, download, delete, backup/export and tenant isolation in staging first.
