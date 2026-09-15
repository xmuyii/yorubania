import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

export function projectsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  async function isAdminOrCouncil(accountId: string, role: string): Promise<boolean> {
    if (role === "admin" || role === "superadmin") return true;
    const { data } = await supabaseAdmin
      .from("council_terms")
      .select("account_id")
      .eq("account_id", accountId)
      .is("term_end", null)
      .maybeSingle();
    return !!data;
  }

  router.get("/projects", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, title, description, status, created_at, updated_at")
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to fetch projects" });
    return res.json({ projects: data ?? [] });
  });

  router.post("/projects", requireAuth(supabaseAdmin), async (req, res) => {
    const allowed = await isAdminOrCouncil(req.auth!.accountId, req.auth!.role);
    if (!allowed) return res.status(403).json({ error: "admin or council membership required" });

    const { title, description, status } = req.body ?? {};
    if (!title) return res.status(400).json({ error: "title is required" });

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({ title, description, status: status ?? "planned", created_by_account_id: req.auth!.accountId })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to create project" });
    return res.status(201).json(data);
  });

  router.patch("/projects/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const allowed = await isAdminOrCouncil(req.auth!.accountId, req.auth!.role);
    if (!allowed) return res.status(403).json({ error: "admin or council membership required" });

    const { title, description, status } = req.body ?? {};
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ title, description, status, updated_at: new Date().toISOString() })
      .eq("id", req.params.id);
    if (error) return res.status(500).json({ error: "failed to update project" });
    return res.json({ ok: true });
  });

  return router;
}
