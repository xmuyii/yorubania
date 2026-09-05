-- ============================================================================
-- Migration 009: System backups, vault recovery custodian, storage buckets
-- ============================================================================

-- Tracks every full-database backup, who triggered it, and where it landed.
-- Open to admin AND superadmin (not just superadmin) — per decision, backup
-- responsibility is shared across every admin account, not a single person.
create table system_backups (
  id uuid primary key default uuid_generate_v4(),
  triggered_by_account_id uuid not null references accounts(id),
  storage_path text not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  status text not null default 'completed'   -- completed | failed
);

-- Restricts WHO may request an offline recovery unsealing for a
-- Standard-mode vault to exactly one account at a time — not "any admin."
-- Reassignable (e.g. to a specific council seat's occupant) by superadmin.
-- Read via tribe_settings key 'vault_recovery_custodian_account_id'
-- (reuses the generic settings table from migration 007 rather than a
-- dedicated column, since this is exactly what that table is for).

-- Personal data export requests — lets a member log/track their own
-- self-service backups of their family data (Section: member backups).
create table member_data_exports (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),
  requested_at timestamptz not null default now()
);
