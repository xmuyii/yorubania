import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

const RESTRICTION_TYPES = ["vault_access", "add_relationships", "update_account", "view_others"];

/**
 * Used by other route files (vault.ts, invite.ts, profile.ts, and the
 * authorization module for 'view_others') to check whether an account is
 * currently restricted from a given action by the punisher. Exported as a
 * standalone function rather than attached to the router, since Express
 * Router objects can't cleanly carry extra typed properties.
 */
export async function isRestricted(
  supabaseAdmin: SupabaseClient,
  accountId: string,
  restrictionType: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("account_restrictions")
    .select("id")
    .eq("account_id", accountId)
    .eq("restriction_type", restrictionType)
    .is("lifted_at", null)
    .gt("ends_at", new Date().toISOString())
    .maybeSingle();
  return !!data;
}

export function enforcementRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  async function getSetting(key: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from("tribe_settings").select("value").eq("key", key).maybeSingle();
    return data?.value ? JSON.parse(data.value as string) : null;
  }

  async function requirePunisher(req: any, res: any, next: any) {
    const punisherId = await getSetting("punisher_account_id");
    if (!punisherId || punisherId !== req.auth!.accountId) {
      return res.status(403).json({ error: "only the designated punisher may take this action" });
    }
    next();
  }

  async function requireRewarder(req: any, res: any, next: any) {
    const rewarderId = await getSetting("rewarder_account_id");
    if (!rewarderId || rewarderId !== req.auth!.accountId) {
      return res.status(403).json({ error: "only the designated rewarder may take this action" });
    }
    next();
  }

  // --------------------------------------------------------------------
  // Superadmin designates punisher (must currently hold a 4-year/cohort B
  // council seat) and rewarder (cannot be the same account as punisher).
  // --------------------------------------------------------------------
  router.put("/admin/punisher", requireAuth(supabaseAdmin), requireRole("superadmin"), async (req, res) => {
    const { accountId } = req.body ?? {};
    if (!accountId) return res.status(400).json({ error: "accountId is required" });

    const { data: term } = await supabaseAdmin
      .from("council_terms")
      .select("seat_number, council_seats!inner(cohort)")
      .eq("account_id", accountId)
      .is("term_end", null)
      .maybeSingle();
    const cohort = (term as any)?.council_seats?.cohort;
    if (cohort !== "B") {
      return res.status(422).json({
        error: "the punisher must currently hold one of the 4-year council seats (cohort B, seats 4-7)",
      });
    }

    await supabaseAdmin.from("tribe_settings").upsert({ key: "punisher_account_id", value: JSON.stringify(accountId) });
    return res.json({ punisherAccountId: accountId });
  });

  router.put("/admin/rewarder", requireAuth(supabaseAdmin), requireRole("superadmin"), async (req, res) => {
    const { accountId } = req.body ?? {};
    if (!accountId) return res.status(400).json({ error: "accountId is required" });

    const punisherId = await getSetting("punisher_account_id");
    if (accountId === punisherId) {
      return res.status(422).json({ error: "the rewarder cannot be the same account as the punisher" });
    }

    await supabaseAdmin.from("tribe_settings").upsert({ key: "rewarder_account_id", value: JSON.stringify(accountId) });
    return res.json({ rewarderAccountId: accountId });
  });

  // --------------------------------------------------------------------
  // Restrictions: action-level, time-bounded, never blocks login itself.
  // The punisher's own remaining council term caps how far ends_at can be
  // set — checked here, not left to trust.
  // --------------------------------------------------------------------
  router.post("/admin/restrictions", requireAuth(supabaseAdmin), requirePunisher, async (req, res) => {
    const { accountId, restrictionType, reason, endsAt } = req.body ?? {};
    if (!accountId || !RESTRICTION_TYPES.includes(restrictionType) || !reason || !endsAt) {
      return res.status(400).json({
        error: `accountId, restrictionType (${RESTRICTION_TYPES.join("|")}), reason, and endsAt are required`,
      });
    }

    const { data: term } = await supabaseAdmin
      .from("council_terms")
      .select("term_expected_end")
      .eq("account_id", req.auth!.accountId)
      .is("term_end", null)
      .maybeSingle();
    if (term?.term_expected_end && new Date(endsAt) > new Date(term.term_expected_end)) {
      return res.status(422).json({ error: "a restriction cannot outlast the punisher's own council term" });
    }

    const { data, error } = await supabaseAdmin
      .from("account_restrictions")
      .insert({
        account_id: accountId,
        restriction_type: restrictionType,
        imposed_by_account_id: req.auth!.accountId,
        reason,
        ends_at: endsAt,
      })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to impose restriction" });
    return res.status(201).json(data);
  });

  // The rewarder can end an active restriction early — cannot touch
  // deletion proposals, only ordinary restrictions.
  router.post("/admin/restrictions/:id/lift-early", requireAuth(supabaseAdmin), requireRewarder, async (req, res) => {
    const { error } = await supabaseAdmin
      .from("account_restrictions")
      .update({ lifted_early_by_account_id: req.auth!.accountId, lifted_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .is("lifted_at", null);
    if (error) return res.status(500).json({ error: "failed to lift restriction" });
    return res.json({ ok: true });
  });

  router.get(
    "/admin/restrictions",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (_req, res) => {
      const { data, error } = await supabaseAdmin
        .from("account_restrictions")
        .select("id, account_id, restriction_type, reason, starts_at, ends_at, lifted_at")
        .order("starts_at", { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: "failed to fetch restrictions" });
      return res.json({ restrictions: data ?? [] });
    }
  );

  // --------------------------------------------------------------------
  // Deletion — the heaviest punishment. Requires council-majority approval
  // AND a living superadmin's explicit approval, even if the punisher
  // initiated it. The voting window is the offender's time to appeal.
  // --------------------------------------------------------------------
  router.post("/admin/deletion-proposals", requireAuth(supabaseAdmin), requirePunisher, async (req, res) => {
    const { accountId, reason, votingDeadline } = req.body ?? {};
    if (!accountId || !reason || !votingDeadline) {
      return res.status(400).json({ error: "accountId, reason, and votingDeadline are required" });
    }
    const { data, error } = await supabaseAdmin
      .from("account_deletion_proposals")
      .insert({
        target_account_id: accountId,
        proposed_by_account_id: req.auth!.accountId,
        reason,
        voting_deadline: votingDeadline,
      })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to open deletion proposal" });

    await supabaseAdmin.from("tribe_announcements").insert({
      title: "A deletion has been proposed",
      body: `A council-and-superadmin vote is now open, closing ${votingDeadline}. This is the affected member's window to contact the council or superadmin directly.`,
      posted_by_account_id: req.auth!.accountId,
      pinned: true,
    });

    return res.status(201).json(data);
  });

  router.post("/admin/deletion-proposals/:id/vote", requireAuth(supabaseAdmin), async (req, res) => {
    const { vote } = req.body ?? {};
    if (!["approve", "reject"].includes(vote)) {
      return res.status(400).json({ error: "vote must be approve or reject" });
    }

    const { data: onCouncil } = await supabaseAdmin
      .from("council_terms")
      .select("account_id")
      .eq("account_id", req.auth!.accountId)
      .is("term_end", null)
      .maybeSingle();
    if (!onCouncil && req.auth!.role !== "superadmin") {
      return res.status(403).json({ error: "only current council members or the superadmin may vote on deletion" });
    }

    const { error } = await supabaseAdmin
      .from("account_deletion_votes")
      .upsert(
        { proposal_id: req.params.id, voter_account_id: req.auth!.accountId, vote },
        { onConflict: "proposal_id,voter_account_id" }
      );
    if (error) return res.status(500).json({ error: "failed to record vote" });
    return res.status(201).json({ ok: true });
  });

  router.post(
    "/admin/deletion-proposals/:id/resolve",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { data: proposal } = await supabaseAdmin
        .from("account_deletion_proposals")
        .select("id, status, target_account_id")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      if (proposal.status !== "voting") return res.status(409).json({ error: "proposal is not open for voting" });

      const { data: votes } = await supabaseAdmin
        .from("account_deletion_votes")
        .select("voter_account_id, vote")
        .eq("proposal_id", proposal.id);

      const approvals = (votes ?? []).filter((v) => v.vote === "approve").length;
      const rejections = (votes ?? []).filter((v) => v.vote === "reject").length;
      const councilMajority = approvals > rejections;

      // A living superadmin's vote is required and effectively a veto —
      // their explicit approval is needed regardless of council tally.
      const { data: livingSuperadmins } = await supabaseAdmin.from("accounts").select("id").eq("role", "superadmin");
      let superadminApproved = true;
      if (livingSuperadmins && livingSuperadmins.length > 0) {
        const superadminVotes = (votes ?? []).filter((v) =>
          livingSuperadmins.some((s) => s.id === v.voter_account_id)
        );
        superadminApproved = superadminVotes.length > 0 && superadminVotes.every((v) => v.vote === "approve");
      }

      const approved = councilMajority && superadminApproved;

      await supabaseAdmin
        .from("account_deletion_proposals")
        .update({ status: approved ? "approved" : "rejected", resolved_at: new Date().toISOString() })
        .eq("id", proposal.id);

      if (approved) {
        await supabaseAdmin
          .from("accounts")
          .update({
            suspended_at: new Date().toISOString(),
            suspended_reason: "deletion approved by council + superadmin vote",
          })
          .eq("id", proposal.target_account_id);
      }

      return res.json({ approved, approvals, rejections, superadminApproved });
    }
  );

  return router;
}
