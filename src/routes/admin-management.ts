import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole } from "../middleware/auth-context";

/**
 * The privilege boundary this file exists to enforce: ONLY a superadmin
 * may grant or revoke the 'admin' role. An account with role='admin' has
 * no path to promote anyone else to admin — requireRole("superadmin")
 * below is the entire mechanism; there is deliberately no "admin can
 * create admin" branch anywhere in this file.
 */
export function adminManagementRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/admin/admins", requireAuth(supabaseAdmin), requireRole("superadmin"), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("id, role, created_at")
      .in("role", ["admin", "superadmin"]);
    if (error) return res.status(500).json({ error: "failed to list admins" });
    return res.json({ admins: data ?? [] });
  });

  router.post(
    "/admin/admins",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { accountId } = req.body ?? {};
      if (!accountId) return res.status(400).json({ error: "accountId is required" });

      const { data: target } = await supabaseAdmin
        .from("accounts")
        .select("id, role")
        .eq("id", accountId)
        .maybeSingle();
      if (!target) return res.status(404).json({ error: "account not found" });
      if (target.role === "superadmin") {
        return res.status(422).json({ error: "cannot change a superadmin's role through this route" });
      }

      const { error } = await supabaseAdmin.from("accounts").update({ role: "admin" }).eq("id", accountId);
      if (error) return res.status(500).json({ error: "failed to grant admin role" });

      await supabaseAdmin.from("access_logs").insert({
        account_id: accountId,
        accessor_account_id: req.auth!.accountId,
        accessor_role: "superadmin",
        action: "admin_role_granted",
      });

      return res.status(201).json({ accountId, role: "admin" });
    }
  );

  router.delete(
    "/admin/admins/:accountId",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { data: target } = await supabaseAdmin
        .from("accounts")
        .select("id, role")
        .eq("id", req.params.accountId)
        .maybeSingle();
      if (!target) return res.status(404).json({ error: "account not found" });
      if (target.role !== "admin") {
        return res.status(422).json({ error: "target account does not currently hold the admin role" });
      }

      const { error } = await supabaseAdmin
        .from("accounts")
        .update({ role: "member" })
        .eq("id", req.params.accountId);
      if (error) return res.status(500).json({ error: "failed to revoke admin role" });

      await supabaseAdmin.from("access_logs").insert({
        account_id: req.params.accountId,
        accessor_account_id: req.auth!.accountId,
        accessor_role: "superadmin",
        action: "admin_role_revoked",
      });

      return res.status(204).send();
    }
  );

  return router;
}
