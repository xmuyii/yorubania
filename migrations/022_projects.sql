-- ============================================================================
-- Migration 022: Projects — what Yorubania is currently undertaking
-- ============================================================================

create table projects (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  created_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
