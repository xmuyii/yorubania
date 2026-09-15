import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * The system never infers whether a relationship "still exists" from
 * access patterns — that would be unreliable and strange. It's a plain
 * declarative field either party can set. Ending a relationship stops NEW
 * default grants from being created (see supabase-graph-adapter.ts's
 * status filter), but does NOT revoke grants already made — that stays
 * governed by the existing "only the original grantor can revoke" rule.
 */
export function relationshipStatusRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.patch("/relationships/:id/end", requireAuth(supabaseAdmin), async (req, res) => {
    const { endReason, endedAt } = req.body ?? {};

    const { data: relationship } = await supabaseAdmin
      .from("relationships")
      .select("id, person_a_id, person_b_id, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!relationship) return res.status(404).json({ error: "relationship not found" });
    if (relationship.status === "ended") return res.status(409).json({ error: "already marked ended" });

    const { data: myPerson } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    const isParty = myPerson?.id === relationship.person_a_id || myPerson?.id === relationship.person_b_id;
    if (!isParty) return res.status(403).json({ error: "only a party to this relationship may end it" });

    const { error } = await supabaseAdmin
      .from("relationships")
      .update({
        status: "ended",
        ended_at: endedAt ?? new Date().toISOString().slice(0, 10),
        end_reason: endReason ?? null,
      })
      .eq("id", relationship.id);
    if (error) return res.status(500).json({ error: "failed to update relationship" });
    return res.json({ ok: true });
  });

  return router;
}
