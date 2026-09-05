# Yorubania Platform — Build Start

## Structure so far

```
migrations/
  001 (schema_v0.sql, already run)         core tables
  002_vault_security_mode.sql              Extra Safe / Standard vault modes
  003_relationship_path_function.sql       graph-distance lookup for authorization
  004_tribe_mission_and_timeline.sql        mission/vision, era phases, announcements
  005_council_governance.sql                elected council: seats, staggered terms,
                                              elections, blood-relation eligibility check
  006_era_phases_seed.sql                    named 1000-year era phases (first-draft wording)
  007_council_terms_and_leadership_display.sql  9yr/4yr cohort term lengths, term_expected_end,
                                              profile images, tribe_settings (founder record)
  008_families_achievements_directory.sql    family branches (with splitting), member
                                              achievements feed, opt-in directory visibility
  009_backups_and_recovery_custodian.sql      system backup tracking, member export log

src/
  auth/
    authorization.ts        canAccess() — the ONE place access decisions are made
    supabase-adapter.ts      wires authorization.ts to Supabase; swap this file
                              only, if the platform ever migrates databases
  vault/
    crypto.ts                 client-side (browser) encryption — Argon2id + AES-GCM
    recovery-admin.ts          offline-only admin recovery tool, Standard mode only
  relationships/
    default-grants.ts          materializes sibling-default-visibility grants
                                (Section 5.0) when relationships are added or
                                backfills them when an account is claimed
    supabase-graph-adapter.ts  Supabase implementation of default-grants.ts's interface
  governance/
    council-eligibility.ts      the three anti-oligarchy checks (blood-relation to
                                  current members, blood-relation to seat's
                                  predecessor, term limit)
  middleware/
    auth-context.ts             resolves a Supabase session into req.auth (accountId, role);
                                  also requireCouncilMembership for governance-gated routes
  routes/
    invite.ts                    admin registration, member-invites-relative,
                                   public invite lookup, public claim endpoint
    tribe.ts                      mission/vision + 1000-year timeline overview,
                                    general announcements feed
    founding-narrative.ts          public read, council-gated versioned edits,
                                     superadmin break-glass seat appointment
    council.ts                     elections: open, nominate, vote, resolve —
                                     auto-announces openings and winners to the
                                     news feed, sets term_expected_end from the
                                     seat's cohort length (9yr / 4yr)
    leadership.ts                   GET /api/tribe/leadership — founder photo +
                                     all 7 council seats (occupant or vacant),
                                     for the dashboard leadership display
    profile.ts                      lets a member set their own public profile
                                     image (used by the leadership display)
    families.ts                      family-branch directory, branch detail
                                       (members + sub-branches that split off it),
                                       founding a new branch, correcting your own
    achievements.ts                   member-generated accomplishments feed
    directory.ts                      opt-in member search across the whole
                                        tribe — name/photo/branch only, never
                                        genealogical data
    vault.ts                           vault init, mandatory decoy upload,
                                         real item upload/download/delete —
                                         server only ever handles ciphertext
    media.ts                           family-page media upload/download,
                                         fixity checksum, lineage-authorized
    backup.ts                          system backup (any admin/superadmin),
                                         30-day staleness check, vault recovery
                                         custodian designation + logged requests,
                                         member self-export
  storage/
    supabase-storage.ts                 thin wrapper over Supabase Storage —
                                          all downloads go through the API,
                                          never a direct public bucket URL
  server.ts                       minimal Express bootstrap (Railway entrypoint)

nixpacks.toml                    tells Railway's build to install postgresql-client
                                  (pg_dump) — required for backup.ts to work
.env.example                     required environment variables

scripts/
  generate-recovery-keypair.ts    run ONCE, offline (see step 6 below)
```

## Setup order

1. Run `migrations/002_vault_security_mode.sql` against your existing Supabase
   database (schema_v0.sql should already be applied).
2. Run `migrations/003_relationship_path_function.sql`.
3. `npm install`.
4. Set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   (server-side only, never exposed to a client bundle), `PORT` (Railway
   sets this automatically).
5. **If you haven't already** (this was originally appended directly to
   schema_v0.sql and may have been missed): run
   `migrations/003b_media_and_founding_narrative_catchup.sql`. Without this,
   migration 007 and anything touching profile images or the Founding
   Narrative will fail with "relation does not exist" errors.
