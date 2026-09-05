import type { SupabaseClient } from "@supabase/supabase-js";
import type { GraphDbClient, PersonRef, RelationshipEdge } from "./default-grants";

export function createSupabaseGraphClient(supabase: SupabaseClient): GraphDbClient {
  return {
    async getPersonWithAccount(personId): Promise<PersonRef | null> {
      const { data, error } = await supabase
        .from("persons")
        .select("id, account_id")
        .eq("id", personId)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id, accountId: data.account_id };
    },

    async getSiblingPersons(personId): Promise<PersonRef[]> {
      const { data, error } = await supabase
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "sibling")
        .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`);
      if (error || !data) return [];

      const siblingIds = data.map((r) =>
        r.person_a_id === personId ? r.person_b_id : r.person_a_id
      );
      if (siblingIds.length === 0) return [];

      const { data: persons } = await supabase
        .from("persons")
        .select("id, account_id")
        .in("id", siblingIds);
      return (persons ?? []).map((p) => ({ id: p.id, accountId: p.account_id }));
    },

    async getSpousePersons(personId): Promise<PersonRef[]> {
      const { data, error } = await supabase
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "spouse")
        .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`);
      if (error || !data) return [];

      const spouseIds = data.map((r) =>
        r.person_a_id === personId ? r.person_b_id : r.person_a_id
      );
      if (spouseIds.length === 0) return [];

      const { data: persons } = await supabase
        .from("persons")
        .select("id, account_id")
        .in("id", spouseIds);
      return (persons ?? []).map((p) => ({ id: p.id, accountId: p.account_id }));
    },

    async getChildPersons(parentPersonId): Promise<PersonRef[]> {
      const { data, error } = await supabase
        .from("relationships")
        .select("person_b_id")
        .eq("relationship_type", "parent_child")
        .eq("person_a_id", parentPersonId); // convention: a = parent, b = child
      if (error || !data) return [];

      const childIds = data.map((r) => r.person_b_id);
      if (childIds.length === 0) return [];

      const { data: persons } = await supabase
        .from("persons")
        .select("id, account_id")
        .in("id", childIds);
      return (persons ?? []).map((p) => ({ id: p.id, accountId: p.account_id }));
    },

    async getRelationshipsForPerson(personId): Promise<RelationshipEdge[]> {
      const { data, error } = await supabase
        .from("relationships")
        .select("id, person_a_id, person_b_id, relationship_type")
        .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`);
      if (error || !data) return [];
      return data.map((r) => ({
        id: r.id,
        personAId: r.person_a_id,
        personBId: r.person_b_id,
        type: r.relationship_type,
      }));
    },

    async grantExists(subjectPersonId, grantorAccountId, granteeAccountId, scope) {
      const { data, error } = await supabase
        .from("access_grants")
        .select("id")
        .eq("subject_person_id", subjectPersonId)
        .eq("grantor_account_id", grantorAccountId)
        .eq("grantee_account_id", granteeAccountId)
        .eq("scope", scope)
        .eq("status", "active")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },

    async insertDefaultGrant(row) {
      await supabase.from("access_grants").insert({
        subject_person_id: row.subjectPersonId,
        grantor_account_id: row.grantorAccountId,
        grantee_account_id: row.granteeAccountId,
        scope: row.scope,
        is_denial: false,
        status: "active",
        // Fixed permanently at creation — this is what makes the grant
        // survive succession untouched (spec Section 5.1/9).
        revocable_by_account_id: row.grantorAccountId,
      });
    },
  };
}
