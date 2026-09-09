import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

const VALID_RULE_TYPES = ["destroy", "all_descendants", "immediate_children_only", "specific_recipients"];

export function vaultDistributionRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  async function ownsVaultItem(accountId: string, vaultItemId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from("vault_items")
      .select("id, vaults!inner(account_id)")
      .eq("id", vaultItemId)
      .maybeSingle();
    return (data as any)?.vaults?.account_id === accountId;
  }

  // Sets (replacing any existing) the inheritance rule for one vault item.
  // No rule set at all = 'destroy' by default (the schema's own default),
  // per decision: without an explicit instruction, a vault item does not
  // survive its owner.
  router.put("/vaults/me/items/:itemId/distribution", requireAuth(supabaseAdmin), async (req, res) => {
    const owns = await ownsVaultItem(req.auth!.accountId, req.params.itemId);
    if (!owns) return res.status(404).json({ error: "vault item not found" });

    const { ruleType, recipients } = req.body ?? {};
    if (!VALID_RULE_TYPES.includes(ruleType)) {
      return res.status(400).json({ error: `ruleType must be one of ${VALID_RULE_TYPES.join(", ")}` });
    }
    if (ruleType === "specific_recipients" && (!Array.isArray(recipients) || recipients.length === 0)) {
      return res.status(400).json({
        error: "specific_recipients requires a non-empty recipients array: [{personId, cascadeToLineage}]",
      });
    }

    await supabaseAdmin.from("vault_item_distribution_rules").delete().eq("vault_item_id", req.params.itemId);
    await supabaseAdmin.from("vault_item_distribution_recipients").delete().eq("vault_item_id", req.params.itemId);

    const { error } = await supabaseAdmin.from("vault_item_distribution_rules").insert({
      vault_item_id: req.params.itemId,
      rule_type: ruleType,
      set_by_account_id: req.auth!.accountId,
    });
    if (error) return res.status(500).json({ error: "failed to set distribution rule" });

    if (ruleType === "specific_recipients") {
      const rows = recipients.map((r: any) => ({
        vault_item_id: req.params.itemId,
        recipient_person_id: r.personId,
        cascade_to_lineage: !!r.cascadeToLineage,
      }));
      const { error: recipError } = await supabaseAdmin.from("vault_item_distribution_recipients").insert(rows);
      if (recipError) return res.status(500).json({ error: "failed to set recipients" });
    }

    return res.json({ ok: true });
  });

  router.get("/vaults/me/items/:itemId/distribution", requireAuth(supabaseAdmin), async (req, res) => {
    const owns = await ownsVaultItem(req.auth!.accountId, req.params.itemId);
    if (!owns) return res.status(404).json({ error: "vault item not found" });

    const { data: rule } = await supabaseAdmin
      .from("vault_item_distribution_rules")
      .select("rule_type")
      .eq("vault_item_id", req.params.itemId)
      .maybeSingle();

    const { data: recipients } = await supabaseAdmin
      .from("vault_item_distribution_recipients")
      .select("recipient_person_id, cascade_to_lineage")
      .eq("vault_item_id", req.params.itemId);

    return res.json({
      ruleType: rule?.rule_type ?? "destroy",
      recipients: recipients ?? [],
    });
  });

  return router;
}
