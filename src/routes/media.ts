import { Router } from "express";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";
import { createSupabaseDbClient } from "../auth/supabase-adapter";
import { canAccess } from "../auth/authorization";
import { uploadObject, downloadObject, deleteObject } from "../storage/supabase-storage";
import { sha256Hex } from "./vault";
import { checkProfileRequirement } from "../policies/profile-requirements";

/**
 * Family-page media — NOT vault content. Stored as-is (original bytes);
 * archival-format conversion (TIFF/FFV1/PDF-A derivatives, spec Section 4)
 * is a separate, still-unbuilt pipeline — this pass covers storage +
 * fixity checksum only. Flagged in the README as a follow-up.
 */
export function mediaRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const rawBody = express.raw({ type: "*/*", limit: "55mb" });
  const db = createSupabaseDbClient(supabaseAdmin);

  // Uploading is a WRITE about a specific person, which is a different
  // question from canAccess() (a READ permission check). A member may
  // upload media concerning: themselves, or a person they are the
  // recorded parent of (mirrors "what I upload about my children" from
  // the default-visibility design, spec Section 5.0). Broader delegation
  // (e.g. an aunt uploading on a niece's behalf) isn't supported yet.
  async function canUploadFor(subjectPersonId: string, accountId: string): Promise<boolean> {
    const { data: subject } = await supabaseAdmin
      .from("persons")
      .select("id, account_id")
      .eq("id", subjectPersonId)
      .maybeSingle();
    if (!subject) return false;
    if (subject.account_id === accountId) return true;

    const { data: parentEdge } = await supabaseAdmin
      .from("relationships")
      .select("id")
      .eq("relationship_type", "parent_child")
      .eq("person_b_id", subjectPersonId)
      .maybeSingle();
    if (!parentEdge) return false;

    const { data: parentPerson } = await supabaseAdmin
      .from("persons")
      .select("account_id")
      .eq("id", (parentEdge as any).person_a_id ?? "")
      .maybeSingle();
    return parentPerson?.account_id === accountId;
  }

  router.post("/media", requireAuth(supabaseAdmin), rawBody, async (req, res) => {
    const profileCheck = await checkProfileRequirement(supabaseAdmin, req.auth!.accountId);
    if (!profileCheck.allowed) {
      return res.status(403).json({ error: profileCheck.reason });
    }

    const subjectPersonId = req.header("x-subject-person-id");
    const originalFormat = req.header("x-original-format");
    if (!subjectPersonId || !originalFormat) {
      return res.status(400).json({ error: "x-subject-person-id and x-original-format headers are required" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "request body must be the file bytes" });
    }

    const allowed = await canUploadFor(subjectPersonId, req.auth!.accountId);
    if (!allowed) {
      return res.status(403).json({ error: "cannot upload media for this person" });
    }

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("family_bytes_used, family_storage_limit_bytes")
      .eq("id", req.auth!.accountId)
      .single();
    if (!account) return res.status(500).json({ error: "account not found" });
    if (account.family_bytes_used + req.body.length > account.family_storage_limit_bytes) {
      return res.status(413).json({
        error: "family media storage cap exceeded",
        usedBytes: account.family_bytes_used,
        limitBytes: account.family_storage_limit_bytes,
      });
    }

    const { data: asset, error: assetError } = await supabaseAdmin
      .from("media_assets")
      .insert({
        owner_account_id: req.auth!.accountId,
        subject_person_id: subjectPersonId,
        original_storage_path: "",
        original_format: originalFormat,
        size_bytes: req.body.length,
        is_vault_item: false,
      })
      .select("id")
      .single();
    if (assetError || !asset) return res.status(500).json({ error: "failed to record media asset" });

    const path = `media/${req.auth!.accountId}/${asset.id}`;
    const { error: uploadError } = await uploadObject(supabaseAdmin, path, req.body, "application/octet-stream");
    if (uploadError) {
      await supabaseAdmin.from("media_assets").delete().eq("id", asset.id);
      return res.status(500).json({ error: `failed to store media: ${uploadError}` });
    }

    const checksum = sha256Hex(req.body);
    await supabaseAdmin.from("media_assets").update({ original_storage_path: path }).eq("id", asset.id);
    await supabaseAdmin.from("media_metadata").insert({
      media_asset_id: asset.id,
      date_uploaded: new Date().toISOString(),
      checksum,
      checksum_status: "ok",
    });
    await supabaseAdmin
      .from("accounts")
      .update({ family_bytes_used: account.family_bytes_used + req.body.length })
      .eq("id", req.auth!.accountId);

    return res.status(201).json({ mediaAssetId: asset.id, checksum, sizeBytes: req.body.length });
  });

  // Lists media for a person, filtered through canAccess() — metadata only.
  router.get("/persons/:personId/media", requireAuth(supabaseAdmin), async (req, res) => {
    const decision = await canAccess(db, req.auth!.accountId, req.params.personId, "media");
    if (!decision.allowed) {
      return res.status(403).json({ error: "forbidden", reason: decision.reason });
    }

    const { data, error } = await supabaseAdmin
      .from("media_assets")
      .select("id, original_format, size_bytes, created_at")
      .eq("subject_person_id", req.params.personId)
      .eq("is_vault_item", false)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to list media" });
    return res.json({ media: data ?? [] });
  });

  router.get("/media/:id/download", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: asset } = await supabaseAdmin
      .from("media_assets")
      .select("id, subject_person_id, original_storage_path, original_format")
      .eq("id", req.params.id)
      .eq("is_vault_item", false)
      .maybeSingle();
    if (!asset) return res.status(404).json({ error: "media not found" });

    if (asset.subject_person_id) {
      const decision = await canAccess(db, req.auth!.accountId, asset.subject_person_id, "media");
      if (!decision.allowed) {
        return res.status(403).json({ error: "forbidden", reason: decision.reason });
      }
    }

    const { bytes, error } = await downloadObject(supabaseAdmin, asset.original_storage_path);
    if (error || !bytes) return res.status(500).json({ error: `failed to fetch media: ${error}` });

    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("x-original-format", asset.original_format);
    return res.send(bytes);
  });

  router.delete("/media/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: asset } = await supabaseAdmin
      .from("media_assets")
      .select("id, owner_account_id, original_storage_path, size_bytes")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!asset) return res.status(404).json({ error: "media not found" });
    if (asset.owner_account_id !== req.auth!.accountId) {
      return res.status(403).json({ error: "only the uploader can delete this media" });
    }

    await deleteObject(supabaseAdmin, asset.original_storage_path);
    await supabaseAdmin.from("media_assets").delete().eq("id", asset.id);

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("family_bytes_used")
      .eq("id", req.auth!.accountId)
      .single();
    if (account) {
      await supabaseAdmin
        .from("accounts")
        .update({ family_bytes_used: Math.max(0, account.family_bytes_used - asset.size_bytes) })
        .eq("id", req.auth!.accountId);
    }

    return res.status(204).send();
  });

  return router;
}
