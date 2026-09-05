-- ============================================================================
-- Migration 008: Family branches, achievements feed, directory visibility
-- ============================================================================

-- A "family" here is an explicit branch, not just a surname string — this
-- lets a family that splits off from another be recorded as such (who
-- founded the split, when, and which branch it came from), producing a
-- real browsable tree of families rather than a flat list of last names.
create table family_branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,                                    -- typically the surname
  parent_family_branch_id uuid references family_branches(id),  -- null = not a known split
  founding_person_id uuid references persons(id),
  origin_note text,                                        -- e.g. "relocated to Ibadan, 1962"
  founded_at date,
  created_at timestamptz not null default now()
);

create index idx_family_branches_parent on family_branches(parent_family_branch_id);

alter table persons add column family_branch_id uuid references family_branches(id);

-- Member-generated accomplishments feed — distinct from tribe_announcements
-- (which is council-only, official news). Anyone can post about their own
-- achievement; status defaults to published (no moderation gate in v1 —
-- flagged as an open item below).
create table community_achievements (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),        -- whose achievement this is
  posted_by_account_id uuid not null references accounts(id),
  title text not null,
  description text,
  achieved_date date,
  posted_at timestamptz not null default now(),
  status text not null default 'published'                  -- published | hidden
);

create index idx_achievements_account on community_achievements(account_id);

-- Opt-in directory visibility, defaulting to false — consistent with the
-- "members start private, opt into sharing" principle established earlier.
-- This is separate from lineage-based AccessGrants entirely: it controls
-- whether a member's NAME/photo/family-branch appear in the general
-- member-search directory, not their genealogical data.
alter table accounts add column directory_visible boolean not null default false;
