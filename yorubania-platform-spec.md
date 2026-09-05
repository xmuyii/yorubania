# Yorubania Genealogy Platform — Technical Specification (v0.1 Draft)

## 0. Purpose

This document defines the data model, storage architecture, security model, and
succession logic for the Yorubania genealogy platform: a system for members of
the Yorubania tribe (a post-colonial, English-speaking branch of the Yoruba
people) to record, preserve, and pass down their ancestry, media, and personal
vaults across generations — with a design horizon of 1,000 years.

---

## 1. Founding Narrative

A dedicated, first-class record type — not a subtype of Person or Event —
because it documents the origin of the tribe itself, not an individual's
lineage. This record anchors every member's ancestry trace: every Person
record in the system should ultimately be able to trace a path back to (or
declare independence from) this record.

### 1.1 Schema (draft — to be filled in later)

```
FoundingNarrative {
  id
  title                      -- e.g. "The Founding of Yorubania"
  version                    -- narratives may be revised; keep full history
  author_person_id           -- who recorded/authored this version
  date_recorded
  language                   -- English (primary), Yoruba (optional parallel text)

  -- Core content sections
  origin_story               -- long-form narrative text
  founding_principles        -- the values/ideals that define Yorubania
  relationship_to_yoruba     -- explicit statement of the branch relationship
                                 to the broader Yoruba tribe/nation — what is
                                 carried forward, what is distinct
  founding_date_or_era        -- may be approximate/symbolic rather than exact
  founding_location

  -- Supporting material
  oral_testimony_media[]      -- audio/video recordings (elders, founders)
  documents[]                 -- any supporting written material
  praise_poetry / oríkì[]     -- optional, culturally significant record type

  -- Provenance
  sources[]                   -- what this narrative is based on
  confidence_level            -- documented / oral tradition / reconstructed
  review_history[]            -- log of edits/revisions over time, append-only
}
```

### 1.2 Governance — decided
- **Single official canonical record.** No competing versions.
- **Authority to amend:** governed by a **7-seat elected council**
  (see Section 11 for the full election/eligibility design). You hold the
  founding seat now; going forward, seats are filled by **tribe-wide
  election** (every member votes, not family representatives), with
  **staggered 10-year terms** (not all 7 seats turn over at once), a
  **2-consecutive-term limit**, and an **anti-oligarchy blood-relation
  rule**: no two currently serving members may be closely blood-related
  (parent/child/sibling/grandparent/grandchild), and a new occupant of a
  seat cannot be closely blood-related to that seat's immediately
  preceding occupant either. This applies to the Mission/Vision statement
  as well as the Founding Narrative — same council, same rules.
- **Visibility:** public — visible to the general public, not just tribe
  members, since it explains what Yorubania is and stands for.
- Exempt from normal lineage-based access rules entirely (it has none —
  always public, always readable).

*(You'll expand the content itself later today — structure above is a
starting scaffold, not final.)*

---

## 2. Core Data Model

| Entity | Purpose |
|---|---|
| **Person** | Core profile: name, dates, bio, privacy defaults |
| **Relationship** | Graph edge: parent-child, spouse, sibling, adoptive, guardian — with date, source, confidence |
| **Family Unit** | Optional grouping (household/compound) |
| **Event** | Birth, death, marriage, migration, tribe-joining, etc. |
| **Media Asset** | Uploaded file + archival derivative + metadata |
| **Founding Narrative** | See Section 1 |
| **AccessGrant** | Immutable log entry recording who granted whom access to what (Section 5) |
| **Vault** | Per-user encrypted store (Section 6) |
| **VerificationContact** | Admin-only emergency/death-verification info (Section 7) |

Recommended DB: Postgres (Supabase) with either a graph extension or
recursive CTEs over an adjacency table for ancestor/descendant queries.

---

## 3. Storage Architecture

- **Supabase** — primary online store: Postgres + Auth + Storage buckets +
  Row-Level Security (RLS) enforcing lineage-based access at the query layer.
- **Local Postgres (offline backup)** — nightly replication/dump from
  Supabase. Runs on your machine.
