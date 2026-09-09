-- ============================================================================
-- Migration 015: Yorubania Rules (spiritual + general) and documents library
-- ============================================================================

-- --------------------------------------------------------------------------
-- Spiritual rules: set only by the superadmin, and — this is enforced at
-- the DATABASE level, not just in application code, so it holds even
-- against a compromised or careless superadmin account — can NEVER be
-- updated or deleted once written. New ones can be added; existing ones
-- can only ever grow in number, never change or shrink.
-- --------------------------------------------------------------------------
create table spiritual_rules (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  set_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now()
);

create or replace function forbid_spiritual_rule_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'spiritual_rules is append-only — rows can never be updated or deleted, by design';
end;
$$;

create trigger spiritual_rules_no_update
  before update on spiritual_rules
  for each row execute function forbid_spiritual_rule_mutation();

create trigger spiritual_rules_no_delete
  before delete on spiritual_rules
  for each row execute function forbid_spiritual_rule_mutation();

-- --------------------------------------------------------------------------
-- General rules: ordinary governance, versioned and editable by the
-- council — same pattern as the Founding Narrative and Mission/Vision.
-- --------------------------------------------------------------------------
create table general_rules (
  id uuid primary key default uuid_generate_v4(),
  version int not null,
  title text not null,
  body text not null,
  set_by_account_id uuid not null references accounts(id),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (version)
);

create unique index one_current_general_rules on general_rules(is_current) where is_current = true;

-- --------------------------------------------------------------------------
-- Open documents library — visible to all members, not gated by lineage
-- access rules (distinct from personal family media).
-- --------------------------------------------------------------------------
create table tribe_documents (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  media_asset_id uuid not null references media_assets(id),
  uploaded_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now()
);
