/**
 * Central authorization module. EVERY route that reads or writes
 * Person / Relationship / Vault / AccessGrant data must call canAccess()
 * before returning data. This is the single source of truth for access
 * decisions — deliberately kept out of database-specific policy syntax
 * (no RLS) so it can be ported to any future database/platform intact.
 *
 * Uses a generic query interface rather than importing @supabase/supabase-js
 * directly, so swapping the underlying database later doesn't require
 * rewriting this file — only the adapter that implements DbClient.
 */

export type Scope = string; // e.g. "full_record", "field:medical_history", "media:vault"

export interface DbClient {
  getPerson(personId: string): Promise<{ id: string; accountId: string | null } | null>;
  getRelationshipPath(fromAccountId: string, toPersonId: string): Promise<RelationshipStep[]>;
  getActiveGrants(subjectPersonId: string, granteeAccountId: string): Promise<AccessGrantRow[]>;
}

export type RelationshipStep = {
  type:
    | "self"
    | "parent"
    | "child"
    | "sibling"
    | "spouse"
    | "grandparent"
    | "grandchild"
    | "other";
  generationDistance: number; // 0 = self, 1 = parent/child/sibling, 2 = grandparent/grandchild, etc.
};

export type AccessGrantRow = {
  id: string;
  scope: Scope;
  isDenial: boolean;
  status: "active" | "revoked";
};

export type AccessDecision = {
  allowed: boolean;
  reason: string;
};

/**
 * Determines whether `accessorAccountId` may access `scope` of data
 * concerning `subjectPersonId`.
 *
 * Order of evaluation (denials always win — a blacklist entry overrides
 * any default or general grant, per spec Section 5):
 *   1. Self-access — always allowed.
 *   2. Explicit denial (blacklist) covering this scope — deny immediately.
 *   3. Explicit or default grant (whitelist / sibling-default / etc.)
 *      covering this scope — allow.
 *   4. No matching grant — deny by default.
 */
export async function canAccess(
  db: DbClient,
  accessorAccountId: string,
  subjectPersonId: string,
  scope: Scope
): Promise<AccessDecision> {
  const subjectPerson = await db.getPerson(subjectPersonId);
  if (!subjectPerson) {
    return { allowed: false, reason: "subject not found" };
  }

  // 1. Self-access
  if (subjectPerson.accountId === accessorAccountId) {
    return { allowed: true, reason: "self" };
  }

  // Pull every AccessGrant (including system-generated defaults, e.g.
  // sibling-default-visibility, Section 5.0) concerning this subject and
  // this specific accessor.
  const grants = await db.getActiveGrants(subjectPersonId, accessorAccountId);

  const matchesScope = (grantScope: Scope) =>
    grantScope === scope || grantScope === "full_record";

  // 2. Denials win outright, regardless of any other grant present.
  const denial = grants.find((g) => g.isDenial && matchesScope(g.scope));
  if (denial) {
    return { allowed: false, reason: `explicit denial (grant ${denial.id})` };
  }

  // 3. Any active, non-denial grant covering this scope allows access.
  const allow = grants.find((g) => !g.isDenial && matchesScope(g.scope));
  if (allow) {
    return { allowed: true, reason: `active grant (${allow.id})` };
  }

  // 4. Default deny.
  return { allowed: false, reason: "no matching grant" };
}

/**
 * Express/Fastify-style middleware wrapper. Attach to any route handling
 * Person/Vault/etc. data. Intentionally throws rather than silently
 * continuing on failure, so a missing scope argument fails loudly in
 * development rather than defaulting open.
 */
export function requireAccess(db: DbClient, scope: Scope) {
  return async (req: any, res: any, next: any) => {
    const accessorAccountId = req.auth?.accountId;
    const subjectPersonId = req.params?.personId;

    if (!accessorAccountId || !subjectPersonId) {
      return res.status(400).json({ error: "missing accessor or subject" });
    }

    const decision = await canAccess(db, accessorAccountId, subjectPersonId, scope);
    if (!decision.allowed) {
      return res.status(403).json({ error: "forbidden", reason: decision.reason });
    }
    next();
  };
}
