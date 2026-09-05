-- ============================================================================
-- Yorubania Platform — Initial Schema (v0)
-- Target: Supabase (Postgres + RLS)
-- ============================================================================
-- This is a first build pass covering the core entities from the spec:
-- people, relationships, access grants, vault, verification contacts,
-- membership/invites, and admin roles. Media assets, founding narrative,
-- and full RLS policies are intentionally left for the next pass once this
-- core is reviewed — flagged inline with TODO markers.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- ROLES
-- ----------------------------------------------------------------------------
create type user_role as enum ('member', 'admin', 'superadmin', 'verification_admin');

-- ----------------------------------------------------------------------------
-- ACCOUNTS (auth identity + role)
-- ----------------------------------------------------------------------------
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role user_role not null default 'member',
  created_at timestamptz not null default now(),
  vault_storage_limit_bytes bigint not null default 26214400,   -- 25 MB default
  family_storage_limit_bytes bigint not null default 52428800,  -- 50 MB default
  vault_bytes_used bigint not null default 0,
  family_bytes_used bigint not null default 0,
  check_in_interval_days int not null default 365,
  last_check_in_at timestamptz not null default now(),
  admin_access_enabled boolean not null default false           -- Section 8.1 opt-in flag
);

create index idx_accounts_auth_user on accounts(auth_user_id);

