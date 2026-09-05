-- ============================================================================
-- Migration 007: Cohort-specific term lengths, expected term-end tracking,
-- profile images, and the founder record
-- ============================================================================

-- Seats 1-3 (cohort A): 9-year terms.
-- Seats 4-7 (cohort B): 4-year terms.
-- Deliberately uneven cohort sizes/lengths, per decision — still staggers
-- renewal (a 9-year seat and a 4-year seat rarely come up in the same
-- year), just not on a single shared cycle length.
alter table council_seats add column term_length_years int not null default 9;
update council_seats set term_length_years = 9 where cohort = 'A';
update council_seats set term_length_years = 4 where cohort = 'B';

-- Lets a currently-serving member's page show "term ends [date]" even
-- before they've actually left — term_end (existing column) stays null
-- until they actually depart (which might differ from the expected date,
-- e.g. early resignation), term_expected_end is the scheduled date.
alter table council_terms add column term_expected_end date;

-- Public-facing profile image, used for the founder photo and council seat
-- photos (Section: tribe leadership display). Points at a media_assets row
-- — reuses the same archival-format pipeline as any other uploaded media.
alter table persons add column profile_image_media_id uuid references media_assets(id);

-- Small generic key/value settings table. First use: recording which
-- account is "the founder" for the leadership display (distinct from
-- superadmin — a role — and distinct from any single council seat, since
-- the founder's council seat rotates like any other once elections start
-- covering it).
create table tribe_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Run once, replacing the account id:
--   insert into tribe_settings (key, value)
--   values ('founder_account_id', to_jsonb('<your account id>'::text));
