import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";
import { calculateAge, calculateYorubanianBirthYear } from "../policies/profile-requirements";

export function accountRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.get("/accounts/me", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: fullAccount } = await supabaseAdmin
      .from("accounts")
      .select("custodial_handover_required")
      .eq("id", req.auth!.accountId)
      .maybeSingle();

    const { data: person } = await supabaseAdmin
      .from("persons")
      .select("id, full_name, date_of_birth, profile_image_media_id")
      .eq("account_id", req.auth!.accountId)
      .maybeSingle();

    const { data: councilTerm } = await supabaseAdmin
      .from("council_terms")
      .select("seat_number, term_expected_end")
      .eq("account_id", req.auth!.accountId)
      .is("term_end", null)
      .maybeSingle();

    const age = person ? calculateAge(person.date_of_birth) : null;
    const yorubanianBirthYear = person
      ? await calculateYorubanianBirthYear(supabaseAdmin, person.date_of_birth)
      : null;

    return res.json({
      accountId: req.auth!.accountId,
      role: req.auth!.role,
      custodialHandoverRequired: fullAccount?.custodial_handover_required ?? false,
      person: person
        ? {
            id: person.id,
            fullName: person.full_name,
            dateOfBirth: person.date_of_birth,
            profileImageMediaId: person.profile_image_media_id,
            age,
            yorubanianBirthYear,
          }
        : null,
      councilSeat: councilTerm
        ? { seatNumber: councilTerm.seat_number, termExpectedEnd: councilTerm.term_expected_end }
        : null,
    });
  });

  return router;
}
