import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";

/**
 * Powers the display described as: "a picture of the founder, underneath
 * it pictures/tabs for the 7 council seats" — shown under the Founding
 * Narrative / mission section on every member's dashboard. Vacant seats
 * are returned as `occupant: null` so the frontend can render an empty
 * tab rather than omitting the seat entirely.
 */
export function leadershipRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/tribe/leadership", requireAuth(supabaseAdmin), async (_req, res) => {
    const { data: founderSetting } = await supabaseAdmin
      .from("tribe_settings")
      .select("value")
      .eq("key", "founder_account_id")
      .maybeSingle();
    const founderAccountId = founderSetting?.value as string | undefined;

    let founder = null;
    if (founderAccountId) {
      const { data: founderPerson } = await supabaseAdmin
        .from("persons")
        .select("full_name, profile_image_media_id")
        .eq("account_id", founderAccountId)
        .maybeSingle();
      founder = founderPerson
        ? {
            accountId: founderAccountId,
            fullName: founderPerson.full_name,
            profileImageMediaId: founderPerson.profile_image_media_id,
          }
        : null;
    }

    const { data: seats } = await supabaseAdmin
      .from("council_seats")
      .select("seat_number, cohort, term_length_years")
      .order("seat_number", { ascending: true });

    const { data: currentTerms } = await supabaseAdmin
      .from("council_terms")
      .select("seat_number, account_id, term_start, term_expected_end")
      .is("term_end", null);

    const seatDetails = await Promise.all(
      (seats ?? []).map(async (seat) => {
        const term = (currentTerms ?? []).find((t) => t.seat_number === seat.seat_number);
        if (!term) {
          return { ...seat, occupant: null };
        }
        const { data: person } = await supabaseAdmin
          .from("persons")
          .select("full_name, profile_image_media_id")
          .eq("account_id", term.account_id)
          .maybeSingle();
        return {
          ...seat,
          occupant: {
            accountId: term.account_id,
            fullName: person?.full_name ?? null,
            profileImageMediaId: person?.profile_image_media_id ?? null,
            termStart: term.term_start,
            termExpectedEnd: term.term_expected_end,
          },
        };
      })
    );

    return res.json({ founder, councilSeats: seatDetails });
  });

  return router;
}