- **External hard drive(s)** — rotating backup targets. Recommend **at least
  two drives** (3-2-1 rule: 3 copies, 2 media types, 1 offsite), with periodic
  checksum verification (`pg_verifybackup` or equivalent) and a drive
  replacement schedule (~every 5 years — spinning disks and SSDs are not
  1,000-year media themselves; the *format* is archival, the *hardware* still
  needs active migration).
- **Railway** — application hosting only. Treated as stateless/replaceable;
  never the sole copy of any data.

**Open item:** define the backup rotation schedule and off-site storage plan
(e.g., a drive kept at a second physical location) before launch — no
concrete plan or hardware yet, revisit once the platform has real usage data
to size against.

### 3.1 Family page storage cap
- **50 MB hard cap by default** on media/documents a member uploads to their
  family-facing page (separate cap from the vault's 25 MB, Section 6.1).
- Same enforcement pattern: check cumulative usage against a per-account
  `storage_limit_bytes` field before accepting an upload, not after.
- Purchasable increases, same tiered-plan approach as the vault (e.g., 50 MB
  free / 250 MB / 1 GB / 5 GB), each tier mapping to a stored limit value.

### 3.2 How to cap memory / plan storage spend (practical approach)
Since you're the one paying for the underlying storage, the cap isn't just a
UX feature — it's what keeps your Supabase/storage bill predictable. Practical
approach:
1. **Track usage per account**, not just globally — a running `bytes_used`
   counter on each user's row (vault and family-page tracked separately),
   updated on every upload/delete. Don't calculate it by summing files on
   every request; that gets slow and expensive at scale.
2. **Enforce the cap in your application code before the file leaves the
   upload request** — check `bytes_used + incoming_file_size <=
   storage_limit_bytes`, reject if it exceeds, rather than relying on Supabase
   Storage bucket policies alone (they can help as a backstop, but the
   friendly "you're over your limit, here's how to upgrade" message needs to
   come from your app).
3. **Tiered pricing, not pay-per-MB.** Simpler to reason about, simpler to
   bill, and easier for users to understand ("upgrade to the next tier") than
   granular metered billing. You set tier prices based on your actual
   Supabase storage cost per GB plus margin, once you know your real
   provider pricing.
4. **Reconcile periodically** — a scheduled job that recomputes actual bytes
   used from storage and corrects the counter, in case of bugs or failed
   deletes drifting the number over time.

---

## 4. Archival Format Policy (1,000-Year Horizon)

| Media type | Archival format | Notes |
|---|---|---|
| Photos | TIFF or lossless JPEG 2000 | Open spec, no licensing risk |
| Video | FFV1 in Matroska (.mkv) | Lossless, open-source, archive-standard |
| Audio | WAV/BWF or FLAC | Uncompressed or losslessly compressed |
| Documents | PDF/A (ISO 19005) | Purpose-built for long-term archival |
| Genealogy data | GEDCOM / GEDCOM X | Industry-standard, portable to any future platform |
| Plain text/metadata | UTF-8 text or XML with documented schema | Minimal rot risk |

Rules:
- Store the **original upload** AND a normalized archival derivative — never
  destructively convert.
- Attach **fixity metadata**: SHA-256 checksum at ingest, re-verified on a
  schedule, to catch bit rot.
- Attach **PREMIS/Dublin Core metadata** (creator, date, provenance) to every
  asset.
- Schedule a **format review every 10–20 years**: check for obsolescence risk,
  migrate proactively, log migrations as new versions (never overwrite).

### 4.1 What "fixity" and "metadata" actually mean, in build terms
This sounds academic but it's simple in practice — just two things happening
around every file upload:

**Fixity checksum (detecting file corruption over time):**
- When a file is uploaded, your server runs it through a hash function
  (SHA-256) — this produces a short fixed-length fingerprint of the file's
  exact bytes.
- Store that fingerprint in a `checksum` column next to the file's metadata
  row.
- Periodically (say, monthly via a scheduled job), re-download the stored
  file and re-hash it. If the new hash doesn't match the stored one, the file
  has been corrupted (bit rot, storage error) and you know to restore it from
  a backup — without this, silent corruption could sit undetected for years.
- This is a few lines of code (`hashlib.sha256()` in Python, or the
  equivalent in Node) plus one scheduled job — not a separate system.

**PREMIS/Dublin Core metadata (recording where a file came from):**
- This is just a set of structured fields you store alongside every media
  asset, answering: who created it, when, what it depicts, where it came
  from, what format it's in. In practice, a `media_metadata` table:

```
MediaMetadata {
  media_asset_id
  creator_person_id      -- who uploaded/created it
  date_created
  date_uploaded
  description
  provenance_note         -- e.g. "scanned from family Bible, 1962"
  original_format
  archival_format
  checksum                -- the SHA-256 above
  checksum_last_verified
}
```
- You don't need to adopt the full PREMIS/Dublin Core standard vocabularies
  by name — the value is in **capturing these facts at all**, so that 100
  years from now someone can tell what a file is and where it came from, not
  just that it exists. The table above covers the practically useful subset.

---

## 5. Lineage-Based Access Control

- Visibility rules attach to Person records and can be **field-level** (e.g.,
  medical history vs. photos vs. cause of death can each have different
  rules).
- Access is computed by graph distance/path between viewer and subject
  (descendant, ancestor, sibling, generation-distance) plus explicit
  overrides.
- **Whitelist/blacklist**: individual overrides regardless of general rule.
- **Family-only data** (as opposed to VerificationContact data, Section 7) is
  visible only within the lineage graph — never to admins by default.

### 5.0 Default visibility rules (decided)
- **Sibling → sibling's descendants:** by default, a sibling can see their
  brother/sister's children and the information that sibling uploads
  concerning those children — *unless* that sibling locks specific content
  in their vault, or explicitly revokes the default via a blacklist grant.
- **Parent → own descendants:** every member can deny their own descendants
  access to specific information about themselves, same mechanism as any
  other blacklist — this isn't a special case, just confirming it applies
  uniformly to every relationship type, not only to siblings.
- These are **defaults**, not hard rules — implemented as an automatically
  created `AccessGrant` (status: active, `grantor_id` = the sibling/parent)
  at record-creation time, which the grantor can revoke like any other grant.
  This keeps the "grantor can always revoke, successor never can" rule
  (Section 5.1) consistent — defaults are just grants with a system-generated
  origin.

### 5.1 Immutable AccessGrant log (the succession mechanism)

```
AccessGrant {
  id
  subject_person_id      -- whose info this concerns
  grantor_id              -- who gave the access (account controller at time of grant)
  grantee_id               -- who received it
  scope                    -- field-level or record-level
  visibility_rule
  created_at
  revocable_by             -- always == grantor_id, permanently, never transfers
  status                   -- active / revoked
}
```

- A successor becomes the new `current_controller` for a Person record and
  can create **new** grants — but cannot alter or revoke grants where
  `revocable_by != themselves`.
- This gives a full, auditable history: "X can see this because Y granted it
  on date Z."
- Whitelist/blacklist entries are modeled the same way (grants/denials with a
  preserved `grantor_id`).

---

## 6. The Vault

- One vault per user. Contents can be **split per recipient** at encryption
  time (not just access-control time) — e.g., a letter to one child, a photo
  album to all children, a document to the successor only.
- **Disposition options** (set while alive):
  - Distribute specific items to specific descendants
  - Destroy entirely on death (cryptographic erasure — delete the key)
  - Hybrid of both
- **Decoy vault — mandatory.** Before a user can upload anything real to
  their vault, they must first author a decoy: a fake-looking document,
  doctored to their own taste, convincing enough to pass as genuine to an
  attacker. Real vault upload is gated on decoy creation being complete —
  enforce this at the application layer (vault stays in a "setup" state,
  upload endpoint for real content rejects requests until `decoy_completed =
  true`).
- A wrong decryption key deterministically opens the user-authored decoy.
  This is safer than a synthetic/algorithmic honey-encryption output because
  the user controls exactly what a bad actor would see, and would recognize
  it immediately if it ever surfaced (e.g., leaked online), giving a
  detection signal you don't get from a generic AI-generated fake.
- **Rate limiting + anomaly detection** on vault access attempts remains the
  primary defense; the decoy buys investigation time on top of that, it
  isn't a substitute for throttling.
- Vault always locked to the account holder; unlock only triggers after
  confirmed death (Section 7).

### 6.1 Vault storage cap
- **25 MB hard cap per vault by default.** Enforced at the application layer
  before upload completes (check cumulative size against `vault.storage_limit_bytes`),
  not just at the storage-bucket level, so the user gets a clear "cap reached"
  message instead of a failed silent upload.
- Users can **purchase additional vault capacity** — model as tiers (e.g.,
  25 MB free / 100 MB / 500 MB / 1 GB) rather than arbitrary custom sizes, to
  keep billing and storage-provisioning simple. Each tier maps to a
  `storage_limit_bytes` value on the vault row; purchase just updates that
  field plus a billing record.

---

## 7. Dead Man's Switch & Death Verification

- **365-day check-in**: active re-authentication required (not passive
  activity — must be an explicit "I'm still here" confirmation).
- **Grace period** before verification begins: reminders sent via the
  mandatory contact info below, to filter out simple unreachability
  (hospitalization, travel, etc.) from actual death.
- On missed check-in past the grace period → **death-verification case**
  opened, routed to the verification admin.

### 7.1 VerificationContact record (separate from family-facing data)

```
VerificationContact {
  person_id
  phone
  address
  email
  guarantor_phone
  guarantor_name
  death_verification_notes    -- who to contact, what to do, in the user's own words
  additional_contacts[]        -- may include contacts NOT known to the user's
                                   family — kept private from family view
}
```

- Accessible **only** to the verification admin role.
- Never merged with, or visible alongside, family-facing profile data.
- `death_verification_notes` lets the user leave explicit instructions (who
  to call, in what order, any context the admin needs) beyond raw contact
  details.

### 7.2 Resolution
- Verification admin confirms death (certificate / multi-party attestation)
  or closes the case (user was reachable, false trigger).
- **Only on confirmed death** does the vault unlock and distribute per the
  user's pre-set instructions, and does account succession begin.

---

## 8. Admin & Role Boundaries

| Role | Can access |
|---|---|
| **Verification admin** | VerificationContact table, death-verification case data, audit logs |
| **System/support admin** | System metadata (login history, storage usage), audit logs |
| **Neither role** | Family-facing genealogy content, vault contents — no standing access to either, by default |

- Any support access to account *content* beyond the above requires an
  explicit, user-granted, time-boxed, audit-logged override — never silent
  or default access. This should be an opt-in account setting, not a platform
  default.

### 8.1 Opt-in emergency admin access override
```
AdminAccessGrant {
  id
  account_id
  granted_by_user_id       -- the account owner
  granted_at
  expires_at                -- time-boxed, mandatory — no indefinite grants
  reason                     -- optional free text from the user
  status                     -- active / expired / revoked
  used_at[]                  -- every time an admin actually accessed under this grant
}
```
- Off by default. User turns it on in account settings, sets (or accepts a
  default) expiry.
- While active, an admin may access account content; every access is logged
  (see 8.2) and the user is **notified** (in-app + email) each time an admin
  actually views their information — not just when the grant is created.
- Auto-expires; user can revoke early at any time.

### 8.2 Universal account access audit log
Independent of the above — this applies to **all** access to an account, by
anyone (the owner logging in, family members viewing shared content, or an
admin under an active override):
```
AccessLog {
  id
  account_id                -- whose account/data was accessed
  accessor_user_id
  accessor_role              -- self / family_member / admin / verification_admin
  timestamp
  ip_address
  approximate_location        -- derived from IP (city/region-level, not precise GPS)
  action                       -- login / view_record / view_media / vault_access_attempt / etc.
}
```
- Always on, not opt-in — this is baseline security logging, distinct from
  the admin-override consent flow above.
- Surface a simplified view of this to the account owner ("your account was
  accessed from Lagos, Nigeria on [date]") so they can spot anything
  unfamiliar themselves, not just rely on admins catching it.

---

## 9. Succession Logic

- Account holder designates their successor (account controller) while
  alive.
- On confirmed death:
  - Successor becomes `current_controller` of the deceased's Person record
    and account.
  - **All pre-existing AccessGrants remain in force exactly as set** — the
    successor cannot revoke them (enforced structurally via `revocable_by`,
    Section 5.1).
  - Successor **can** create new grants going forward, controlling access
    for anyone who joins the lineage or requests access from that point on.
  - Descendants continue to inherit ancestry/genealogy data by default, but
    can be excluded from specific non-lineage information per the original
    grant rules.
- **Must always resolve to exactly one controller. Resolution mechanism
  (decided):**
  1. **Family vote** — all eligible descendants/members with standing to
     vote (defined per-family; nearest-generation descendants by default)
     cast a vote; majority becomes controller.
  2. **Fallback to eldest child** — if there aren't enough participating
     members to hold a valid vote (quorum not met) or no one lays claim,
     control passes automatically to the eldest child.
- This applies both to normal succession (a pre-designated successor who is
  unreachable or declines) and to the no-inheritor fallback case below —
  same two-path logic either way.

### 9.1 Fallback (no designated or reachable inheritor)
- Nearest direct descendants (graph-distance function: children first, then
  grandchildren, etc.) are notified and the same **vote → eldest-child
  fallback** resolution above applies.

**Still open:** exact quorum threshold for a valid vote, voting window
length, and how ties are broken if there are multiple "eldest" candidates
(e.g., twins, or eldest from different marriages) — worth deciding before
this flow is built, but not blocking on the rest of the system.

---

## 10. Membership & Account Creation

**There is no public signup.** No "create account" link exists anywhere on
the homepage, dashboard, or any public page. Every account is created
through one of two closed paths:

### 10.1 Admin-registered path
- An admin registers a person's name into the system (e.g., "Muyiwa
  Ifakande").
- This generates a **unique, single-use invite link** tied to that specific
  registration — e.g. `ancestralvault.com/muyiwa` (final URL scheme TBD, but
  functionally: one link, one pending registration).
- The admin shares that link with the person.
- Once followed and the account is claimed (password set, etc.), the link is
  **permanently consumed** — reusing an old link, or any link from a
  since-claimed registration, must fail. Store `status: pending | claimed` on
  the registration and check it server-side on every link visit, not just at
  claim time.

### 10.2 Member-invited path
- An existing member can invite someone **only if that person is already
  their relative** — the inviting member must first specify the new person's
  **name and relationship to themselves** (e.g., "my daughter, Funmi").
- This creates the Person record and Relationship edge *before* any account
  exists, then generates a single-use claim link (same consumption rule as
  10.1).
- Once Funmi claims the link, her account is automatically connected into
  the graph at the relationship already specified — she doesn't join
  "generically," she joins already positioned in her family's lineage.
- **No member can invite an unrelated person.** Unrelated people can only
  enter via an admin (10.1).

### 10.3 Membership eligibility (decided)
- Anyone who is able to hold an account on the system — whether admitted via
  blood relation or via admin registration for other reasons — **is by that
  fact recognized as Yorubanian.** Having an account is the qualifying
  criterion, not bloodline.
- Members who aren't Yorubanian by blood may still separately identify as
  Yoruba if they choose; the two identities aren't exclusive.

```
PersonRegistration {
  id
  full_name
  registered_by_user_id      -- admin or inviting member
  relationship_to_inviter     -- required if registered_by is a regular member; null if admin
  invite_token                 -- unique, single-use
  status                        -- pending / claimed / expired
  created_at
  claimed_at
  claimed_by_user_id
}
```

---

## 11. Admin Roles & Hierarchy, and Tribe Council Governance

### 11.1 Admin roles
- **Superadmin**: can create and revoke admin accounts. This is the only
  role with that power.
- **Admin**: can register new Person records and generate invite links
  (Section 10.1), handles death-verification cases (Section 7), and can be
  granted temporary account-content access only via the user's own opt-in
  override (Section 8.1). **Cannot** create or revoke other admins — that
  privilege is not delegable below superadmin.
- Enforce this at the authorization layer with a strict role check (not just
  a UI hiding of the "create admin" button) — `create_admin` and
  `revoke_admin` actions check `role == superadmin`, full stop.

### 11.2 Tribe governance council (decided)
A 7-seat council governs both the Founding Narrative (Section 1) and the
Mission/Vision statement (Section 12). Designed specifically to resist
capture by any single family, including the founder's own:

- **Tribe-wide election**, not family representatives or council
  self-selection. Every member with a claimed account gets one vote per
  election — evaluated and rejected two alternatives during design:
  - *A permanent founder-descendant seat*: rejected — institutionalizes
    exactly the founder-family privilege the tribe is meant to avoid, even
    at just 1 of 7 seats.
  - *Council recommends its own successors*: rejected — small
    self-perpetuating groups reliably drift toward insularity even without
    blood ties, by recruiting people similar to themselves.
- **Staggered 10-year terms.** Seats are split into two cohorts (3 seats /
  4 seats) on offset election cycles, so the council never fully turns
  over in a single election — preserves continuity while still rotating.
- **2-consecutive-term limit** per seat occupant.
- **Anti-oligarchy blood-relation rule**, two parts:
  1. No two *currently serving* council members may be closely
     blood-related (parent/child/sibling/grandparent/grandchild) —
     prevents one family from holding multiple seats at once, even across
     different election cycles.
  2. A new occupant of a seat may not be closely blood-related to that
     *specific seat's* immediately preceding occupant — prevents quiet
     succession within a single seat even after the predecessor has left
     the council.
- **Open nomination**: any member may nominate any other member (or
  themselves) — not restricted to the council, so incumbents don't control
  the candidate pool.
- **Transparency**: current council composition, how each member got their
  seat, and when each term ends are all visible to members — treated as
  itself an anti-oligarchy safeguard, not just a nicety.

**Left open, worth revisiting once there's a real second generation of
members:** the term-limit tracking currently counts total terms served
rather than strictly consecutive terms (a member could theoretically leave
and return after a gap) — flagged as an acceptable v1 simplification, not a
permanent decision.

---

## 12. Tribe Mission/Vision, Timeline & General News

A shared, non-genealogical section every member sees on their account —
what connects members regardless of blood relation (Section 10.3):

- **Mission/Vision statement** — versioned like the Founding Narrative,
  exactly one current version, edited by the same governance council
  (Section 11.2).
- **1000-year timeline** — anchored to a canonical `founding_date`
  (separate from the Founding Narrative's descriptive, possibly-symbolic
  founding date/era text). Every member's account shows: years/days
  elapsed since founding, years remaining toward the 1000-year milestone,
  percent complete, and which **named era phase** the tribe is currently
  living in (see the seeded era list — Founding Era, Root-Laying Era,
  Expansion Era, Consolidation Era, Renewal Era, Continuity Era, Reflection
  Era, Approach Era, Millennial Threshold, and an open-ended "The Next
  Thousand" phase beyond year 1000).
- **General announcements/news feed** — visible to all members, posting
  restricted to the council, separate from personal genealogy content.

---

## 13. Authorization Architecture (Decided — No RLS)

To avoid tying enforcement logic to Postgres/Supabase specifically, access
control is enforced in a **single application-layer authorization module**,
not database Row-Level Security:
- One shared function, e.g. `canAccess(accessorAccountId, subjectPersonId,
  scope)`, walks the AccessGrant log (Section 5.1) and lineage graph and
  returns a decision.
- Every API route that reads or writes Person/Relationship/Vault/AccessGrant
  data must call this before returning data — treated as a mandatory
  middleware, not an optional per-route check.
- **Portability benefit:** if the platform ever moves off Supabase/Postgres,
  this one module is what gets ported — no policy syntax rewrite across
  dozens of RLS rules.
- **Tradeoff to accept:** this relies on code discipline (every new endpoint
  must call the check) rather than a database-level backstop. Recommend
  covering this with tests that assert every data-returning route invokes
  the authorization module, rather than relying on developers remembering.

## 14. Vault Encryption & Backup/Migration Safety

**Key finding: server-managed encryption (e.g., a KMS-held key) does not
actually prevent admins from seeing vault contents** — it protects against
external attackers, but anyone with database + KMS access (including you,
future admins, or a compromised backup) can still decrypt. This applies
during normal operation, during backups, and during any future data
migration alike — the risk is the same in all three cases, since it's about
*who holds the key*, not *where the bytes currently live*.

**Decided approach: zero-knowledge / client-side encryption.**
- The vault's encryption key is derived from the user's own passphrase on
  their device, using a slow key-derivation function (Argon2id recommended).
- Only ciphertext + a salt + KDF parameters are ever sent to or stored by
  the server.
- The server, its backups, its admins, and any future migration target never
  hold anything capable of decrypting vault contents — only the user's
  passphrase can.
- **This is also what makes the vault genuinely platform-independent**:
  decryption depends only on the passphrase and stored salt/KDF params, not
  on Supabase, Railway, or any specific host. Migrating hosting providers
  just means copying the ciphertext bytes and their salt/KDF metadata
  faithfully — decryption works identically afterward.
- **Explicit tradeoff, decide before building:** if a user forgets their
  passphrase, the vault is permanently unrecoverable — by design, since
  there's no backdoor to lose. Confirm this is the tradeoff you want versus
  offering some recovery mechanism (which would necessarily weaken the "no
  one but the user can ever see it" guarantee).
- **Schema note:** the `encrypted_master_key` column on `vaults` in
  `schema_v0.sql` assumed server-side envelope encryption and should be
  reconsidered — under zero-knowledge encryption, replace it with
  `kdf_salt` and `kdf_params` columns instead (no key material stored at
  all, server-side).

---

---

## 16. Family Branches, Achievements Feed, Member Directory

- **Family branches**: an explicit entity, not a flat surname field —
  captures branching (a family splitting off from another, with a founding
  person, date, and origin note), so members can browse an actual tree of
  families rather than a list of last names. A member can found a new
  branch for themselves (optionally recording which branch it split from);
  new children/siblings inherit the inviting relative's branch by default
  (Section 10.2's invite flow), other relationship types are left
  unassigned by default.
- **Community achievements feed**: member-generated, distinct from the
  council's official announcements (Section 12) — anyone can post their
  own accomplishment. No moderation gate in v1 (flagged as an open item).
- **Member directory**: opt-in (default off, consistent with "members
  start private"), deliberately minimal — name, photo, family branch only.
  Never surfaces genealogical data; that stays governed entirely by the
  lineage-based AccessGrant system (Section 5) regardless of directory
  visibility. Lets unrelated members find and reconnect with each other
  without weakening the privacy model built for actual family data.

---

## 17. Open Items Before Building

Resolved in this revision: succession mechanism, sibling/descendant default
visibility, decoy vault (now mandatory), storage caps, admin access override,
audit logging, membership/invite flow, admin hierarchy, founding narrative
governance, authorization architecture (app-layer, no RLS), vault encryption
approach (zero-knowledge/client-side), invite link duplicate-name handling
(non-issue — tokens are random, not name-based). Still open:

1. **Founding Narrative** — content itself (you're drafting this).
2. **Vote quorum & tie-break rules** (Section 9) — exact quorum threshold,
   voting window length, and tie-break when there's more than one "eldest"
   candidate.
3. **Backup rotation schedule** — no concrete plan or hardware yet; revisit
   once there's real usage data to size drives against.
4. **Legal review** — digital inheritance/estate handling varies by
   jurisdiction; worth a legal consult once you're targeting real users,
   particularly around the vault-as-inheritance-mechanism piece.
5. **Passphrase recovery policy** (Section 14) — whether forgotten
   passphrases mean permanent vault loss, or whether some recovery path is
   offered at the cost of weakening the zero-knowledge guarantee. Needs a
   decision before the vault upload/unlock flow is built.
6. **Argon2id parameter tuning and KDF library choice** for the client-side
   encryption implementation — a build-time task, not a design question, but
   flagged so it doesn't get skipped.

---

*End of v0.1 draft. Update as sections are filled in.*
