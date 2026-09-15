-- ============================================================================
-- Migration 020: Punisher/Rewarder enforcement, restrictions, voted deletion
-- ============================================================================
-- Punisher must hold one of the 4-year council seats (4-7) — validated in
-- application code when the superadmin designates them, not enforced at
-- the DB level, since it depends on current council_terms state.

create table account_restrictions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),
  restriction_type text not null,
  -- 'vault_access' | 'add_relationships' | 'update_account' | 'view_others'
  imposed_by_account_id uuid not null references accounts(id),
  reason text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  lifted_early_by_account_id uuid references accounts(id),
  lifted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_restrictions_account on account_restrictions(account_id, restriction_type);

-- Deletion is the one punishment heavy enough to require a full council +
-- living-superadmin vote, even when the punisher initiates it — giving the
-- offender a real window to appeal before anything executes.
create table account_deletion_proposals (
  id uuid primary key default uuid_generate_v4(),
  target_account_id uuid not null references accounts(id),
  proposed_by_account_id uuid not null references accounts(id),
  reason text not null,
  status text not null default 'voting',   -- 'voting' | 'approved' | 'rejected' | 'executed'
  voting_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table account_deletion_votes (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references account_deletion_proposals(id) on delete cascade,
  voter_account_id uuid not null references accounts(id),
  vote text not null,   -- 'approve' | 'reject'
  created_at timestamptz not null default now(),
  unique (proposal_id, voter_account_id)
);
