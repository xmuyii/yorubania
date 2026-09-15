import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";
import { deleteObject } from "../storage/supabase-storage";

export function deathRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // --------------------------------------------------------------------
  // Living-member self-service
  // --------------------------------------------------------------------
  router.patch("/persons/me/verification-contact", requireAuth(supabaseAdmin), async (req, res) => {
    const { phone, address, email, guarantorName, guarantorPhone, deathVerificationNotes, additionalContacts } =
      req.body ?? {};
    const { error } = await supabaseAdmin.from("verification_contacts").upsert({
      account_id: req.auth!.accountId,
      phone,
      address,
      email,
      guarantor_name: guarantorName,
      guarantor_phone: guarantorPhone,
      death_verification_notes: deathVerificationNotes,
      additional_contacts: additionalContacts ?? [],
      updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: "failed to save verification contact" });
    return res.json({ ok: true });
  });

  router.patch("/accounts/me/designated-successor", requireAuth(supabaseAdmin), async (req, res) => {
    const { successorAccountId } = req.body ?? {};
    if (!successorAccountId) return res.status(400).json({ error: "successorAccountId is required" });
    const { error } = await supabaseAdmin
      .from("accounts")
      .update({ designated_successor_account_id: successorAccountId })
      .eq("id", req.auth!.accountId);
    if (error) return res.status(500).json({ error: "failed to set designated successor" });
    return res.json({ ok: true });
  });

  router.post("/accounts/me/check-in", requireAuth(supabaseAdmin), async (req, res) => {
    const { error } = await supabaseAdmin
      .from("accounts")
      .update({ last_check_in_at: new Date().toISOString() })
      .eq("id", req.auth!.accountId);
    if (error) return res.status(500).json({ error: "failed to record check-in" });
    return res.json({ ok: true });
  });

  // --------------------------------------------------------------------
  // Admin: overdue check-ins, case handling
  // --------------------------------------------------------------------
  router.get(
    "/admin/death-checkins/overdue",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (_req, res) => {
      const { data: accounts } = await supabaseAdmin
        .from("accounts")
        .select("id, last_check_in_at, check_in_interval_days");
      const { data: openCases } = await supabaseAdmin
        .from("death_verification_cases")
        .select("account_id")
        .eq("status", "open");
      const openAccountIds = new Set((openCases ?? []).map((c) => c.account_id));

      const overdue = (accounts ?? []).filter((a) => {
        if (openAccountIds.has(a.id)) return false;
        const daysSince = (Date.now() - new Date(a.last_check_in_at).getTime()) / (24 * 60 * 60 * 1000);
        return daysSince > a.check_in_interval_days;
      });

      return res.json({ overdue });
    }
  );

  router.post(
    "/admin/death-verification-cases",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { accountId } = req.body ?? {};
      if (!accountId) return res.status(400).json({ error: "accountId is required" });

      const { data: existing } = await supabaseAdmin
        .from("death_verification_cases")
        .select("id")
        .eq("account_id", accountId)
        .eq("status", "open")
        .maybeSingle();
      if (existing) return res.status(409).json({ error: "a case is already open for this account" });

      const { data, error } = await supabaseAdmin
        .from("death_verification_cases")
        .insert({ account_id: accountId, status: "open" })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to open case" });
      return res.status(201).json(data);
    }
  );

  router.post(
    "/admin/death-verification-cases/:id/resolve",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { outcome, note, extendedPresumptionNote } = req.body ?? {};
      if (!["confirmed_death", "closed_false_trigger", "presumed_death"].includes(outcome)) {
        return res.status(400).json({ error: "invalid outcome" });
      }
      if (outcome === "presumed_death" && !extendedPresumptionNote) {
        return res.status(400).json({
          error: "presumed_death requires extendedPresumptionNote documenting what attempts were made",
        });
      }

      const { data: caseRow } = await supabaseAdmin
        .from("death_verification_cases")
        .select("id, account_id, status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!caseRow) return res.status(404).json({ error: "case not found" });
      if (caseRow.status !== "open") return res.status(409).json({ error: "case is not open" });

      if (outcome === "closed_false_trigger") {
        await supabaseAdmin
          .from("death_verification_cases")
          .update({
            status: "closed_false_trigger",
            handled_by_admin_id: req.auth!.accountId,
            resolved_at: new Date().toISOString(),
            resolution_note: note ?? null,
          })
          .eq("id", caseRow.id);
        // Give them a fresh check-in clock, since we've now confirmed they're reachable.
        await supabaseAdmin
          .from("accounts")
          .update({ last_check_in_at: new Date().toISOString() })
          .eq("id", caseRow.account_id);
        return res.json({ ok: true, outcome });
      }

      const deathStatus = outcome === "confirmed_death" ? "confirmed" : "presumed";
      await supabaseAdmin
        .from("death_verification_cases")
        .update({
          status: "confirmed_death",
          handled_by_admin_id: req.auth!.accountId,
          resolved_at: new Date().toISOString(),
          resolution_note: note ?? null,
          extended_presumption_note: extendedPresumptionNote ?? null,
        })
        .eq("id", caseRow.id);

      const result = await processDeath(supabaseAdmin, caseRow.account_id, caseRow.id, deathStatus);
      return res.json({ ok: true, outcome, ...result });
    }
  );

  // --------------------------------------------------------------------
  // Succession voting (for accounts without a reachable designated successor)
  // --------------------------------------------------------------------
  router.post("/succession-cases/:id/vote", requireAuth(supabaseAdmin), async (req, res) => {
    const { candidateAccountId } = req.body ?? {};
    if (!candidateAccountId) return res.status(400).json({ error: "candidateAccountId is required" });

    const { error } = await supabaseAdmin.from("succession_votes").upsert(
      {
        succession_case_id: req.params.id,
        voter_account_id: req.auth!.accountId,
        candidate_account_id: candidateAccountId,
      },
      { onConflict: "succession_case_id,voter_account_id" }
    );
    if (error) return res.status(500).json({ error: "failed to record vote" });
    return res.status(201).json({ ok: true });
  });

  router.post(
    "/succession-cases/:id/resolve",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { data: caseRow } = await supabaseAdmin
        .from("succession_cases")
        .select("id, person_id, status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!caseRow) return res.status(404).json({ error: "case not found" });
      if (caseRow.status !== "voting") return res.status(409).json({ error: "case is not open for voting" });

      const { data: votes } = await supabaseAdmin
        .from("succession_votes")
        .select("candidate_account_id")
        .eq("succession_case_id", caseRow.id);

      let winnerAccountId: string | null = null;
      let method = "vote";

      if (votes && votes.length > 0) {
        const tally = new Map<string, number>();
        for (const v of votes) tally.set(v.candidate_account_id, (tally.get(v.candidate_account_id) ?? 0) + 1);
        winnerAccountId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        // Quorum not met — fall back to eldest child by date of birth.
        const { data: children } = await supabaseAdmin
          .from("relationships")
          .select("person_b_id")
          .eq("relationship_type", "parent_child")
          .eq("person_a_id", caseRow.person_id);
        const childIds = (children ?? []).map((c) => c.person_b_id);
        const { data: childPersons } = await supabaseAdmin
          .from("persons")
          .select("account_id, date_of_birth")
          .in("id", childIds)
          .not("account_id", "is", null)
          .order("date_of_birth", { ascending: true })
          .limit(1);
        winnerAccountId = childPersons?.[0]?.account_id ?? null;
        method = "eldest_child_fallback";
      }

      if (!winnerAccountId) {
        return res.status(422).json({ error: "no eligible candidate found — resolve manually" });
      }

      await supabaseAdmin
        .from("persons")
        .update({ current_controller_account_id: winnerAccountId })
        .eq("id", caseRow.person_id);
      await supabaseAdmin
        .from("succession_cases")
        .update({ status: "resolved", resolved_controller_account_id: winnerAccountId, resolution_method: method })
        .eq("id", caseRow.id);

      return res.json({ winnerAccountId, method });
    }
  );

  return router;
}

