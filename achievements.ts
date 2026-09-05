import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

export function achievementsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/tribe/achievements", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("community_achievements")
      .select("id, account_id, title, description, achieved_date, posted_at")
      .eq("status", "published")
      .order("posted_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: "failed to fetch achievements" });
    return res.json({ achievements: data ?? [] });
  });

  // v1: a member may only post about themselves — extending this to let
  // someone post on a relative's behalf (e.g. a parent sharing a child's
  // achievement) is a reasonable future addition, deliberately left out
  // for now to avoid the moderation questions that come with it.
  router.post("/tribe/achievements", requireAuth(supabaseAdmin), async (req, res) => {
    const { title, description, achievedDate } = req.body ?? {};
    if (!title) return res.status(400).json({ error: "title is required" });

    const { data, error } = await supabaseAdmin
      .from("community_achievements")
      .insert({
        account_id: req.auth!.accountId,
        posted_by_account_id: req.auth!.accountId,
        title,
        description,
        achieved_date: achievedDate ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to post achievement" });
    return res.status(201).json(data);
  });

  return router;
}
