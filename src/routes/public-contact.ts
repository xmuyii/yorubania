import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * There is no messaging on Yorubania and never will be — this just lets a
 * living member point to wherever they're reachable externally. Shown
 * alongside the directory listing for anyone who's opted into it.
 */
export function publicContactRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.patch("/persons/me/public-contact", requireAuth(supabaseAdmin), async (req, res) => {
    const { telegramHandle, externalContactNote } = req.body ?? {};
    const { error } = await supabaseAdmin
      .from("persons")
      .update({ telegram_handle: telegramHandle ?? null, external_contact_note: externalContactNote ?? null })
      .eq("account_id", req.auth!.accountId);
    if (error) return res.status(500).json({ error: "failed to save contact info" });
    return res.json({ ok: true });
  });

  return router;
}
