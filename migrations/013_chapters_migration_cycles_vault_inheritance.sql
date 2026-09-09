-- ============================================================================
-- Migration 013: Biography chapters, 10-year migration cycles, vault
-- inheritance rules
-- ============================================================================

-- --------------------------------------------------------------------------
-- "Our History" — biography chapters. Draft while alive and editable;
-- sealing makes a chapter immutable. Only the account that performed the
-- seal may unseal it — and a death-triggered seal can never be unsealed by
-- anyone, because the only account ever permitted to reverse it belongs to
-- someone who is no longer able to authenticate as themselves again.
-- --------------------------------------------------------------------------
create table biography_chapters (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references persons(id),
  title text not null,
  body text not null,
  chapter_order int not null default 0,
  status text not null default 'draft',      -- 'draft' | 'sealed'
  sealed_at timestamptz,
  sealed_by_account_id uuid references accounts(id),
  sealed_via text,                            -- 'manual' | 'death_confirmed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_chapters_person on biography_chapters(person_id, chapter_order);

-- --------------------------------------------------------------------------
-- 10-year whole-system migration cycles. "Migration" here means: inclusion
-- in the durable archival/offline copy, with format re-verification — NOT
-- moving to a different platform. Members choose per-cycle whether to
-- participate and which items to include; declining just means waiting
-- for the next cycle (individual on-demand migration is separate, below).
-- --------------------------------------------------------------------------
create table migration_cycles (
  id uuid primary key default uuid_generate_v4(),
  opens_at timestamptz not null,             -- when the countdown/decision window starts
  decision_deadline timestamptz not null,     -- when the whole-system migration executes
  status text not null default 'scheduled',   -- scheduled | decisions_open | executed | cancelled
  created_at timestamptz not null default now()
);

create table migration_decisions (
  id uuid primary key default uuid_generate_v4(),
  cycle_id uuid not null references migration_cycles(id) on delete cascade,
  account_id uuid not null references accounts(id),
  decision text not null default 'pending',    -- 'pending' | 'migrate' | 'decline'
  decided_at timestamptz,
  unique (cycle_id, account_id)
);

-- Which specific items an account included, for a given cycle. cycle_id is
-- null for an individual on-demand migration (self-service, any time,
-- outside the 10-year whole-system cycle).
create table migration_item_selections (
  id uuid primary key default uuid_generate_v4(),
  cycle_id uuid references migration_cycles(id) on delete cascade,
  account_id uuid not null references accounts(id),
  item_type text not null,                     -- 'media' | 'vault_item'
  item_id uuid not null,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Vault item inheritance rules. Every vault item needs an explicit answer
-- to "what happens to this on death" — destroy, go to all descendants,
-- stop at immediate children only, or go to specific chosen children
-- (optionally cascading onward down that child's own line).
-- --------------------------------------------------------------------------
create table vault_item_distribution_rules (
  id uuid primary key default uuid_generate_v4(),
  vault_item_id uuid not null unique references vault_items(id) on delete cascade,
  rule_type text not null default 'destroy',
  -- 'destroy' | 'all_descendants' | 'immediate_children_only' | 'specific_recipients'
  set_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vault_item_distribution_recipients (
  id uuid primary key default uuid_generate_v4(),
  vault_item_id uuid not null references vault_items(id) on delete cascade,
  recipient_person_id uuid not null references persons(id),
  -- true = this recipient's own descendants inherit it onward automatically;
  -- false = it stops with this specific chosen child.
  cascade_to_lineage boolean not null default false,
  created_at timestamptz not null default now(),
  unique (vault_item_id, recipient_person_id)
);

-- --------------------------------------------------------------------------
-- Structural ancestor-default check, used by the authorization module so
-- descendants see ancestor content by default, indefinitely far back,
-- without needing to materialize a grant row for every generation. An
-- explicit denial (blacklist AccessGrant) still overrides this.
-- --------------------------------------------------------------------------
create or replace function is_ancestor_of(
  ancestor_person_id uuid,
  descendant_person_id uuid,
  max_depth int default 50
)
returns boolean
language plpgsql
stable
as $$
declare
  current_ids uuid[] := array[descendant_person_id];
  depth int := 0;
begin
  if ancestor_person_id = descendant_person_id then
    return false; -- not your own ancestor
  end if;

  while depth < max_depth and array_length(current_ids, 1) > 0 loop
    if ancestor_person_id = any(current_ids) then
      return true;
    end if;

    select coalesce(array_agg(distinct r.person_a_id), array[]::uuid[])
    into current_ids
    from relationships r
    where r.relationship_type = 'parent_child'
      and r.person_b_id = any(current_ids);

    depth := depth + 1;
  end loop;

  return ancestor_person_id = any(current_ids);
end;
$$;