6. Run `migrations/004_tribe_mission_and_timeline.sql`,
   `005_council_governance.sql`, `006_era_phases_seed.sql`,
   `007_council_terms_and_leadership_display.sql`,
   `008_families_achievements_directory.sql`, and
   `009_backups_and_recovery_custodian.sql` in order. Then seed your
   own founding council seat and founder record:
   ```sql
   insert into council_terms (seat_number, account_id, term_start, term_expected_end, elected_via)
   values (1, '<your account id>', current_date, current_date + interval '9 years', 'founding_appointment');

   insert into tribe_settings (key, value)
   values ('founder_account_id', to_jsonb('<your account id>'::text));

   -- Designates who may request Standard-mode vault recovery. Start with
   -- yourself; reassign later to a specific council seat's occupant if
   -- that's how you want to formalize the role.
   insert into tribe_settings (key, value)
   values ('vault_recovery_custodian_account_id', to_jsonb('<your account id>'::text));
   ```
7. **Create the storage bucket**: in the Supabase dashboard, Storage → New
   bucket → name it exactly `yorubania-storage` → set it **Private**.
   `vault.ts`, `media.ts`, and `backup.ts` all write to this bucket.
8. **For system backups** (`backup.ts`): set a `DATABASE_URL` environment
   variable — this is Supabase's **direct Postgres connection string**
   (Project Settings → Database → Connection string), which is different
   from `SUPABASE_URL` (the REST API endpoint). `pg_dump` needs this to
   actually dump the database. Locally, you also need the `postgresql-client`
   package installed so the `pg_dump` binary exists on your machine; on
   Railway, `nixpacks.toml` in this project handles that automatically.
7. **One-time, offline, before any Standard-mode vault can be created** —
   see `scripts/generate-recovery-keypair.ts` for exact steps. Short
   version: copy this project to a machine you trust, `npm install` first
   (needs network), then disconnect and run
   `npx tsx scripts/generate-recovery-keypair.ts`. It prints a public key
   (goes into `platform_recovery_keys` via SQL) and a private key (written
   down physically, never saved digitally). Skipping this just means
   Standard-mode vaults aren't available yet — Extra Safe still works fine
   without it.
