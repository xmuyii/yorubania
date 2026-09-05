import { Router } from "express";
import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";
import { uploadObject } from "../storage/supabase-storage";

const STALE_BACKUP_DAYS = 30;

export function backupRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // --------------------------------------------------------------------
  // System backup — open to ANY admin or superadmin, not just superadmin,
  // per decision. Dumps the whole Postgres database's metadata (schema +
  // rows). Does NOT include actual vault/media ciphertext bytes — those
  // live in Supabase Storage, not Postgres, and need a separate storage
  // sync mechanism (flagged in the README as a follow-up).
  //
  // REQUIRES: a DATABASE_URL env var (Supabase's direct Postgres
  // connection string — Project Settings → Database → Connection string,
  // NOT the same as SUPABASE_URL/the REST API), and the `pg_dump` binary
  // present in the deployed environment (see nixpacks.toml).
  // --------------------------------------------------------------------
  router.post(
    "/admin/backups/system",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        return res.status(500).json({ error: "DATABASE_URL is not configured on this server" });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tmpPath = join(tmpdir(), `backup-${timestamp}.sql`);

      try {
        await runPgDump(databaseUrl, tmpPath);
        const fs = await import("node:fs/promises");
        const dumpBytes = await fs.readFile(tmpPath);

        const storagePath = `backups/${timestamp}.sql`;
        const { error: uploadError } = await uploadObject(
          supabaseAdmin,
          storagePath,
          dumpBytes,
          "application/sql"
        );
        await unlink(tmpPath).catch(() => {});

        if (uploadError) {
          await supabaseAdmin.from("system_backups").insert({
            triggered_by_account_id: req.auth!.accountId,
            storage_path: storagePath,
            status: "failed",
          });
          return res.status(500).json({ error: `backup ran but upload failed: ${uploadError}` });
        }

        await supabaseAdmin.from("system_backups").insert({
          triggered_by_account_id: req.auth!.accountId,
          storage_path: storagePath,
          size_bytes: dumpBytes.length,
          status: "completed",
        });
        await supabaseAdmin
          .from("tribe_settings")
          .upsert({ key: "last_system_backup_at", value: JSON.stringify(new Date().toISOString()) });

        return res.status(201).json({ storagePath, sizeBytes: dumpBytes.length });
      } catch (err: any) {
        await unlink(tmpPath).catch(() => {});
        return res.status(500).json({ error: `backup failed: ${err.message}` });
      }
    }
  );

  router.get(
    "/admin/backups/status",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (_req, res) => {
      const { data: setting } = await supabaseAdmin
        .from("tribe_settings")
        .select("value")
        .eq("key", "last_system_backup_at")
        .maybeSingle();

      const lastBackupAt = setting?.value ? JSON.parse(setting.value as string) : null;
      const daysSince = lastBackupAt
        ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      const { data: recent } = await supabaseAdmin
        .from("system_backups")
        .select("id, created_at, size_bytes, status, triggered_by_account_id")
        .order("created_at", { ascending: false })
        .limit(10);

      return res.json({
        lastBackupAt,
        daysSinceLastBackup: daysSince,
        overdue: daysSince === null || daysSince > STALE_BACKUP_DAYS,
        staleThresholdDays: STALE_BACKUP_DAYS,
        recentBackups: recent ?? [],
      });
    }
  );

  // --------------------------------------------------------------------
  // Vault recovery custodian — exactly ONE account may be designated to
  // request Standard-mode vault recovery at a time (superadmin-settable;
  // in practice this could be handed to a specific council seat's
  // occupant, per decision). Every recovery request auto-announces to
  // the whole tribe, for the transparency you asked for.
  // --------------------------------------------------------------------
  router.put(
    "/admin/vault-recovery-custodian",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { accountId } = req.body ?? {};
      if (!accountId) return res.status(400).json({ error: "accountId is required" });
      await supabaseAdmin
        .from("tribe_settings")
        .upsert({ key: "vault_recovery_custodian_account_id", value: JSON.stringify(accountId) });
      return res.json({ custodianAccountId: accountId });
    }
  );

  router.post("/admin/vault-recovery-requests", requireAuth(supabaseAdmin), async (req, res) => {
    const { vaultId, reason } = req.body ?? {};
    if (!vaultId || !reason) return res.status(400).json({ error: "vaultId and reason are required" });

    const { data: custodianSetting } = await supabaseAdmin
      .from("tribe_settings")
      .select("value")
      .eq("key", "vault_recovery_custodian_account_id")
      .maybeSingle();
    const custodianAccountId = custodianSetting?.value ? JSON.parse(custodianSetting.value as string) : null;

    const isCustodian = custodianAccountId === req.auth!.accountId;
    const isSuperadmin = req.auth!.role === "superadmin";
    if (!isCustodian && !isSuperadmin) {
      return res.status(403).json({ error: "only the designated vault recovery custodian may request recovery" });
    }

    const { data: vault } = await supabaseAdmin
      .from("vaults")
      .select("id, account_id, security_mode")
      .eq("id", vaultId)
      .maybeSingle();
    if (!vault) return res.status(404).json({ error: "vault not found" });
    if (vault.security_mode !== "standard") {
      return res.status(422).json({ error: "this vault is Extra Safe — no recovery path exists, by design" });
    }

    await supabaseAdmin.from("vault_recovery_events").insert({
      vault_id: vault.id,
      performed_by_account_id: req.auth!.accountId,
      reason,
    });

    // Full transparency, per decision: every member learns a recovery was
    // requested, not just the account holder or an internal admin log.
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("full_name")
      .eq("account_id", vault.account_id)
      .maybeSingle();
    await supabaseAdmin.from("tribe_announcements").insert({
      title: "Vault recovery requested",
      body: `A vault recovery has been requested for ${person?.full_name ?? "a member"}'s account. Reason on record: ${reason}. This does not mean the vault has been opened — only that the recovery process has begun.`,
      posted_by_account_id: req.auth!.accountId,
      pinned: true,
    });

    return res.status(201).json({
      message:
        "Recovery request logged and announced. Actual unsealing still requires the offline recovery private key (see scripts/generate-recovery-keypair.ts / recovery-admin.ts) — this endpoint does not perform the unsealing itself.",
    });
  });

  // --------------------------------------------------------------------
  // Member self-export — any member can back up their own accessible
  // family data as a JSON download. Not a full-system backup; scoped to
  // what THIS account can already see.
  // --------------------------------------------------------------------
  router.get("/members/me/export", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, full_name, date_of_birth, family_branch_id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();

    const { data: relationships } = await supabaseAdmin
      .from("relationships")
      .select("id, person_a_id, person_b_id, relationship_type, event_date, source_note")
      .or(`person_a_id.eq.${person?.id ?? ""},person_b_id.eq.${person?.id ?? ""}`);

    const { data: media } = await supabaseAdmin
      .from("media_assets")
      .select("id, original_format, size_bytes, created_at")
      .eq("owner_account_id", req.auth!.accountId)
      .eq("is_vault_item", false);

    const { data: achievements } = await supabaseAdmin
      .from("community_achievements")
      .select("title, description, achieved_date, posted_at")
      .eq("account_id", req.auth!.accountId);

    await supabaseAdmin.from("member_data_exports").insert({ account_id: req.auth!.accountId });

    res.setHeader("content-type", "application/json");
    res.setHeader("content-disposition", `attachment; filename="yorubania-export-${req.auth!.accountId}.json"`);
    return res.json({
      exportedAt: new Date().toISOString(),
      person: person ?? null,
      relationships: relationships ?? [],
      mediaAssets: media ?? [],
      achievements: achievements ?? [],
      note: "This export does not include vault contents — those are zero-knowledge encrypted and never available to export in plaintext through the server.",
    });
  });

  return router;
}

function runPgDump(databaseUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pg_dump", [databaseUrl, "-f", outputPath, "--no-owner", "--no-privileges"]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", (err) => reject(new Error(`pg_dump not available: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
    });
  });
}
