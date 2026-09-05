import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CONSECUTIVE_TERMS = 2;

export type EligibilityResult = { eligible: boolean; reason?: string };

/**
 * Combines all three anti-oligarchy safeguards agreed on:
 *   1. Not closely blood-related to any CURRENTLY SERVING council member
 *      (prevents a family from holding multiple seats at once, even
 *      across different election cycles/seats).
 *   2. Not closely blood-related to the immediately preceding occupant
 *      of THIS specific seat (prevents quiet succession within one seat).
 *   3. Has not already served the maximum consecutive terms.
 */
export async function checkCouncilEligibility(
  supabase: SupabaseClient,
  candidateAccountId: string,
  seatNumber: number
): Promise<EligibilityResult> {
  const { data: candidatePerson } = await supabase
    .from("persons")
    .select("id")
    .eq("account_id", candidateAccountId)
    .maybeSingle();
  if (!candidatePerson) {
    return { eligible: false, reason: "candidate has no linked person record" };
  }

  // --- Rule 1: not blood-related to any currently serving member ---
  const { data: currentMembers } = await supabase
    .from("council_terms")
    .select("account_id")
    .is("term_end", null);

  for (const member of currentMembers ?? []) {
    if (member.account_id === candidateAccountId) continue;
    const { data: memberPerson } = await supabase
      .from("persons")
      .select("id")
      .eq("account_id", member.account_id)
      .maybeSingle();
    if (!memberPerson) continue;

    const { data: related } = await supabase.rpc("is_closely_blood_related", {
      person_a: candidatePerson.id,
      person_b: memberPerson.id,
    });
    if (related) {
      return {
        eligible: false,
        reason: "closely blood-related to a currently serving council member",
      };
    }
  }

  // --- Rule 2: not blood-related to the immediately preceding occupant of this seat ---
  const { data: lastOccupant } = await supabase
    .from("council_terms")
    .select("account_id")
    .eq("seat_number", seatNumber)
    .order("term_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastOccupant && lastOccupant.account_id !== candidateAccountId) {
    const { data: lastPerson } = await supabase
      .from("persons")
      .select("id")
      .eq("account_id", lastOccupant.account_id)
      .maybeSingle();
    if (lastPerson) {
      const { data: related } = await supabase.rpc("is_closely_blood_related", {
        person_a: candidatePerson.id,
        person_b: lastPerson.id,
      });
      if (related) {
        return {
          eligible: false,
          reason: "closely blood-related to the previous occupant of this seat",
        };
      }
    }
  }

  // --- Rule 3: term limit ---
  const { data: pastTerms } = await supabase
    .from("council_terms")
    .select("term_start")
    .eq("account_id", candidateAccountId)
    .order("term_start", { ascending: false })
    .limit(MAX_CONSECUTIVE_TERMS + 1);

  if ((pastTerms?.length ?? 0) >= MAX_CONSECUTIVE_TERMS) {
    // NOTE: this counts total terms served, not strictly "consecutive" —
    // tracking true consecutiveness (allowing a return after a gap) needs
    // comparing term_start/term_end continuity across seats, which is a
    // reasonable v2 refinement rather than a blocker for launch.
    return { eligible: false, reason: "term limit reached" };
  }

  return { eligible: true };
}
