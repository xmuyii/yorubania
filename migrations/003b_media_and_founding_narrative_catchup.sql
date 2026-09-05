-- ============================================================================
-- Catch-up migration: media_assets, media_metadata, founding_narrative
-- ============================================================================
-- Run this BEFORE migration 007 (which adds a foreign key from
-- persons.profile_image_media_id to media_assets). This content was
-- originally meant to be added right after schema_v0.sql, but appears not
-- to have been applied — this file makes it safe to run on its own,
-- regardless of what else has or hasn't run yet.
--
-- Safe to run even if some of this partially exists — each statement will
-- simply error harmlessly if its object is already present; comment out
-- any individual block that reports "already exists" and re-run the rest.
-- ============================================================================

create table if not exists media_assets (
  id uuid primary key default uuid_generate_v4(),
  owner_account_id uuid not null references accounts(id),
  subject_person_id uuid references persons(id),
  original_storage_path text not null,
  archival_storage_path text,
  original_format text not null,
  archival_format text,
  size_bytes bigint not null,
  is_vault_item boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_media_owner on media_assets(owner_account_id);
create index if not exists idx_media_subject on media_assets(subject_person_id);

create table if not exists media_metadata (
  media_asset_id uuid primary key references media_assets(id) on delete cascade,
  creator_person_id uuid references persons(id),
  date_created date,
  date_uploaded timestamptz not null default now(),
  description text,
  provenance_note text,
  checksum text not null,
  checksum_last_verified timestamptz not null default now(),
  checksum_status text not null default 'ok'
);

create table if not exists founding_narrative (
  id uuid primary key default uuid_generate_v4(),
  version int not null,
  authored_by_account_id uuid not null references accounts(id),
  language text not null default 'en',
  title text not null,
  origin_story text,
  founding_principles text,
  relationship_to_yoruba text,
  founding_date_or_era text,
  founding_location text,
  sources text,
  confidence_level text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (version)
);

create table if not exists founding_narrative_media (
  founding_narrative_id uuid not null references founding_narrative(id) on delete cascade,
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  primary key (founding_narrative_id, media_asset_id)
);

-- Enforce "exactly one is_current = true" — this one will error if it
-- already exists, which is fine; that just means it's already applied.
create unique index if not exists one_current_narrative
  on founding_narrative(is_current) where is_current = true;
