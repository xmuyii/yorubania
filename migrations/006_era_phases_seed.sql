-- ============================================================================
-- Migration 006: Named era phases across the 1000-year span
-- ============================================================================
-- These are a first draft — reword/retheme freely once the mission
-- statement content is written (you flagged you'll rework things then).
-- The mechanics (offsets, open-ended final phase) are what matters for the
-- /api/tribe/overview calculation; names and descriptions are easy to
-- change later with a simple update, no migration needed for wording edits.

insert into tribe_era_phases (name, start_year_offset, end_year_offset, description, display_order) values
  ('Founding Era', 0, 25,
   'The founder and first generation establish Yorubania''s identity, structures, and earliest members.',
   1),
  ('Root-Laying Era', 25, 75,
   'The council, vaults, and archive become established practice, independent of any single founder.',
   2),
  ('Expansion Era', 75, 150,
   'Active growth beyond the founding families; the tribe welcomes members connected by choice, not only blood.',
   3),
  ('Consolidation Era', 150, 250,
   'Governance and culture become fully self-sustaining across generations that never knew the founding era firsthand.',
   4),
  ('Renewal Era', 250, 400,
   'Archival formats and platforms are actively migrated forward; the tribe revisits and renews its founding narrative.',
   5),
  ('Continuity Era', 400, 600,
   'Yorubania stands as an established, permanent culture with deep institutional memory.',
   6),
  ('Reflection Era', 600, 800,
   'A deliberate season of historical review — celebrating centuries of preserved identity and adding to the founding record.',
   7),
  ('Approach Era', 800, 950,
   'Active preparation for the millennium milestone; deliberate re-verification of archival integrity across all records.',
   8),
  ('Millennial Threshold', 950, 1000,
   'The final approach to Yorubania''s thousand-year milestone.',
   9),
  ('The Next Thousand', 1000, null,
   'Beyond the first millennium — its character to be defined by the generations who reach it.',
   10)
on conflict do nothing;
