import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole, requireCouncilMembership } from "../middleware/auth-context";

export function rulesRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // --------------------------------------------------------------------
  // Spiritual rules — append-only. The database itself refuses UPDATE/
  // DELETE on this table (see migration 015's trigger), so this route
  // never even attempts to offer editing — there's nothing to build,
  // because permanence is enforced structurally, not by choosing not to
  // write an edit button.
  // --------------------------------------------------------------------
  router.get("/rules/spiritual", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("spiritual_rules")
      .select("id, title, body, created_at")
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: "failed to fetch spiritual rules" });
    return res.json({ rules: data ?? [] });
  });

  router.post(
    "/rules/spiritual",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { title, body } = req.body ?? {};
      if (!title || !body) return res.status(400).json({ error: "title and body are required" });
      const { data, error } = await supabaseAdmin
        .from("spiritual_rules")
        .insert({ title, body, set_by_account_id: req.auth!.accountId })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to add spiritual rule" });

      await supabaseAdmin.from("tribe_announcements").insert({
        title: `A spiritual rule has been set: ${title}`,
        body: "This is now part of Yorubania's eternal, unchanging law.",
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.status(201).json(data);
    }
  );

  // --------------------------------------------------------------------
  // General rules — ordinary governance, versioned, council-editable.
  // --------------------------------------------------------------------
  router.get("/rules/general", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("general_rules")
      .select("id, version, title, body, created_at")
      .eq("is_current", true)
      .maybeSingle();
    if (error || !data) return res.status(404).json({ error: "no general rules published yet" });
    return res.json(data);
  });

  // Full version history — clarifies that "editable" general rules are
  // never actually erased, only superseded. Old versions are permanently
  // preserved and readable, exactly like the immutable spiritual rules —
  // the difference is only which version counts as "current" right now.
  router.get("/rules/general/history", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("general_rules")
      .select("id, version, title, body, set_by_account_id, is_current, created_at")
      .order("version", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to fetch rules history" });
    return res.json({ versions: data ?? [] });
  });

  router.post(
    "/rules/general",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { title, body } = req.body ?? {};
      if (!title || !body) return res.status(400).json({ error: "title and body are required" });

      const { data: latest } = await supabaseAdmin
        .from("general_rules")
        .select("version")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (latest?.version ?? 0) + 1;

      await supabaseAdmin.from("general_rules").update({ is_current: false }).eq("is_current", true);

      const { data, error } = await supabaseAdmin
        .from("general_rules")
        .insert({ version: nextVersion, title, body, set_by_account_id: req.auth!.accountId, is_current: true })
        .select("id, version")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to publish general rules" });
      return res.status(201).json(data);
    }
  );

  // --------------------------------------------------------------------
  // Open documents library — visible to every member, not gated by
  // lineage access (distinct from personal family media).
  // --------------------------------------------------------------------
  router.get("/documents", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("tribe_documents")
      .select("id, title, description, media_asset_id, created_at")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to fetch documents" });
    return res.json({ documents: data ?? [] });
  });

  router.post(
    "/documents",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { title, description, mediaAssetId } = req.body ?? {};
      if (!title || !mediaAssetId) return res.status(400).json({ error: "title and mediaAssetId are required" });
      const { data, error } = await supabaseAdmin
        .from("tribe_documents")
        .insert({ title, description, media_asset_id: mediaAssetId, uploaded_by_account_id: req.auth!.accountId })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to add document" });
      return res.status(201).json(data);
    }
  );

  return router;
}
