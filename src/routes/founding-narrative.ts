import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireCouncilMembership, requireRole } from "../middleware/auth-context";

export function foundingNarrativeRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // Public — the Founding Narrative is meant to be visible to the general
  // public, per spec Section 1.2, not just tribe members.
  router.get("/founding-narrative", async (_req, res) => {
    const { data: narrative, error } = await supabaseAdmin
      .from("founding_narrative")
      .select(
        "id, version, title, origin_story, founding_principles, relationship_to_yoruba, founding_date_or_era, founding_location, sources, confidence_level, language"
      )
      .eq("is_current", true)
      .maybeSingle();
    if (error || !narrative) {
      return res.status(404).json({ error: "no current founding narrative published yet" });
    }

    const { data: media } = await supabaseAdmin
      .from("founding_narrative_media")
      .select("media_asset_id")
      .eq("founding_narrative_id", narrative.id);

    return res.json({ ...narrative, mediaAssetIds: (media ?? []).map((m) => m.media_asset_id) });
  });

  // Council-only — creates a new version and makes it current. Right now
  // the council is just the founder's own account (seeded manually per
  // migration 004's comment); this route doesn't need to know or care
  // whether it's one person or seven, only that the caller is in the
  // founding_narrative_council table.
  router.post(
    "/founding-narrative",
    requireAuth(supabaseAdmin),
    requireCouncilMembership(supabaseAdmin),
    async (req, res) => {
      const {
        title,
        originStory,
        foundingPrinciples,
        relationshipToYoruba,
        foundingDateOrEra,
        foundingLocation,
        sources,
        confidenceLevel,
        language,
      } = req.body ?? {};

      if (!title) return res.status(400).json({ error: "title is required" });

      const { data: latest } = await supabaseAdmin
        .from("founding_narrative")
        .select("version")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (latest?.version ?? 0) + 1;

      await supabaseAdmin.from("founding_narrative").update({ is_current: false }).eq("is_current", true);

      const { data: created, error } = await supabaseAdmin
        .from("founding_narrative")
        .insert({
          version: nextVersion,
          authored_by_account_id: req.auth!.accountId,
          language: language ?? "en",
          title,
          origin_story: originStory,
          founding_principles: foundingPrinciples,
          relationship_to_yoruba: relationshipToYoruba,
          founding_date_or_era: foundingDateOrEra,
          founding_location: foundingLocation,
          sources,
          confidence_level: confidenceLevel,
          is_current: true,
        })
        .select("id, version")
        .single();
      if (error || !created) {
        return res.status(500).json({ error: "failed to publish founding narrative" });
      }
      return res.status(201).json(created);
    }
  );

  // --------------------------------------------------------------------
  // Superadmin-only DIRECT seat appointment — bootstrap/emergency use only
  // (e.g. seeding seats before any election has run, or filling a vacancy
  // left empty with no pending election). Normal seat turnover should go
  // through the election flow in routes/council.ts, not this route — using
  // this to bypass an election defeats the anti-oligarchy safeguards, so
  // treat it as a break-glass tool, not routine governance.
  // --------------------------------------------------------------------
  router.post(
    "/admin/council-seats/:seatNumber/appoint",
    requireAuth(supabaseAdmin),
    requireRole("superadmin"),
    async (req, res) => {
      const { accountId } = req.body ?? {};
      const seatNumber = Number(req.params.seatNumber);
      if (!accountId) return res.status(400).json({ error: "accountId is required" });

      await supabaseAdmin
        .from("council_terms")
        .update({ term_end: new Date().toISOString().slice(0, 10) })
        .eq("seat_number", seatNumber)
        .is("term_end", null);

      const { data: seat } = await supabaseAdmin
        .from("council_seats")
        .select("term_length_years")
        .eq("seat_number", seatNumber)
        .single();
      const termStart = new Date();
      const expectedEnd = new Date(termStart);
      expectedEnd.setFullYear(expectedEnd.getFullYear() + (seat?.term_length_years ?? 9));

      const { error } = await supabaseAdmin.from("council_terms").insert({
        seat_number: seatNumber,
        account_id: accountId,
        term_start: termStart.toISOString().slice(0, 10),
        term_expected_end: expectedEnd.toISOString().slice(0, 10),
        elected_via: "founding_appointment",
      });
      if (error) return res.status(500).json({ error: "failed to appoint council member" });

      const { data: person } = await supabaseAdmin
        .from("persons")
        .select("full_name")
        .eq("account_id", accountId)
        .maybeSingle();
      await supabaseAdmin.from("tribe_announcements").insert({
        title: `Council Seat ${seatNumber} — appointment`,
        body: `${person?.full_name ?? "A member"} has been appointed to Council Seat ${seatNumber}.`,
        posted_by_account_id: req.auth!.accountId,
        pinned: true,
      });

      return res.status(201).json({ seatNumber, accountId, termExpectedEnd: expectedEnd.toISOString().slice(0, 10) });
    }
  );

  return router;
}
