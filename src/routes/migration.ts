import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

/**
 * "Migration" here means inclusion in the durable archival/offline copy
 * with format re-verification — NOT moving to a different platform. See
 * spec discussion: this exists so Yorubania's memory doesn't depend on
 * any single company (Supabase, Railway) staying in business forever, and
 * so file formats get re-verified as usable before they quietly rot.
 */
export function migrationRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.post(
    "/admin/migration-cycles",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { opensAt, decisionDeadline } = req.body ?? {};
      if (!opensAt || !decisionDeadline) {
        return res.status(400).json({ error: "opensAt and decisionDeadline are required" });
      }
      const { data, error } = await supabaseAdmin
        .from("migration_cycles")
        .insert({ opens_at: opensAt, decision_deadline: decisionDeadline, status: "scheduled" })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to schedule migration cycle" });

      await supabaseAdmin.from("tribe_announcements").insert({
        title: "Ten-year archival migration scheduled",
        body: `A whole-system archival migration is scheduled. The decision window opens ${opensAt} and closes ${decisionDeadline}. This preserves items against format obsolescence and platform risk — it does not move your account anywhere. You'll be able to choose which of your items to include, or decline until the next cycle.`,
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.status(201).json(data);
    }
  );

  router.post(
    "/admin/migration-cycles/:id/open",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { error } = await supabaseAdmin
        .from("migration_cycles")
        .update({ status: "decisions_open" })
        .eq("id", req.params.id);
      if (error) return res.status(500).json({ error: "failed to open decision window" });

      await supabaseAdmin.from("tribe_announcements").insert({
        title: "Migration decision window is open",
        body: "You can now choose whether to include your items in this cycle's archival migration, or decline until the next one. Go to Migration in your account to decide.",
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });
      return res.json({ ok: true });
    }
  );

  // Countdown/status for every member's dashboard.
  router.get("/tribe/migration-status", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: cycle } = await supabaseAdmin
      .from("migration_cycles")
      .select("id, opens_at, decision_deadline, status")
      .in("status", ["scheduled", "decisions_open"])
      .order("decision_deadline", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!cycle) return res.json({ cycle: null });

    const { data: myDecision } = await supabaseAdmin
      .from("migration_decisions")
      .select("decision")
      .eq("cycle_id", cycle.id)
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();

    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(cycle.decision_deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    );

    return res.json({
      cycle,
      daysRemaining,
      myDecision: myDecision?.decision ?? "pending",
    });
  });

  router.post("/migration-cycles/:id/decision", requireAuth(supabaseAdmin), async (req, res) => {
    const { decision } = req.body ?? {};
    if (!["migrate", "decline"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'migrate' or 'decline'" });
    }
    const { error } = await supabaseAdmin.from("migration_decisions").upsert({
      cycle_id: req.params.id,
      account_id: req.auth!.accountId,
      decision,
      decided_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: "failed to record decision" });
    return res.json({ ok: true });
  });

  // Add/remove specific items from the migration set — either for a
  // whole-system cycle (cycleId given) or an individual on-demand
  // migration (no cycleId — a member can preserve something anytime,
  // without waiting for the 10-year cycle).
  router.post("/migration/selections", requireAuth(supabaseAdmin), async (req, res) => {
    const { cycleId, itemType, itemId } = req.body ?? {};
    if (!["media", "vault_item"].includes(itemType) || !itemId) {
      return res.status(400).json({ error: "itemType ('media'|'vault_item') and itemId are required" });
    }
    const { error } = await supabaseAdmin.from("migration_item_selections").insert({
      cycle_id: cycleId ?? null,
      account_id: req.auth!.accountId,
      item_type: itemType,
      item_id: itemId,
    });
    if (error) return res.status(500).json({ error: "failed to add selection" });
    return res.status(201).json({ ok: true });
  });

  router.delete("/migration/selections/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { error } = await supabaseAdmin
      .from("migration_item_selections")
      .delete()
      .eq("id", req.params.id)
      .eq("account_id", req.auth!.accountId);
    if (error) return res.status(500).json({ error: "failed to remove selection" });
    return res.status(204).send();
  });

  router.get("/migration/selections", requireAuth(supabaseAdmin), async (req, res) => {
    const cycleId = (req.query.cycleId as string) ?? null;
    let query = supabaseAdmin
      .from("migration_item_selections")
      .select("id, item_type, item_id, created_at")
      .eq("account_id", req.auth!.accountId);
    query = cycleId ? query.eq("cycle_id", cycleId) : query.is("cycle_id", null);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: "failed to fetch selections" });
    return res.json({ selections: data ?? [] });
  });

  return router;
}
