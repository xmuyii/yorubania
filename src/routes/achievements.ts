import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

export function achievementsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/tribe/achievements", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("community_achievements")
      .select(
        "id, account_id, title, description, achieved_date, posted_at, posted_by_account_id"
      )
      .eq("status", "published")
      .order("posted_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: "failed to fetch achievements" });

    // Attach the subject's display name so the frontend doesn't need a
    // second round trip per achievement.
    const accountIds = [...new Set((data ?? []).map((a) => a.account_id))];
    const { data: persons } = await supabaseAdmin
      .from("persons")
      .select("account_id, full_name")
      .in("account_id", accountIds);
    const nameByAccount = new Map((persons ?? []).map((p) => [p.account_id, p.full_name]));

    return res.json({
      achievements: (data ?? []).map((a) => ({
        ...a,
        subjectFullName: nameByAccount.get(a.account_id) ?? null,
      })),
    });
  });

  // DECISION: achievements are logged by admins/superadmins on a member's
  // behalf, not self-posted. This spreads the responsibility across every
  // admin account rather than requiring the founder personally to record
  // everyone's accomplishments.
  router.post(
    "/tribe/achievements",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { accountId, title, description, achievedDate } = req.body ?? {};
      if (!accountId || !title) {
        return res.status(400).json({ error: "accountId and title are required" });
      }

      const { data: targetAccount } = await supabaseAdmin
        .from("accounts")
        .select("id, directory_visible")
        .eq("id", accountId)
        .maybeSingle();
      if (!targetAccount) return res.status(404).json({ error: "account not found" });
      if (!targetAccount.directory_visible) {
        return res.status(422).json({
          error: "this member must opt into the member directory before an achievement can be recorded for them",
        });
      }

      const { data, error } = await supabaseAdmin
        .from("community_achievements")
        .insert({
          account_id: accountId,
          posted_by_account_id: req.auth!.accountId,
          title,
          description,
          achieved_date: achievedDate ?? null,
        })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to post achievement" });
      return res.status(201).json(data);
    }
  );

  return router;
}
