import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole, requireCouncilMembership } from "../middleware/auth-context";

export function educationRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/education", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("education_materials")
      .select("id, title, description, media_asset_id, created_at")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to fetch education materials" });
    return res.json({ materials: data ?? [] });
  });

  router.post("/education", requireAuth(supabaseAdmin), async (req, res) => {
    const isAdmin = req.auth!.role === "admin" || req.auth!.role === "superadmin";
    let onCouncil = false;
    if (!isAdmin) {
      const { data } = await supabaseAdmin
        .from("council_terms")
        .select("account_id")
        .eq("account_id", req.auth!.accountId)
        .is("term_end", null)
        .maybeSingle();
      onCouncil = !!data;
    }
    if (!isAdmin && !onCouncil) return res.status(403).json({ error: "admin or council membership required" });

    const { title, description, mediaAssetId } = req.body ?? {};
    if (!title || !mediaAssetId) return res.status(400).json({ error: "title and mediaAssetId are required" });

    const { data, error } = await supabaseAdmin
      .from("education_materials")
      .insert({ title, description, media_asset_id: mediaAssetId, uploaded_by_account_id: req.auth!.accountId })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to add material" });
    return res.status(201).json(data);
  });

  return router;
}
