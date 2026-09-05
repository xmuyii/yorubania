-- ============================================================================
-- Migration 005: Council governance — elections, staggered terms, seats
-- ============================================================================
-- Supersedes the placeholder `founding_narrative_council` table from
-- schema_v0.sql. That table stays in the database (harmless) but is no
-- longer read by the application — council membership is now derived from
-- `council_terms` (term_end is null = currently serving).

create table council_seats (
  seat_number int primary key check (seat_number between 1 and 7),
  -- Staggers renewal: seats in cohort 'A' come up for election on one
  -- 10-year cycle, cohort 'B' on a cycle offset by 5 years — so the
  -- council never fully turns over in a single election.
  cohort text not null check (cohort in ('A', 'B'))
);

insert into council_seats (seat_number, cohort) values
  (1, 'A'), (2, 'A'), (3, 'A'),
  (4, 'B'), (5, 'B'), (6, 'B'), (7, 'B');

create table council_terms (
  id uuid primary key default uuid_generate_v4(),
  seat_number int not null references council_seats(seat_number),
  account_id uuid not null references accounts(id),
  term_start date not null,
  term_end date,                    -- null = currently serving
  elected_via text not null default 'election',  -- 'founding_appointment' | 'election'
  election_id uuid                   -- set once council_elections exists below
);

create index idx_council_terms_account on council_terms(account_id);
create index idx_council_terms_seat on council_terms(seat_number);
-- At most one currently-serving occupant per seat:
create unique index one_current_occupant_per_seat
  on council_terms(seat_number) where term_end is null;

create table council_elections (
  id uuid primary key default uuid_generate_v4(),
  seat_number int not null references council_seats(seat_number),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'open',   -- open | closed | resolved
  resolved_account_id uuid references accounts(id)
);

alter table council_terms
  add constraint fk_council_terms_election
  foreign key (election_id) references council_elections(id);

create table council_election_nominations (
  id uuid primary key default uuid_generate_v4(),
  election_id uuid not null references council_elections(id) on delete cascade,
  nominee_account_id uuid not null references accounts(id),
  nominated_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  unique (election_id, nominee_account_id)
);

create table council_election_votes (
  id uuid primary key default uuid_generate_v4(),
  election_id uuid not null references council_elections(id) on delete cascade,
  voter_account_id uuid not null references accounts(id),
  candidate_account_id uuid not null references accounts(id),
  cast_at timestamptz not null default now(),
  unique (election_id, voter_account_id)  -- one vote per member per election
);

-- ----------------------------------------------------------------------------
-- SEEDING: your founding appointment to seat 1, cohort A.
-- Run this once, replacing the account id:
--
--   insert into council_terms (seat_number, account_id, term_start, elected_via)
--   values (1, '<your account id>', current_date, 'founding_appointment');
--
-- Seats 2–7 remain vacant until their first elections are run. Vacant seats
-- simply mean fewer than 7 people currently pass requireCouncilMembership —
-- the application does not require all 7 to be filled to function.
-- ----------------------------------------------------------------------------

-- Close-blood-relation check used by council eligibility rules: true if
-- person_a and person_b are parent/child, siblings, or grandparent/
-- grandchild of each other. Deliberately does NOT count spouse or
-- cousin-level relations — adjust here if you want the anti-oligarchy
-- rule to reach further than immediate/grandparent-level family.
create or replace function is_closely_blood_related(person_a uuid, person_b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    -- direct parent/child, either direction
    select 1 from relationships
    where relationship_type = 'parent_child'
      and ((person_a_id = person_a and person_b_id = person_b)
        or (person_a_id = person_b and person_b_id = person_a))
  ) or exists (
    -- siblings
    select 1 from relationships
    where relationship_type = 'sibling'
      and ((person_a_id = person_a and person_b_id = person_b)
        or (person_a_id = person_b and person_b_id = person_a))
  ) or exists (
    -- grandparent/grandchild: two chained parent_child edges
    select 1
    from relationships r1
    join relationships r2
      on r1.relationship_type = 'parent_child'
     and r2.relationship_type = 'parent_child'
     and r1.person_b_id = r2.person_a_id
    where (r1.person_a_id = person_a and r2.person_b_id = person_b)
       or (r1.person_a_id = person_b and r2.person_b_id = person_a)
  );
$$;
