-- ============================================================================
-- Migration 012: Captions and legacy-curation flag on media
-- ============================================================================

alter table media_assets
  add column caption text,
  add column is_legacy boolean not null default false;

-- Legacy-flagged items surface first within an album — a simple, honest
-- proxy for "what this family decided mattered enough to prioritize,"
-- rather than any algorithmic guess at importance.
create index idx_media_assets_legacy on media_assets(subject_person_id, is_legacy desc, created_at desc);
