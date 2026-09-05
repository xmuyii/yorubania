-- ============================================================================
-- Migration 001b: Fix-up for anyone who already ran an earlier bytea version
-- ============================================================================
-- If you ran the very first version of the vaults table (before this
-- project was reorganized into numbered migrations), `kdf_salt` was
-- created as `bytea`. This migration converts it — and the related key
-- columns from 002/010, if present — to `text` (base64), which is what
-- the current backend code expects. Safe to run regardless of which of
-- those columns already exist; each check is guarded.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'vaults' and column_name = 'kdf_salt' and data_type = 'bytea'
  ) then
    alter table vaults alter column kdf_salt type text using encode(kdf_salt, 'base64');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'vaults' and column_name = 'admin_recovery_sealed_key' and data_type = 'bytea'
  ) then
    alter table vaults alter column admin_recovery_sealed_key type text
      using encode(admin_recovery_sealed_key, 'base64');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'vaults' and column_name = 'wrapped_master_key_ciphertext' and data_type = 'bytea'
  ) then
    alter table vaults alter column wrapped_master_key_ciphertext type text
      using encode(wrapped_master_key_ciphertext, 'base64');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'vaults' and column_name = 'wrapped_master_key_iv' and data_type = 'bytea'
  ) then
    alter table vaults alter column wrapped_master_key_iv type text
      using encode(wrapped_master_key_iv, 'base64');
  end if;
end $$;
