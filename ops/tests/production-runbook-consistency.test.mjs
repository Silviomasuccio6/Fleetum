import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const restore = await readFile(
  new URL("../../deploy/backup/restore-postgres.md", import.meta.url),
  "utf8",
);
const deploy = await readFile(
  new URL("../../docs/deployment/production-deploy.md", import.meta.url),
  "utf8",
);
const checklist = await readFile(
  new URL("../../docs/deployment/production-checklist.md", import.meta.url),
  "utf8",
);
const fallbackCompose = await readFile(
  new URL("../../docker-compose.prod.local-postgres.yml", import.meta.url),
  "utf8",
);

test("restore runbook matches the canonical managed PostgreSQL topology", () => {
  assert.match(restore, /managed PostgreSQL/i);
  assert.match(restore, /docker compose[\s\S]* stop backend/);
  assert.doesNotMatch(restore, /docker compose[^\n]* down backend/);
  assert.doesNotMatch(restore, /docker-compose\.prod\.yml exec -T postgres/);
  assert.match(restore, /provider-native/i);
});

test("production topology and checklist distinguish managed DB from local fallback", () => {
  assert.match(deploy, /PostgreSQL: managed/i);
  assert.doesNotMatch(deploy, /PostgreSQL volume: `\/opt\/fleetum\/postgres`/);
  assert.match(checklist, /Managed PostgreSQL/i);
  assert.doesNotMatch(checklist, /Container PostgreSQL healthy/);
});

test("the emergency local PostgreSQL compose also requires explicit release images", () => {
  assert.match(fallbackCompose, /FLEETUM_BACKEND_IMAGE:\?/);
  assert.match(fallbackCompose, /FLEETUM_FRONTEND_IMAGE:\?/);
  assert.doesNotMatch(fallbackCompose, /:latest/);
});
