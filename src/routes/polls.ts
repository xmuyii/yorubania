import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole, requireCouncilMembership } from "../middleware/auth-context";

export function pollsRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  async function canOpenPolls(accountId: string, role: string): Promise<boolean> {
    if (role === "admin" || role === "superadmin") return true;
    const { data } = await supabaseAdmin
      .from("council_terms")
      .select("account_id")
      .eq("account_id", accountId)
      .is("term_end", null)
      .maybeSingle();
    return !!data;
  }

  router.post("/polls", requireAuth(supabaseAdmin), async (req, res) => {
    const allowed = await canOpenPolls(req.auth!.accountId, req.auth!.role);
    if (!allowed) return res.status(403).json({ error: "only admins, superadmin, or council may open polls" });

    const { title, description, options, closesAt } = req.body ?? {};
    if (!title || !Array.isArray(options) || options.length < 2 || !closesAt) {
      return res.status(400).json({ error: "title, at least 2 options, and closesAt are required" });
    }

    const { data: poll, error } = await supabaseAdmin
      .from("polls")
      .insert({ title, description, opened_by_account_id: req.auth!.accountId, closes_at: closesAt })
      .select("id")
      .single();
    if (error || !poll) return res.status(500).json({ error: "failed to open poll" });

    const optionRows = options.map((label: string) => ({ poll_id: poll.id, label }));
    await supabaseAdmin.from("poll_options").insert(optionRows);

    await supabaseAdmin.from("tribe_announcements").insert({
      title: `Poll: ${title}`,
      body: `Voting is open until ${closesAt}. ${description ?? ""}`.trim(),
      posted_by_account_id: req.auth!.accountId,
      pinned: true,
    });

    return res.status(201).json({ id: poll.id });
  });

  router.get("/polls", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("polls")
      .select("id, title, description, status, opens_at, closes_at")
      .order("opens_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: "failed to fetch polls" });
    return res.json({ polls: data ?? [] });
  });

  router.get("/polls/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: poll } = await supabaseAdmin
      .from("polls")
      .select("id, title, description, status, opens_at, closes_at")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!poll) return res.status(404).json({ error: "poll not found" });

    const { data: options } = await supabaseAdmin
      .from("poll_options")
      .select("id, label")
      .eq("poll_id", poll.id);

    let results = null;
    if (poll.status === "closed") {
      const { data: votes } = await supabaseAdmin.from("poll_votes").select("option_id").eq("poll_id", poll.id);
      const tally: Record<string, number> = {};
      for (const o of options ?? []) tally[o.id] = 0;
      for (const v of votes ?? []) tally[v.option_id] = (tally[v.option_id] ?? 0) + 1;
      results = tally;
    }

    return res.json({ ...poll, options: options ?? [], results });
  });

  // Voting requires directory opt-in — per decision, participating in
  // tribe governance requires being a discoverable member.
  router.post("/polls/:id/vote", requireAuth(supabaseAdmin), async (req, res) => {
    const { optionId } = req.body ?? {};
    if (!optionId) return res.status(400).json({ error: "optionId is required" });

    const { data: account } = await supabaseAdmin
      .from("accounts")
      .select("directory_visible")
      .eq("id", req.auth!.accountId)
      .single();
    if (!account?.directory_visible) {
      return res.status(403).json({
        error: "you must opt into the member directory before you can vote (see Settings)",
      });
    }

    const { data: poll } = await supabaseAdmin
      .from("polls")
      .select("id, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!poll || poll.status !== "open") return res.status(409).json({ error: "poll is not open" });

    const { error } = await supabaseAdmin
      .from("poll_votes")
      .insert({ poll_id: req.params.id, voter_account_id: req.auth!.accountId, option_id: optionId });
    if (error) return res.status(500).json({ error: "failed to record vote (already voted?)" });
    return res.status(201).json({ ok: true });
  });

  router.post(
    "/polls/:id/close",
    requireAuth(supabaseAdmin),
    requireRole("admin", "superadmin"),
    async (req, res) => {
      const { data: poll } = await supabaseAdmin
        .from("polls")
        .select("id, title")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!poll) return res.status(404).json({ error: "poll not found" });

      await supabaseAdmin.from("polls").update({ status: "closed" }).eq("id", poll.id);

      const { data: options } = await supabaseAdmin.from("poll_options").select("id, label").eq("poll_id", poll.id);
      const { data: votes } = await supabaseAdmin.from("poll_votes").select("option_id").eq("poll_id", poll.id);
      const tally = new Map<string, number>();
      for (const v of votes ?? []) tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + 1);
      const summary = (options ?? [])
        .map((o) => `${o.label}: ${tally.get(o.id) ?? 0}`)
        .join(", ");

      await supabaseAdmin.from("tribe_announcements").insert({
        title: `Poll results: ${poll.title}`,
        body: summary || "No votes were cast.",
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.json({ ok: true });
    }
  );

  return router;
}
