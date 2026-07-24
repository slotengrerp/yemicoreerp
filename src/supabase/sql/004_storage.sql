-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering — Storage Bucket Setup (004)
--
-- Creates the `scanner-docs` bucket used by the DocScanner migration.
-- Run after 003_per_record_tables.sql.
--
-- IMPORTANT: this bucket MUST be private (public = false). Public would
-- expose every scanned receipt, PO, and payroll document to the open
-- Internet. Documents are accessed via createSignedUrl() with short-lived
-- tokens (default 1 hour).
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scanner-docs',
  'scanner-docs',
  false,           -- private bucket — signed URLs only
  52428800,        -- 50 MB per file (plenty for high-res scans)
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- RLS for storage.objects — only the owning company can read/write their docs.
-- The path convention is `<company_id>/<timestamp>-<random>-<filename>`, so we
-- police the first segment.
DROP POLICY IF EXISTS "scanner_docs_company_isolation" ON storage.objects;
CREATE POLICY "scanner_docs_company_isolation" ON storage.objects
  FOR ALL
  USING       (bucket_id = 'scanner-docs' AND (storage.foldername(name))[1] = public.get_my_company_id())
  WITH CHECK  (bucket_id = 'scanner-docs' AND (storage.foldername(name))[1] = public.get_my_company_id());