/**
 * The core death-processing pipeline: seals draft chapters, releases or
 * destroys vault items per each item's distribution rule, and triggers
 * succession (direct handoff to a designated successor, a family vote, or
 * — if truly no living descendants or relatives exist anywhere in the
 * system — an honestly-flagged "unclaimed" outcome rather than a silent
 * failure).
 */
async function processDeath(
  supabaseAdmin: SupabaseClient,
  accountId: string,
  caseId: string,
  deathStatus: "confirmed" | "presumed"
) {
  const { data: person } = await supabaseAdmin
    .from("persons")
    .select("id, full_name")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!person) return { error: "no linked person record" };

  await supabaseAdmin
    .from("persons")
    .update({ is_deceased: true, date_of_death: new Date().toISOString().slice(0, 10), death_status: deathStatus })
    .eq("id", person.id);

  // Seal every draft chapter — permanently, per the sealing rule.
  await supabaseAdmin
    .from("biography_chapters")
    .update({
      status: "sealed",
      sealed_at: new Date().toISOString(),
      sealed_by_account_id: accountId,
      sealed_via: "death_confirmed",
    })
    .eq("person_id", person.id)
    .eq("status", "draft");

  // Transcribe Life Goals into a specially-scoped chapter — visible only
  // to actual descendants going forward (see the life_goals scope
  // exclusion in authorization.ts), never to a spouse/sibling/parent even
  // if they otherwise have general chapter access. This is the one and
  // only place life goals ever become visible to anyone but the person
  // themselves.
  const { data: goals } = await supabaseAdmin
    .from("life_goals")
    .select("goal_number, description, achieved")
    .eq("person_id", person.id)
    .order("goal_number", { ascending: true });

  if (goals && goals.length > 0) {
    const { data: existingChapters } = await supabaseAdmin
      .from("biography_chapters")
      .select("chapter_order")
      .eq("person_id", person.id)
      .order("chapter_order", { ascending: false })
      .limit(1);
    const nextOrder = (existingChapters?.[0]?.chapter_order ?? -1) + 1;

    const body = goals
      .map(
        (g) =>
          `${g.goal_number}. ${g.description} — ${g.achieved ? "Achieved." : "Not achieved in their lifetime."}`
      )
      .join("\n\n");

    await supabaseAdmin.from("biography_chapters").insert({
      person_id: person.id,
      title: "Life Goals",
      body,
      chapter_order: nextOrder,
      chapter_type: "life_goals",
      status: "sealed",
      sealed_at: new Date().toISOString(),
      sealed_by_account_id: accountId,
      sealed_via: "death_confirmed",
    });
  }

  // --- Vault release/destruction ---
  const { data: vault } = await supabaseAdmin.from("vaults").select("id").eq("account_id", accountId).maybeSingle();
  if (vault) {
    const { data: items } = await supabaseAdmin
      .from("vault_items")
      .select("id, storage_path, is_decoy")
      .eq("vault_id", vault.id)
      .eq("is_decoy", false);

    for (const item of items ?? []) {
      const { data: rule } = await supabaseAdmin
        .from("vault_item_distribution_rules")
        .select("rule_type")
        .eq("vault_item_id", item.id)
        .maybeSingle();
      const ruleType = rule?.rule_type ?? "destroy"; // undecided = destroy, per decision

      if (ruleType === "destroy") {
        await deleteObject(supabaseAdmin, item.storage_path);
        await deleteObject(supabaseAdmin, `${item.storage_path}.iv`);
        await supabaseAdmin.from("vault_items").delete().eq("id", item.id);
        await supabaseAdmin.from("vault_destruction_log").insert({
          vault_item_id: item.id,
          vault_id: vault.id,
          death_verification_case_id: caseId,
        });
        continue;
      }

      let recipientPersonIds: string[] = [];
      if (ruleType === "all_descendants") {
        recipientPersonIds = await getAllDescendantIds(supabaseAdmin, person.id);
      } else if (ruleType === "immediate_children_only") {
        recipientPersonIds = await getDirectChildIds(supabaseAdmin, person.id);
      } else if (ruleType === "specific_recipients") {
        const { data: recipients } = await supabaseAdmin
          .from("vault_item_distribution_recipients")
          .select("recipient_person_id, cascade_to_lineage")
          .eq("vault_item_id", item.id);
        for (const r of recipients ?? []) {
          recipientPersonIds.push(r.recipient_person_id);
          if (r.cascade_to_lineage) {
            recipientPersonIds.push(...(await getAllDescendantIds(supabaseAdmin, r.recipient_person_id)));
          }
        }
      }

      if (recipientPersonIds.length > 0) {
        const { data: recipientPersons } = await supabaseAdmin
          .from("persons")
          .select("account_id")
          .in("id", [...new Set(recipientPersonIds)])
          .not("account_id", "is", null);
        for (const rp of recipientPersons ?? []) {
          await supabaseAdmin
            .from("vault_distributions")
            .insert({ vault_item_id: item.id, recipient_account_id: rp.account_id });
        }
      }
    }
  }

  // --- Succession (account control) ---
  let successionOutcome: any;
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("designated_successor_account_id, role")
    .eq("id", accountId)
    .single();

  // If the deceased was superadmin, that ROLE needs its own resolution,
  // separate from ordinary account-control succession below (both run —
  // a superadmin is still a person whose Person record and vault also
  // need normal succession/distribution handling).
  if (account?.role === "superadmin") {
    if (account.designated_successor_account_id) {
      await supabaseAdmin
        .from("accounts")
        .update({ role: "superadmin" })
        .eq("id", account.designated_successor_account_id);
      await supabaseAdmin.from("superadmin_transitions").insert({
        previous_account_id: accountId,
        new_account_id: account.designated_successor_account_id,
        method: "designated_successor",
      });
    } else {
      const { data: election } = await supabaseAdmin
        .from("superadmin_elections")
        .insert({ opened_reason: "founder/superadmin death, no designated successor" })
        .select("id")
        .single();
      await supabaseAdmin.from("tribe_announcements").insert({
        title: "Superadmin election opened",
        body: "No designated successor was on record. The council must now elect a new superadmin.",
        posted_by_account_id: accountId,
        pinned: true,
      });
      void election;
    }
  }

  // --- Succession ---

  if (account?.designated_successor_account_id) {
    await supabaseAdmin
      .from("persons")
      .update({ current_controller_account_id: account.designated_successor_account_id })
      .eq("id", person.id);
    successionOutcome = { method: "designated_successor", accountId: account.designated_successor_account_id };
  } else {
    let candidateIds = await getDirectChildIds(supabaseAdmin, person.id);
    if (candidateIds.length === 0) {
      // No children — fall back to siblings' descendants (nieces/nephews).
      const { data: siblingEdges } = await supabaseAdmin
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "sibling")
        .or(`person_a_id.eq.${person.id},person_b_id.eq.${person.id}`);
      const siblingIds = (siblingEdges ?? []).map((e) => (e.person_a_id === person.id ? e.person_b_id : e.person_a_id));
      for (const sibId of siblingIds) {
        candidateIds.push(...(await getDirectChildIds(supabaseAdmin, sibId)));
      }
    }
    if (candidateIds.length === 0) {
      // Truly no descendants or nearby relatives found — flagged honestly
      // rather than silently leaving the record in an undefined state.
      successionOutcome = { method: "unclaimed", note: "no living descendants or relatives found in the system" };
    } else {
      const { data: succCase } = await supabaseAdmin
        .from("succession_cases")
        .insert({ person_id: person.id, status: "voting" })
        .select("id")
        .single();
      successionOutcome = { method: "voting_opened", succession_case_id: succCase?.id };
    }
  }

  await supabaseAdmin.from("tribe_announcements").insert({
    title: `In memory of ${person.full_name}`,
    body: `${person.full_name}'s passing has been ${deathStatus === "confirmed" ? "confirmed" : "presumed after an extended, documented absence"}. Their sealed chapters are now part of Yorubania's permanent record.`,
    posted_by_account_id: accountId,
    pinned: true,
  });

  return { personId: person.id, succession: successionOutcome };
}

async function getDirectChildIds(supabaseAdmin: SupabaseClient, personId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("relationships")
    .select("person_b_id")
    .eq("relationship_type", "parent_child")
    .eq("person_a_id", personId);
  return (data ?? []).map((r) => r.person_b_id);
}

async function getAllDescendantIds(supabaseAdmin: SupabaseClient, rootPersonId: string): Promise<string[]> {
  const visited = new Set<string>();
  let frontier = [rootPersonId];
  while (frontier.length > 0) {
    const { data } = await supabaseAdmin
      .from("relationships")
      .select("person_b_id")
      .eq("relationship_type", "parent_child")
      .in("person_a_id", frontier);
    const next: string[] = [];
    for (const row of data ?? []) {
      if (!visited.has(row.person_b_id)) {
        visited.add(row.person_b_id);
        next.push(row.person_b_id);
      }
    }
    frontier = next;
  }
  return [...visited];
}
