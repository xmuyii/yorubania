-- ============================================================================
-- Migration 002: Vault security mode (Extra Safe vs Standard recovery)
-- ============================================================================
-- Run this against the database that already has schema_v0.sql applied.

create type vault_security_mode as enum ('extra_safe', 'standard');

-- Platform recovery keypair(s). Only the PUBLIC key is ever stored here or
-- known to the running application. The matching PRIVATE key is generated
-- and held entirely offline (e.g. printed/stored in a hardware security key
-- or safe) — it must never exist on any server, in any backup, or in any
-- environment variable. Versioned so the key can be rotated in the future
-- without breaking vaults sealed under an older key.
create table platform_recovery_keys (
  id uuid primary key default uuid_generate_v4(),
  public_key text not null,     -- base64 X25519 public key
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Only one active recovery key at a time
create unique index one_active_recovery_key
  on platform_recovery_keys(is_active) where is_active = true;

alter table vaults
  add column security_mode vault_security_mode not null default 'extra_safe',
  add column admin_recovery_sealed_key bytea,       -- null unless security_mode = 'standard'
  add column recovery_key_id uuid references platform_recovery_keys(id);

-- A Standard-mode vault must record which recovery key it was sealed under
-- and must have the sealed key present. An Extra Safe vault must have
-- neither — enforced here so it's impossible at the data layer to end up
-- in a half-configured state.
alter table vaults add constraint vault_security_mode_consistency check (
  (security_mode = 'extra_safe' and admin_recovery_sealed_key is null and recovery_key_id is null)
  or
  (security_mode = 'standard' and admin_recovery_sealed_key is not null and recovery_key_id is not null)
);

-- Every use of admin recovery is a deliberate, exceptional act — log it
-- distinctly from the general access_logs table so it's easy to audit
-- specifically who invoked vault recovery, when, and for which account.
create table vault_recovery_events (
  id uuid primary key default uuid_generate_v4(),
  vault_id uuid not null references vaults(id),
  performed_by_account_id uuid not null references accounts(id),
  reason text not null,
  occurred_at timestamptz not null default now()
);
