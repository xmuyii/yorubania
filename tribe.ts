import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireCouncilMembership } from "../middleware/auth-context";

export function tribeRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // --------------------------------------------------------------------
  // GET /api/tribe/overview — mission statement + 1000-year timeline
  // position. Every member sees this on their account (the "general
  // section"). Requires auth (member-only, not public) since it's part
  // of the member experience — flip to public later if you want it
  // visible to prospective members too.
  // --------------------------------------------------------------------
  router.get("/tribe/overview", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data: mission, error: missionError } = await supabaseAdmin
      .from("tribe_mission")
      .select("statement, founding_date, milestone_years")
      .eq("is_current", true)
      .maybeSingle();
    if (missionError || !mission) {
      return res.status(404).json({ error: "no current mission statement set" });
    }

    const foundingDate = new Date(mission.founding_date);
    const now = new Date();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsElapsed = (now.getTime() - foundingDate.getTime()) / msPerYear;
    const daysElapsed = Math.floor((now.getTime() - foundingDate.getTime()) / (24 * 60 * 60 * 1000));
    const yearsRemaining = Math.max(0, mission.milestone_years - yearsElapsed);
    const percentComplete = Math.min(100, (yearsElapsed / mission.milestone_years) * 100);

    const { data: phases } = await supabaseAdmin
      .from("tribe_era_phases")
      .select("name, start_year_offset, end_year_offset, description")
      .order("display_order", { ascending: true });

    const currentPhase = (phases ?? []).find(
      (p) => yearsElapsed >= p.start_year_offset && (p.end_year_offset === null || yearsElapsed < p.end_year_offset)
    );

    return res.json({
      statement: mission.statement,
      foundingDate: mission.founding_date,
      milestoneYears: mission.milestone_years,
      yearsElapsed: Math.floor(yearsElapsed),
      daysElapsed,
      yearsRemaining: Math.floor(yearsRemaining),
      percentComplete: Number(percentComplete.toFixed(4)),
      currentPhase: currentPhase ?? null,
      allPhases: phases ?? [],
    });
  });

  // --------------------------------------------------------------------
  // Council-only: publish a new mission/vision version. Versions are
  // immutable once created — "editing" means creating a new current
  // version, same pattern as the Founding Narrative.
  // --------------------------------------------------------------------
  router.post(
    "/tribe/mission",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { statement, foundingDate, milestoneYears } = req.body ?? {};
      if (!statement || !foundingDate) {
        return res.status(400).json({ error: "statement and foundingDate are required" });
      }

      const { data: latest } = await supabaseAdmin
        .from("tribe_mission")
        .select("version")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (latest?.version ?? 0) + 1;

      await supabaseAdmin.from("tribe_mission").update({ is_current: false }).eq("is_current", true);

      const { data: created, error } = await supabaseAdmin
        .from("tribe_mission")
        .insert({
          version: nextVersion,
          statement,
          founding_date: foundingDate,
          milestone_years: milestoneYears ?? 1000,
          authored_by_account_id: req.auth!.accountId,
          is_current: true,
        })
        .select("id, version")
        .single();
      if (error || !created) {
        return res.status(500).json({ error: "failed to publish mission statement" });
      }
      return res.status(201).json(created);
    }
  );

  // --------------------------------------------------------------------
  // General news/announcements
  // --------------------------------------------------------------------
  router.get("/tribe/announcements", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("tribe_announcements")
      .select("id, title, body, pinned, posted_at, posted_by_account_id")
      .order("pinned", { ascending: false })
      .order("posted_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: "failed to fetch announcements" });
    return res.json({ announcements: data ?? [] });
  });

  router.post(
    "/tribe/announcements",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const { title, body, pinned } = req.body ?? {};
      if (!title || !body) {
        return res.status(400).json({ error: "title and body are required" });
      }
      const { data, error } = await supabaseAdmin
        .from("tribe_announcements")
        .insert({
          title,
          body,
          pinned: !!pinned,
          posted_by_account_id: req.auth!.accountId,
        })
        .select("id")
        .single();
      if (error || !data) return res.status(500).json({ error: "failed to post announcement" });
      return res.status(201).json(data);
    }
  );

  return router;
}
