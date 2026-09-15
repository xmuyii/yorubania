-- ============================================================================
-- Migration 019: Polls — called by admins/superadmin/council, time-bound,
-- results announced in the news feed
-- ============================================================================

create table polls (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  opened_by_account_id uuid not null references accounts(id),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  status text not null default 'open',   -- 'open' | 'closed'
  created_at timestamptz not null default now()
);

create table poll_options (
  id uuid primary key default uuid_generate_v4(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null
);

create table poll_votes (
  id uuid primary key default uuid_generate_v4(),
  poll_id uuid not null references polls(id) on delete cascade,
  voter_account_id uuid not null references accounts(id),
  option_id uuid not null references poll_options(id),
  created_at timestamptz not null default now(),
  unique (poll_id, voter_account_id)
);
