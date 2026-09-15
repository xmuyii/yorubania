import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * Deliberately minimal: name, family branch, photo. Never surfaces
 * genealogical data (birthdates, relationships, uploaded family content) —
 * that stays behind the lineage-based AccessGrant system regardless of
 * directory visibility. Opt-in by default (accounts.directory_visible),
 * per the "members start private" principle.
 */
export function directoryRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/members/directory", requireAuth(supabaseAdmin), async (req, res) => {
    const search = (req.query.search as string | undefined)?.trim();

    let query = supabaseAdmin
      .from("persons")
      .select(
        "id, full_name, profile_image_media_id, family_branch_id, account_id, telegram_handle, external_contact_note, accounts!inner(directory_visible)"
      )
      .eq("accounts.directory_visible", true);

    if (search) {
      query = query.ilike("full_name", `%${search}%`);
    }

    const { data, error } = await query.limit(50);
    if (error) return res.status(500).json({ error: "failed to search directory" });

    return res.json({
      results: (data ?? []).map((p: any) => ({
        personId: p.id,
        fullName: p.full_name,
        profileImageMediaId: p.profile_image_media_id,
        familyBranchId: p.family_branch_id,
        telegramHandle: p.telegram_handle,
        externalContactNote: p.external_contact_note,
      })),
    });
  });

  router.patch("/accounts/me/directory-visibility", requireAuth(supabaseAdmin), async (req, res) => {
    const { visible } = req.body ?? {};
    if (typeof visible !== "boolean") return res.status(400).json({ error: "visible (boolean) is required" });

    const { error } = await supabaseAdmin
      .from("accounts")
      .update({ directory_visible: visible })
      .eq("id", req.auth!.accountId);
    if (error) return res.status(500).json({ error: "failed to update visibility" });
    return res.json({ directoryVisible: visible });
  });

  return router;
}
