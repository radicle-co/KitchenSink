---
type: feat
status: proposed
date: 2026-07-18
origin: specs/001-commise-recipe-app (C-007, FR-013b) + identity (002) + food (003); supersedes Track B of docs/plans/2026-07-18-001-feat-gdpr-erasure-hardening-coordination-plan.md
title: 'Account closure vs. erasure — the permanent-ULID identity anchor (Track B / CR-002)'
---

# Account closure vs. erasure — the permanent-ULID identity anchor

> **Supersedes** the "cross-service anonymization coordinator" sketch. Two grounded investigations + **three
> rounds of five-persona doc-review + a full plan-vs-worktree reconciliation + a GDPR erasure code-audit**
> shaped this. All owner questions are resolved (KTDs); corrections are folded in (ratings-by-deletion,
> **admin-mediated recovery**, deletion-worker orchestration, U4a/U4b split, the two-axis `visibility`+`status`
> privacy scope, **lifecycle-aware provisioning (R10)**, the **food-erasure leg**, and **author-handle
> scrub**). The GDPR audit confirmed this CR is the remediation for real shipped erasure gaps (see "Shipped-state
> gaps this CR closes"). Ready for sign-off as **CR-002** once the audit-driven units are accepted; one PR on
> the `001-commise-recipe-app` worktree.

---

## Guiding principle — the ULID is a permanent anchor

Every service references a user by the **app-user ULID** (identity's `users.id`), an **opaque value with no
cross-service FK** (D2). The identity **profile row is never hard-deleted** — the ULID must always resolve,
because recipes (`owner_id`), collections, ratings, and food requesters point at it. **Closure** and
**erasure** differ in one axis: **which profile fields survive** — and, for erasure, **which owned content is
removed vs. donated vs. anonymized.** Downstream data keys on the durable ULID, so it is unaffected — except
food, which today keys on the Clerk `sub` and must be migrated to the ULID (U1).

The design is **domain-event routing, not a saga**: closure and erasure are two events dispatched to
per-service handlers, anchored on the stable ULID, with a lightweight completion contract on the erasure path.

---

## Summary

Two distinct, both-legitimate lifecycle events:

- **Account closure** — recoverable, soft. Triggered ONLY by the app's own "close account" action. The
  platform **bans** the Clerk identity (`banUser` — durable, reversible, **not** delete) and tombstones the
  profile to `{ id, name }`, scrubbing email, avatar, sessions. Because the Clerk `sub` survives, an
  **admin-mediated `unbanUser` restores the same ULID** → name + recipes come back (recovery is
  support-mediated, not self-service — see KTD-1). Recipes, collections, food
  references are untouched. We scrub aggressively anyway (good-GDPR-citizen).
- **True erasure** (right to be forgotten) — irreversible, the ONLY path that **deletes** the Clerk identity.
  Reduce the profile to `{ id }` only. Per the user's per-recipe election, their **owner-only** recipes
  (private, or public-visibility **drafts** — a draft is owner-only regardless of visibility) are **removed**
  unless the user **elected to publish** specific ones (donate). **All the user's collections are removed.** The user's **ratings on others' recipes are deleted** (per-user rating rows removed); the CR-001
  statement-level trigger then re-derives each affected recipe's average from the surviving rows, so the erased
  user's stars **no longer count** — true anonymization, no per-user row survives. **Truly-public**
  (`visibility='public' AND status='published'`) + donated recipes stay, attributed to the **pseudonymized** ULID.

**Pseudonymized, not anonymized (compliance note).** Retained public/donated recipes stay attributed to the
stable ULID — that is **pseudonymized personal data** (GDPR Recital 26), still in scope, needing a stated
Art. 17(3) basis (see Risks). Ratings, by contrast, are **anonymized** at erasure (the per-user rating rows are
deleted; the aggregate re-derives without them) — no ULID-attributable rating survives, and the erased user's
stars leave the public average.

The only cross-service _data-model_ change is a correctness fix: food must key requesters by the app ULID, not
the Clerk `sub` (U1).

---

## Key Technical Decisions

- **KTD-1 — Closure BANS (durable, reversible), erasure DELETES the Clerk identity.** **Spike passed
  (2026-07-20):** `@clerk/backend` v1.34.0 exposes `banUser`/`unbanUser` (`POST /users/{id}/ban|unban`, no
  duration param) — a durable, admin-reversible hold that **preserves the user record and `sub`** and blocks
  sign-in; `lockUser` (auto-expiring account-lockout) is explicitly **rejected**. The Clerk mutation calls
  live in the **identity-webhooks deletion-worker Lambda**, which already holds the Clerk secret + an admin
  client (`identityClient.ts` — already does `deleteUser`/`updateUser`, though that `deleteUser` is **dead code
  today**) and is already the enqueue target of `deleteUserMe` — so **no Clerk secret is added to the
  public-ALB service.** **Recovery correction (GDPR code-audit):** the spike proved `banUser`/`unbanUser` exist
  — it did NOT prove a self-service recovery primitive, and there is none (`@clerk/backend` v1.34.0 has no
  server-side sign-in-attempt verification; a banned user can't sign in to be verified). **Recovery is
  therefore admin/support-mediated `unbanUser`** (optionally re-admitting via `createSignInToken`), not a
  self-service handshake. _(resolves OQ1)_
- **KTD-2 — The `user.deleted` webhook = full erasure.** No in-app Clerk delete UI exists (verified — the app
  renders its own delete button → its own backend, never `<UserProfile>`), so `user.deleted` only arrives from
  our own erasure (idempotent confirmation), an admin dashboard deletion, or test. All → **erasure**; no
  user election on this path → **defaults to `delete`**, and **alarms**. It is system-authorized via a **new
  service-principal auth path** into recipe-service (U4a) — NOT a phrase-bypass flag (see U4a/Risks). _(resolves
  OQ2)_
- **KTD-3 — 12-month tombstone → auto-erasure: policy decided, enforcement is an owner-accepted, time-boxed
  risk.** The automated sweep is deferred; **no in-CR control ships.** Recorded as an owner-accepted
  compliance risk with a hard due-by = the first closure's 12-month mark (≈1 year of runway before any
  tombstone binds). _(resolves OQ3)_
- **KTD-4 — One PR, the `001-commise-recipe-app` worktree.** U1 ships here (food + recipe/identity deploy as
  separate CDK stacks, so one PR ≠ one deploy — see the U1 rollback-boundary note). _(resolves OQ4)_
- **KTD-5 — Erasure content disposition.** **Removed:** every **owner-only** recipe (`visibility='private'`
  OR `status='draft'` — a draft is owner-only regardless of visibility) not elected for publish + **all** the
  user's collections. **Anonymized:** the user's ratings on others' recipes (per-user rows deleted; the CR-001
  trigger re-derives the aggregate without them — no manual aggregate write). **Kept, pseudonymized:**
  **truly-public** recipes (`visibility='public' AND status='published'`) + donated recipes (published as part
  of erasure). _(resolves OQ5)_

---

## Pattern Register _(per CLAUDE.md — Design-pattern-first)_

- **Opaque cross-service reference (D2).** Per-user ids are bare unenforced ULIDs, never an FK. Extended to
  food (U1). No FK — cross-database FKs are forbidden and would couple a must-persist profile.
- **Policy / Specification module (new).** Two authoritative rules, each in one place: (A) _field-scrub_ —
  which profile fields survive per event; (B) _content-disposition_ — remove / anonymize / keep per owned
  data class (KTD-5). Consumed by U2 and U3a/b/c, not open-coded.
- **Strategy (kept).** The owner-only-recipe erasure **election** (`delete` | `publish` per recipe; default
  `delete`) is a per-request strategy persisted on `account_erasure_jobs` (durable row is source of truth; the
  sweeper reconstructs the message from it).
- **Domain-event routing + minimal completion contract (NOT a full Saga).** Closure/erasure are events per
  service. A full orchestration Saga stays rejected; the erasure path (identity scrub + recipe erasure)
  carries a lightweight completion contract: idempotent hand-off, DLQ-exhausted erasure → "erasure incomplete"
  alarm, reconciliation query for silently-lost legs.
- **Reuse — transactional Outbox + SQS + DLQ + scheduled Sweeper.** The recipe erasure leg reuses the shipped
  `account-erasure` worker/sweeper — routed through recipe-service's `POST /v1/account/erasure` (respecting
  the Track A bookkeeping interlock), never a raw enqueue.

