import { Router } from "express";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";
import { uploadObject } from "../storage/supabase-storage";
import { sha256Hex } from "./vault";
import { calculateAge, calculateYorubanianBirthYear, canViewAge } from "../policies/profile-requirements";

/**
 * Sets a Person's public-facing profile image. Used for the founder photo
 * and council seat photos on the leadership display (routes/leadership.ts).
 * A member may only set their OWN person's image — no one can set another
 * member's public photo on their behalf, including admins, since this is
 * publicly/broadly visible content, not something to be assigned to someone.
 */
export function profileRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const rawBody = express.raw({ type: "*/*", limit: "10mb" });

  // --------------------------------------------------------------------
  // Combined upload + set, in one step. DELIBERATELY exempt from the
  // profile-picture requirement enforced elsewhere (media.ts, vault.ts,
  // invite.ts) — this is exactly the action that satisfies that
  // requirement, so gating it too would make it impossible to ever
  // satisfy for an adult with no photo yet.
  // --------------------------------------------------------------------
  router.post("/persons/me/profile-photo", requireAuth(supabaseAdmin), rawBody, async (req, res) => {
    const originalFormat = req.header("x-original-format") ?? "application/octet-stream";
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "request body must be the image bytes" });
    }

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data: asset, error: assetError } = await supabaseAdmin
      .from("media_assets")
      .insert({
        owner_account_id: req.auth!.accountId,
        subject_person_id: person.id,
        original_storage_path: "",
        original_format: originalFormat,
        size_bytes: req.body.length,
        is_vault_item: false,
      })
      .select("id")
      .single();
    if (assetError || !asset) return res.status(500).json({ error: "failed to record photo" });

    const path = `media/${req.auth!.accountId}/${asset.id}`;
    const { error: uploadError } = await uploadObject(supabaseAdmin, path, req.body, "application/octet-stream");
    if (uploadError) {
      await supabaseAdmin.from("media_assets").delete().eq("id", asset.id);
      return res.status(500).json({ error: `failed to store photo: ${uploadError}` });
    }

    await supabaseAdmin.from("media_assets").update({ original_storage_path: path }).eq("id", asset.id);
    await supabaseAdmin.from("media_metadata").insert({
      media_asset_id: asset.id,
      date_uploaded: new Date().toISOString(),
      checksum: sha256Hex(req.body),
      checksum_status: "ok",
    });
    await supabaseAdmin.from("persons").update({ profile_image_media_id: asset.id }).eq("id", person.id);

    return res.status(201).json({ mediaAssetId: asset.id });
  });

  // Reuse an already-uploaded media asset as the profile image, without
  // re-uploading. Still self-only.
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

  // Self-only. Setting your own date of birth is what determines whether
  // the profile-picture requirement applies to you at all (minors are
  // exempt) and what "born in Year N of Yorubania" shows as.
  router.patch("/persons/me/date-of-birth", requireAuth(supabaseAdmin), async (req, res) => {
    const { dateOfBirth } = req.body ?? {};
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required (YYYY-MM-DD)" });

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { error } = await supabaseAdmin
      .from("persons")
      .update({ date_of_birth: dateOfBirth })
      .eq("id", person.id);
    if (error) return res.status(500).json({ error: "failed to set date of birth" });

    return res.json({ personId: person.id, dateOfBirth });
  });

  // Age/birthdate are private: visible only to the person themself, their
  // family (anyone with an active content grant for them), or an admin —
  // see policies/profile-requirements.ts for the exact rule. Nobody else
  // gets a value back, even if they can see the person's name/tree
  // position via other endpoints.
  router.get("/persons/:personId/basic-info", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, full_name, date_of_birth")
      .eq("id", req.params.personId)
      .maybeSingle();
    if (!person) return res.status(404).json({ error: "person not found" });

    const allowed = await canViewAge(
      supabaseAdmin,
      req.auth!.accountId,
      req.auth!.role,
      person.id
    );

    if (!allowed) {
      return res.json({ id: person.id, fullName: person.full_name });
    }

    const age = calculateAge(person.date_of_birth);
    const yorubanianBirthYear = await calculateYorubanianBirthYear(supabaseAdmin, person.date_of_birth);
    return res.json({
      id: person.id,
      fullName: person.full_name,
      dateOfBirth: person.date_of_birth,
      age,
      yorubanianBirthYear,
    });
  });

  return router;
}
