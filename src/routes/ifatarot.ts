import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

/**
 * Ifatarot itself is a separate application — this just gives every
 * account a consistent place to reach it from, and lets the superadmin
 * update the URL if it ever moves without needing a code deploy.
 */
export function ifatarotRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/ifatarot", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data } = await supabaseAdmin.from("tribe_settings").select("value").eq("key", "ifatarot_app_url").maybeSingle();
    const url = data?.value ? JSON.parse(data.value as string) : "";
    return res.json({ url });
  });

  router.put("/admin/ifatarot-url", requireAuth(supabaseAdmin), requireRole("superadmin"), async (req, res) => {
    const { url } = req.body ?? {};
    if (!url) return res.status(400).json({ error: "url is required" });
    await supabaseAdmin.from("tribe_settings").upsert({ key: "ifatarot_app_url", value: JSON.stringify(url) });
    return res.json({ ok: true });
  });

  return router;
}
