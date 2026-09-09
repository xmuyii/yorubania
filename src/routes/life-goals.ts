import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * Entirely private while the person is alive — not even visible to this
 * endpoint's own caller viewing someone else, since there's no route here
 * that accepts a personId other than "me". Nobody can build a request
 * that reads another living person's goals through this file. What
 * happens to them on death (auto-transcribed into a specially-scoped
 * chapter, descendant-only) is handled in death.ts's processDeath().
 */
export function lifeGoalsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/persons/me/life-goals", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data, error } = await supabaseAdmin
      .from("life_goals")
      .select("goal_number, description, achieved, achieved_at")
      .eq("person_id", person.id)
      .order("goal_number", { ascending: true });
    if (error) return res.status(500).json({ error: "failed to fetch life goals" });
    return res.json({ goals: data ?? [] });
  });

  router.put("/persons/me/life-goals", requireAuth(supabaseAdmin), async (req, res) => {
    const { goals } = req.body ?? {};
    if (!Array.isArray(goals) || goals.length === 0 || goals.length > 3) {
      return res.status(400).json({ error: "goals must be an array of 1-3 entries" });
    }

    const person = (
      await supabaseAdmin.from("persons").select("id").eq("account_id", req.auth!.accountId).maybeSingle()
    ).data;
    if (!person) return res.status(400).json({ error: "no linked person record" });

    for (const g of goals) {
      if (!g.goalNumber || g.goalNumber < 1 || g.goalNumber > 3 || !g.description) {
        return res.status(400).json({ error: "each goal needs goalNumber (1-3) and description" });
      }
    }

    const rows = goals.map((g: any) => ({
      person_id: person.id,
      goal_number: g.goalNumber,
      description: g.description,
      achieved: !!g.achieved,
      achieved_at: g.achieved ? (g.achievedAt ?? new Date().toISOString().slice(0, 10)) : null,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from("life_goals")
      .upsert(rows, { onConflict: "person_id,goal_number" });
    if (error) return res.status(500).json({ error: "failed to save life goals" });
    return res.json({ ok: true });
  });

  return router;
}
