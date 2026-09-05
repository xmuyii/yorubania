import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";
import { createSupabaseGraphClient } from "../relationships/supabase-graph-adapter";
import {
  applyDefaultGrantsForRelationship,
  syncDefaultGrantsForPerson,
} from "../relationships/default-grants";

const RELATIONSHIP_TYPES = [
  "parent_child",
  "spouse",
  "sibling",
  "adoptive_parent",
  "guardian",
] as const;
type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * `supabaseAdmin` must be a service-role client (bypasses RLS if any is ever
 * added incidentally, and is required for auth.admin.createUser). Never
 * expose this client or its key to the browser.
 */
export function inviteRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const graphDb = createSupabaseGraphClient(supabaseAdmin);

  // --------------------------------------------------------------------
  // 10.1 — Admin registers a person with no existing family link on the
  // system. No relationship is created; this is purely an entry point for
  // otherwise-unconnected members.
  // --------------------------------------------------------------------
  router.post(
    "/admin/register-person",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { fullName } = req.body ?? {};
      if (!fullName || typeof fullName !== "string") {
        return res.status(400).json({ error: "fullName is required" });
      }

      const { data: person, error: personError } = await supabaseAdmin
        .from("persons")
        .insert({ full_name: fullName })
        .select("id")
        .single();
      if (personError || !person) {
        return res.status(500).json({ error: "failed to create person record" });
      }

      const { data: registration, error: regError } = await supabaseAdmin
        .from("person_registrations")
        .insert({
          full_name: fullName,
          registered_by_account_id: req.auth!.accountId,
          relationship_to_inviter: null,
          person_id: person.id,
          status: "pending",
        })
        .select("invite_token")
        .single();
      if (regError || !registration) {
        return res.status(500).json({ error: "failed to create registration" });
      }

      return res.status(201).json({
        personId: person.id,
        inviteToken: registration.invite_token,
        claimUrl: `/claim/${registration.invite_token}`,
      });
    }
  );

  // --------------------------------------------------------------------
  // 10.2 — An existing member invites a relative. The Person record AND
  // the Relationship edge are created immediately, before the invited
  // person has any account — so default-visibility grants (Section 5.0)
  // apply as early as possible rather than waiting for claim.
  // --------------------------------------------------------------------
  router.post("/members/invite-relative", requireAuth(supabaseAdmin), async (req, res) => {
    const { fullName, relationshipType, inviterRole } = req.body ?? {};

    if (!fullName || typeof fullName !== "string") {
      return res.status(400).json({ error: "fullName is required" });
    }
    if (!RELATIONSHIP_TYPES.includes(relationshipType)) {
      return res.status(400).json({ error: `relationshipType must be one of ${RELATIONSHIP_TYPES.join(", ")}` });
    }
    if (relationshipType === "parent_child" && !["parent", "child"].includes(inviterRole)) {
      return res
        .status(400)
        .json({ error: "inviterRole ('parent' or 'child') is required for parent_child invites" });
    }

    // Resolve the inviter's own Person record.
    // SECURITY INVARIANT: the new relationship is always anchored to the
    // AUTHENTICATED caller's own Person record (never a personId supplied
    // in the request body). This is what makes it structurally impossible
    // for a member to attach a new person to someone else's branch of the
    // tree — do not change this to accept a caller-supplied anchor id.
    const { data: inviterPerson, error: inviterError } = await supabaseAdmin
      .from("persons")
      .select("id, family_branch_id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (inviterError || !inviterPerson) {
      return res.status(400).json({ error: "inviter has no linked person record" });
    }

    // Create the new (unclaimed) Person record.
    const { data: newPerson, error: newPersonError } = await supabaseAdmin
      .from("persons")
      .insert({ full_name: fullName })
      .select("id")
      .single();
    if (newPersonError || !newPerson) {
      return res.status(500).json({ error: "failed to create person record" });
    }

    // Determine edge direction. Convention throughout the schema:
    // parent_child -> person_a_id = parent, person_b_id = child.
    let personAId = inviterPerson.id;
    let personBId = newPerson.id;
    if (relationshipType === "parent_child" && inviterRole === "child") {
      personAId = newPerson.id; // the invited person is the parent
      personBId = inviterPerson.id;
    }

    const { data: relationship, error: relError } = await supabaseAdmin
      .from("relationships")
      .insert({
        person_a_id: personAId,
        person_b_id: personBId,
        relationship_type: relationshipType,
      })
      .select("id, person_a_id, person_b_id, relationship_type")
      .single();
    if (relError || !relationship) {
      return res.status(500).json({ error: "failed to create relationship" });
    }

    // Materialize whatever default-visibility grants are possible now
    // (Section 5.0). Anything requiring the new person's not-yet-existing
    // account is deferred and picked up at claim time.
    await applyDefaultGrantsForRelationship(graphDb, {
      id: relationship.id,
      personAId: relationship.person_a_id,
      personBId: relationship.person_b_id,
      type: relationship.relationship_type as RelationshipType,
    });

    // Family-branch inheritance: a new child or sibling defaults into the
    // inviter's own branch (branches flow down/across generations, not
    // upward — inviting your own parent does NOT retroactively assign
    // them your branch). Spouse/adoptive/guardian relationships are left
    // unassigned — no clear default applies.
    const inheritsBranch =
      (relationshipType === "parent_child" && inviterRole === "parent") ||
      relationshipType === "sibling";
    if (inheritsBranch && inviterPerson.family_branch_id) {
      await supabaseAdmin
        .from("persons")
        .update({ family_branch_id: inviterPerson.family_branch_id })
        .eq("id", newPerson.id);
    }

    const { data: registration, error: regError } = await supabaseAdmin
      .from("person_registrations")
      .insert({
        full_name: fullName,
        registered_by_account_id: req.auth!.accountId,
        relationship_to_inviter: relationshipType,
        person_id: newPerson.id,
        status: "pending",
      })
      .select("invite_token")
      .single();
    if (regError || !registration) {
      return res.status(500).json({ error: "failed to create registration" });
    }

    return res.status(201).json({
      personId: newPerson.id,
      inviteToken: registration.invite_token,
      claimUrl: `/claim/${registration.invite_token}`,
    });
  });

  // --------------------------------------------------------------------
  // Public: look up a pending invite by token, for rendering the claim page.
  // Deliberately returns only the display name — nothing else.
  // --------------------------------------------------------------------
  router.get("/invite/:token", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("person_registrations")
      .select("full_name, status")
      .eq("invite_token", req.params.token)
      .maybeSingle();

    if (error || !data || data.status !== "pending") {
      // Deliberately vague — a previously-used or invalid token should
      // behave the same as one that never existed (spec: "trying to use a
      // previous link ... will not work").
      return res.status(404).json({ error: "invite not found or already used" });
    }

    return res.json({ fullName: data.full_name });
  });

  // --------------------------------------------------------------------
  // Public: claim an invite — sets password, creates the auth user + account,
  // links it to the pre-existing Person record, backfills default grants.
  // --------------------------------------------------------------------
  router.post("/invite/:token/claim", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { data: registration, error: regFetchError } = await supabaseAdmin
      .from("person_registrations")
      .select("id, person_id, status")
      .eq("invite_token", req.params.token)
      .maybeSingle();

    if (regFetchError || !registration || registration.status !== "pending") {
      return res.status(410).json({ error: "invite not found or already used" });
    }

    // Create the Supabase auth user server-side (service role required).
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError || !authUser?.user) {
      return res.status(500).json({ error: "failed to create auth user", detail: authError?.message });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("accounts")
      .insert({ auth_user_id: authUser.user.id, role: "member" })
      .select("id")
      .single();
    if (accountError || !account) {
      return res.status(500).json({ error: "failed to create account" });
    }

    // Link the pre-existing Person record to the new account.
    const { error: linkError } = await supabaseAdmin
      .from("persons")
      .update({ account_id: account.id })
      .eq("id", registration.person_id);
    if (linkError) {
      return res.status(500).json({ error: "failed to link person to account" });
    }

    // Consume the invite — permanently. Re-using this token must now fail.
    await supabaseAdmin
      .from("person_registrations")
      .update({
        status: "claimed",
        claimed_at: new Date().toISOString(),
        claimed_by_account_id: account.id,
      })
      .eq("id", registration.id);

    // Backfill any default-visibility grants that were deferred earlier
    // because this person had no account yet (spec Section 5.0).
    await syncDefaultGrantsForPerson(graphDb, registration.person_id);

    await supabaseAdmin.from("access_logs").insert({
      account_id: account.id,
      accessor_account_id: account.id,
      accessor_role: "self",
      action: "account_claimed",
    });

    return res.status(201).json({ accountId: account.id });
  });

  return router;
}
