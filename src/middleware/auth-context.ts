import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthContext = {
  authUserId: string;
  accountId: string;
  role: "member" | "admin" | "superadmin" | "verification_admin";
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Verifies the caller's Supabase session and attaches req.auth. Every route
 * below (except GET /api/invite/:token, which is intentionally public — a
 * person can't be authenticated before they have an account) should sit
 * behind this.
 */
export function requireAuth(supabase: SupabaseClient) {
  return async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "missing token" });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: "invalid session" });
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, role")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (accountError || !account) {
      return res.status(401).json({ error: "no account for this session" });
    }

    req.auth = {
      authUserId: userData.user.id,
      accountId: account.id,
      role: account.role,
    };
    next();
  };
}

/** Restricts a route to one or more roles. Chain after requireAuth(). */
export function requireRole(...roles: AuthContext["role"][]) {
  return (req: any, res: any, next: any) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

/**
 * Restricts a route to current members of the tribe governance council —
 * governs both the Founding Narrative and the Mission/Vision statement, and
 * council-related actions like opening/resolving elections. Membership is
 * derived from `council_terms` (term_end is null = currently serving), not
 * a static table — reflects staggered elected terms (migration 005).
 * Chain after requireAuth().
 */
export function requireCouncilMembership(supabase: SupabaseClient) {
  return async (req: any, res: any, next: any) => {
    if (!req.auth) return res.status(401).json({ error: "unauthenticated" });
    const { data, error } = await supabase
      .from("council_terms")
      .select("account_id")
      .eq("account_id", req.auth.accountId)
      .is("term_end", null)
      .maybeSingle();
    if (error || !data) {
      return res.status(403).json({ error: "council membership required" });
    }
    next();
  };
}
