import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Single private bucket, path-namespaced by purpose:
 *   vault/{accountId}/{itemId}
 *   media/{accountId}/{mediaAssetId}
 *   backups/{timestamp}.sql
 *
 * The bucket must be created once (Supabase dashboard: Storage → New
 * bucket → name "yorubania-storage" → Private). Access control is enforced
 * entirely at the application layer (routes calling canAccess() before
 * ever fetching an object) — deliberately NOT relying on Supabase Storage
 * policies, consistent with the "no RLS, app-layer authorization" decision
 * (spec Section 13). Every download goes through our API, never a direct
 * public bucket URL.
 */
const BUCKET = "yorubania-storage";

export async function uploadObject(
  supabase: SupabaseClient,
  path: string,
  bytes: Buffer,
  contentType: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  return { error: error?.message ?? null };
}

export async function downloadObject(
  supabase: SupabaseClient,
  path: string
): Promise<{ bytes: Buffer | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return { bytes: null, error: error?.message ?? "not found" };
  const arrayBuffer = await data.arrayBuffer();
  return { bytes: Buffer.from(arrayBuffer), error: null };
}

export async function deleteObject(supabase: SupabaseClient, path: string): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return { error: error?.message ?? null };
}
