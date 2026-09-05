import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

export function accountRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/accounts/me", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, full_name")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();

    return res.json({
      accountId: req.auth!.accountId,
      role: req.auth!.role,
      person: person ? { id: person.id, fullName: person.full_name } : null,
    });
  });

  return router;
}
