-- ============================================================================
-- Migration 003: get_relationship_path()
-- ============================================================================
-- Bounded BFS over the relationships graph, used by the authorization
-- module (src/auth/authorization.ts) to classify how two people are
-- related and how many generations apart they are. Depth-limited to avoid
-- runaway queries on large family trees; 4 hops comfortably covers
-- sibling/grandparent/grandchild-level defaults (Section 5.0) without
-- scanning the whole graph on every access check.
--
-- Returns at most one row (the shortest classified relationship found).
-- An empty result means "no relationship found within max_depth" — callers
-- should treat that as "unrelated" for default-visibility purposes, not as
-- an error.
-- ============================================================================

create or replace function get_relationship_path(
  from_account_id uuid,
  to_person_id uuid,
  max_depth int default 4
)
returns table(rel_type text, generation_distance int)
language plpgsql
stable
as $$
declare
  from_person_id uuid;
begin
  select id into from_person_id from persons where account_id = from_account_id limit 1;

  if from_person_id is null or from_person_id = to_person_id then
    return query select 'self'::text, 0;
    return;
  end if;

  return query
  with recursive walk(person_id, depth, up_steps, down_steps, path_types) as (
    select from_person_id, 0, 0, 0, array[]::text[]

    union all

    select
      case when r.person_a_id = walk.person_id then r.person_b_id else r.person_a_id end,
      walk.depth + 1,
      walk.up_steps + case
        when r.relationship_type = 'parent_child' and r.person_b_id = walk.person_id then 1
        else 0
      end,
      walk.down_steps + case
        when r.relationship_type = 'parent_child' and r.person_a_id = walk.person_id then 1
        else 0
      end,
      walk.path_types || r.relationship_type::text
    from relationships r
    join walk on r.person_a_id = walk.person_id or r.person_b_id = walk.person_id
    where walk.depth < max_depth
  )
  select
    case
      when up_steps = 1 and down_steps = 0 and depth = 1 then 'parent'
      when down_steps = 1 and up_steps = 0 and depth = 1 then 'child'
      when up_steps = 0 and down_steps = 0 and depth = 1 then 'sibling_or_spouse'
      when up_steps = 2 and down_steps = 0 then 'grandparent'
      when down_steps = 2 and up_steps = 0 then 'grandchild'
      when up_steps = 1 and down_steps = 1 then 'sibling_lineage' -- e.g. sibling's child
      else 'other'
    end,
    depth
  from walk
  where person_id = to_person_id
  order by depth asc
  limit 1;
end;
$$;
