import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * Sets a Person's public-facing profile image. Used for the founder photo
 * and council seat photos on the leadership display (routes/leadership.ts).
 * A member may only set their OWN person's image — no one can set another
 * member's public photo on their behalf, including admins, since this is
 * publicly/broadly visible content, not something to be assigned to someone.
 */
export function profileRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.patch("/persons/:personId/profile-image", requireAuth(supabaseAdmin), async (req, res) => {
    const { mediaAssetId } = req.body ?? {};
    if (!mediaAssetId) return res.status(400).json({ error: "mediaAssetId is required" });

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, account_id")
      .eq("id", req.params.personId)
      .maybeSingle();
    if (!person || person.account_id !== req.auth!.accountId) {
      return res.status(403).json({ error: "can only set your own profile image" });
    }

    // Confirm the media asset belongs to this same account before linking it
    // as a public-facing image — prevents pointing a profile at someone
    // else's private/vault media.
    const { data: asset } = await supabaseAdmin
      .from("media_assets")
      .select("id, owner_account_id, is_vault_item")
      .eq("id", mediaAssetId)
      .maybeSingle();
    if (!asset || asset.owner_account_id !== req.auth!.accountId || asset.is_vault_item) {
      return res.status(422).json({ error: "media asset must be your own, non-vault media" });
    }

    const { error } = await supabaseAdmin
      .from("persons")
      .update({ profile_image_media_id: mediaAssetId })
      .eq("id", person.id);
    if (error) return res.status(500).json({ error: "failed to set profile image" });

    return res.json({ personId: person.id, profileImageMediaId: mediaAssetId });
  });

  return router;
}