8. Publish an initial mission/vision (`POST /api/tribe/mission`, council
   membership required — you'll have it after step 6) and at least one
   Founding Narrative version (`POST /api/founding-narrative`) so
   `/api/tribe/overview` and `/api/founding-narrative` have something to
   return.
9. `npm run build && node dist/server.js` (or wire up `ts-node`/`tsx` for
   local dev) to run the API.

## What's implemented

- **Vault security mode choice** (Extra Safe / Standard) — schema and
  crypto both support it; `security_mode` is set per-vault at creation.
- **Zero-knowledge encryption** for both modes — the passphrase-derived key
  path is identical either way; Standard mode adds a second, sealed
  recovery path that only an offline private key can open.
- **Authorization module** — `canAccess()` covers self-access, explicit
  denials (blacklist, always wins), and explicit/default grants (whitelist,
  sibling-default-visibility). No RLS — logic lives entirely in
  `authorization.ts`, portable to any future backend by rewriting only
  `supabase-adapter.ts`.
- **Default-grant materialization** (`default-grants.ts`) — sibling
  default-visibility grants are created automatically the moment a
  qualifying relationship is recorded, and backfilled at account-claim time
  for any direction that was deferred because the grantee had no account
  yet. Fully idempotent.
- **Invite API routes** (`routes/invite.ts`):
  - `POST /api/admin/register-person` — admin/superadmin only, no relationship
    implied (Section 10.1).
  - `POST /api/members/invite-relative` — any member, requires naming the
    relationship, creates the Person + Relationship edge immediately and
    applies whatever default grants that unlocks (Section 10.2). Always
    anchored to the caller's own Person record — structurally cannot attach
    a new person to someone else's branch.
  - `GET /api/invite/:token` — public, returns only the display name for
    the claim page.
  - `POST /api/invite/:token/claim` — public, creates the auth user +
    account, links it to the pre-existing Person record, permanently
    consumes the token, and backfills deferred default grants.
- **Vault storage** (`routes/vault.ts`) — `POST /vaults/me/init` (records
  KDF salt/params + security mode), `POST /vaults/me/decoy` (mandatory
  gate), `POST /vaults/me/items` (enforces the 25MB cap), `GET .../items`,
  `GET .../items/:id/download`, `DELETE .../items/:id`. The server only
  ever handles ciphertext — encryption/decryption happens client-side
  using `vault/crypto.ts`.
- **Family media storage** (`routes/media.ts`) — upload (enforces the
  50MB cap, computes a SHA-256 fixity checksum), download (gated through
  `canAccess()` — the same lineage-based authorization as everything
  else), delete. Archival-format conversion (TIFF/FFV1/PDF-A derivatives)
  is NOT included yet — files are stored as uploaded; flagged below.
- **System backups & recovery** (`routes/backup.ts`) — any admin or
  superadmin can trigger a full Postgres dump (`POST /admin/backups/system`,
  via `pg_dump`) and check staleness (`GET /admin/backups/status`, flags
  overdue past 30 days). A single designated "vault recovery custodian"
  account (superadmin-settable) can log a Standard-mode vault recovery
  request, which auto-announces to the whole tribe for transparency. Any
  member can self-export their own accessible data as JSON
  (`GET /members/me/export`).
- **Tribe mission/vision + 1000-year timeline** (`routes/tribe.ts`):
  - `GET /api/tribe/overview` — member-facing "general section": mission
    statement, years/days elapsed since founding, years remaining toward
    the 1000-year milestone, percent complete, and which named era phase
    (from `tribe_era_phases`) the tribe is currently in.
  - `POST /api/tribe/mission` — council-only, publishes a new version
    (immutable history, same pattern as the Founding Narrative).
  - `GET` / `POST /api/tribe/announcements` — general news feed, posting
    restricted to the council.
- **Founding Narrative routes** (`routes/founding-narrative.ts`):
  - `GET /api/founding-narrative` — public (not just members).
  - `POST /api/founding-narrative` — council-only, versioned.
  - `POST` / `DELETE /api/admin/council-members` — superadmin-only for now;
    this is how you (as founder/superadmin) currently control who else can
    edit the Founding Narrative and Mission/Vision.

## Not yet built (next steps)

- **Archival-format conversion pipeline** — uploaded media is stored
  as-is; converting to TIFF/FFV1-MKV/PDF-A archival derivatives (spec
  Section 4) needs actual transcoding tools (ffmpeg etc.) and is a
  separate piece of work from the storage routes themselves.
- **Storage-bucket backup/sync** — `backup.ts`'s system backup covers
  Postgres metadata only. The actual vault/media ciphertext bytes live in
  Supabase Storage, not Postgres, so they're NOT included in a
  `pg_dump`-based backup. A real offline copy of the full system needs a
  separate bucket-sync mechanism (e.g. a script that downloads every
  object to local disk/hard drive) — not built yet.
- **Death-verification and succession-vote workflows** — schema exists
  (`death_verification_cases`, `succession_cases`, `succession_votes`); no
  application logic yet. (Not to be confused with `council.ts`'s election
  routes, which are built — this is the separate system for transferring
  control of a *deceased member's own account*, not a council seat.) This
  also means `vault_distributions` (who inherits which vault item on
  death) has schema but no redemption flow yet.
- **Explicit whitelist/blacklist API** — users need an endpoint to create
  their own AccessGrant rows (including denials) beyond the system
  defaults; not built yet.
- **Front-end** — every route built so far is API-only; nothing renders any
  of it yet.

## Deploying to Railway — what you can host right now

The API compiles and boots cleanly (`npm run build && npm start`), so you
*can* deploy it today. Be clear-eyed about what that gets you, though:
**a live backend API with no user interface.** Nobody can sign up through a
webpage yet — you'd be interacting with it via `curl`/Postman/similar, or
building a frontend against it. If what you pictured was "a website people
can use," that's not this yet — see the frontend gap above.

What **does** work end-to-end today, callable as an API right now:
admin/member invite + claim flow, tribe mission/timeline overview, founding
narrative (read + council-edited versions), council elections (open,
nominate, vote, resolve — with all the eligibility rules), the leadership
display, profile images, family branches, the achievements feed, the
opt-in member directory, **vault init/decoy/upload/download**, **family
media upload/download**, and **system backups + the 30-day staleness
check**.

What will 404/500 if called today: whitelist/blacklist grants, death
verification, or succession-of-account — none of those have routes yet.

### Steps
1. Make sure every migration through `009_backups_and_recovery_custodian.sql`
   (including the `003b` catch-up file) has been run against your Supabase
   project, that you've seeded your founder/council row and both
   `tribe_settings` entries (Setup order, steps 5–6 above), and that
   you've created the `yorubania-storage` bucket (step 7).
2. Push this project to a GitHub repo (Railway deploys from a repo, or you
   can use the Railway CLI to deploy a local folder directly if you'd
   rather skip GitHub for now).
3. In Railway: **New Project → Deploy from GitHub repo** (or `railway up`
   from the CLI in this folder).
4. Railway auto-detects Node from `package.json`. Confirm the build command
   is `npm run build` and the start command is `npm start` (Railway
   usually infers these correctly from the scripts already in
   `package.json`, but check under Settings → Deploy if it guesses wrong).
   `nixpacks.toml` is already in the repo, so Railway will also install
   `postgresql-client` automatically for `pg_dump`.
5. Under **Variables**, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   (from your Supabase project's API settings — use the **service role**
   key, never the anon key, since several routes need to bypass normal
   client restrictions by design), and `DATABASE_URL` (the direct Postgres
   connection string, for backups). Don't set `PORT` — Railway provides it
   automatically and `server.ts` already reads `process.env.PORT`.
6. Deploy. Railway gives you a public URL
   (`your-app.up.railway.app`) — test it with something like:
   ```
   curl https://your-app.up.railway.app/api/founding-narrative
   ```
   (expect a 404 with "no current founding narrative published yet" until
   you've posted one via `POST /api/founding-narrative`).
7. **Before inviting real people to use it**: there's still no frontend —
   see the frontend section of this README, and the remaining "Blocking"
   items below (whitelist/blacklist, death verification, succession).

## Path to production — what's left

Organized by how blocking each item is. Updated to reflect everything built
through the family branches / achievements / directory / council-election
work — quite a lot has moved out of this list since it was first drafted.

### Blocking (nothing real should launch without these)
- [ ] **Explicit whitelist/blacklist API** — members need a way to create
      their own AccessGrant rows (including denials) beyond the automatic
      sibling defaults — not built yet.
- [ ] **Death-verification workflow app logic** — schema exists
      (`death_verification_cases`, `verification_contacts`); no routes for
      the 365-day check-in, admin case handling, or triggering succession
      on confirmed death.
- [ ] **Succession voting app logic** — schema exists
      (`succession_cases`, `succession_votes`); no routes for opening a
      vote, casting votes, resolving to the eldest-child fallback on low
      quorum, or transferring `current_controller_account_id`. Also needed
      for `vault_distributions` redemption (who inherits which vault item).
- [ ] **Frontend** — needed before any non-technical person can actually
      use this.
- [ ] **Archival-format conversion pipeline** — media is currently stored
      as-uploaded; converting to the long-term archival formats (spec
      Section 4) is separate work needing transcoding tools.
- [ ] **Storage-bucket backup/sync** — `pg_dump`-based system backups
      (now built) cover Postgres metadata only, NOT the actual vault/media
      ciphertext bytes sitting in Supabase Storage. A real full-system
      offline copy needs a separate bucket-sync script.
- [ ] **Terms of service / privacy policy** — needed before any real
      person's data or payment goes into the system; also worth having a
      lawyer confirm the vault/inheritance mechanism is sound in whatever
      jurisdiction(s) your members are in (flagged earlier as open item).
- [ ] **Backup hardware + rotation schedule** — you don't have the drives
      yet; needed before there's real data worth losing.

### Important, not strictly blocking a small early launch
- [ ] **Media fixity-check scheduled job** — re-hash stored files on a
      timer, flag mismatches. Fine to defer briefly, but bit rot doesn't
      announce itself, so don't defer long.
- [ ] **Council election scheduling automation** — right now a council
      member has to manually call `POST /council/elections` when a seat
      comes up; nothing tracks "seat 4 is due in 2036" and reminds anyone.
- [ ] **Rate limiting on auth endpoints** (login, invite-claim, vault
      access attempts) — mentioned in the original design as a primary
      defense alongside the decoy vault; not implemented in any route yet.
- [ ] **Storage billing integration** — the tiered storage-cap model
      (Section 3.2/6.1) is designed but not connected to any actual
      payment processor.
- [ ] **Achievements feed moderation** — v1 has no review gate; any member
      can post anything under their own name. Fine for a small trusted
      cohort, worth revisiting before wider growth.
- [ ] **Founding Narrative and Mission/Vision content** — you're writing
      these; routes are ready to receive them whenever they're done.

### Good to have before wider growth, not needed for a first small cohort
- [ ] Duplicate-invite protection (two registrations for the same real
      person).
- [ ] Field-level default-grant scoping (currently only `"full_record"`).
- [ ] True consecutive-term tracking for council eligibility (currently
      counts total terms, noted as a v1 simplification).
- [ ] Automated tests covering the authorization module and eligibility
      rules — given how much of this system's trust rests on those two
      pieces behaving correctly, this is worth prioritizing earlier than
      "nice to have" once there's time.

### Suggested order of attack from here
1. Vault + media upload routes (the core value proposition — nothing else
   matters if people can't actually store things).
2. Explicit whitelist/blacklist API (closes the loop on the access-control
   system you designed first).
3. Death-verification + succession app logic (the other core promise of
   the platform).
4. A minimal frontend covering: invite claim, vault upload, tree browsing,
   council voting, the leadership/family/achievements/directory pages that
   already have working API routes behind them.
5. Everything else, once real usage tells you what's actually urgent.

## Decisions this build assumed, worth confirming

- `authorization.ts` denies by default when no grant exists — new members
  start maximally private and opt into sharing via defaults/explicit
  grants, not the reverse.
- `invite-relative` requires the inviter to already have a linked Person
  record (i.e., they must be a claimed member themselves) — an unclaimed
  registration cannot invite anyone yet, by construction.
- Scope granularity is currently just `"full_record"` for defaults — the
  spec allows field-level scopes (e.g. `field:medical_history`), but no UI
  or route yet lets a user restrict a default grant down to a specific
  field. Worth deciding whether that's a v1 requirement or a later
  refinement.
