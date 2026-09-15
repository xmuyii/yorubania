-- ============================================================================
-- Migration 018: Public contact info (opt-in, external platform contact)
-- ============================================================================
-- No messaging exists on Yorubania itself — this is deliberately just a
-- pointer to wherever members currently agree to communicate externally
-- (Telegram today; whatever the tribe agrees on later, via a poll).

alter table persons
  add column telegram_handle text,
  add column external_contact_note text;
