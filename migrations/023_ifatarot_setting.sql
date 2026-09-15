-- ============================================================================
-- Migration 023: Ifatarot integration point
-- ============================================================================
-- The actual Ifatarot application lives outside this codebase — this just
-- gives every account a consistent, always-available link to it. Deeper
-- integration (passing identity so Ifatarot recognizes the Yorubania user
-- without a second login) depends on what Ifatarot's own app supports and
-- isn't attempted here — see frontend ifatarot.html for the current
-- simple-link version.

insert into tribe_settings (key, value)
values ('ifatarot_app_url', to_jsonb(''::text))
on conflict (key) do nothing;
