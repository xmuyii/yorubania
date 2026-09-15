import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole, requireCouncilMembership } from "../middleware/auth-context";

export function superadminRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // Voluntary retirement handoff — the current superadmin chooses their
  // successor directly. Requires the target to already be a member of the
  // system (any account); does not require them to already be admin.
  router.post(
    "/admin/superadmin/transfer",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { newSuperadminAccountId, note } = req.body ?? {};
      if (!newSuperadminAccountId) return res.status(400).json({ error: "newSuperadminAccountId is required" });

      const { data: target } = await supabaseAdmin
        .from("accounts")
        .select("id")
        .eq("id", newSuperadminAccountId)
        .maybeSingle();
      if (!target) return res.status(404).json({ error: "account not found" });

      await supabaseAdmin.from("accounts").update({ role: "admin" }).eq("id", req.auth!.accountId);
      await supabaseAdmin.from("accounts").update({ role: "superadmin" }).eq("id", newSuperadminAccountId);
      await supabaseAdmin.from("superadmin_transitions").insert({
        previous_account_id: req.auth!.accountId,
        new_account_id: newSuperadminAccountId,
        method: "manual_transfer",
        note: note ?? null,
      });

      await supabaseAdmin.from("tribe_announcements").insert({
        title: "Superadmin transition",
        body: "Leadership of Yorubania's founding seat has been transferred, per the founder's own decision.",
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.json({ ok: true });
    }
  );

  // Called from death.ts's processDeath() when the deceased was superadmin
  // and had no designated successor — opens a council-only election.
  router.post(
    "/admin/superadmin-elections/:id/vote",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { candidateAccountId } = req.body ?? {};
      if (!candidateAccountId) return res.status(400).json({ error: "candidateAccountId is required" });
      const { error } = await supabaseAdmin.from("superadmin_election_votes").upsert(
        { election_id: req.params.id, voter_account_id: req.auth!.accountId, candidate_account_id: candidateAccountId },
        { onConflict: "election_id,voter_account_id" }
      );
      if (error) return res.status(500).json({ error: "failed to record vote" });
      return res.status(201).json({ ok: true });
    }
  );

  router.post(
    "/admin/superadmin-elections/:id/resolve",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { data: election } = await supabaseAdmin
        .from("superadmin_elections")
        .select("id, status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!election || election.status !== "open") return res.status(409).json({ error: "election not open" });

      const { data: votes } = await supabaseAdmin
        .from("superadmin_election_votes")
        .select("candidate_account_id")
        .eq("election_id", election.id);
      if (!votes || votes.length === 0) return res.status(422).json({ error: "no votes cast" });

      const tally = new Map<string, number>();
      for (const v of votes) tally.set(v.candidate_account_id, (tally.get(v.candidate_account_id) ?? 0) + 1);
      const winnerAccountId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

      await supabaseAdmin.from("accounts").update({ role: "superadmin" }).eq("id", winnerAccountId);
      await supabaseAdmin
        .from("superadmin_elections")
        .update({ status: "resolved", resolved_account_id: winnerAccountId, resolved_at: new Date().toISOString() })
        .eq("id", election.id);
      await supabaseAdmin.from("superadmin_transitions").insert({
        previous_account_id: null,
        new_account_id: winnerAccountId,
        method: "council_election",
      });

      await supabaseAdmin.from("tribe_announcements").insert({
        title: "A new superadmin has been elected",
        body: "The council has resolved the superadmin election following the founder's passing.",
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.json({ winnerAccountId });
    }
  );

  return router;
}
