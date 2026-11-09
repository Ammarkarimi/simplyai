/** Object storage: S3 compatible when S3_BUCKET is set, local disk otherwise. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface Storage {
  readonly driver: 's3' | 'local';
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
    });
  }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let storage: Storage | undefined;
export function getStorage(): Storage {
  if (!storage) {
    const bucket = process.env.S3_BUCKET;
    storage = bucket ? new S3Storage(bucket) : new LocalStorage(path.resolve(process.env.STORAGE_LOCAL_DIR || path.resolve(__dirname, '../../../storage')));
  }
  return storage;
}

export function newStorageKey(workspaceId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return `${workspaceId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safe}`;
}
