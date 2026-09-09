import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middleware/auth-context";
import { createSupabaseDbClient } from "../auth/supabase-adapter";
import { canAccess } from "../auth/authorization";

/**
 * "Our History" — each person's chapters, sealed at will, assembled into a
 * lineage's book. Sealing rule, enforced here exactly as decided:
 *   - A chapter sealed manually can ONLY be unsealed by the same account
 *     that sealed it.
 *   - A chapter sealed via confirmed death (sealed_via = 'death_confirmed')
 *     can NEVER be unsealed by anyone — the unseal route hard-blocks this
 *     regardless of who's asking, since the deceased's own account can
 *     never again prove it's them.
 */
export function biographyRoutes(supabaseAdmin: SupabaseClient) {
  const router = Router();
  const db = createSupabaseDbClient(supabaseAdmin);

  async function ownPerson(accountId: string) {
    const { data } = await supabaseAdmin
      .from("persons")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    return data;
  }

  router.post("/persons/me/chapters", requireAuth(supabaseAdmin), async (req, res) => {
    const { title, body } = req.body ?? {};
    if (!title || !body) return res.status(400).json({ error: "title and body are required" });

    const person = await ownPerson(req.auth!.accountId);
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data: latest } = await supabaseAdmin
      .from("biography_chapters")
      .select("chapter_order")
      .eq("person_id", person.id)
      .order("chapter_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("biography_chapters")
      .insert({
        person_id: person.id,
        title,
        body,
        chapter_order: (latest?.chapter_order ?? -1) + 1,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !data) return res.status(500).json({ error: "failed to create chapter" });
    return res.status(201).json(data);
  });

  router.patch("/chapters/:id", requireAuth(supabaseAdmin), async (req, res) => {
    const { title, body } = req.body ?? {};
    const person = await ownPerson(req.auth!.accountId);
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data: chapter } = await supabaseAdmin
      .from("biography_chapters")
      .select("id, person_id, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!chapter || chapter.person_id !== person.id) {
      return res.status(404).json({ error: "chapter not found" });
    }
    if (chapter.status !== "draft") {
      return res.status(403).json({ error: "sealed chapters cannot be edited — unseal it first" });
    }

    const { error } = await supabaseAdmin
      .from("biography_chapters")
      .update({ title, body, updated_at: new Date().toISOString() })
      .eq("id", chapter.id);
    if (error) return res.status(500).json({ error: "failed to update chapter" });
    return res.json({ ok: true });
  });

  router.post("/chapters/:id/seal", requireAuth(supabaseAdmin), async (req, res) => {
    const person = await ownPerson(req.auth!.accountId);
    if (!person) return res.status(400).json({ error: "no linked person record" });

    const { data: chapter } = await supabaseAdmin
      .from("biography_chapters")
      .select("id, person_id, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!chapter || chapter.person_id !== person.id) {
      return res.status(404).json({ error: "chapter not found" });
    }
    if (chapter.status === "sealed") return res.status(409).json({ error: "already sealed" });

    const { error } = await supabaseAdmin
      .from("biography_chapters")
      .update({
        status: "sealed",
        sealed_at: new Date().toISOString(),
        sealed_by_account_id: req.auth!.accountId,
        sealed_via: "manual",
      })
      .eq("id", chapter.id);
    if (error) return res.status(500).json({ error: "failed to seal chapter" });
    return res.json({ ok: true });
  });

  // The one place the "must not be unsealed" rule is actually enforced.
  router.post("/chapters/:id/unseal", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: chapter } = await supabaseAdmin
      .from("biography_chapters")
      .select("id, status, sealed_by_account_id, sealed_via")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!chapter) return res.status(404).json({ error: "chapter not found" });
    if (chapter.status !== "sealed") return res.status(409).json({ error: "not sealed" });

    if (chapter.sealed_via === "death_confirmed") {
      return res.status(403).json({
        error: "chapters sealed on confirmed death can never be unsealed, by anyone",
      });
    }
    if (chapter.sealed_by_account_id !== req.auth!.accountId) {
      return res.status(403).json({ error: "only the account that sealed this chapter may unseal it" });
    }

    const { error } = await supabaseAdmin
      .from("biography_chapters")
      .update({ status: "draft", sealed_at: null, sealed_by_account_id: null, sealed_via: null })
      .eq("id", chapter.id);
    if (error) return res.status(500).json({ error: "failed to unseal chapter" });
    return res.json({ ok: true });
  });

  // Self sees everything (drafts + sealed, so they can preview how a draft
  // WOULD look once sealed). Anyone else sees only sealed chapters, each
  // individually gated by its own scope — life_goals chapters need the
  // stricter descendant-only check, ordinary chapters use 'biography'.
  router.get("/persons/:personId/chapters", requireAuth(supabaseAdmin), async (req, res) => {
    const { data: subject } = await supabaseAdmin
      .from("persons")
      .select("id, account_id")
      .eq("id", req.params.personId)
      .maybeSingle();
    if (!subject) return res.status(404).json({ error: "person not found" });

    const isSelf = subject.account_id === req.auth!.accountId;

    let query = supabaseAdmin
      .from("biography_chapters")
      .select("id, title, body, chapter_order, status, chapter_type, sealed_at, sealed_via")
      .eq("person_id", subject.id)
      .order("chapter_order", { ascending: true });
    if (!isSelf) query = query.eq("status", "sealed");

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: "failed to fetch chapters" });

    if (isSelf) return res.json({ chapters: data ?? [] });

    const visible = [];
    for (const chapter of data ?? []) {
      const scope = chapter.chapter_type === "life_goals" ? "life_goals" : "biography";
      const decision = await canAccess(db, req.auth!.accountId, subject.id, scope);
      if (decision.allowed) visible.push(chapter);
    }
    return res.json({ chapters: visible });
  });

  // Assembles the "book": sealed chapters from ancestors (oldest first,
  // each gated individually through canAccess) followed by the requested
  // person's own sealed chapters.
  router.get("/persons/:personId/book", requireAuth(supabaseAdmin), async (req, res) => {
    const rootId = req.params.personId;
    const { data: rootPerson } = await supabaseAdmin
      .from("persons")
      .select("id, full_name")
      .eq("id", rootId)
      .maybeSingle();
    if (!rootPerson) return res.status(404).json({ error: "person not found" });

    // Walk ancestors, oldest-first (reverse BFS order).
    const chain: { id: string; fullName: string }[] = [];
    let frontier = [rootId];
    const visited = new Set([rootId]);
    while (frontier.length > 0) {
      const { data: parentEdges } = await supabaseAdmin
        .from("relationships")
        .select("person_a_id, person_b_id")
        .eq("relationship_type", "parent_child")
        .in("person_b_id", frontier);
      const nextFrontier: string[] = [];
      for (const edge of parentEdges ?? []) {
        if (!visited.has(edge.person_a_id)) {
          visited.add(edge.person_a_id);
          nextFrontier.push(edge.person_a_id);
        }
      }
      frontier = nextFrontier;
    }

    const ancestorIds = [...visited].filter((id) => id !== rootId);
    if (ancestorIds.length > 0) {
      const { data: ancestorPersons } = await supabaseAdmin
        .from("persons")
        .select("id, full_name")
        .in("id", ancestorIds);
      chain.push(...(ancestorPersons ?? []).reverse().map((p) => ({ id: p.id, fullName: p.full_name })));
    }
    chain.push({ id: rootPerson.id, fullName: rootPerson.full_name });

    const bookChapters: any[] = [];
    for (const person of chain) {
      const { data: chapters } = await supabaseAdmin
        .from("biography_chapters")
        .select("id, title, body, chapter_order, chapter_type, sealed_at")
        .eq("person_id", person.id)
        .eq("status", "sealed")
        .order("chapter_order", { ascending: true });

      const visibleChapters = [];
      for (const chapter of chapters ?? []) {
        if (person.id === rootId) {
          visibleChapters.push(chapter);
          continue;
        }
        const scope = chapter.chapter_type === "life_goals" ? "life_goals" : "biography";
        const decision = await canAccess(db, req.auth!.accountId, person.id, scope);
        if (decision.allowed) visibleChapters.push(chapter);
      }

      if (visibleChapters.length > 0) {
        bookChapters.push({ authorPersonId: person.id, authorFullName: person.fullName, chapters: visibleChapters });
      }
    }

    return res.json({ rootPersonId: rootId, sections: bookChapters });
  });

  return router;
}
