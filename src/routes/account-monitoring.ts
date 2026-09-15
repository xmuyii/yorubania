import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";
import { calculateAge } from "../policies/profile-requirements";

export function accountMonitoringRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // Called at claim time by the inviter (or a subsequent admin review) to
  // mark an account as custodial — invited/set up on behalf of a minor.
  router.post(
    "/admin/accounts/:accountId/mark-custodial",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (req, res) => {
      const { error } = await supabaseAdmin
        .from("accounts")
        .update({ is_custodial: true })
        .eq("id", req.params.accountId);
      if (error) return res.status(500).json({ error: "failed to mark custodial" });
      return res.json({ ok: true });
    }
  );

  // Sweep: custodial accounts whose recorded age has now reached 18 and
  // haven't completed handover yet. Sets the flag that the login flow
  // should check to prompt the required password reset.
  router.post(
    "/admin/accounts/sweep-custodial-handover",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (_req, res) => {
      const { data: custodial } = await supabaseAdmin
        .from("accounts")
        .select("id, custodial_handover_required")
        .eq("is_custodial", true)
        .eq("custodial_handover_required", false);

      let flagged = 0;
      for (const acc of custodial ?? []) {
        const { data: person } = await supabaseAdmin
          .from("persons")
          .select("date_of_birth")
          .eq("account_id", acc.id)
          .maybeSingle();
        const age = calculateAge(person?.date_of_birth ?? null);
        if (age !== null && age >= 18) {
          await supabaseAdmin.from("accounts").update({ custodial_handover_required: true }).eq("id", acc.id);
          flagged++;
        }
      }
      return res.json({ flagged });
    }
  );

  router.get(
    "/admin/accounts/pending-handover",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (_req, res) => {
      const { data, error } = await supabaseAdmin
        .from("accounts")
        .select("id, custodial_handover_required")
        .eq("is_custodial", true)
        .eq("custodial_handover_required", true);
      if (error) return res.status(500).json({ error: "failed to fetch pending handovers" });
      return res.json({ pending: data ?? [] });
    }
  );

  // The actual handover: the account holder sets a brand-new password
  // only they know, ending the custodial period. This is the one point
  // where the person, now an adult, can exclude a parent who previously
  // knew the credentials.
  router.post("/accounts/me/complete-custodial-handover", requireAuth(supabaseAdmin), async (req, res) => {
    const { newPassword } = req.body ?? {};
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword (8+ characters) is required" });
    }

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("auth_user_id")
      .eq("id", req.auth!.accountId)
      .maybeSingle();
    if (!account) return res.status(400).json({ error: "account not found" });

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(account.auth_user_id, {
      password: newPassword,
    });
    if (authError) return res.status(500).json({ error: `failed to update password: ${authError.message}` });

    await supabaseAdmin
      .from("accounts")
      .update({
        custodial_handover_required: false,
        is_custodial: false,
        custodial_handover_completed_at: new Date().toISOString(),
      })
      .eq("id", req.auth!.accountId);

    return res.json({ ok: true });
  });

  // --------------------------------------------------------------------
  // Verification admin: review new/minor/photo-less accounts
  // --------------------------------------------------------------------
  router.get(
    "/admin/verification/pending-review",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (_req, res) => {
      const { data: unverified } = await supabaseAdmin
        .from("accounts")
        .select("id, is_custodial, verified_at, created_at")
        .is("verified_at", null);

      const results = [];
      for (const acc of unverified ?? []) {
        const { data: person } = await supabaseAdmin
          .from("persons")
          .select("full_name, date_of_birth, profile_image_media_id")
          .eq("account_id", acc.id)
          .maybeSingle();
        const age = calculateAge(person?.date_of_birth ?? null);
        const needsReview = acc.is_custodial || age !== null && age < 18 || !person?.profile_image_media_id;
        if (needsReview) {
          results.push({ accountId: acc.id, fullName: person?.full_name, age, hasProfileImage: !!person?.profile_image_media_id, isCustodial: acc.is_custodial });
        }
      }
      return res.json({ pendingReview: results });
    }
  );

  router.post(
    "/admin/verification/:accountId/confirm",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (req, res) => {
      const { error } = await supabaseAdmin
        .from("accounts")
        .update({ verified_by_account_id: req.auth!.accountId, verified_at: new Date().toISOString() })
        .eq("id", req.params.accountId);
      if (error) return res.status(500).json({ error: "failed to confirm verification" });
      return res.json({ ok: true });
    }
  );

  // --------------------------------------------------------------------
  // Duplicate-account flagging — reporting only; merging data across
  // accounts (especially vaults, which are cryptographically tied to one
  // specific account) isn't attempted here, flagged as out of scope.
  // --------------------------------------------------------------------
  router.post("/admin/accounts/:accountId/flag-duplicate", requireAuth(supabaseAdmin), async (req, res) => {
    const { suspectedDuplicateOfAccountId, reason } = req.body ?? {};
    if (!reason) return res.status(400).json({ error: "reason is required" });
    const { error } = await supabaseAdmin.from("duplicate_account_flags").insert({
      flagged_account_id: req.params.accountId,
      suspected_duplicate_of_account_id: suspectedDuplicateOfAccountId ?? null,
      flagged_by_account_id: req.auth!.accountId,
      reason,
    });
    if (error) return res.status(500).json({ error: "failed to flag account" });
    return res.status(201).json({ ok: true });
  });

  router.get(
    "/admin/duplicate-flags",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (_req, res) => {
      const { data, error } = await supabaseAdmin
        .from("duplicate_account_flags")
        .select("id, flagged_account_id, suspected_duplicate_of_account_id, reason, status, created_at")
        .eq("status", "open");
      if (error) return res.status(500).json({ error: "failed to fetch flags" });
      return res.json({ flags: data ?? [] });
    }
  );

  router.post(
    "/admin/accounts/:accountId/suspend",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (req, res) => {
      const { reason } = req.body ?? {};
      if (!reason) return res.status(400).json({ error: "reason is required" });
      const { error } = await supabaseAdmin
        .from("accounts")
        .update({
          suspended_at: new Date().toISOString(),
          suspended_by_account_id: req.auth!.accountId,
          suspended_reason: reason,
        })
        .eq("id", req.params.accountId);
      if (error) return res.status(500).json({ error: "failed to suspend account" });
      return res.json({ ok: true });
    }
  );

  // Pending, still-unclaimed registrations — for spotting spam invites
  // before anyone even clicks the link.
  router.get(
    "/admin/registrations",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (_req, res) => {
      const { data, error } = await supabaseAdmin
        .from("person_registrations")
        .select("id, full_name, registered_by_account_id, relationship_to_inviter, status, claimed_by_account_id, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: "failed to fetch registrations" });
      return res.json({ registrations: data ?? [] });
    }
  );

  router.post(
    "/admin/registrations/:id/reject",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin", "verification_admin"),
    async (req, res) => {
      const { data: registration } = await supabaseAdmin
        .from("person_registrations")
        .select("id, status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!registration) return res.status(404).json({ error: "registration not found" });
      if (registration.status !== "pending") {
        return res.status(409).json({ error: "already claimed — use suspend on the resulting account instead" });
      }
      const { error } = await supabaseAdmin
        .from("person_registrations")
        .update({ status: "expired" })
        .eq("id", registration.id);
      if (error) return res.status(500).json({ error: "failed to reject registration" });
      return res.json({ ok: true });
    }
  );

  return router;
}
