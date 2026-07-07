import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { metrics } from "../observability/metrics.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

export type StorageProviderName = "local" | "s3";

export type StoredFileMetadata = {
  tenantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
};

export interface StorageProvider {
  readonly name: StorageProviderName;
  buildKey(...segments: string[]): string;
  resolveLocalPath(key: string): string;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<Buffer>;
  write(key: string, data: Buffer, metadata?: StoredFileMetadata): Promise<void>;
  writeFromFile(key: string, filePath: string, metadata?: StoredFileMetadata): Promise<void>;
  delete(key: string): Promise<void>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

const normalizeSegment = (segment: string) => segment.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const sha256Hex = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => crypto.createHmac("sha256", key).update(value).digest();
const hmacHex = (key: Buffer | string, value: string) => crypto.createHmac("sha256", key).update(value).digest("hex");
const encodeKeyPath = (key: string) => key.split("/").map(encodeURIComponent).join("/");

const assertSafeStorageKey = (key: string) => {
  const normalized = key.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || normalized.includes("//")) {
    throw new AppError("Chiave storage non valida", 400, "INVALID_STORAGE_KEY");
  }
  return normalized;
};

class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly rootDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

  buildKey(...segments: string[]) {
    return path.posix.join(env.UPLOAD_DIR, ...segments.map(normalizeSegment).filter(Boolean));
  }

  resolveLocalPath(key: string) {
    const fullPath = path.resolve(process.cwd(), assertSafeStorageKey(key));
    if (fullPath !== this.rootDir && !fullPath.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new AppError("Percorso file non valido", 400, "INVALID_FILE_PATH");
    }
    return fullPath;
  }

  async exists(key: string) {
    try {
      await fs.access(this.resolveLocalPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async read(key: string) {
    const payload = await fs.readFile(this.resolveLocalPath(key));
    metrics.observeStorageOperation({
      operation: "read",
      provider: this.name,
      bytes: payload.byteLength
    });
    return payload;
  }

  async write(key: string, data: Buffer) {
    const fullPath = this.resolveLocalPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    metrics.observeStorageOperation({
      operation: "write",
      provider: this.name,
      bytes: data.byteLength
    });
  }

  async writeFromFile(key: string, filePath: string, metadata?: StoredFileMetadata) {
    const fullPath = this.resolveLocalPath(key);
    const sourcePath = path.resolve(filePath);
    if (sourcePath === fullPath) {
      const stat = await fs.stat(fullPath);
      metrics.observeStorageOperation({
        operation: "write",
        provider: this.name,
        resourceType: metadata?.resourceType,
        bytes: stat.size
      });
      return;
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.copyFile(sourcePath, fullPath);
    const stat = await fs.stat(fullPath);
    metrics.observeStorageOperation({
      operation: "write",
      provider: this.name,
      resourceType: metadata?.resourceType,
      bytes: stat.size
    });
  }

  async delete(key: string) {
    await fs.unlink(this.resolveLocalPath(key)).catch(() => undefined);
    metrics.observeStorageOperation({
      operation: "delete",
      provider: this.name
    });
  }

  async getSignedReadUrl(key: string) {
    return `/${assertSafeStorageKey(key)}`;
  }

  getRootDir() {
    return this.rootDir;
  }
}

type FetchLike = typeof fetch;

type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  fetchImpl?: FetchLike;
};

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly publicBaseUrl?: string;
  private readonly fetchImpl: FetchLike;

  constructor(config?: Partial<S3Config>) {
    const endpoint = config?.endpoint ?? env.S3_ENDPOINT;
    const bucket = config?.bucket ?? env.S3_BUCKET;
    const region = config?.region ?? env.S3_REGION ?? "auto";
    const accessKeyId = config?.accessKeyId ?? env.S3_ACCESS_KEY_ID;
    const secretAccessKey = config?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new AppError("Configurazione storage S3/R2/B2 incompleta", 500, "STORAGE_PROVIDER_CONFIG_INVALID");
    }

    this.endpoint = new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
    this.bucket = bucket;
    this.region = region;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.publicBaseUrl = config?.publicBaseUrl ?? env.S3_PUBLIC_BASE_URL;
    this.fetchImpl = config?.fetchImpl ?? fetch;
  }

  buildKey(...segments: string[]) {
    return path.posix.join(...segments.map(normalizeSegment).filter(Boolean));
  }

  resolveLocalPath(): string {
    throw new AppError("Il provider S3 non espone percorsi locali", 400, "LOCAL_PATH_NOT_AVAILABLE");
  }

  private objectUrl(key: string) {
    const safeKey = assertSafeStorageKey(key);
    const url = new URL(`${encodeURIComponent(this.bucket)}/${encodeKeyPath(safeKey)}`, this.endpoint);
    return url;
  }

  private credentialScope(dateStamp: string) {
    return `${dateStamp}/${this.region}/s3/aws4_request`;
  }

  private signingKey(dateStamp: string) {
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  private authorization(input: { method: string; url: URL; payloadHash: string; amzDate: string; dateStamp: string; extraHeaders?: Record<string, string> }) {
    const host = input.url.host;
    const headers = {
      host,
      "x-amz-content-sha256": input.payloadHash,
      "x-amz-date": input.amzDate,
      ...(input.extraHeaders ?? {})
    };
    const sortedHeaderNames = Object.keys(headers).map((x) => x.toLowerCase()).sort();
    const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headers[name as keyof typeof headers]}\n`).join("");
    const signedHeaders = sortedHeaderNames.join(";");
    const canonicalQuery = Array.from(input.url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const canonicalRequest = [input.method, input.url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, this.credentialScope(input.dateStamp), sha256Hex(canonicalRequest)].join("\n");
    const signature = hmacHex(this.signingKey(input.dateStamp), stringToSign);
    return {
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${this.credentialScope(input.dateStamp)}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      headers
    };
  }

  private async request(method: string, key: string, body?: Buffer, metadata?: StoredFileMetadata) {
    const url = this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const extraHeaders: Record<string, string> = {};
    if (metadata?.mimeType) extraHeaders["content-type"] = metadata.mimeType;
    if (metadata?.tenantId) extraHeaders["x-amz-meta-tenant-id"] = metadata.tenantId;
    if (metadata?.resourceType) extraHeaders["x-amz-meta-resource-type"] = metadata.resourceType;
    if (metadata?.resourceId) extraHeaders["x-amz-meta-resource-id"] = metadata.resourceId;

    const signed = this.authorization({ method, url, payloadHash, amzDate, dateStamp, extraHeaders });
    const response = await this.fetchImpl(url, {
      method,
      body: body as unknown as BodyInit,
      headers: {
        ...signed.headers,
        ...extraHeaders,
        authorization: signed.authorization
      }
    });

    if (!response.ok && !(method === "HEAD" && response.status === 404) && !(method === "DELETE" && response.status === 404)) {
      throw new AppError(`Errore storage S3 (${response.status})`, 502, "S3_STORAGE_ERROR");
    }

    return response;
  }

  async exists(key: string) {
    const response = await this.request("HEAD", key);
    return response.ok;
  }

  async read(key: string) {
    const response = await this.request("GET", key);
    const payload = Buffer.from(await response.arrayBuffer());
    metrics.observeStorageOperation({
      operation: "read",
      provider: this.name,
      bytes: payload.byteLength
    });
    return payload;
  }

  async write(key: string, data: Buffer, metadata?: StoredFileMetadata) {
    await this.request("PUT", key, data, metadata);
    metrics.observeStorageOperation({
      operation: "write",
      provider: this.name,
      resourceType: metadata?.resourceType,
      bytes: data.byteLength
    });
  }

  async writeFromFile(key: string, filePath: string, metadata?: StoredFileMetadata) {
    const data = await fs.readFile(filePath);
    await this.write(key, data, metadata);
  }

  async delete(key: string) {
    await this.request("DELETE", key);
    metrics.observeStorageOperation({
      operation: "delete",
      provider: this.name
    });
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 300) {
    const url = this.publicBaseUrl
      ? new URL(`${encodeKeyPath(assertSafeStorageKey(key))}`, this.publicBaseUrl.endsWith("/") ? this.publicBaseUrl : `${this.publicBaseUrl}/`)
      : this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${this.accessKeyId}/${this.credentialScope(dateStamp)}`;
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", credential);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", "host");

    const canonicalQuery = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([queryKey, value]) => `${encodeURIComponent(queryKey)}=${encodeURIComponent(value)}`)
      .join("&");
    const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, this.credentialScope(dateStamp), sha256Hex(canonicalRequest)].join("\n");
    url.searchParams.set("X-Amz-Signature", hmacHex(this.signingKey(dateStamp), stringToSign));
    return url.toString();
  }
}

export const localStorageProvider = new LocalStorageProvider();

export const storageProvider: StorageProvider =
  env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : localStorageProvider;
