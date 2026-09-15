import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireCouncilMembership } from "../middleware/auth-context";
import { checkCouncilEligibility } from "../governance/council-eligibility";

export function councilRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // Anyone can see who's currently on the council and when their seat is
  // next up — transparency is one of the anti-oligarchy safeguards itself.
  router.get("/council", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data: currentTerms, error } = await supabaseAdmin
      .from("council_terms")
      .select("seat_number, account_id, term_start, term_expected_end, elected_via")
      .is("term_end", null)
      .order("seat_number", { ascending: true });
    if (error) return res.status(500).json({ error: "failed to fetch council" });

    const { data: seats } = await supabaseAdmin
      .from("council_seats")
      .select("seat_number, cohort, term_length_years")
      .order("seat_number", { ascending: true });

    return res.json({
      seats: (seats ?? []).map((seat) => ({
        ...seat,
        occupant: (currentTerms ?? []).find((t) => t.seat_number === seat.seat_number) ?? null,
      })),
    });
  });

  // Opening an election is currently council-only — any sitting member can
  // trigger a seat's election when it comes up, rather than this requiring
  // a single administrator. Scheduling WHEN a seat comes up (the 9-year /
  // 4-year staggered cadence, per seat) is intentionally left to whoever
  // operates the platform to trigger — no automatic cron is assumed here yet.
  router.post(
    "/council/elections",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { seatNumber, opensAt, closesAt } = req.body ?? {};
      if (!seatNumber || !opensAt || !closesAt) {
        return res.status(400).json({ error: "seatNumber, opensAt, closesAt are required" });
      }

      const { data: openExisting } = await supabaseAdmin
        .from("council_elections")
        .select("id")
        .eq("seat_number", seatNumber)
        .eq("status", "open")
        .maybeSingle();
      if (openExisting) {
        return res.status(409).json({ error: "an election for this seat is already open" });
      }

      const { data: election, error } = await supabaseAdmin
        .from("council_elections")
        .insert({ seat_number: seatNumber, opens_at: opensAt, closes_at: closesAt, status: "open" })
        .select("id")
        .single();
      if (error || !election) return res.status(500).json({ error: "failed to open election" });

      // Every election gets announced through the general news feed —
      // members shouldn't have to go looking for election dates.
      await supabaseAdmin.from("tribe_announcements").insert({
        title: `Council election open — Seat ${seatNumber}`,
        body: `Nominations and voting for Council Seat ${seatNumber} are open from ${opensAt} until ${closesAt}. Any member may nominate a candidate, and every member gets one vote.`,
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.status(201).json(election);
    }
  );

  // Any member may nominate any other member (or themselves) — nominating
  // is open, not restricted to the council, so the pool of candidates isn't
  // itself controlled by the incumbents.
  router.post(
    "/council/elections/:electionId/nominate",
    requireAuth(supabaseAdmin),
    async (req, res) => {
      const { nomineeAccountId } = req.body ?? {};
      if (!nomineeAccountId) return res.status(400).json({ error: "nomineeAccountId is required" });

      const { data: nomineeAccount } = await supabaseAdmin
        .from("accounts")
        .select("directory_visible")
        .eq("id", nomineeAccountId)
        .single();
      if (!nomineeAccount?.directory_visible) {
        return res.status(422).json({
          error: "the nominee must be opted into the member directory to contest for a seat",
        });
      }

      const { data: election } = await supabaseAdmin
        .from("council_elections")
        .select("id, seat_number, status")
        .eq("id", req.params.electionId)
        .maybeSingle();
      if (!election || election.status !== "open") {
        return res.status(404).json({ error: "election not found or not open" });
      }

      const eligibility = await checkCouncilEligibility(supabaseAdmin, nomineeAccountId, election.seat_number);
      if (!eligibility.eligible) {
        return res.status(422).json({ error: "nominee not eligible", reason: eligibility.reason });
      }

      const { error } = await supabaseAdmin.from("council_election_nominations").insert({
        election_id: election.id,
        nominee_account_id: nomineeAccountId,
        nominated_by_account_id: req.auth!.accountId,
      });
      if (error) return res.status(500).json({ error: "failed to record nomination (already nominated?)" });
      return res.status(201).json({ ok: true });
    }
  );

  // Tribe-wide vote — every member gets one vote per election, deliberately
  // NOT restricted to any family/branch, per the "general election, not
  // family representatives" decision.
  router.post("/council/elections/:electionId/vote", requireAuth(supabaseAdmin), async (req, res) => {
    const { candidateAccountId } = req.body ?? {};
    if (!candidateAccountId) return res.status(400).json({ error: "candidateAccountId is required" });

    const { data: voterAccount } = await supabaseAdmin
      .from("accounts")
      .select("directory_visible")
      .eq("id", req.auth!.accountId)
      .single();
    if (!voterAccount?.directory_visible) {
      return res.status(403).json({
        error: "you must opt into the member directory before you can vote (see Settings)",
      });
    }

    const { data: election } = await supabaseAdmin
      .from("council_elections")
      .select("id, status")
      .eq("id", req.params.electionId)
      .maybeSingle();
    if (!election || election.status !== "open") {
      return res.status(404).json({ error: "election not found or not open" });
    }

    const { data: nomination } = await supabaseAdmin
      .from("council_election_nominations")
      .select("id")
      .eq("election_id", election.id)
      .eq("nominee_account_id", candidateAccountId)
      .maybeSingle();
    if (!nomination) {
      return res.status(422).json({ error: "candidate was not nominated for this election" });
    }

    const { error } = await supabaseAdmin.from("council_election_votes").insert({
      election_id: election.id,
      voter_account_id: req.auth!.accountId,
      candidate_account_id: candidateAccountId,
    });
    if (error) return res.status(500).json({ error: "failed to record vote (already voted?)" });
    return res.status(201).json({ ok: true });
  });

  // Closes an election, tallies votes, re-checks eligibility on the winner
  // (in case a relevant relationship or another term was recorded during
  // the voting window), and installs them into the seat.
  router.post(
    "/council/elections/:electionId/resolve",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { data: election } = await supabaseAdmin
        .from("council_elections")
        .select("id, seat_number, status")
        .eq("id", req.params.electionId)
        .maybeSingle();
      if (!election || election.status !== "open") {
        return res.status(404).json({ error: "election not found or not open" });
      }

      const { data: votes } = await supabaseAdmin
        .from("council_election_votes")
        .select("candidate_account_id")
        .eq("election_id", election.id);

      if (!votes || votes.length === 0) {
        return res.status(422).json({ error: "no votes cast — cannot resolve" });
      }

      const tally = new Map<string, number>();
      for (const v of votes) {
        tally.set(v.candidate_account_id, (tally.get(v.candidate_account_id) ?? 0) + 1);
      }
      const winnerAccountId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

      const finalCheck = await checkCouncilEligibility(supabaseAdmin, winnerAccountId, election.seat_number);
      if (!finalCheck.eligible) {
        return res.status(422).json({
          error: "winner is no longer eligible — election cannot be resolved automatically",
          reason: finalCheck.reason,
        });
      }

      // Close out the previous occupant of this seat, if any.
      const termStart = new Date();
      await supabaseAdmin
        .from("council_terms")
        .update({ term_end: termStart.toISOString().slice(0, 10) })
        .eq("seat_number", election.seat_number)
        .is("term_end", null);

      const { data: seat } = await supabaseAdmin
        .from("council_seats")
        .select("term_length_years")
        .eq("seat_number", election.seat_number)
        .single();
      const expectedEnd = new Date(termStart);
      expectedEnd.setFullYear(expectedEnd.getFullYear() + (seat?.term_length_years ?? 9));

      await supabaseAdmin.from("council_terms").insert({
        seat_number: election.seat_number,
        account_id: winnerAccountId,
        term_start: termStart.toISOString().slice(0, 10),
        term_expected_end: expectedEnd.toISOString().slice(0, 10),
        elected_via: "election",
        election_id: election.id,
      });

      await supabaseAdmin
        .from("council_elections")
        .update({ status: "resolved", resolved_account_id: winnerAccountId })
        .eq("id", election.id);

      // A council seat carries admin privileges in addition to council
      // authority (per decision) — never downgrades an existing
      // superadmin. What happens to this admin grant when their term
      // ends is still an open governance question (not yet decided), so
      // deliberately not auto-revoked here.
      const { data: winnerAccount } = await supabaseAdmin
        .from("accounts")
        .select("role")
        .eq("id", winnerAccountId)
        .single();
      if (winnerAccount?.role === "member") {
        await supabaseAdmin.from("accounts").update({ role: "admin" }).eq("id", winnerAccountId);
      }
      // Council seats are automatically directory-visible, per decision.
      await supabaseAdmin.from("accounts").update({ directory_visible: true }).eq("id", winnerAccountId);

      // Announce the winner — the news feed is how members learn who's
      // now on the council, not just an admin panel.
      const { data: winnerPerson } = await supabaseAdmin
        .from("persons")
        .select("full_name")
        .eq("account_id", winnerAccountId)
        .maybeSingle();
      await supabaseAdmin.from("tribe_announcements").insert({
        title: `Council Seat ${election.seat_number} — election result`,
        body: `${winnerPerson?.full_name ?? "A new member"} has been elected to Council Seat ${election.seat_number}, term expected to run until ${expectedEnd.toISOString().slice(0, 10)}.`,
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.json({ winnerAccountId, termExpectedEnd: expectedEnd.toISOString().slice(0, 10) });
    }
  );

  return router;
}
