-- ============================================================================
-- Migration 016: Life Goals — private during life, descendant-only after death
-- ============================================================================

create table life_goals (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references persons(id),
  goal_number int not null check (goal_number between 1 and 3),
  description text not null,
  achieved boolean not null default false,
  achieved_at date,
  updated_at timestamptz not null default now(),
  unique (person_id, goal_number)
);

-- Distinguishes the auto-generated posthumous "Life Goals" chapter from
-- ordinary chapters, so it can be gated more strictly than regular
-- biography content — visible only to actual descendants (via the
-- ancestor-default rule), never via a general 'biography'/'full_record'
-- grant a spouse, sibling, or parent might otherwise hold.
alter table biography_chapters
  add column chapter_type text not null default 'chapter'
  check (chapter_type in ('chapter', 'life_goals'));
