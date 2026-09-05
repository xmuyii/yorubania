-- ============================================================================
-- Migration 010: Store the WRAPPED (passphrase-encrypted) master key
-- ============================================================================
-- This was a gap in the original zero-knowledge design: kdf_salt/kdf_params
-- let you re-derive the same key FROM a passphrase, but nothing stored the
-- actual encrypted master key to unwrap — meaning a returning user had no
-- way to recover their master key on a new session. What's stored here is
-- ciphertext (useless without the passphrase-derived key) — storing it does
-- NOT weaken the zero-knowledge guarantee, it's what makes "log in from a
-- new device and still open your vault" possible at all.

alter table vaults
  add column wrapped_master_key_ciphertext text,  -- base64
  add column wrapped_master_key_iv text;           -- base64
