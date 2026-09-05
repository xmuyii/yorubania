import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

export function familyRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // Directory of all families present in Yorubania — the "who's here"
  // overview. Shows each branch's name, member count, and what it split
  // from (if anything), so the branching structure is visible at a glance.
  router.get("/families", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data: branches, error } = await supabaseAdmin
      .from("family_branches")
      .select("id, name, parent_family_branch_id, founded_at, origin_note")
      .order("name", { ascending: true });
    if (error) return res.status(500).json({ error: "failed to fetch families" });

    const { data: counts } = await supabaseAdmin
      .from("persons")
      .select("family_branch_id")
      .not("family_branch_id", "is", null);

    const countByBranch = new Map<string, number>();
    for (const row of counts ?? []) {
      countByBranch.set(row.family_branch_id, (countByBranch.get(row.family_branch_id) ?? 0) + 1);
    }

    return res.json({
      families: (branches ?? []).map((b) => ({
        ...b,
        memberCount: countByBranch.get(b.id) ?? 0,
      })),
    });
  });

  // Detail view: members of this branch + any branches that split off from it.
  router.get("/families/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: branch, error } = await supabaseAdmin
      .from("family_branches")
      .select("id, name, parent_family_branch_id, founding_person_id, origin_note, founded_at")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error || !branch) return res.status(404).json({ error: "family branch not found" });

    const { data: members } = await supabaseAdmin
      .from("persons")
      .select("id, full_name, profile_image_media_id")
      .eq("family_branch_id", branch.id);

    const { data: subBranches } = await supabaseAdmin
      .from("family_branches")
      .select("id, name, founded_at")
      .eq("parent_family_branch_id", branch.id);

    return res.json({ branch, members: members ?? [], subBranches: subBranches ?? [] });
  });

  // Founds a new family branch, optionally splitting off an existing one.
  // The caller becomes the branch's founding person and moves themselves
  // into it — does not retroactively move any existing relatives; only
  // future descendants added under this person inherit the new branch
  // (see invite.ts's default-inheritance behavior).
  router.post("/families/branch", requireAuth(supabaseAdmin), async (req, res) => {
    const { name, parentFamilyBranchId, originNote } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data: branch, error } = await supabaseAdmin
      .from("family_branches")
      .insert({
        name,
        parent_family_branch_id: parentFamilyBranchId ?? null,
        founding_person_id: person.id,
        origin_note: originNote ?? null,
        founded_at: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error || !branch) return res.status(500).json({ error: "failed to create family branch" });

    await supabaseAdmin.from("persons").update({ family_branch_id: branch.id }).eq("id", person.id);

    return res.status(201).json({ familyBranchId: branch.id });
  });

  // Lets a member manually set/correct their own family_branch_id (e.g.
  // joining an existing branch rather than founding a new one).
  router.patch("/persons/:personId/family-branch", requireAuth(supabaseAdmin), async (req, res) => {
    const { familyBranchId } = req.body ?? {};
    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, account_id")
      .eq("id", req.params.personId)
      .maybeSingle();
    if (!person || person.account_id !== req.auth!.accountId) {
      return res.status(403).json({ error: "can only set your own family branch" });
    }
    const { error } = await supabaseAdmin
      .from("persons")
      .update({ family_branch_id: familyBranchId ?? null })
      .eq("id", person.id);
    if (error) return res.status(500).json({ error: "failed to update family branch" });
    return res.json({ personId: person.id, familyBranchId: familyBranchId ?? null });
  });

  return router;
}
