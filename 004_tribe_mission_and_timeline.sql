-- ============================================================================
-- Migration 004: Tribe mission/vision, timeline phases, announcements
-- ============================================================================

-- Mission/vision statement — versioned like the Founding Narrative, exactly
-- one current version at a time. `founding_date` is the canonical anchor
-- for the 1000-year milestone calculation (kept separate from the
-- Founding Narrative's free-text founding_date_or_era, which may be
-- approximate/symbolic — this one needs to be a real date for the math).
create table tribe_mission (
  id uuid primary key default uuid_generate_v4(),
  version int not null,
  statement text not null,
  founding_date date not null,
  milestone_years int not null default 1000,
  authored_by_account_id uuid not null references accounts(id),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (version)
);

create unique index one_current_mission on tribe_mission(is_current) where is_current = true;

-- Named eras across the 1000-year span (e.g. "Founding Generation",
-- "Growth Era"), so members can see not just a raw year-count but which
-- named phase of the journey they're currently living in.
create table tribe_era_phases (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  start_year_offset int not null,   -- years since founding_date
  end_year_offset int,               -- null = open-ended / final phase
  description text,
  display_order int not null
);

-- General news/announcements visible to all members — the "general
-- section" separate from personal genealogy pages.
create table tribe_announcements (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  posted_by_account_id uuid not null references accounts(id),
  pinned boolean not null default false,
  posted_at timestamptz not null default now()
);

-- Reused as the general tribe governance council — currently gates edits to
-- both the Founding Narrative (schema_v0.sql) and the Mission/Vision above.
-- Seed the founder's own account as its first (and initially only) member:
--
--   insert into founding_narrative_council (account_id)
--   values ('<your account id here>');
