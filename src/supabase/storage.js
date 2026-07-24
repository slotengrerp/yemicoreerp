// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Document Storage (Supabase Storage + base64 fallback)
//
// The audit's Tier-2 finding: DocScanner stores images as base64 data URLs
// inline in the same app state as everything else. localStorage is capped
// at ~4.8MB total — a handful of scans can blow the budget for the entire
// company dataset. The fix is to put binaries in object storage (Supabase
// Storage) and store only a reference (URL/path + metadata) in app state.
//
// This module:
//   • Uploads a Blob/File to a Supabase Storage bucket ("scanner-docs")
//   • Returns a stable URL (public or signed) the app can render
//   • Provides download + delete helpers
//   • Falls back to base64 only when Supabase is unavailable, and tags the
//     doc record with `storageBackend: 'inline'` so future migrations can
//     find and re-upload them
//
// Requires: a `scanner-docs` bucket in Supabase Storage with appropriate
// RLS policies (the migration creates one — see supabase/sql/004_storage.sql).
// ══════════════════════════════════════════════════════════════════════════════
import { supabase, supabaseReady } from './client';

const BUCKET = 'scanner-docs';

// ── Upload a file/blob/dataURL to storage ────────────────────────────────────
// Returns { url, path, sizeBytes, backend } where backend is 'storage' on
// success or 'inline' when we fell back to base64 (e.g. Supabase offline).
export async function uploadDocument({ file, blob, dataUrl, base64, name, contentType, companyId }) {
  const mime = contentType || file?.type || (dataUrl ? dataUrl.match(/^data:([^;]+)/)?.[1] : 'application/octet-stream');
  const cleanName = (name || file?.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${companyId || 'public'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cleanName}`;

  let bytes;
  if (file) bytes = file;
  else if (blob) bytes = blob;
  else if (dataUrl) {
    const r = await fetch(dataUrl);
    bytes = await r.blob();
  } else if (base64) {
    const r = await fetch(`data:${mime};base64,${base64}`);
    bytes = await r.blob();
  } else {
    throw new Error('uploadDocument requires file, blob, dataUrl, or base64');
  }

  if (!supabaseReady) {
    // Fall back to inline base64
    const b64 = await blobToBase64(bytes);
    return { url: `data:${mime};base64,${b64}`, path, sizeBytes: bytes.size, backend: 'inline' };
  }

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw error;

    // Get a public URL — if the bucket is private, the caller should swap
    // this for createSignedUrl() in the doc viewer.
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub?.publicUrl || null, path, sizeBytes: bytes.size, backend: 'storage' };
  } catch (e) {
    console.warn('[SLOT] Storage upload failed, falling back to inline:', e?.message);
    const b64 = await blobToBase64(bytes);
    return { url: `data:${mime};base64,${b64}`, path, sizeBytes: bytes.size, backend: 'inline' };
  }
}

// ── Get a signed URL (private bucket) ────────────────────────────────────────
export async function getSignedUrl(path, expiresInSec = 3600) {
  if (!supabaseReady) return null;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSec);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (e) {
    return null;
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────
export async function deleteDocument(path) {
  if (!supabaseReady || !path) return false;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw error;
    return true;
  } catch (e) {
    return false;
  }
}

// ── List all docs in a folder (for browsing/recovery) ────────────────────────
export async function listDocuments(prefix = '', { limit = 200 } = {}) {
  if (!supabaseReady) return [];
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    return data || [];
  } catch (e) {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result || '';
      // result is "data:mime;base64,XXXXX" — strip the prefix
      const b64 = String(result).includes(',') ? String(result).split(',')[1] : String(result);
      resolve(b64);
    };
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
