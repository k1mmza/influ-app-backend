import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Two buckets, created manually in the Supabase dashboard (see the migration plan).
// public-assets is world-readable (rendered on the unauthenticated share page +
// the unguarded GET /influencers); private-files is served only via short-lived
// signed URLs.
export const PUBLIC_BUCKET = 'public-assets';
export const PRIVATE_BUCKET = 'private-files';

/**
 * Single wrapper around Supabase Storage. Replaces the six duplicated
 * `process.env.UPLOAD_BASE_DIR || './uploads'` + diskStorage constants that used
 * to live in each upload controller.
 *
 * Public objects → the DB stores the absolute public URL (uploadPublic's return).
 * Private objects → the DB stores the bucket-relative path (uploadPrivate's
 * return); callers turn it into a signed URL at read time with signPrivate().
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use file storage',
      );
    }
    // Service-role key bypasses RLS; never expose it to the frontend.
    // supabase-js eagerly constructs a Realtime client, which needs a global
    // WebSocket — absent on Node < 22. We only use Storage, so hand it the `ws`
    // implementation as the transport to satisfy construction (never connects).
    this.client = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket as unknown as never },
    });
    return this.client;
  }

  /**
   * Cheap reachability probe for the readiness check (GET /health). Lists a
   * single object from the public bucket — the smallest authenticated round-trip
   * to Supabase Storage. Never throws: returns false on any error (missing env,
   * network, auth) so the health endpoint can report `storage: down` without
   * blowing up. This is a REPORT-only signal — it does not gate readiness.
   */
  async ping(): Promise<boolean> {
    try {
      const { error } = await this.getClient()
        .storage.from(PUBLIC_BUCKET)
        .list('', { limit: 1 });
      return !error;
    } catch {
      return false;
    }
  }

  /** Preserves the historical filename scheme: `<ts>-<rand><ext>`, original name discarded. */
  buildFilename(originalName: string): string {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    return `${unique}${extname(originalName)}`;
  }

  /** Upload to the public bucket; returns the absolute public URL to store in the DB. */
  async uploadPublic(
    objectPath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.getClient()
      .storage.from(PUBLIC_BUCKET)
      .upload(objectPath, buffer, { contentType, upsert: false });
    if (error) throw error;
    const { data } = this.getClient()
      .storage.from(PUBLIC_BUCKET)
      .getPublicUrl(objectPath);
    return data.publicUrl;
  }

  /** Upload to the private bucket; returns the bucket-relative path to store in the DB. */
  async uploadPrivate(
    objectPath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.getClient()
      .storage.from(PRIVATE_BUCKET)
      .upload(objectPath, buffer, { contentType, upsert: false });
    if (error) throw error;
    return objectPath;
  }

  /** Turn a stored private path into a short-lived signed URL. Null-safe. */
  async signPrivate(
    path: string | null | undefined,
    ttlSeconds = 3600,
  ): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.getClient()
      .storage.from(PRIVATE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error) {
      this.logger.warn(`Failed to sign ${path}: ${error.message}`);
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Best-effort delete of a public object given its stored absolute URL.
   * Never throws — an already-gone object must not fail the request.
   */
  async deletePublicByUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const marker = `/object/public/${PUBLIC_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return; // not one of ours (e.g. external/legacy URL)
    const objectPath = url.slice(idx + marker.length);
    await this.remove(PUBLIC_BUCKET, objectPath);
  }

  /** Best-effort delete of a private object given its stored path. Never throws. */
  async deletePrivate(path: string | null | undefined): Promise<void> {
    if (!path) return;
    await this.remove(PRIVATE_BUCKET, path);
  }

  /** Best-effort delete of a public object given its bucket-relative path. Never throws. */
  async deletePublicPath(objectPath: string): Promise<void> {
    await this.remove(PUBLIC_BUCKET, objectPath);
  }

  /** List objects under a public-bucket prefix (used by the orphan sweep). */
  async listPublic(
    prefix: string,
  ): Promise<{ path: string; createdAt: string | null }[]> {
    const { data, error } = await this.getClient()
      .storage.from(PUBLIC_BUCKET)
      .list(prefix, { limit: 1000 });
    if (error) throw error;
    return (data ?? [])
      .filter((o) => o.id) // folders have a null id; keep only real objects
      .map((o) => ({
        path: `${prefix}/${o.name}`,
        createdAt: o.created_at ?? null,
      }));
  }

  private async remove(bucket: string, objectPath: string): Promise<void> {
    try {
      const { error } = await this.getClient()
        .storage.from(bucket)
        .remove([objectPath]);
      if (error) {
        this.logger.warn(`Failed to delete ${bucket}/${objectPath}: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to delete ${bucket}/${objectPath}: ${(err as Error).message}`,
      );
    }
  }
}
