import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * Returns the STRUCTURE of a family tree (who's connected to whom, names,
 * photos) — never content. This is deliberately more open than the
 * AccessGrant-gated content system (media, achievements, etc.): a
 * grandchild can see the *lines* connecting them to a great-grandparent
 * even if they don't have a content-visibility grant for that ancestor,
 * matching "tracing your ancestry" as a stated goal of the platform.
 * Actual uploaded media/vault content is fetched separately (media.ts,
 * vault.ts) and remains governed by canAccess()/account ownership as
 * before — this endpoint never returns file contents, only who exists and
 * how they're related.
 */
export function familyTreeRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const MAX_DEPTH = 6; // generations up/down from the root, each direction

  router.get("/persons/:personId/tree", requireAuth(supabaseAdmin), async (req, res) => {
    const rootId = req.params.personId;

    const { data: rootPerson } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("id", rootId)
      .maybeSingle();
    if (!rootPerson) return res.status(404).json({ error: "person not found" });

    const visited = new Set<string>([rootId]);
    const edges: { from: string; to: string; type: string }[] = [];
    const generation = new Map<string, number>([[rootId, 0]]);

    // Walk ancestors (parents, grandparents, ...) up to MAX_DEPTH.
    let frontier = [rootId];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
      const { data: parentEdges } = await supabaseAdmin
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "parent_child")
        .in("person_b_id", frontier);
      const nextFrontier: string[] = [];
      for (const edge of parentEdges ?? []) {
        edges.push({ from: edge.person_a_id, to: edge.person_b_id, type: "parent_child" });
        if (!visited.has(edge.person_a_id)) {
          visited.add(edge.person_a_id);
          generation.set(edge.person_a_id, -depth);
          nextFrontier.push(edge.person_a_id);
        }
      }
      frontier = nextFrontier;
    }

    // Walk descendants (children, grandchildren, ...) down to MAX_DEPTH.
    frontier = [rootId];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
      const { data: childEdges } = await supabaseAdmin
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "parent_child")
        .in("person_a_id", frontier);
      const nextFrontier: string[] = [];
      for (const edge of childEdges ?? []) {
        edges.push({ from: edge.person_a_id, to: edge.person_b_id, type: "parent_child" });
        if (!visited.has(edge.person_b_id)) {
          visited.add(edge.person_b_id);
          generation.set(edge.person_b_id, depth);
          nextFrontier.push(edge.person_b_id);
        }
      }
      frontier = nextFrontier;
    }

    // Pull in siblings and spouses of everyone found so far (same
    // generation, doesn't extend the walk further).
    const currentIds = [...visited];
    const orFilter = currentIds.map((id) => `person_a_id.eq.${id},person_b_id.eq.${id}`).join(",");

    const { data: siblingEdges } = await supabaseAdmin
      .from("relationships")
      .select("person_a_id, person_b_id")
      .eq("relationship_type", "sibling")
      .or(orFilter);
    for (const edge of siblingEdges ?? []) {
      edges.push({ from: edge.person_a_id, to: edge.person_b_id, type: "sibling" });
      const knownGen = generation.get(edge.person_a_id) ?? generation.get(edge.person_b_id) ?? 0;
      for (const id of [edge.person_a_id, edge.person_b_id]) {
        if (!visited.has(id)) {
          visited.add(id);
          generation.set(id, knownGen);
        }
      }
    }

    const { data: spouseEdges } = await supabaseAdmin
      .from("relationships")
      .select("person_a_id, person_b_id")
      .eq("relationship_type", "spouse")
      .or(orFilter);
    for (const edge of spouseEdges ?? []) {
      edges.push({ from: edge.person_a_id, to: edge.person_b_id, type: "spouse" });
      const knownGen = generation.get(edge.person_a_id) ?? generation.get(edge.person_b_id) ?? 0;
      for (const id of [edge.person_a_id, edge.person_b_id]) {
        if (!visited.has(id)) {
          visited.add(id);
          generation.set(id, knownGen);
        }
      }
    }

    const { data: persons } = await supabaseAdmin
      .from("persons")
      .select("id, full_name, profile_image_media_id, is_deceased")
      .in("id", [...visited]);

    const nodes = (persons ?? []).map((p) => ({
      id: p.id,
      fullName: p.full_name,
      profileImageMediaId: p.profile_image_media_id,
      isDeceased: p.is_deceased,
      generation: generation.get(p.id) ?? 0,
    }));

    return res.json({ rootPersonId: rootId, nodes, edges });
  });

  return router;
}
