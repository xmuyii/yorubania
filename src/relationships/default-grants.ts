/**
 * Materializes the default-visibility rules from spec Section 5.0:
 *   "My brother by default sees my children and what I upload about them,
 *    unless I lock it in my vault or explicitly revoke it."
 *
 * These defaults are just AccessGrant rows with a system-generated origin —
 * NOT a separate rule engine. Once created, they behave exactly like any
 * other grant: the grantor (and only the grantor) can revoke them later
 * (spec Section 5.1), and they survive succession unchanged.
 *
 * A default grant can only be created once its GRANTEE has an account (you
 * can't grant access to someone with no account to log into). Since a
 * relationship can be recorded before the other party claims their invite
 * (spec Section 10.2), this module provides two entry points:
 *
 *   - applyDefaultGrantsForRelationship(): call right after a relationship
 *     is inserted. Creates whatever grants are possible immediately;
 *     silently skips any direction whose grantee has no account yet.
 *   - syncDefaultGrantsForPerson(): call right after a person claims their
 *     account. Re-walks all of their relationships and backfills any
 *     defaults that were skipped earlier because they had no account.
 *
 * Idempotent throughout — safe to call syncDefaultGrantsForPerson multiple
 * times, or to re-run applyDefaultGrantsForRelationship for the same edge.
 */

const DEFAULT_SCOPE = "full_record";

export type PersonRef = { id: string; accountId: string | null };

export type RelationshipEdge = {
  id: string;
  personAId: string;
  personBId: string;
  type: "parent_child" | "spouse" | "sibling" | "adoptive_parent" | "guardian";
};

export interface GraphDbClient {
  getPersonWithAccount(personId: string): Promise<PersonRef | null>;
  getSiblingPersons(personId: string): Promise<PersonRef[]>;
  getSpousePersons(personId: string): Promise<PersonRef[]>;
  getChildPersons(parentPersonId: string): Promise<PersonRef[]>;
  getRelationshipsForPerson(personId: string): Promise<RelationshipEdge[]>;
  grantExists(
    subjectPersonId: string,
    grantorAccountId: string,
    granteeAccountId: string,
    scope: string
  ): Promise<boolean>;
  insertDefaultGrant(row: {
    subjectPersonId: string;
    grantorAccountId: string;
    granteeAccountId: string;
    scope: string;
  }): Promise<void>;
}

async function createIfMissing(
  db: GraphDbClient,
  subjectPersonId: string,
  grantorAccountId: string,
  granteeAccountId: string
) {
  if (grantorAccountId === granteeAccountId) return; // never grant to yourself
  const exists = await db.grantExists(
    subjectPersonId,
    grantorAccountId,
    granteeAccountId,
    DEFAULT_SCOPE
  );
  if (!exists) {
    await db.insertDefaultGrant({
      subjectPersonId,
      grantorAccountId,
      granteeAccountId,
      scope: DEFAULT_SCOPE,
    });
  }
}

/**
 * Parent-child edge: parent's existing siblings AND parent's spouse
 * default into seeing the new child's record. The spouse case is what
 * makes "both parents see their children's uploads by default" work,
 * regardless of which parent the child's relationship edge names.
 */
async function applyParentChildDefaults(
  db: GraphDbClient,
  parentId: string,
  childId: string
) {
  const parent = await db.getPersonWithAccount(parentId);
  if (!parent?.accountId) return; // parent must have an account to be a grantor

  const parentSiblings = await db.getSiblingPersons(parentId);
  for (const sibling of parentSiblings) {
    if (!sibling.accountId) continue; // defer until sibling claims their account
    await createIfMissing(db, childId, parent.accountId, sibling.accountId);
  }

  const parentSpouses = await db.getSpousePersons(parentId);
  for (const spouse of parentSpouses) {
    if (!spouse.accountId) continue; // defer until spouse claims their account
    await createIfMissing(db, childId, parent.accountId, spouse.accountId);
  }
}

/**
 * Spouse edge: each spouse's EXISTING children become visible to the
 * other spouse by default, in both directions — same shape as sibling
 * defaults, just for a co-parent relationship instead of a sibling one.
 */
async function applySpouseDefaults(
  db: GraphDbClient,
  personAId: string,
  personBId: string
) {
  for (const [ownerId, viewerId] of [
    [personAId, personBId],
    [personBId, personAId],
  ] as const) {
    const owner = await db.getPersonWithAccount(ownerId);
    const viewer = await db.getPersonWithAccount(viewerId);
    if (!owner?.accountId || !viewer?.accountId) continue;

    const children = await db.getChildPersons(ownerId);
    for (const child of children) {
      await createIfMissing(db, child.id, owner.accountId, viewer.accountId);
    }
  }
}

/**
 * Sibling edge: each sibling's EXISTING children become visible to the
 * other sibling by default, in both directions.
 */
async function applySiblingDefaults(
  db: GraphDbClient,
  personAId: string,
  personBId: string
) {
  for (const [ownerId, viewerId] of [
    [personAId, personBId],
    [personBId, personAId],
  ] as const) {
    const owner = await db.getPersonWithAccount(ownerId);
    const viewer = await db.getPersonWithAccount(viewerId);
    if (!owner?.accountId || !viewer?.accountId) continue; // defer if either side unclaimed

    const children = await db.getChildPersons(ownerId);
    for (const child of children) {
      await createIfMissing(db, child.id, owner.accountId, viewer.accountId);
    }
  }
}

export async function applyDefaultGrantsForRelationship(
  db: GraphDbClient,
  relationship: RelationshipEdge
) {
  if (relationship.type === "parent_child") {
    // convention: personAId = parent, personBId = child
    await applyParentChildDefaults(db, relationship.personAId, relationship.personBId);
  } else if (relationship.type === "sibling") {
    await applySiblingDefaults(db, relationship.personAId, relationship.personBId);
  } else if (relationship.type === "spouse") {
    await applySpouseDefaults(db, relationship.personAId, relationship.personBId);
  }
  // adoptive_parent / guardian: no default-visibility rule defined in the
  // spec yet — intentionally a no-op until one is specified.
}

/**
 * Call after a person claims their account. Re-walks every relationship
 * they're part of and creates any default grant that couldn't be created
 * earlier because this person (as grantee) had no account yet.
 */
export async function syncDefaultGrantsForPerson(db: GraphDbClient, personId: string) {
  const relationships = await db.getRelationshipsForPerson(personId);
  for (const relationship of relationships) {
    await applyDefaultGrantsForRelationship(db, relationship);
  }
}
