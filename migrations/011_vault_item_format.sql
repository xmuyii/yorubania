-- ============================================================================
-- Migration 011: Track original file format on vault items
-- ============================================================================
-- Without this, decrypted downloads had no MIME type to reconstruct with —
-- some browsers default an untyped Blob download to .txt, which is why an
-- uploaded image came back as a text file. This column lets the download
-- route hand the original type back so the browser can save it correctly.

alter table vault_items add column original_format text;
