-- ============================================================================
-- Migration 017: Superadmin succession, custodial accounts, verification
-- ============================================================================

-- --------------------------------------------------------------------------
-- Superadmin succession: a manual retirement transfer, or — if the
-- superadmin dies with no designated successor — a council election.
-- --------------------------------------------------------------------------
create table superadmin_transitions (
  id uuid primary key default uuid_generate_v4(),
  previous_account_id uuid references accounts(id),
  new_account_id uuid not null references accounts(id),
  method text not null,   -- 'manual_transfer' | 'designated_successor' | 'council_election'
  note text,
  created_at timestamptz not null default now()
);

create table superadmin_elections (
  id uuid primary key default uuid_generate_v4(),
  opened_reason text not null,
  status text not null default 'open',   -- 'open' | 'resolved'
  resolved_account_id uuid references accounts(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table superadmin_election_votes (
  id uuid primary key default uuid_generate_v4(),
  election_id uuid not null references superadmin_elections(id) on delete cascade,
  voter_account_id uuid not null references accounts(id),   -- must be a current council member
  candidate_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  unique (election_id, voter_account_id)
);

-- --------------------------------------------------------------------------
-- Custodial accounts: an account claimed on behalf of a minor (typically
-- by the inviting parent). Once the person's recorded age reaches 18, the
-- system requires them to personally set a brand-new password before
-- continuing — the one structural mechanism available to actually hand
-- control back to the person themselves, rather than leaving whoever
-- originally set the password (often a parent) permanently in control.
-- --------------------------------------------------------------------------
alter table accounts
  add column is_custodial boolean not null default false,
  add column custodial_handover_required boolean not null default false,
  add column custodial_handover_completed_at timestamptz;

-- --------------------------------------------------------------------------
-- Verification / anti-fraud monitoring — a lightweight review trail for
-- new accounts (especially minors, or accounts with no profile picture),
-- and a place to record a suspected-duplicate flag.
-- --------------------------------------------------------------------------
alter table accounts
  add column verified_by_account_id uuid references accounts(id),
  add column verified_at timestamptz,
  add column suspended_at timestamptz,
  add column suspended_by_account_id uuid references accounts(id),
  add column suspended_reason text;

create table duplicate_account_flags (
  id uuid primary key default uuid_generate_v4(),
  flagged_account_id uuid not null references accounts(id),
  suspected_duplicate_of_account_id uuid references accounts(id),
  flagged_by_account_id uuid not null references accounts(id),
  reason text not null,
  status text not null default 'open',   -- 'open' | 'dismissed' | 'confirmed'
  created_at timestamptz not null default now()
);
