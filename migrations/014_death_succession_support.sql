-- ============================================================================
-- Migration 014: Death/succession support — designated successor,
-- confirmed-vs-presumed death, vault destruction audit
-- ============================================================================

-- Lets a member pre-name who takes over their account, decided while
-- alive. If set and reachable at time of death, succession is a direct
-- handoff rather than a family vote.
alter table accounts add column designated_successor_account_id uuid references accounts(id);

-- Distinguishes a death confirmed with documentary evidence from one
-- presumed after an extended, unreachable absence — both trigger the same
-- succession/vault processing (the system can't stay in limbo forever),
-- but descendants reading the record later see which kind it was, rather
-- than a false certainty.
alter table persons add column death_status text; -- 'confirmed' | 'presumed', null while living

alter table death_verification_cases
  add column extended_presumption_note text; -- required justification if status becomes presumed

-- Audit trail for vault items destroyed on death (rule_type = 'destroy',
-- or no rule set at all) — the ciphertext is gone, but the fact that it
-- existed and was destroyed, when, and under what case, is preserved.
create table vault_destruction_log (
  id uuid primary key default uuid_generate_v4(),
  vault_item_id uuid not null,
  vault_id uuid not null,
  death_verification_case_id uuid references death_verification_cases(id),
  destroyed_at timestamptz not null default now()
);
