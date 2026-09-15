-- ============================================================================
-- Migration 021: Relationship status, multi-spouse privacy, education library
-- ============================================================================

-- --------------------------------------------------------------------------
-- Relationships gain an explicit status. This answers "how does the
-- system know a relationship still exists" — it doesn't infer it from
-- access patterns (unreliable, and a strange thing to base family status
-- on); it's a plain declarative field either party can update. Ending a
-- relationship does NOT retroactively revoke grants already created (that
-- would violate the "only the original grantor can revoke" rule) — it
-- only stops NEW default grants from being created going forward.
-- --------------------------------------------------------------------------
alter table relationships
  add column status text not null default 'active' check (status in ('active', 'ended')),
  add column ended_at date,
  add column end_reason text;

-- --------------------------------------------------------------------------
-- Multi-spouse privacy: a person with more than one spouse relationship
-- may not want one spouse's line to automatically see the other's
-- children. Defaults to true (current behavior); can be turned off
-- per-relationship at creation time.
-- --------------------------------------------------------------------------
alter table relationships
  add column default_sharing_enabled boolean not null default true;

-- --------------------------------------------------------------------------
-- Education materials — teaching/learning content, open to all members,
-- same storage pattern as the documents library.
-- --------------------------------------------------------------------------
create table education_materials (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  media_asset_id uuid not null references media_assets(id),
  uploaded_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now()
);
