import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Adult" here means: date_of_birth is known and indicates 18+, OR
 * date_of_birth is unknown entirely. An unknown birthdate is treated as
 * adult (the stricter case) rather than assumed to be a minor — we'd
 * rather ask an unnecessary photo of a data-entry gap than silently
 * exempt someone who simply hasn't set their birthdate yet.
 */
export function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age--;
  return age;
}

/** "Born in Year N of Yorubania" — relative to the tribe's founding_date. */
export async function calculateYorubanianBirthYear(
  supabase: SupabaseClient,
  dateOfBirth: string | null
): Promise<number | null> {
  if (!dateOfBirth) return null;
  const { data: mission } = await supabase
    .from("tribe_mission")
    .select("founding_date")
    .eq("is_current", true)
    .maybeSingle();
  if (!mission) return null;
  const founding = new Date(mission.founding_date);
  const dob = new Date(dateOfBirth);
  const years = (dob.getTime() - founding.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.floor(years);
}

/**
 * Enforces: an adult account must have a profile picture set on their
 * Person record before they can add a relationship or upload anything
 * (vault or family media). Minors (date_of_birth indicates under 18) are
 * exempt from the photo requirement entirely.
 */
export async function checkProfileRequirement(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: person } = await supabase
    .from("persons")
    .select("id, date_of_birth, profile_image_media_id")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!person) return { allowed: false, reason: "no linked person record" };

  const age = calculateAge(person.date_of_birth);
  const isMinor = age !== null && age < 18;
  if (isMinor) return { allowed: true };

  if (!person.profile_image_media_id) {
    return {
      allowed: false,
      reason:
        "a profile picture is required before adding relationships or uploading, unless your account is registered as under 18",
    };
  }
  return { allowed: true };
}

/**
 * Age/birthdate visibility: self, family (any active AccessGrant covering
 * this person — the same defaults/explicit grants used everywhere else),
 * or an admin/superadmin. This is a DELIBERATE, narrow exception to the
 * "admins have no special data access" principle used throughout the rest
 * of the platform — scoped only to age/birthdate, per explicit decision.
 */
export async function canViewAge(
  supabase: SupabaseClient,
  accessorAccountId: string,
  accessorRole: string,
  subjectPersonId: string
): Promise<boolean> {
  if (accessorRole === "admin" || accessorRole === "superadmin") return true;

  const { data: subject } = await supabase
    .from("persons")
    .select("account_id")
    .eq("id", subjectPersonId)
    .maybeSingle();
  if (subject?.account_id === accessorAccountId) return true;

  const { data: grant } = await supabase
    .from("access_grants")
    .select("id")
    .eq("subject_person_id", subjectPersonId)
    .eq("grantee_account_id", accessorAccountId)
    .eq("status", "active")
    .eq("is_denial", false)
    .maybeSingle();
  return !!grant;
}