---

## Requirements

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | The identity profile row (ULID) MUST NOT be hard-deleted on closure OR erasure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | KTD; D2                   |
| R2  | On **closure**, the platform **bans** (`banUser`) the Clerk identity — never deletes it — and the profile retains `{ id, name }`; email, sessions, avatar (col + S3) MUST be scrubbed. A later admin-mediated `unbanUser` restores the same ULID (recoverable via support, not self-service — Clerk has no server-side sign-in-attempt verification, see KTD-1).                                                                                                                                                                                                                                                                        | KTD-1                     |
| R3  | On **erasure**, the platform **deletes** the Clerk identity; the profile retains `{ id }` only; name, email, avatar (col + S3), and any Clerk-`sub`-derived placeholder MUST be destroyed. No recovery.                                                                                                                                                                                                                                                                                                                                                                                                                                 | KTD-1; GDPR Art. 17       |
| R4  | On **erasure**: **owner-only** recipes (`visibility='private'` OR `status='draft'`) are **removed** unless **elected to publish** (donate, which sets `visibility='public' AND status='published'`); **all collections removed**; the user's **ratings on others' recipes are anonymized** by **deleting the per-user rating rows** and letting the CR-001 statement-level trigger re-derive the aggregate (NO manual aggregate write — the two columns are trigger-only); **truly-public** (`public AND published`) + donated recipes kept, pseudonymized ULID. Applied **eventually** across identity + recipe (not atomic — see R7). | KTD-5                     |
| R5  | Food MUST key `fetch_requesters` by the **app ULID** for user principals (from the token's `external_id`, verified present), retaining `svc_*` for service principals. No FK. Independent of the deletion flow.                                                                                                                                                                                                                                                                                                                                                                                                                         | KTD-4; FR-048             |
| R6  | Closure vs. erasure MUST be explicit and non-conflatable. The user-facing erasure is confirmation-gated (Track A U7); closure is recoverable. A `user.deleted` webhook is **always** erasure (KTD-2).                                                                                                                                                                                                                                                                                                                                                                                                                                   | KTD-1/2                   |
| R7  | The **erasure completion contract**: both legs (identity scrub + recipe erasure) MUST be observable as jointly complete; a failed/lost leg MUST raise an "erasure incomplete" signal and be reconcilable — never a silent half-erased account.                                                                                                                                                                                                                                                                                                                                                                                          | Doc-review                |
| R8  | Every lifecycle transition MUST leave an **append-only audit record** (`{userId, event, trigger_source, actor, occurred_at, election/confirmation evidence}`), independent of the mutable state column.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Doc-review                |
| R9  | The two erasure entry points (user + webhook/admin) MUST NOT collide or drop the user's election: the election-bearing job MUST be the first writer, and a webhook echo MUST be a true no-op whenever a job for that owner **already exists in ANY state** (queued/running/terminal) — guarded by job existence/correlation key, NOT by "terminal" state (the async worker is still running when the echo arrives).                                                                                                                                                                                                                     | Doc-review (adversarial)  |
| R10 | Provisioning MUST be **lifecycle-aware**: neither the auth read-through (`resolveOrCreateFromClaims` → `provisionCompleteUser`) nor the nightly reconciliation sweep may resurrect a `tombstoned`/`erased` user — the `upsertUser` conflict path MUST NOT clear `deletedAt`/lifecycle or restore name/avatar for such rows. (Today `provisioning.ts` sets `deletedAt: null` unconditionally, so a soft-deleted user is revived by any sign-in or the nightly cron — verified.)                                                                                                                                                          | Code audit (this session) |
| R11 | On **erasure**, the user's food footprint MUST be erased: the food service's per-user `fetch_requesters` rows (keyed by the principal) MUST be deleted via `eraseUser`, invoked by the erasure orchestration. (Today `eraseUser` is shipped but DEAD CODE — no handler/subscription/caller — verified.)                                                                                                                                                                                                                                                                                                                                 | Code audit (this session) |

---

## High-Level Technical Design

### The two events, one anchor

```mermaid
flowchart TD
    subgraph Triggers
      FEc[app: close account]
      FEe[app: erase me\n(confirmation-gated)]
      WH[user.deleted webhook\n(admin / test / our-own-erasure echo)]
    end
    FEc --> Close[CLOSURE]
    FEe --> Erase[ERASURE]
    WH --> Erase

    Close --> Ban[deletion-worker Lambda:\nClerk banUser (durable) +\ntombstone {id,name}; scrub email/avatar/sessions]
    Ban --> Recover[admin-mediated: support verifies →\nunbanUser (+ optional createSignInToken magic-link) →\nsame sub → same ULID, name + recipes return]

    Erase --> Route[recipe erasure FIRST\nPOST /v1/account/erasure + election]
    Route --> Scrub[then identity: scrub → {id} only\nClerk deleteUser]
    Route --> Worker[account-erasure worker\nflip donated→public+published, remove owner-only private/draft + ALL collections\ndelete ratings (aggregate re-derives); keep truly-public+donated]
    Erase -. completion contract .-> Recon[reconcile: erased identity\nwhose recipe leg never acked → alarm]
```

### Field-scrub policy (Specification A) — U2

| Field                                         | Closure (tombstone)                               | Erasure                          |
| --------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| `id` (ULID)                                   | keep                                              | keep                             |
| `name` (+ `profiles.displayName`)             | keep                                              | destroy                          |
| `email`                                       | scrub → **ULID**-keyed placeholder                | destroy → ULID-keyed placeholder |
| `picture` / avatar (DB col **and** S3 object) | scrub + delete S3                                 | destroy + delete S3              |
| Clerk identity                                | **`banUser`** (durable, reversible; sub survives) | **`deleteUser`**                 |
| lifecycle state                               | `tombstoned` (prefer extending `status`)          | `erased`                         |
| recoverable                                   | yes (`unbanUser` → same ULID)                     | no                               |

### Erasure content disposition (Specification B) — U3a/b/c

**Two orthogonal privacy axes (verified against `recipes.ts`).** A recipe is community-visible only when
`visibility = 'public'` **AND** `status = 'published'`. `status` (`draft | published`, default `published`) is
a **separate owner-only security boundary**: a `draft` is owner-only _regardless of_ `visibility` (a
`public`-visibility draft is still owner-only). So "truly public" = `visibility='public' AND status='published'`
— scoping by `visibility` alone would wrongly spare a public-visibility draft and leave it orphaned under an
erased owner.

| Owned data                                                                       | On erasure                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe, **truly public** (`visibility='public' AND status='published'`)          | kept, pseudonymized ULID                                                                                                                 |
| Recipe, **owner-only** (`visibility='private'` OR `status='draft'`), not donated | **removed** (row + its per-recipe S3 keys)                                                                                               |
| Recipe, **elected to publish** (donate)                                          | flipped to `visibility='public' AND status='published'`, kept, pseudonymized ULID                                                        |
| Collections (public + private)                                                   | **removed** (`source_collection_id` is `ON DELETE SET NULL` — clones survive)                                                            |
| Ratings on **others'** recipes                                                   | **anonymized** — delete the per-user rating rows; the CR-001 trigger re-derives the aggregate (no manual write; stars leave the average) |

---

## Implementation Units

### U1. Food: key requesters by the app ULID, not the Clerk `sub`

- **Goal:** Replace `fetch_requesters.sub` with the app ULID for users / `svc_*` for services — opaque, no FK.
- **Requirements:** R5
- **Dependencies:** none
- **Files:** `packages/services/food-service/src/db/schema/operational.ts` (`sub` → `requesterId`);
  `.../db/migrations/` (migration + cutover); `.../auth/food-auth.guard.ts` + `authenticated-principal.ts`
  (surface `claims.userId` = the token's `external_id`, **already provided by the shared verifier**);
  `.../worker/provenance.ts` + `food-consumer.service.ts` (`isValidPrincipal` → valid-ULID-or-`svc_*`);
  `.../foods/dao/fetch-requesters.dao.ts`, `user-erasure.service.ts` (only to re-key what `eraseUser` deletes
  by, `sub` → ULID — U1 does NOT invoke `eraseUser`; wiring the actual food-erasure leg is U4b/R11). Tests.
- **Approach:** Discriminated value — user ULID or allowlisted `svc_*`. **Cutover ordering is load-bearing:**
  tightening `isValidPrincipal` while `sub`-keyed rows remain fails FR-048 for in-flight leased foods (zero
  valid requesters). Either purge/backfill as part of/just before the validator deploy (rows self-prune,
  DSN-10), OR tolerate both forms for one deploy window. `(food_id, requesterId)` PK + self-prune unchanged.
  No FK.
- **Rollback boundary (KTD-4):** food is a **separate CDK stack** from recipe/identity, so this migration
  reverts independently; a food-cutover problem does not force reverting the erasure feature (and vice versa).
- **Execution note:** Test-first for the guard's `external_id` read + the provenance validator.
- **Test scenarios:** user token → ULID requester; `svc_recipe_import` → `svc_*`; missing `external_id` →
  deferred, never a raw sub; `isValidPrincipal` accepts ULID + `svc_*`, rejects raw sub/empty/`'system'`;
  provenance passes ≥1 valid, fails at zero; cutover strands no foods.
- **Verification:** requesters persist as ULID/`svc_*`; provenance holds; fairness/WS/demand unchanged; no FK.

### U2. Identity: ban-on-closure / delete-on-erasure via the deletion-worker; scrub by event; audit + recovery

- **Goal:** Replace "soft-delete + retain id/email/name" with the field-scrub Specification on a
  never-hard-deleted row; the **deletion-worker Lambda orchestrates** both events (it holds the Clerk secret):
  closure → field-scrub + `banUser`; erasure → **create the recipe erasure job first (U4a), then `deleteUser`**.
  Wire **admin-mediated reactivation** (`unbanUser`). Make provisioning **lifecycle-aware** so a tombstone is
  not silently resurrected. Add the audit trail. **This BUILDS the deletion-worker's cross-service
  orchestration from scratch** — today the worker only calls `purgePrivateDataByIdentityId` (identity DB) and
  the shipped `identityClient.deleteUser` is dead code (no handler imports it).
- **Requirements:** R1, R2, R3, R6, R8, R10
- **Dependencies:** U4a (the service-principal recipe-erasure call the worker makes on the erasure path)
- **Files:** `packages/services/identity/src/users/users.service.ts` (`deleteUserMe` → set lifecycle + enqueue
  `{userId, event: closure|erasure, election}`; the service does NOT call Clerk — no secret on the public ALB)
    - the users DAL (`purgePrivateDataByIdentityId` → replace "retain id/email/name" with the ProfileScrubPolicy;
      **email scrubbed, not retained**) + the deletion-queue DTO/`enqueueDeletion` + `queue/sqs.service.ts`
      (**carry `event` + `election`** — today `{identityId, userId, enqueuedAt, failureReason}` only);
      **`packages/services/identity/src/types/schema/users.ts`** (the real path — NOT `database/schema/`) for the
      lifecycle state (**`status` is a `pgEnum('user_status', ['active','suspended'])`** — extend via
      `ALTER TYPE … ADD VALUE 'tombstoned'/'erased'`, or switch to a text+CHECK column to mirror `recipes.status`;
      note `users_email_unique` is a **plain full-unique** index on `email`, NOT partial — the ULID-keyed
      placeholder still satisfies it) + a new `lifecycle_events` audit table;
      **`packages/utils/identity/src/provisioning.ts`** (the `upsertUser` `onConflictDoUpdate` currently sets
      `deletedAt: null` unconditionally — **make it lifecycle-aware: never revive a `tombstoned`/`erased` row**,
      see R10) + **`packages/services/identity-webhooks/src/handlers/reconciliation.ts`** (skip
      tombstoned/erased users so the nightly `provisionCompleteUser` sweep can't resurrect them);
      **`packages/services/identity-webhooks/src/common/identityClient.ts`** (add `banUser`/`unbanUser` — admin
      client + secret already here; `deleteUser` already exists, currently dead code); `.../handlers/deletion-worker.ts`
      (orchestrate per event: field-scrub → `banUser` for closure; recipe-job-then-`deleteUser` for erasure) +
      `identityWebhook.ts` (`user.deleted` → erasure, KTD-2); an **admin-scoped reactivation endpoint** (identity
      already has an admin surface) that calls `unbanUser` + clears the tombstone; tests + an identity integration
      test.
- **Approach:** One authoritative `ProfileScrubPolicy` (Spec A). The row is UPDATEd, never DELETEd. **Closure
  = `banUser`** (durable, reversible; sub persists); **erasure = `deleteUser`**, and per the orchestration
  decision the worker calls the recipe erasure (U4a) **before** `deleteUser`, so the election-bearing job is
  the first writer (R9). `email` scrub → a **ULID**-keyed placeholder (never `sub`-keyed). Avatar destroy
  deletes the **S3 object**. Every transition writes a `lifecycle_events` row.
  **Recovery (admin/support-mediated — owner decision, corrected after the Clerk-SDK finding):** `banUser`
  keeps the `sub` but blocks sign-in, and `@clerk/backend` v1.34.0 has **no server-side sign-in-attempt
  verification** primitive — so self-service recovery is NOT buildable. Instead: a closed user contacts
  support; an **admin-scoped** endpoint verifies identity out-of-band and calls `unbanUser` + clears the
  tombstone (optionally minting a Clerk **`createSignInToken`** magic-link to re-admit). No new public pre-auth
  surface; no retained email required. `erased` is not reactivatable.
- **Execution note:** Test-first; assert the surviving field-set + the Clerk ban-vs-delete call + the
  lifecycle-aware provisioning (no revival) per event.
- **Test scenarios:** closure → Clerk **banned** (not deleted), profile `{id, name}`, email ULID-placeholder,
  avatar S3 deleted, `tombstoned`, audit row; **no-resurrection** → a `tombstoned`/`erased` user hit by
  `provisionCompleteUser` (read-through OR the nightly reconciliation sweep) stays tombstoned/erased,
  `deletedAt` NOT cleared, name/avatar NOT restored from Clerk (R10); **admin reactivation** → admin `unbanUser`
  → same ULID, name restored, lifecycle `active`; erasure → recipe job created first, then Clerk **deleted**,
  `{id}` only, name/avatar/placeholder destroyed, `erased`, audit row; `user.deleted` webhook → erasure (KTD-2).
- **Verification:** row never hard-deleted; ban-vs-delete matches the event; a tombstone is never resurrected
  by provisioning/reconciliation; admin reactivation re-admits only the
  genuine owner; recipe job precedes Clerk delete; audit append-only.

### U3a. Erasure worker: scope the DELETE + S3 sweep + clone-detach to PRIVATE recipes (safety-critical)

- **Goal:** Turn the unconditional owner-wide delete into an **owner-only-scoped** delete that spares
  **truly-public** recipes (`visibility='public' AND status='published'`) AND their media. The removed set is
  everything else the owner owns — `visibility='private'` **OR** `status='draft'` (a draft is owner-only
  regardless of visibility; see Spec B). Donated recipes are handled by U3b flipping them to
  public-and-published **before** this delete runs, so they fall out of the removed scope naturally — U3a keys
  only on the existing `visibility` + `status` columns and needs no election data of its own.
- **Requirements:** R4
- **Dependencies:** U2 (erasure event); **U3b** (the donate-flip runs first, within the same erasure
  transaction, so what remains owner-only = to-be-removed); the shipped account-erasure worker (Track A)
- **Files:** `packages/services/recipe-workers/src/handlers/account-erasure-worker.ts`
  (`eraseRecipeRows`/`eraseRecipeObjects`); tests.
- **Approach:** In one erasure transaction, ordered: (1) U3b flips elected recipes to
  `visibility='public', status='published'`; (2) U3a computes the **removed-recipe id set** = the owner's rows
  that are **not** truly-public — `owner_id = ownerId AND NOT (visibility='public' AND status='published')` —
  **inside the claiming transaction** (the ids are unrecoverable after the delete — re-establishing the
  crash/replay convergence the worker's prefix-driven design relied on); (3) **scope the `cloned_from_id`
  detach to exactly that id set**, NOT `WHERE owner_id` — else it either NULLs clone pointers to surviving
  truly-public recipes (provenance corruption) or, left owner-wide, a deleted owner-only recipe with an
  external clone hits the `NO ACTION` FK and the whole transaction fails. **Preserve the existing
  `AND owner_id <> ownerId` guard** on the detach (the current worker already restricts to _other_ users'
  clones — keep that, just narrow the `cloned_from_id IN (…)` set from all-owner-rows to the removed set);
  (4) S3 sweep changes from whole-owner-prefix to **per-removed-recipe keys** (`recipes/{owner}/{recipeId}/…`)
  so truly-public/donated media survive.
- **Execution note:** Test-first; mutation-verify against the current mass-delete. Tests seed donated recipes
  via U3b's election, so U3a is NOT tested in isolation from U3b — they co-define the scoped delete.
- **Test scenarios:** owner-only rows (`private` **and** `public`-visibility-but-`draft`) + their photos gone;
  **truly-public + donated (flipped) rows + photos remain**; a surviving truly-public recipe with an external
  clone keeps that clone's `cloned_from_id`; a deleted owner-only recipe with an external clone detaches
  cleanly (no FK failure) while a _third_ user's unrelated clone of a _surviving_ recipe is untouched
  (`owner_id <> ownerId` + id-set scope both hold); crash between row-delete and S3-sweep still converges
  (id set captured in the claim).
- **Verification:** only owner-only content + media removed; truly-public survives; provenance intact;
  replay-safe.

### U3b. Erasure election: `delete | publish` per recipe, persisted on the job row + the publish warning

- **Goal:** Let the user elect which owner-only recipes to donate; persist the election durably; publish
  donated recipes — set **`visibility='public'` AND `status='published'`** (a visibility-only flip would leave
  a donated _draft_ still owner-only, i.e. not actually donated) — BEFORE U3a's owner-only delete; anonymize
  the user's ratings by deleting the rows.
- **Requirements:** R4
- **Dependencies:** U2 (erasure event / election on the message). _(U3a depends on U3b, not the reverse — the
  flip must precede the delete.)_
- **Files:** `packages/services/recipe-service/src/account/erasure.service.ts` + `dto/erasure.dto.ts`;
  **`packages/services/recipe-service/src/database/schema/account.ts`** (an election column + `confirmed_at` on
  `account_erasure_jobs`) + the `ErasureJobsDal`; `packages/shared/recipe-core/src/*` (`AccountErasureMessage`
  gains the election — **rollout: deploy consumer-tolerant (optional read) first, then producers**);
  `.../account-erasure-worker.ts` (publish-flip + **delete the user's `recipe_ratings` rows** — the CR-001
  statement-level trigger re-derives each affected recipe's aggregate; **no manual aggregate write**, which is
  forbidden by the single-writer invariant) + `erasure-sweeper.ts` (`toErasureMessage` reads the persisted
  election — today it returns `{ownerId, requestedAt}` only); `contracts/api.openapi.yaml`; the app's
  publish-election UI copy (a **permanence warning**: "donated recipes become public and are permanently
  unremovable by you once your account is erased"); tests.
- **Approach:** Election = a Strategy persisted on the job row (source of truth). **Publish = set BOTH
  `visibility='public'` and `status='published'`** on the elected recipe (draft-or-private → community-visible;
  the permanence warning applies). **Ratings are ANONYMIZED by
  deletion, not folded:** `DELETE FROM recipe_ratings WHERE user_id = ownerId` — the CR-001 statement-level
  `recipe_ratings_aggregate_refresh()` trigger re-derives each affected recipe's `average_rating`/
  `rating_count` from the surviving rows in one firing. The two aggregate columns are trigger-only; **any
  manual write is forbidden and would double-apply against the trigger.** Consequence (intended): the erased
  user's stars leave the public average. This leg largely already ships in the account-erasure worker; U3a's
  scoping does not touch it. The publish warning makes the R8 consent informed.
  **Author-handle residue (code-audit finding).** Kept truly-public + donated recipes carry a denormalized
  `recipes.author_handle` (a name-ish display handle, `schema/recipes.ts:130`), and the shipped worker deletes
  the `author_handles` read-model wholesale (`DELETE FROM author_handles WHERE user_id`, worker:359). Left as-is,
  a "kept, pseudonymized" recipe would either retain a real handle string (residual identity) or lose its
  author mapping entirely. On erasure, **scrub `recipes.author_handle` on KEPT rows to a pseudonymized token**
  (rendered from the ULID) and **scope the `author_handles` deletion to REMOVED recipes only** (or repoint the
  surviving read-model rows to the pseudonym) — so no cleartext handle survives and kept recipes still render a
  consistent (pseudonymous) author.
- **Execution note:** Test-first; prove donated content readable by a non-owner; prove the aggregate is correct
  after the user's rating rows are deleted **and** under a concurrent new rating on the same recipe (re-verify
  the CR-001 `FOR UPDATE` lock discipline holds — no lost update).
- **Test scenarios:** election persisted + survives a sweeper re-drain (redelivery with no message election
  still completes from the row); a donated **draft** (and a donated private) recipe ends
  `visibility='public' AND status='published'`, readable by a non-owner (proving the visibility-only flip would
  have failed); a rated-others'-recipe ends with **zero** surviving rows for the erased user and a re-derived
  average that excludes their star; concurrent (erase-delete vs. new rating on the same recipe) → no lost
  update; missing election rejected on the user path.
- **Verification:** election durable; donated content survives; ratings deleted with the aggregate re-derived
  (no manual write); no per-user row survives.

### U3c. Erasure: remove all the user's collections

- **Goal:** Delete every collection (public + private) the user owns + memberships, without harming clones.
- **Requirements:** R4
- **Dependencies:** U2 (erasure event) — orthogonal to the recipe-scoping (different table), so independent of
  U3a/U3b
- **Files:** `.../account-erasure-worker.ts` (collections delete); `packages/services/recipe-service/src/database/schema/collections.ts`
  (verify `source_collection_id` `ON DELETE SET NULL`); tests.
- **Approach:** Delete the owner's `collections` rows + memberships. `source_collection_id` is a self-FK
  `ON DELETE SET NULL` (verified), so clones survive with a nulled source pointer; the "pull-from-source"
  action must degrade gracefully against a vanished source.
- **Test scenarios:** all the user's collections + memberships gone; a clone (other owner) survives with
  `source_collection_id` NULL; **a cloner invoking "pull from source" against the removed source degrades
  gracefully** (no error, no data loss) — and if the current pull path isn't tolerant of a missing source,
  fix it here.
- **Verification:** collections removed; clones intact; pull-from-source graceful.

### U4a. Recipe-service service-principal erasure path (security-sensitive — its own unit)

- **Goal:** Build the **greenfield** inbound service-principal auth that lets the deletion-worker Lambda
  trigger an erasure for a target `ownerId` **bound to a single verified `user.deleted`/close event**, without
  the U7 phrase — scoped, audited, and rate-limited. Split from U4b because it is the highest-blast-radius
  change in the plan (a brand-new machine-auth surface on a service that has never had one).
- **Requirements:** R6, R8, R9
- **Dependencies:** U3a/b/c (the worker behavior it triggers)
- **Files:** `packages/services/recipe-service/src/auth/` (a **new, structurally-distinct** service-principal
  guard/route — recipe-service today hard-rejects tokens without `external_id` and takes owner only from the
  token; this is NOT "mirror food's `svc_*`" — food's `svc_*` is a worker-side provenance string, not inbound
  auth); `account.controller.ts`/`erasure.service.ts` (a **separate guarded route/DTO** that accepts a target
  `ownerId` + skips the phrase ONLY for the verified principal — never a runtime `if` inside the shared
  user-token handler); **`account.ts` schema** (add `trigger_source` + `actor` to `account_erasure_jobs`); the
  deletion-worker Lambda's credential (the Lambda holds the Clerk _secret_, which is not a verifiable inbound
  token — decide the token type: a Clerk M2M client with an `azp` allowlist entry, OR an internal asymmetric
  JWT verified by a dedicated key) + egress (VPC/NAT already reaches the shared ALB); a **volume alarm** on
  service-principal-attributed erasures; tests.
- **Approach:** The capability is **event-bound, not ambient**: the erase carries proof tying it to the
  specific verified event (e.g., a short-lived single-target signed token minted per `user.deleted`, or the
  verified `sub→ULID`), so a leaked credential cannot erase arbitrary accounts at will; every such job records
  `trigger_source`/`actor` (R8) and a burst of distinct `ownerId`s alarms. The guard is a distinct code path,
  so a bug can't let a user token supply a body `ownerId`.
- **Execution note:** Test-first; a forged/header identity MUST be rejected (negative test is the gate).
- **Test scenarios:** the deletion-worker's verified principal erases exactly the bound `ownerId`; a
  client-suppliable header/body `ownerId` on the user path is rejected (whitelist-strip intact); a job created
  via the service principal records `trigger_source=service`, `actor`; a burst of distinct ownerIds trips the
  alarm; a user token cannot reach the phrase-skip branch.
- **Verification:** service-principal auth is a distinct, verified, event-bound path; every service erasure is
  attributable + rate-alarmed; the user path's owner-from-token invariant is untouched.

### U4b. Routing + orchestration ordering + completion contract

- **Goal:** Make `closure | erasure` explicit and non-conflatable; wire the deletion-worker orchestration
  (recipe-first, R9) **fanning out to recipe AND food**; make erasure completion observable (R7).
- **Requirements:** R6, R7, R9, R11
- **Dependencies:** U2, U3a/b/c, U4a
- **Files:** the app account screens (distinct "close account" → closure; "erase / forget me" → the
  confirmation-gated erasure with per-recipe donate election) — web + mobile; the deletion-worker
  orchestration (recipe-job → **food `eraseUser`** → Clerk-delete) + the `user.deleted` echo guard; **the
  food-erasure leg** — the shipped `packages/services/food-service/src/foods/user-erasure.service.ts`
  (`eraseUser`, currently DEAD CODE: no handler/subscription) must be invoked on erasure, either via a new
  food deletion Lambda subscribed to the fan-out or an M2M call from the deletion-worker (+ its CDK/IAM — the
  service explicitly deferred this wiring); **the R7 reconciliation job** — a NEW scheduled handler
  `packages/services/identity-webhooks/src/handlers/erasure-reconciliation.ts` (distinct from the existing
  provisioning `reconciliation.ts`) that scans identity `status='erased'` rows against recipe
  `account_erasure_jobs` terminal state (correlation key = the owner ULID, across the two DBs) + food, and
  emits the "erasure incomplete" metric/alarm; tests incl. cross-platform UI.
- **Approach:** Domain-event routing, **server-orchestrated by the deletion-worker** (owner decision). The
  worker creates the election-bearing recipe job (via U4a) **first**, then invokes food `eraseUser` (removes
  the user's `fetch_requesters` rows), then `deleteUser` — so the job always exists before the `user.deleted`
  echo arrives. **R9 echo guard keys on job EXISTENCE for the owner in ANY state (queued/running/terminal)** —
  the async worker is still running when the echo lands, so a "terminal-only" check would miss the window; an
  existing job (any state) → the echo is a true no-op, no second job. The webhook/admin erasure (no election)
  defaults to `delete`. **Completion contract (R7):** idempotent + monitored on ALL THREE legs (identity
  scrub/ban-or-delete, recipe erasure, food `eraseUser`); DLQ-exhausted or missing leg → "erasure incomplete";
  the reconciliation job surfaces `erased` identities whose recipe/food leg never acked. **Food is NOT a
  no-op** — this replaces the earlier (wrong) "food does nothing": food holds per-user `fetch_requesters` (keyed
  by the principal) that must be erased (R11); U1's `sub`→ULID rekey is a separate correctness fix, not the
  erasure leg.
- **Execution note:** UI feature-bearing — vitest component tests every state + Playwright (web) + Maestro
  (mobile) happy paths.
- **Test scenarios:** closure and erasure presented as distinct, non-conflatable (erasure carries the phrase +
  election; closure doesn't); **the `user.deleted` echo fires while the first job is still RUNNING → zero
  second job row, no collision, donated recipe NOT deleted** (R9); webhook/admin erasure → default `delete`,
  alarmed; a dropped recipe leg raises the incomplete signal + is reconcilable.
- **Verification:** events never collapse; the deletion-worker guarantees recipe-first ordering server-side;
  the echo is a no-op against any existing job; a half-completed erasure is detected.

---

## Shipped-state gaps this CR closes (GDPR code-audit, this session)

The audit confirmed the **currently-shipped** "forget me" is broken at the seams; this CR is the remediation.
Each gap is code-verified (file:line in the audit) and mapped to the unit that closes it:

| Shipped gap (verified)                                                                                                                             | GDPR             | Closed by                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------- |
| "Delete Account" never deletes the Clerk identity (`deleteUser` is dead code) → user can still sign in; PII persists in Clerk                      | Art. 17          | U2 (erasure → `deleteUser`)                                     |
| Soft-delete auto-reverses — `provisioning.ts` sets `deletedAt: null`; nightly reconciliation (`cron(0 7 * * ? *)`) + any sign-in resurrect the row | Art. 17, 5(1)(e) | R10 + U2 (lifecycle-aware provisioning + reconciliation skip)   |
| Cross-service disconnection — delete hits identity only; recipe corpus + S3 + food rows survive; UI claims "all your data"                         | Art. 17          | U2/U4b orchestration (identity + recipe + food fan-out)         |
| Food `eraseUser` is dead code — `fetch_requesters` survive every erasure                                                                           | Art. 17          | R11 + U4b (wire the food-erasure leg + CDK)                     |
| Email + name retained indefinitely, no TTL, self-contradicted basis                                                                                | Art. 5(1)(e)     | U2 (scrub email; KTD-3 TTL policy) — TTL _enforcement_ deferred |
| No Art. 30 audit — only a mutable status that clears `last_error`                                                                                  | Art. 30, 5(2)    | R8 + U2 `lifecycle_events` + U4a `trigger_source`/`actor`       |
| Admin/Clerk `user.deleted` purges identity DB only, no fan-out                                                                                     | Art. 17          | KTD-2 + U4b (webhook → full cross-service erasure)              |

**NOT closed by this CR (open — flagged so they aren't lost):** ids in logs→Sentry surviving erasure (Art. 17
copies), backup/snapshot residue (Art. 17), and **no data-subject access/export endpoint (Art. 15/20)**. All
are follow-ups below. **Release note:** the identity service is a live deployed service, so the identity-side
gaps (Clerk-not-deleted, resurrection, email/name retention) may be reachable in prod today — **confirm
prod-exposure and prioritize accordingly**, independent of this CR's merge.

---

## Scope Boundaries

- **Deferred / no v1 referent:** "keep the real name on private-shared recipes" — per US2/FR-005 per-user
  private sharing is out of scope for v1, and no surface renders an author name. No name-snapshot seam (YAGNI).
- **Explicitly rejected:** a full orchestration Saga — the lightweight completion contract (R7) covers the
  three-leg erasure.

### Deferred to Follow-Up Work

- **The 12-month tombstone → auto-erasure sweep (KTD-3).** Deferred with **no in-CR control**; recorded as an
  owner-accepted, time-boxed risk with a hard due-by = the first closure's 12-month mark.
- **Logs / backups / Sentry PII propagation.** Out of scope here, tracked separately (ids like `sub`/ULID leak
  into Sentry + CloudWatch and outlive the purged row; RDS backups retain 7 days — needs a scrub + a
  restore-then-re-erase runbook).
- **Data-subject ACCESS / portability (Art. 15/20).** No export-my-data endpoint exists across identity +
  recipe + food. Out of scope for this closure/erasure CR, but a real GDPR obligation — track as a separate
  feature (an authenticated export keyed on the ULID).

---

## Risks & Dependencies

- **Retained-ULID inventory + Art. 17(3) basis.** Post-erasure the ULID persists in `identity users` (`{id}`),
  `recipes.owner_id` (public/donated), and `account_erasure_jobs.owner_id` (job history). Ratings are
  anonymized (no surviving row). The kept public/donated recipes are pseudonymized personal data — **name the
  specific Art. 17(3) exemption** (e.g., a documented Art. 6(1)(f) legitimate-interest / freedom-of-expression
  basis for community content) with counsel, so the "Art. 17 satisfaction" claim is backed.
- **Service-principal auth (U4a) is a security-sensitive GREENFIELD inbound path.** Recipe-service has no
  machine principal today (food's `svc_*` is a worker-side provenance string, NOT reusable inbound auth) and
  deliberately rejects trusted-header identity (PR-#39). The capability MUST be a verified, event-bound
  principal (scoped to the one `user.deleted`/close event, not "erase any owner"), a distinct guarded code
  path, audited (`trigger_source`/`actor`), and volume-alarmed — never a client-suppliable value or an ambient
  erase-any-user grant.
- **Webhook-secret blast radius elevated by KTD-2.** `user.deleted` is gated ONLY by the svix signature
  inside the webhook Lambda. Today that triggers identity-DB churn; under KTD-2 it triggers **irreversible
  cross-service content destruction** for the event's `ownerId`. State this elevation; the "alarms" mitigation
  is detective (fires after deletion), so pair it with a preventive posture — signing-secret rotation
  cadence/owner + the U4a event-binding so a single forged/leaked signal can't erase an arbitrary account.
- **`external_id` immutability (food).** Present on the food path (verified). Confirm it is Clerk
  `public_metadata` (identity-backend-written, never user-editable `unsafe_metadata`); test that food's guard
  rejects an untrusted/mismatched `external_id`, not just a missing one.
- **U3a rebuilds the most safety-critical path** (scoped delete + scoped clone-detach + per-recipe S3 sweep +
  crash-convergence). Keep Track A's mutation-tested rigor; re-verify CR-001 invariants.
- **Two privacy axes, not one (verified against `recipes.ts`).** `recipes` has both `visibility`
  (`public|private`) AND `status` (`draft|published`) — a `draft` is owner-only _regardless of_ visibility. The
  erasure "keep" set is `visibility='public' AND status='published'`; scoping by `visibility` alone would
  orphan a public-visibility draft under an erased owner, and a donate-flip that sets only `visibility` would
  leave a donated draft un-published (still owner-only). U3a/U3b key on **both** columns. (Worktree-review
  finding — the axis the three doc-review rounds missed.)
- **Implementation strengtheners (worktree-verified, fold into the units):** (a) the current worker's
  clone-detach already restricts to `owner_id <> ownerId` (other users' clones) — U3a **narrows the id-set**,
  it must **keep that guard**, not replace it; (b) `erasure.service` already has `hasCompletedJob` +
  `findActiveJob` — R9's job-existence guard **extends existing machinery**, lowering U4b risk; (c) the
  identity deletion SQS message is `{identityId, userId, enqueuedAt, failureReason}` today (`sqs.service.ts`) —
  U2 must extend that DTO + `enqueueDeletion` to carry `{event, election}`.
- **Legal.** Tombstone-retains-name + the deferred TTL, and the erasure retention basis, need documented
  lawful bases. This plan states the engineering shape, not legal advice.

---

## Sources & Research

- Two grounded investigations + two five-persona doc-review rounds (this session). **Code-verified** and
  spike-confirmed: `@clerk/backend` v1.34.0 has `banUser`/`unbanUser` (`POST /users/{id}/ban|unban`, durable,
  reversible, sub-preserving) — `lockUser` auto-expires (rejected); the identity **webhooks** package already
  holds a Clerk admin client + secret (`identityClient.ts`) and `deleteUserMe` touches Clerk not at all today;
  the app renders no Clerk delete UI (we own the entry point); `eraseRecipeRows`/`eraseRecipeObjects` delete
  ALL owner content + whole-prefix sweep (U3a is a rebuild) and the clone-detach is currently owner-wide
  against a `NO ACTION` FK; `collections.source_collection_id` is `ON DELETE SET NULL` (clones survive);
  `toErasureMessage` returns `{ownerId, requestedAt}` only (election must persist on the row); recipe-service
  accepts only Clerk user tokens + unconditionally requires the phrase (the service-principal path + phrase
  skip are net-new); `external_id` present on the food path (U1 needs no new dependency).
- Specs: `specs/001-commise-recipe-app` (US2, FR-005, FR-010, FR-011, C-004, C-007, data-model.md §D2);
  identity `users.service.ts`, `users.ts`, `clerk-auth.service.ts`, `identityClient.ts`, `deletion-worker.ts`;
  food `operational.ts`, `provenance.ts`, `food-auth.guard.ts`; recipe `account-erasure-worker.ts`,
  `erasure-sweeper.ts`, `account.ts`, `collections.ts`, `recipes.ts`.