-- ----------------------------------------------------------------------------
-- PERSON (may or may not have a linked account — a Person can exist as a
-- record before the individual ever claims an account, per Section 10)
-- ----------------------------------------------------------------------------
create table persons (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references accounts(id) on delete set null,   -- null until claimed
  full_name text not null,
  date_of_birth date,
  date_of_death date,
  bio text,
  is_deceased boolean not null default false,
  current_controller_account_id uuid references accounts(id),   -- who controls this record
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_persons_account on persons(account_id);
create index idx_persons_controller on persons(current_controller_account_id);

-- ----------------------------------------------------------------------------
-- RELATIONSHIPS (graph edges)
-- ----------------------------------------------------------------------------
create type relationship_type as enum (
  'parent_child', 'spouse', 'sibling', 'adoptive_parent', 'guardian'
);

create table relationships (
  id uuid primary key default uuid_generate_v4(),
  person_a_id uuid not null references persons(id) on delete cascade,
  person_b_id uuid not null references persons(id) on delete cascade,
  relationship_type relationship_type not null,
  -- direction matters for parent_child: a = parent, b = child
  event_date date,
  source_note text,
  confidence_level text,        -- 'documented' | 'oral_tradition' | 'reconstructed'
  created_at timestamptz not null default now(),
  constraint no_self_relationship check (person_a_id <> person_b_id)
);

create index idx_relationships_a on relationships(person_a_id);
create index idx_relationships_b on relationships(person_b_id);

-- ----------------------------------------------------------------------------
-- ACCESS GRANTS (Section 5.1 — immutable succession-safe permission log)
-- ----------------------------------------------------------------------------
create type grant_status as enum ('active', 'revoked');

create table access_grants (
  id uuid primary key default uuid_generate_v4(),
  subject_person_id uuid not null references persons(id) on delete cascade,
  grantor_account_id uuid not null references accounts(id),
  grantee_account_id uuid not null references accounts(id),
  scope text not null,                 -- e.g. 'full_record', 'field:medical_history', 'media:vault'
  visibility_rule text,                -- free-form rule descriptor, refine later
  is_denial boolean not null default false,  -- true = explicit blacklist entry
  created_at timestamptz not null default now(),
  status grant_status not null default 'active',
  revoked_at timestamptz,
  -- CRITICAL: revocable_by is fixed at creation and never changes, even
  -- when current_controller_account_id on the person changes. This is what
  -- makes prior grants survive succession (Section 9).
  revocable_by_account_id uuid not null references accounts(id)
);

create index idx_grants_subject on access_grants(subject_person_id);
create index idx_grants_grantee on access_grants(grantee_account_id);

-- Enforce at the application layer: revoke action must check
-- requesting_account_id = revocable_by_account_id before allowing status update.
-- (Postgres can't easily enforce "only this specific row's original creator"
-- beyond a trigger — recommend a BEFORE UPDATE trigger that raises an
-- exception if revocable_by_account_id doesn't match the session's account,
-- once Supabase auth context is wired up.)

-- ----------------------------------------------------------------------------
-- VAULT
-- ----------------------------------------------------------------------------
create type vault_disposition as enum ('distribute', 'destroy', 'hybrid');

create table vaults (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null unique references accounts(id) on delete cascade,
  decoy_completed boolean not null default false,   -- gates real uploads, Section 6
  disposition vault_disposition,
  kdf_salt text not null,               -- base64-encoded salt for client-side key derivation
  kdf_algorithm text not null default 'argon2id',
  kdf_params jsonb not null,           -- e.g. {"memory_kb":65536,"iterations":3,"parallelism":4}
  -- NOTE: no key material of any kind is stored here. The server only ever
  -- holds ciphertext + these public KDF parameters. The decryption key is
  -- derived from the user's passphrase on their device and never transmitted.
  created_at timestamptz not null default now()
);

create table vault_items (
  id uuid primary key default uuid_generate_v4(),
  vault_id uuid not null references vaults(id) on delete cascade,
  is_decoy boolean not null default false,
  storage_path text not null,
  size_bytes bigint not null,
  encrypted boolean not null default true,
  created_at timestamptz not null default now()
);

create table vault_distributions (
  id uuid primary key default uuid_generate_v4(),
  vault_item_id uuid not null references vault_items(id) on delete cascade,
  recipient_account_id uuid not null references accounts(id),
  -- who gets this specific item on confirmed death
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- VERIFICATION CONTACT (Section 7 — admin-only, never merged with family data)
-- ----------------------------------------------------------------------------
create table verification_contacts (
  account_id uuid primary key references accounts(id) on delete cascade,
  phone text,
  address text,
  email text,
  guarantor_name text,
  guarantor_phone text,
  death_verification_notes text,
  additional_contacts jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- DEATH VERIFICATION CASES
-- ----------------------------------------------------------------------------
create type verification_case_status as enum ('open', 'confirmed_death', 'closed_false_trigger');

create table death_verification_cases (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),
  opened_at timestamptz not null default now(),
  status verification_case_status not null default 'open',
  handled_by_admin_id uuid references accounts(id),
  resolved_at timestamptz,
  resolution_note text
);

-- ----------------------------------------------------------------------------
-- SUCCESSION (Section 9 — family vote / eldest-child fallback)
-- ----------------------------------------------------------------------------
create type succession_case_status as enum ('voting', 'resolved');

create table succession_cases (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references persons(id),
  opened_at timestamptz not null default now(),
  status succession_case_status not null default 'voting',
  resolved_controller_account_id uuid references accounts(id),
  resolution_method text   -- 'vote' | 'eldest_child_fallback'
);

create table succession_votes (
  id uuid primary key default uuid_generate_v4(),
  succession_case_id uuid not null references succession_cases(id) on delete cascade,
  voter_account_id uuid not null references accounts(id),
  candidate_account_id uuid not null references accounts(id),
  cast_at timestamptz not null default now(),
  unique (succession_case_id, voter_account_id)  -- one vote per voter per case
);

-- ----------------------------------------------------------------------------
-- MEMBERSHIP / INVITE SYSTEM (Section 10)
-- ----------------------------------------------------------------------------
create type registration_status as enum ('pending', 'claimed', 'expired');

create table person_registrations (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  registered_by_account_id uuid not null references accounts(id),
  relationship_to_inviter relationship_type,  -- null if registered_by is admin
  person_id uuid references persons(id),      -- created immediately alongside this row
  invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status registration_status not null default 'pending',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by_account_id uuid references accounts(id)
);

create index idx_registrations_token on person_registrations(invite_token);

-- ----------------------------------------------------------------------------
-- ADMIN ACCESS OVERRIDE (Section 8.1)
-- ----------------------------------------------------------------------------
create table admin_access_grants (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),
  granted_by_account_id uuid not null references accounts(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text,
  status text not null default 'active'  -- active | expired | revoked
);

-- ----------------------------------------------------------------------------
-- UNIVERSAL ACCESS LOG (Section 8.2 — always on)
-- ----------------------------------------------------------------------------
create table access_logs (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),   -- whose data was accessed
  accessor_account_id uuid references accounts(id),
  accessor_role text,
  occurred_at timestamptz not null default now(),
  ip_address inet,
  approximate_location text,
  action text not null
);

create index idx_access_logs_account on access_logs(account_id);
create index idx_access_logs_time on access_logs(occurred_at);

-- ----------------------------------------------------------------------------
-- MEDIA ASSETS (Section 4 — archival format storage + fixity)
-- ----------------------------------------------------------------------------
create table media_assets (
  id uuid primary key default uuid_generate_v4(),
  owner_account_id uuid not null references accounts(id),
  subject_person_id uuid references persons(id),   -- who/what this media concerns
  original_storage_path text not null,              -- as-uploaded file
  archival_storage_path text,                        -- normalized archival-format derivative
  original_format text not null,
  archival_format text,                               -- TIFF / FFV1-MKV / WAV / PDF-A / etc.
  size_bytes bigint not null,
  is_vault_item boolean not null default false,       -- true if this lives in a vault, not family page
  created_at timestamptz not null default now()
);

create index idx_media_owner on media_assets(owner_account_id);
create index idx_media_subject on media_assets(subject_person_id);

-- ----------------------------------------------------------------------------
-- MEDIA METADATA (Section 4.1 — fixity + PREMIS/Dublin-Core-style provenance)
-- ----------------------------------------------------------------------------
create table media_metadata (
  media_asset_id uuid primary key references media_assets(id) on delete cascade,
  creator_person_id uuid references persons(id),
  date_created date,
  date_uploaded timestamptz not null default now(),
  description text,
  provenance_note text,
  checksum text not null,               -- SHA-256 hex digest at ingest
  checksum_last_verified timestamptz not null default now(),
  checksum_status text not null default 'ok'   -- 'ok' | 'mismatch_detected' | 'pending_review'
);

-- Scheduled job (run outside Postgres — a Railway cron task or Supabase Edge
-- Function on a timer) re-hashes archival_storage_path on a rolling schedule
-- and updates checksum_last_verified / checksum_status. A mismatch should
-- trigger an alert, not a silent overwrite of the stored checksum.

-- ----------------------------------------------------------------------------
-- FOUNDING NARRATIVE (Section 1 — single canonical, publicly readable record)
-- ----------------------------------------------------------------------------
create table founding_narrative_council (
  account_id uuid primary key references accounts(id)
  -- membership of this table = who currently has amendment authority,
  -- once authority transfers from the founder to a council (Section 1.2)
);

create table founding_narrative (
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
  is_current boolean not null default false,   -- exactly one row should be true
  created_at timestamptz not null default now(),
  unique (version)
);

-- Supporting media (oral testimony, documents, oríkì) reuses media_assets,
-- linked via subject_person_id = null and a dedicated join table so a single
-- recording can support multiple narrative versions if needed:
create table founding_narrative_media (
  founding_narrative_id uuid not null references founding_narrative(id) on delete cascade,
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  primary key (founding_narrative_id, media_asset_id)
);

-- Enforce "exactly one is_current = true" with a partial unique index:
create unique index one_current_narrative on founding_narrative(is_current) where is_current = true;

-- ============================================================================
-- STILL NOT IN THIS PASS:
--   - Application-layer authorization module (replaces RLS — lives in app
--     code, not SQL; see spec Section 13)
--   - Triggers: revocable_by enforcement, bytes_used counters, check-in reset
--   - Client-side (zero-knowledge) encryption implementation itself lives in
--     the client/app code, not the database — schema now only stores salt
--     and KDF params (see `vaults` table above), never key material
-- ============================================================================

