/**
 * Concrete implementation of DbClient (authorization.ts) backed by Supabase.
 * This is the ONLY file that would need a rewrite if the platform ever
 * migrates off Supabase — the authorization logic itself stays untouched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbClient, RelationshipStep, AccessGrantRow } from "./authorization";

export function createSupabaseDbClient(supabase: SupabaseClient): DbClient {
  return {
    async getPerson(personId: string) {
      const { data, error } = await supabase
        .from("persons")
        .select("id, account_id")
        .eq("id", personId)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id, accountId: data.account_id };
    },

    async getActiveGrants(subjectPersonId: string, granteeAccountId: string): Promise<AccessGrantRow[]> {
      const { data, error } = await supabase
        .from("access_grants")
        .select("id, scope, is_denial, status")
        .eq("subject_person_id", subjectPersonId)
        .eq("grantee_account_id", granteeAccountId)
        .eq("status", "active");
      if (error || !data) return [];
      return data.map((row) => ({
        id: row.id,
        scope: row.scope,
        isDenial: row.is_denial,
        status: row.status,
      }));
    },

    // Used for computing generation distance (e.g. to decide whether a
    // fallback default like "sibling sees sibling's children" applies before
    // an explicit AccessGrant row even exists). Implemented as a bounded
    // recursive walk — depth-limited to avoid runaway queries on large trees.
    async getRelationshipPath(fromAccountId: string, toPersonId: string): Promise<RelationshipStep[]> {
      const { data, error } = await supabase.rpc("get_relationship_path", {
        from_account_id: fromAccountId,
        to_person_id: toPersonId,
        max_depth: 4,
      });
      if (error || !data) return [];
      return data as RelationshipStep[];
    },
  };
}
