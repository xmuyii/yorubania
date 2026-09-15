import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * This is the whitelist/blacklist UI, correctly understood: it's not a
 * separate system from the lineage-based access control already built —
 * it IS that system. A "whitelist" entry is just an AccessGrant with
 * is_denial = false; a "blacklist" entry is one with is_denial = true.
 * What was missing until now was a way for a member to create one
 * themselves, beyond the automatic sibling/spouse defaults.
 */
export function accessGrantsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.post("/persons/me/access-grants", requireAuth(supabaseAdmin), async (req, res) => {
    const { granteeAccountId, scope, isDenial } = req.body ?? {};
    if (!granteeAccountId || !scope) {
      return res.status(400).json({ error: "granteeAccountId and scope are required" });
    }
    if (granteeAccountId === req.auth!.accountId) {
      return res.status(400).json({ error: "cannot grant or deny access to yourself" });
    }

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data, error } = await supabaseAdmin
      .from("access_grants")
      .insert({
        subject_person_id: person.id,
        grantor_account_id: req.auth!.accountId,
        grantee_account_id: granteeAccountId,
        scope,
        is_denial: !!isDenial,
        status: "active",
        // Fixed permanently — only this account can ever revoke this
        // specific grant, even after succession (spec Section 5.1/9).
        revocable_by_account_id: req.auth!.accountId,
      })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to create access grant" });
    return res.status(201).json(data);
  });

  router.get("/persons/me/access-grants", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data, error } = await supabaseAdmin
      .from("access_grants")
      .select("id, grantee_account_id, scope, is_denial, status, created_at")
      .eq("subject_person_id", person.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to fetch access grants" });
    return res.json({ grants: data ?? [] });
  });

  // Only the original grantor may revoke — enforced here, and this is
  // exactly what makes a grant survive succession unchanged: a successor
  // controlling the same Person record still cannot pass this check for
  // grants they didn't personally create.
  router.delete("/access-grants/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: grant } = await supabaseAdmin
      .from("access_grants")
      .select("id, revocable_by_account_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!grant) return res.status(404).json({ error: "grant not found" });
    if (grant.revocable_by_account_id !== req.auth!.accountId) {
      return res.status(403).json({ error: "only the account that created this grant may revoke it" });
    }

    const { error } = await supabaseAdmin
      .from("access_grants")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", grant.id);
    if (error) return res.status(500).json({ error: "failed to revoke grant" });
    return res.status(204).send();
  });

  return router;
}
