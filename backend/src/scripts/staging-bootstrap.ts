import {
  assertStagingBootstrapEnvironment, parseStagingBootstrapCredentials, runStagingBootstrap,
  StagingBootstrapError, STAGING_BOOTSTRAP_INPUT_MAX_BYTES
} from "./staging-bootstrap-policy.js";

const main = async () => {
  if (process.argv.length !== 2 || process.stdin.isTTY) throw new StagingBootstrapError("STAGING_BOOTSTRAP_INPUT_REFUSED");
  assertStagingBootstrapEnvironment(process.env);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > STAGING_BOOTSTRAP_INPUT_MAX_BYTES) throw new StagingBootstrapError("STAGING_BOOTSTRAP_INPUT_REFUSED");
    chunks.push(bytes);
  }
  const credentials = parseStagingBootstrapCredentials(Buffer.concat(chunks).toString("utf8"));
  const result = await runStagingBootstrap(process.env, credentials);
  process.stdout.write(`${result}\n`);
};

main().catch((error: unknown) => {
  const code = error instanceof StagingBootstrapError ? error.code : "STAGING_BOOTSTRAP_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
