import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

export type StorageProviderName = "local" | "s3";

export interface StorageProvider {
  readonly name: StorageProviderName;
  buildKey(...segments: string[]): string;
  resolveLocalPath(key: string): string;
  exists(key: string): Promise<boolean>;
  write(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}

const normalizeSegment = (segment: string) => segment.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly rootDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

  buildKey(...segments: string[]) {
    return path.posix.join(env.UPLOAD_DIR, ...segments.map(normalizeSegment).filter(Boolean));
  }

  resolveLocalPath(key: string) {
    const fullPath = path.resolve(process.cwd(), key);
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

  async write(key: string, data: Buffer) {
    const fullPath = this.resolveLocalPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  async delete(key: string) {
    await fs.unlink(this.resolveLocalPath(key)).catch(() => undefined);
  }

  getRootDir() {
    return this.rootDir;
  }
}

class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;

  private notEnabled(): never {
    throw new AppError(
      "Storage S3/R2 predisposto ma non ancora abilitato in questo runtime.",
      503,
      "STORAGE_PROVIDER_NOT_ENABLED"
    );
  }

  buildKey(...segments: string[]) {
    return path.posix.join(...segments.map(normalizeSegment).filter(Boolean));
  }

  resolveLocalPath(): string {
    return this.notEnabled();
  }

  async exists(): Promise<boolean> {
    return this.notEnabled();
  }

  async write(): Promise<void> {
    return this.notEnabled();
  }

  async delete(): Promise<void> {
    return this.notEnabled();
  }
}

export const localStorageProvider = new LocalStorageProvider();

export const storageProvider: StorageProvider =
  env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : localStorageProvider;

