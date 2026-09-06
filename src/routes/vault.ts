import { Router } from "express";
import express from "express";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";
import { uploadObject, downloadObject, deleteObject } from "../storage/supabase-storage";
import { checkProfileRequirement } from "../policies/profile-requirements";

/**
 * IMPORTANT: the server NEVER sees plaintext vault contents. Every byte
 * that arrives here is already client-side-encrypted ciphertext (see
 * vault/crypto.ts) — this route only stores/retrieves opaque blobs and
 * enforces the rules ABOUT them (decoy-first, storage caps, ownership).
 * Decryption happens only in the browser, using the passphrase-derived key
 * that never leaves the user's device.
 */
export function vaultRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const rawBody = express.raw({ type: "*/*", limit: "30mb" });

  // Initializes a vault: records the KDF salt/params and, for Standard
  // mode, the sealed recovery key. Called once per account, right after
  // the client has generated its master key and wrapped it (crypto.ts).
  router.post("/vaults/me/init", requireAuth(supabaseAdmin), async (req, res) => {
    const {
      kdfSalt,
      kdfAlgorithm,
      kdfParams,
      securityMode,
      wrappedMasterKeyCiphertext,
      wrappedMasterKeyIv,
      sealedRecoveryKey,
      recoveryKeyId,
    } = req.body ?? {};
    if (!kdfSalt || !kdfParams || !securityMode || !wrappedMasterKeyCiphertext || !wrappedMasterKeyIv) {
      return res.status(400).json({
        error:
          "kdfSalt, kdfParams, securityMode, wrappedMasterKeyCiphertext, and wrappedMasterKeyIv are required",
      });
    }
    if (securityMode === "standard" && (!sealedRecoveryKey || !recoveryKeyId)) {
      return res
        .status(400)
        .json({ error: "standard mode requires sealedRecoveryKey and recoveryKeyId" });
    }

    const { data: existing } = await supabaseAdmin
      .from("vaults")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: "vault already initialized" });

    const { data: vault, error } = await supabaseAdmin
      .from("vaults")
      .insert({
        account_id: req.auth!.accountId,
        kdf_salt: kdfSalt,
        kdf_algorithm: kdfAlgorithm ?? "argon2id",
        kdf_params: kdfParams,
        security_mode: securityMode,
        wrapped_master_key_ciphertext: wrappedMasterKeyCiphertext,
        wrapped_master_key_iv: wrappedMasterKeyIv,
        admin_recovery_sealed_key: securityMode === "standard" ? sealedRecoveryKey : null,
        recovery_key_id: securityMode === "standard" ? recoveryKeyId : null,
      })
      .select("id")
      .single();
    if (error || !vault) {
      return res
        .status(500)
        .json({ error: `failed to initialize vault: ${error?.message ?? "unknown error"}` });
    }
    return res.status(201).json({ vaultId: vault.id });
  });

  async function getOwnVault(supabase: SupabaseClient, accountId: string) {
    const { data } = await supabase
      .from("vaults")
      .select("id, decoy_completed, security_mode")
      .eq("account_id", accountId)
      .maybeSingle();
    return data;
  }

  router.get("/vaults/me", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: vault } = await supabaseAdmin
      .from("vaults")
      .select(
        "id, decoy_completed, security_mode, kdf_salt, kdf_algorithm, kdf_params, wrapped_master_key_ciphertext, wrapped_master_key_iv"
      )
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!vault) return res.status(404).json({ error: "no vault for this account" });
    return res.json({
      vaultId: vault.id,
      decoyCompleted: vault.decoy_completed,
      securityMode: vault.security_mode,
      kdfSalt: vault.kdf_salt,
      kdfAlgorithm: vault.kdf_algorithm,
      kdfParams: vault.kdf_params,
      wrappedMasterKeyCiphertext: vault.wrapped_master_key_ciphertext,
      wrappedMasterKeyIv: vault.wrapped_master_key_iv,
    });
  });

  // Uploads the MANDATORY decoy — must happen before any real item can be
  // uploaded (spec Section 6). Body is the encrypted decoy blob itself;
  // filename/IV etc. travel as headers since this is a raw binary upload.
  router.post("/vaults/me/decoy", requireAuth(supabaseAdmin), rawBody, async (req, res) => {
    const profileCheck = await checkProfileRequirement(supabaseAdmin, req.auth!.accountId);
    if (!profileCheck.allowed) {
      return res.status(403).json({ error: profileCheck.reason });
    }

    const vault = await getOwnVault(supabaseAdmin, req.auth!.accountId);
    if (!vault) return res.status(400).json({ error: "vault not initialized — call /vaults/me/init first" });
    if (vault.decoy_completed) return res.status(409).json({ error: "decoy already uploaded" });

    const iv = req.header("x-iv");
    if (!iv) return res.status(400).json({ error: "x-iv header is required" });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "request body must be the encrypted decoy bytes" });
    }

    const path = `vault/${req.auth!.accountId}/decoy`;
    const { error: uploadError } = await uploadObject(supabaseAdmin, path, req.body, "application/octet-stream");
    if (uploadError) return res.status(500).json({ error: `failed to store decoy: ${uploadError}` });

    const { error: itemError } = await supabaseAdmin.from("vault_items").insert({
      vault_id: vault.id,
      is_decoy: true,
      storage_path: path,
      size_bytes: req.body.length,
      encrypted: true,
    });
    if (itemError) return res.status(500).json({ error: "failed to record decoy item" });

    await supabaseAdmin.from("vaults").update({ decoy_completed: true }).eq("id", vault.id);
    return res.status(201).json({ ok: true });
  });

  // Uploads a real vault item. Gated on decoy_completed. Enforces the
  // per-account vault storage cap (accounts.vault_storage_limit_bytes /
  // vault_bytes_used, spec Section 6.1).
  router.post("/vaults/me/items", requireAuth(supabaseAdmin), rawBody, async (req, res) => {
    const profileCheck = await checkProfileRequirement(supabaseAdmin, req.auth!.accountId);
    if (!profileCheck.allowed) {
      return res.status(403).json({ error: profileCheck.reason });
    }

    const vault = await getOwnVault(supabaseAdmin, req.auth!.accountId);
    if (!vault) return res.status(400).json({ error: "vault not initialized — call /vaults/me/init first" });
    if (!vault.decoy_completed) {
      return res.status(403).json({ error: "must upload a decoy before storing real vault items" });
    }

    const iv = req.header("x-iv");
    if (!iv) return res.status(400).json({ error: "x-iv header is required" });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "request body must be the encrypted item bytes" });
    }

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("vault_bytes_used, vault_storage_limit_bytes")
      .eq("id", req.auth!.accountId)
      .single();
    if (!account) return res.status(500).json({ error: "account not found" });
    if (account.vault_bytes_used + req.body.length > account.vault_storage_limit_bytes) {
      return res.status(413).json({
        error: "vault storage cap exceeded",
        usedBytes: account.vault_bytes_used,
        limitBytes: account.vault_storage_limit_bytes,
      });
    }

    const { data: item, error: itemInsertError } = await supabaseAdmin
      .from("vault_items")
      .insert({ vault_id: vault.id, is_decoy: false, storage_path: "", size_bytes: req.body.length, encrypted: true })
      .select("id")
      .single();
    if (itemInsertError || !item) {
      return res
        .status(500)
        .json({ error: `failed to record vault item: ${itemInsertError?.message ?? "unknown error"}` });
    }

    const path = `vault/${req.auth!.accountId}/${item.id}`;
    const { error: uploadError } = await uploadObject(supabaseAdmin, path, req.body, "application/octet-stream");
    if (uploadError) {
      await supabaseAdmin.from("vault_items").delete().eq("id", item.id);
      return res.status(500).json({ error: `failed to store item: ${uploadError}` });
    }

    await supabaseAdmin.from("vault_items").update({ storage_path: path }).eq("id", item.id);
    await supabaseAdmin
      .from("accounts")
      .update({ vault_bytes_used: account.vault_bytes_used + req.body.length })
      .eq("id", req.auth!.accountId);

    // Store the caller-supplied IV alongside the item as metadata so it can
    // be returned on download — stored as a separate small object rather
    // than a new column, to keep this pass additive to the schema.
    await supabaseAdmin.storage
      .from("yorubania-storage")
      .upload(`${path}.iv`, Buffer.from(iv), { contentType: "text/plain", upsert: true });

    return res.status(201).json({ itemId: item.id, sizeBytes: req.body.length });
  });

  router.get("/vaults/me/items", requireAuth(supabaseAdmin), async (req, res) => {
    const vault = await getOwnVault(supabaseAdmin, req.auth!.accountId);
    if (!vault) return res.status(404).json({ error: "no vault for this account" });

    const { data, error } = await supabaseAdmin
      .from("vault_items")
      .select("id, is_decoy, size_bytes, created_at")
      .eq("vault_id", vault.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "failed to list vault items" });
    return res.json({ items: data ?? [] });
  });

  // Returns the raw ciphertext + its IV. Decryption happens client-side —
  // this server never decrypts vault content, by design (zero-knowledge).
  router.get("/vaults/me/items/:itemId/download", requireAuth(supabaseAdmin), async (req, res) => {
    const vault = await getOwnVault(supabaseAdmin, req.auth!.accountId);
    if (!vault) return res.status(404).json({ error: "no vault for this account" });

    const { data: item } = await supabaseAdmin
      .from("vault_items")
      .select("id, storage_path")
      .eq("id", req.params.itemId)
      .eq("vault_id", vault.id)
      .maybeSingle();
    if (!item) return res.status(404).json({ error: "vault item not found" });

    const { bytes, error } = await downloadObject(supabaseAdmin, item.storage_path);
    if (error || !bytes) return res.status(500).json({ error: `failed to fetch item: ${error}` });

    const { bytes: ivBytes } = await downloadObject(supabaseAdmin, `${item.storage_path}.iv`);

    await supabaseAdmin.from("access_logs").insert({
      account_id: req.auth!.accountId,
      accessor_account_id: req.auth!.accountId,
      accessor_role: "self",
      action: "vault_item_download",
    });

    res.setHeader("x-iv", ivBytes ? ivBytes.toString() : "");
    res.setHeader("content-type", "application/octet-stream");
    return res.send(bytes);
  });

  router.delete("/vaults/me/items/:itemId", requireAuth(supabaseAdmin), async (req, res) => {
    const vault = await getOwnVault(supabaseAdmin, req.auth!.accountId);
    if (!vault) return res.status(404).json({ error: "no vault for this account" });

    const { data: item } = await supabaseAdmin
      .from("vault_items")
      .select("id, storage_path, size_bytes, is_decoy")
      .eq("id", req.params.itemId)
      .eq("vault_id", vault.id)
      .maybeSingle();
    if (!item) return res.status(404).json({ error: "vault item not found" });
    if (item.is_decoy) return res.status(403).json({ error: "the decoy cannot be deleted independently" });

    await deleteObject(supabaseAdmin, item.storage_path);
    await deleteObject(supabaseAdmin, `${item.storage_path}.iv`);
    await supabaseAdmin.from("vault_items").delete().eq("id", item.id);

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("vault_bytes_used")
      .eq("id", req.auth!.accountId)
      .single();
    if (account) {
      await supabaseAdmin
        .from("accounts")
        .update({ vault_bytes_used: Math.max(0, account.vault_bytes_used - item.size_bytes) })
        .eq("id", req.auth!.accountId);
    }

    return res.status(204).send();
  });

  return router;
}

/** Exposed for reuse by tests or other routes needing a quick checksum. */
export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
