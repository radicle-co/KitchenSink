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
  _(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_

**Pseudonymized, not anonymized (compliance note).** Retained public/donated recipes stay attributed to the
stable ULID — that is **pseudonymized personal data** (GDPR Recital 26), still in scope, needing a stated
Art. 17(3) basis (see Risks). Ratings, by contrast, are **anonymized** at erasure (the per-user rating rows are
deleted; the aggregate re-derives without them) — no ULID-attributable rating survives, and the erased user's
stars leave the public average.

_(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_

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
  OQ2)_ _(Owner ruling 2026-11-21.)_ Self-deletion MUST be off in Clerk, both the dashboard's self-service delete and every user's `deleteSelfEnabled`, because the Frontend API lets a session delete itself without any UI. The code renders no `<UserProfile>`, but that alone does not close the path. U4b verifies the setting.
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
  _(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_

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

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Source                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | The identity profile row (ULID) MUST NOT be hard-deleted on closure OR erasure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | KTD; D2                   |
| R2  | On **closure**, the platform **bans** (`banUser`) the Clerk identity — never deletes it — and the profile retains `{ id, name }`; email, sessions, avatar (col + S3) MUST be scrubbed. A later admin-mediated `unbanUser` restores the same ULID (recoverable via support, not self-service — Clerk has no server-side sign-in-attempt verification, see KTD-1).                                                                                                                                                                                                                                                                                                                                                      | KTD-1                     |
| R3  | On **erasure**, the platform **deletes** the Clerk identity; the profile retains `{ id }` only; name, email, avatar (col + S3), and any Clerk-`sub`-derived placeholder MUST be destroyed. No recovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | KTD-1; GDPR Art. 17       |
| R4  | On **erasure**: **owner-only** recipes (`visibility='private'` OR `status='draft'`) are **removed** unless **elected to publish** (donate, which sets `visibility='public' AND status='published'`); **all collections removed**; the user's **ratings on others' recipes are anonymized** by **deleting the per-user rating rows** and letting the CR-001 statement-level trigger re-derive the aggregate (NO manual aggregate write — the two columns are trigger-only); **truly-public** (`public AND published`) + donated recipes kept, pseudonymized ULID _(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_. Applied **eventually** across identity + recipe (not atomic — see R7). | KTD-5                     |
| R5  | Food MUST key `fetch_requesters` by the **app ULID** for user principals (from the token's `external_id`, verified present), retaining `svc_*` for service principals. No FK. Independent of the deletion flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | KTD-4; FR-048             |
| R6  | Closure vs. erasure MUST be explicit and non-conflatable. The user-facing erasure is confirmation-gated (Track A U7); closure is recoverable. A `user.deleted` webhook is **always** erasure (KTD-2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | KTD-1/2                   |
| R7  | The **erasure completion contract**: both legs (identity scrub + recipe erasure) MUST be observable as jointly complete; a failed/lost leg MUST raise an "erasure incomplete" signal and be reconcilable — never a silent half-erased account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Doc-review                |
| R8  | Every lifecycle transition MUST leave an **append-only audit record** (`{userId, event, trigger_source, actor, occurred_at, election/confirmation evidence}`), independent of the mutable state column. The evidence holds counts and the confirmation, never recipe ids.                                                                                                                                                                                                                                                                                                                                                                                                                                             | Doc-review                |
| R9  | The two erasure entry points (user + webhook/admin) MUST NOT collide or drop the user's election: the election-bearing job MUST be the first writer, and a webhook echo MUST be a true no-op whenever a job for that owner **already exists in ANY state** (queued/running/terminal) — guarded by job existence/correlation key, NOT by "terminal" state (the async worker is still running when the echo arrives).                                                                                                                                                                                                                                                                                                   | Doc-review (adversarial)  |
| R10 | Provisioning MUST be **lifecycle-aware**: neither the auth read-through (`resolveOrCreateFromClaims` → `provisionCompleteUser`) nor the nightly reconciliation sweep may resurrect a `tombstoned`/`erased` user — the `upsertUser` conflict path MUST NOT clear `deletedAt`/lifecycle or restore name/avatar for such rows. (Today `provisioning.ts` sets `deletedAt: null` unconditionally, so a soft-deleted user is revived by any sign-in or the nightly cron — verified.)                                                                                                                                                                                                                                        | Code audit (this session) |
| R11 | On **erasure**, the user's food footprint MUST be erased: the food service's per-user `fetch_requesters` rows (keyed by the principal) MUST be deleted via `eraseUser`, invoked by the erasure orchestration. (Today `eraseUser` is shipped but DEAD CODE — no handler/subscription/caller — verified.)                                                                                                                                                                                                                                                                                                                                                                                                               | Code audit (this session) |

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
    Route --> Worker[account-erasure worker\nflip donated→public+published, remove every recipe not kept + ALL collections\ndelete ratings (aggregate re-derives); keep truly-public+donated]
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

_(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_

**Two orthogonal privacy axes (verified against `recipes.ts`).** A recipe is community-visible only when
`visibility = 'public'` **AND** `status = 'published'`. `status` (`draft | published`, default `published`) is
a **separate owner-only security boundary**: a `draft` is owner-only _regardless of_ `visibility` (a
`public`-visibility draft is still owner-only). So "truly public" = `visibility='public' AND status='published'`
— scoping by `visibility` alone would wrongly spare a public-visibility draft and leave it orphaned under an
erased owner.

| Owned data                                                                       | On erasure                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe, **truly public** (`visibility='public' AND status='published'`)          | kept; `owner_id` = the recipe's own owner token (U3b, Kept-recipe disposition)                                                           |
| Recipe, **owner-only** (`visibility='private'` OR `status='draft'`), not donated | **removed** (row, and its objects under the cook's owner media prefix, which is swept whole once kept media has moved out; U3b, Photos)  |
| Recipe, **elected to publish** (donate)                                          | flipped to `visibility='public' AND status='published'`, kept; `owner_id` = the recipe's own owner token (U3b, Kept-recipe disposition)  |
| Collections (public + private)                                                   | **removed** (`source_collection_id` is `ON DELETE SET NULL` — clones survive)                                                            |
| Ratings on **others'** recipes                                                   | **anonymized** — delete the per-user rating rows; the CR-001 trigger re-derives the aggregate (no manual write; stars leave the average) |

---

## Implementation Units

### U1. Food: key requesters by the app ULID, not the Clerk `sub`

- **Goal:** Replace `fetch_requesters.sub` with the app ULID for users / `svc_*` for services — opaque, no FK.
- **Requirements:** R5
- **Dependencies:** none
- **Files:** `packages/services/food-service/src/db/schema/operational.ts` (`sub` → `requesterId`);
  `.../db/migrations/` (migration + cutover); `.../auth/foodAuth.guard.ts` + `authenticatedPrincipal.ts`
  (surface `claims.userId` = the token's `external_id`, **already provided by the shared verifier**);
  `.../worker/provenance.ts` + `foodConsumer.service.ts` (`isValidPrincipal` → valid-ULID-or-`svc_*`);
  `.../foods/dao/fetchRequesters.dao.ts`, `userErasure.service.ts` (only to re-key what `eraseUser` deletes
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
      client + secret already here; `deleteUser` already exists, currently dead code); `.../handlers/deletionWorker.ts`
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

### U3a. Erasure worker: scope the DELETE + S3 sweep + clone-detach to the recipes the erasure does not keep (safety-critical)

- **Goal:** _(Superseded 2026-11-21 by U3b Order; owner rulings 2026-11-26.)_ Turn the unconditional owner-wide delete into a delete of exactly the recipes the erasure does not keep. Each kept recipe (truly public under the kept rule, or elected and passing the donate rules) is erased in its own recipe transaction, which gives it a token `owner_id` and moves its media to fresh prefixes. The final transaction then removes every recipe the owner still holds (`owner_id = {internal id}`), after it re-checks that none of them still passes the kept rule (U3b, Order, steps 2 and 7). The cook's whole old media prefix is swept once kept media has moved out.
- **Requirements:** R4
- **Dependencies:** U2 (erasure event); **U3b** (the donate-flip runs first, within the erasure's transactions (U3b, Order), so what the owner still holds after the recipe transactions = to-be-removed); the shipped account-erasure worker (Track A)
- **Files:** `packages/services/recipe-workers/src/handlers/accountErasureWorker.ts`
  (`eraseRecipeRows`/`eraseRecipeObjects`); tests.
- **Approach:** In the erasure's transactions (U3b, Order), ordered: (1) U3b flips each elected recipe to `visibility='public', status='published'` in its own recipe transaction (U3b, Order, step 6); (2) the final transaction (U3b, Order, step 7) computes the **removed-recipe id set** after the recipe transactions, as every recipe the owner still holds (`owner_id = {internal id}`), and writes it once to `removed_recipe_ids` (`accountErasureWorker.ts:772-775`), so a crash or replay converges; (3) **scope the `cloned_from_id`
  detach to exactly that id set**, NOT `WHERE owner_id` — else it either NULLs clone pointers to surviving
  truly-public recipes (provenance corruption) or, left owner-wide, a deleted owner-only recipe with an
  external clone hits the `NO ACTION` FK and the final transaction fails. **Preserve the existing
  `AND owner_id <> ownerId` guard** on the detach (the current worker already restricts to _other_ users'
  clones — keep that, just narrow the `cloned_from_id IN (…)` set from all-owner-rows to the removed set);
  (4) S3 sweep: U3b first moves kept media to fresh prefixes, then the cook's whole old owner media prefix (`recipes/{owner media key}/…`, `003A` U15) is swept in both buckets, so truly-public and donated media survive.
- **Execution note:** Test-first; mutation-verify against the current mass-delete. Tests seed donated recipes
  via U3b's election, so U3a is NOT tested in isolation from U3b — they co-define the scoped delete.
- **Test scenarios:** owner-only rows (`private` **and** `public`-visibility-but-`draft`), and a public recipe that fails the kept rule, + their photos gone;
  **truly-public + donated (flipped) rows + photos remain**; a surviving truly-public recipe with an external
  clone keeps that clone's `cloned_from_id`; a deleted recipe with an external clone detaches
  cleanly (no FK failure) while a _third_ user's unrelated clone of a _surviving_ recipe is untouched
  (`owner_id <> ownerId` + id-set scope both hold); crash between row-delete and S3-sweep still converges (each kept recipe's token `owner_id`, plus `removed_recipe_ids` written once in the final transaction).
- **Verification:** only the recipes the erasure does not keep, and the cook's old media prefix, are removed; kept recipes survive under fresh media prefixes; provenance intact;
  replay-safe.

### U3b. Erasure election: `delete | publish` per recipe, persisted on the job row + the publish warning

_Code cites in U3b are to origin/main `3451fc3f1` unless a cite names another commit. Migration cites are to the migration files, which do not change once merged. When a cited line moves, cite the symbol it belongs to._

- **Goal:** Let the user elect which owner-only recipes to donate; persist the election durably; publish
  donated recipes — set **`visibility='public'` AND `status='published'`** (a visibility-only flip would leave
  a donated _draft_ still owner-only, i.e. not actually donated) — in its own recipe transaction, BEFORE the final transaction's delete (Order); anonymize
  the user's ratings by deleting the rows.
- **Requirements:** R4
- **Dependencies:** U2 (erasure event / election on the message). _(U3a depends on U3b, not the reverse — the
  flip must precede the delete.)_; `003A` U4 (the `recipe_public_ids` tables, which the renewal writes), after this unit's own migration step. Build order: this unit's migration (`author_erased`, its CHECK and the partial index) lands first, then `003A` U15 and U4, then this unit's worker, the renewal included. `003A` U15 changes `packages/infra/global` (the media CDN's `removeHeaders`), which deploys through that package's own pipeline, so it is deployed to a stage before this unit's worker runs there.
- **Files:** `packages/services/recipe-service/src/account/erasure.service.ts` + `dto/erasure.dto.ts`;
  **`packages/services/recipe-service/src/database/schema/account.ts`** (an election column + `confirmed_at` on
  `account_erasure_jobs`) + the `ErasureJobsDal`; `packages/shared/recipe-core/src/*` (`AccountErasureMessage`
  gains the election — **rollout: deploy consumer-tolerant (optional read) first, then producers**);
  `.../accountErasureWorker.ts` (publish-flip + **delete the user's `recipe_ratings` rows** — the CR-001
  statement-level trigger re-derives each affected recipe's aggregate; **no manual aggregate write**, which is
  forbidden by the single-writer invariant) + `erasureSweeper.ts` (`toErasureMessage` reads the persisted
  election — today it returns `{ownerId, requestedAt}` only); `contracts/api.openapi.yaml`; the app's
  publish-election UI copy (`account.delete.donateWarning`, and `account.delete.donateWarningDetail` when the count is above 0, directly under the election control and updating live, with no recipe ticked in advance; the copy is in `016-FR-012a`; the receipt code proves authorship for a later takedown, `016-FR-016`); tests.
- **Approach:** Election = a Strategy persisted on the job row (source of truth). **Publish = set BOTH
  `visibility='public'` and `status='published'`** on the elected recipe (draft-or-private → community-visible;
  the publish warning applies). **Ratings are ANONYMIZED by
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

    _(Superseded in part 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`.)_ A kept recipe's owner id becomes its own owner token, and its author handle and username become NULL. The erasure marker (`003A` data-model, Erased owner) is written last (below). The code is made at confirm and shown once on the done step. An erasure outside the app's screen makes it at erasure and sends it in the erasure notice email, again with a new code after a send error (Bounce window) (`016-FR-012a`). A kept recipe whose title scrub removed a name gets a new public id: the old id joins the retired list, and a new `recipe_public_ids` row replaces the old one in one transaction (`016-FR-037`, `003A` data-model, Public id). The code's SHA-256 digest is held on the job only until the final erasure transaction commits (Order). That transaction clears it, and nothing after it needs it. The erase screen also shows the `016-FR-012a` reminder (`002` T-096). The code is made in the confirm request that creates the job, and its digest is written with the job before the response shows it. A replayed confirm finds the job (R9) and makes no second code. If that response is lost, the code is gone, and staff judge any later takedown on its evidence.

    **Kept-recipe disposition (the one list; `016-FR-037` cites it).**

    - **Owner token:** `erased_` plus the first 32 hex characters of HMAC-SHA-256 (key = SHA-256 of the receipt code, message = the recipe row id). It is computed in the worker (`node:crypto`), never in SQL. The job holds only the code's SHA-256 digest.
    - **Before the erasure transactions** (job `running`). The kept recipes still read with the cook's name (`003A` data-model, Erased owner). Main's erasure lock already refuses the cook's writes while the job is `queued` or `running` (`erasureLock.guard.ts:80`). A re-claimed job whose `removed_recipe_ids` is set skips this step and the transactions. Once (P3) has written the photo plan, this step runs only over the planned recipes not yet erased, and a saved result whose input is unchanged is reused (Scrub budget).
        - (P1) The kept set, its photos and its free text are read, with no lock.
        - (P2) The automatic scrub runs over every free-text field under Recipe row, and over the cook's own `ingredient_parse_corrections` and `ingredient_resolution_mappings` rows (Kept as they are). The scrub's instructions state the validator's rules: the protected words and number tokens it must keep, and where a replacement word may come from (Scrub validator). On a retry, the scrub gets the last rejection reason for each field it failed. The automatic photo check marks each kept photo kept or removed, by market (`016-FR-037`). Both are network calls, so neither runs inside the transaction. Each passed result is saved as it returns (Scrub budget), so a retry scrubs and checks only what has not passed. The scrub validator (below) checks each scrubbed field before its result is saved or used. Once (P3) has written the photo plan, the plan decides each photo, and the photo check does not run again.
        - **Scrub validator** (`016-FR-037`; owner ruling 2026-11-26: no person checks the text). A pure function in the worker, with no network call, checks each scrubbed field against its input. Field i of the output is checked against field i of the input. It passes only if all of these hold:
            - **Words.** The field is first split on whitespace. A whitespace token whose core holds a number character (Unicode `\p{N}`: a digit, a vulgar fraction such as `½`, or a digit in another script) is a number token and one word, whatever else it holds (`1/2`, `350°F`, `20mins`, `2nd`, `-18`). Its core is the token with its leading and trailing punctuation removed, except a leading minus or plus sign. This pass runs before segmentation, so no number token is split and none loses a character. The rest of the text is split into the word-like segments of `Intl.Segmenter` with word granularity. Two words are equal when they are equal after NFKC normalisation and case folding, and a number token is compared by its core. A word's folded form is that, then with a trailing `'s` or `’s` dropped, then one trailing `s` dropped.
            - **Number tokens.** A number token is a whitespace token found by the rule above, or a word in recipe-core's `WHOLE_NUMBER_WORDS`, `MULTIPLIER_WORDS` or `FRACTION_WORD_DENOMINATORS` (`@kitchensink/recipe-core/parsing/number-words`), except the articles `a` and `an`. recipe-core stays the one source of these word lists, and the validator copies none of them. The table's docstring, which says the maps are exported only for their own test, changes at U3b's build. The validator has no number grammar of its own and needs none of `amountAt`, `splitGluedUnit` or `readNumberWords`: a number glued to a unit is one number token by the rule above.
            - **Only deletions, with a bounded replacement.** The output is the input's words in order, with zero or more runs of consecutive words removed. In place of each removed run there may be a replacement of at most three words, and of no more words than the run plus one. A replacement word is not a number token and not a unit, time, temperature or serving word, and its folded form is never the folded form of a word the scrub removed anywhere in the recipe. A word comes from a field when its folded form equals the folded form of a word of that field's input. Where a replacement word may come from depends on the field, and nothing else is added:
                - title: the fixed list of plain words (`a`, `an`, `the`, `my`, `our`, `family`, `friend`, `home`), the title itself, or an ingredient line;
                - ingredient line: the fixed list, or the same line;
                - step: the fixed list, or any field of the recipe except another step;
                - story, tags and cuisine: the fixed list, or any field of the recipe.
            - **Protected words.** No removed run holds a protected word, and no replacement adds one. In every field, a meaning word is protected, because removing it changes what the recipe says (owner ruling 2026-11-26: the erasure must never be able to change a recipe's meaning). The meaning words are: the negations `not`, `no`, `never`, `nor`, `none`, `neither`, `without`, `cannot` and `avoid`, and any word that ends in `n't` once a curly apostrophe is folded to `'` (`don't`, `doesn't`, `can't`, `won't`); the limits and conditions `only`, `unless`, `until`, `except`, `instead` and `if`; the comparisons `more`, `less`, `fewer` and `extra`; the alternative `or`; `optional` and `optionally`; and the order words `before` and `after`. Every number token in the title, a step or an ingredient line is protected. In the story, tags and cuisine, a number token is protected when the word before or after it is a unit, time, temperature or serving word, or when the letters after its number are one (`350F`, `20mins`). A unit, time, temperature or serving word next to a protected number token is protected too. A unit word is one that recipe-core's `classifyUnit` does not class `unknown`, and time words are `DURATION_WORDS` (`page-reader/src/cardMetaLabels.ts:55`), which U3b moves to recipe-core (page-reader already depends on it) so the worker reads it without a new package edge. The validator adds only the temperature words (`degrees`, `C`, `F`, `°C`, `°F`, `celsius`, `fahrenheit`, and the two words `gas mark`, which count as one word for "before or after") and the serving words (`serves`, `servings`, `makes`, `portions`, `people`). A `°` written against its number (`350°`) is part of that number token.
            - **Shape.** The count and order of the steps and of the ingredient lines are unchanged. The title, each step and each ingredient line keep at least one input word. The story, tags and cuisine may become empty, and a tag that becomes empty is dropped.
        - **Validator limit.** A replacement can still change a word that is not a number, a unit or a step boundary: a title's word for a word of an ingredient line ("Chicken soup" to "Lentil soup" when a line holds "lentils"), a step's word for a word of the title, the lines or the story, and a line's word for another word of the same line. A line never takes a word from another line, so a line's food is never replaced by another line's. The validator cannot tell those edits from a removed name, and that limit is accepted. A number word recipe-core does not list, such as `thousand`, is not protected. A personal token that holds a digit, such as a phone number in a step, `maya88's` in a title or `@ruth1950` in a step, is a number token and so is never removed. It stays in place and the job passes: the scrub's instructions tell it to leave such a token, and the validator accepts the field with it. This is a known gap the owner deferred (2026-11-26), nothing else handles it, and it never holds the erasure in retry.
        - **Scrub budget** (one run of the worker). The worker reads its deadline once, at the start of the run: the Lambda context's remaining time (`getRemainingTimeInMillis()`) less `ERASURE_PREPARE_RESERVE`, a named constant of 120 seconds in a side-effect-free module beside `src/common/erasureGiveUp.ts`, which the worker and the stack's synth test both import. So the deadline follows `ERASURE_WORKER_TIMEOUT` (`RecipeWorkersStack.ts:157`, 5 minutes) with no second copy of it, and leaves about 3 minutes to prepare. Each scrub call, each photo-check call and each S3 call (the (P4) copies and the clean-up's deletes) carries its own 30-second abort timeout (`AbortSignal.timeout`, passed to the S3 client as its `abortSignal`). No new call and no erasure transaction (Order) starts after the deadline. One transaction holds one recipe, one copy in R, or the final steps, so the 90 seconds left after the last call's timeout cover the last transaction started (LOCAL e2e, timing).
            - **What is saved.** A new table, `account_erasure_scrub_results`: `job_id` (references the job, `ON DELETE CASCADE`), `subject_kind` (`recipe`, `parseCorrection` or `resolutionMapping`), `subject_id`, `input_digest` and `result jsonb`, with the primary key (`job_id`, `subject_kind`, `subject_id`). A kept recipe's row is written once its text and every one of its photos have passed. Its `result` holds the scrubbed fields by column and row id, and each photo's verdict, kept or removed. A correction or mapping row's `result` holds whether the scrub flagged it. `input_digest` is `v1:` plus the SHA-256 of the fields, photo ids and stored keys that (P1) read for that subject. One row per subject, never a job column, so each save adds a row rather than rewriting a growing value. A row is no larger than its subject's scrubbed text. It holds no original text. Its ids name the cook's own rows, and step (13) deletes them.
            - **Progress.** A run that saves at least one new result sets `attempts = 0` and clears `scrub_retry_since`. A run that commits at least one redaction or recipe transaction sets `attempts = 0`. If (P2), (P4) or the erasure transactions are still incomplete at the end of a run that saved a new result or hash or committed a transaction (the deadline reached, or a subject rejected or unavailable), the worker records its stop (`recordErasureJobError`) and returns without rethrowing, and the sweeper re-sends the job after `STALE_AFTER`, as on main. So main's give-up counts only runs that made no progress. A run that ends with (P2) incomplete and no new result saved is a scrub failure (Scrub retry).
            - **Stale results.** A retry re-reads (P1) and reuses a saved result only when its `input_digest` equals the digest of what it just read. Any other result is deleted, and that subject is scrubbed again. A result for a recipe no longer in the kept set is ignored. Every result of the job is deleted in step (13).
            - **Photo check.** It is one network call per photo, so it runs under the same deadline, and its verdicts are saved in the recipe's row.
            - **(P4)** runs under the same deadline, and a run that adds a hash sets `attempts = 0`. At the deadline it records its stop and returns without rethrowing, as above. A (P4) deadline stop that adds no hash rethrows, as on main, so a `failed` job always has a DLQ message (`erasureGiveUp.ts:22`).
        - **Scrub retry** (owner ruling 2026-11-26: "Retry until it passes"). A scrub failure is a run of (P2) that ends with a kept recipe, photo or flagged row not yet passed and no new result saved in that run: a validator rejection, the scrub or the photo check being unavailable, or the scrub budget running out (Scrub budget). On one, the worker writes nothing from (P2) to a recipe, keeps the results already saved, sets `scrub_retry_since = now()` on the job if it is NULL, records the error (`recordErasureJobError`, which also sets `updated_at`) and returns without rethrowing, so the message never reaches the erasure DLQ. The job stays `running`, with no take-down and no give-up for this cause, and keeps its links (`owner_id`, `publish_recipe_ids` and any `photo_plan`) while it retries (accepted by the owner). Its `account_erasure_scrub_results` rows stay too, and they need no further ruling: they link the cook to nothing that `recipes.owner_id` does not already link until the recipe's own transaction, which deletes its row. Instead of `STALE_AFTER`, the erasure sweeper re-sends such a job once `now() - updated_at` reaches `LEAST(15 minutes × 2^n, 24 hours)`, where n is `LEAST(GREATEST(attempts - 1, 0), 7)` (2^7 × 15 minutes is 32 hours, so the outer cap applies), so the waits are 15 minutes, 30, then 1 hour, doubling up to one day. The exponent is capped before the multiply, so the interval never overflows however large `attempts` grows. A run that saves a new result sets `attempts = 0` (Scrub budget), so the wait starts again at 15 minutes. The sweeper's give-up (`redrainStuckJobs`, `erasureSweeper.ts`) skips any job whose `scrub_retry_since` is set, so neither the plain give-up nor the pre-commit give-up that deletes the plan's copies applies to it. When (P2) passes, one update clears `scrub_retry_since` and sets `attempts = 0`, so the give-up counts only attempts made after it passed, and a later failure of another kind follows main's give-up. `queueCheckReads.ts`'s account-erasure statement leaves out a job whose `scrub_retry_since` is set from `at_allowance` and `claimed_too_long`, and leaves out of `at_allowance` and `claimed_too_long` a job whose send row holds an error and no message id (send retry, Bounce window), and leaves out of `claimed_too_long` a job that holds an `account_erasure_scrub_results` row or a `photo_plan` while `updated_at > now() - STALE_AFTER` (a run that stopped at its budget waits for the sweeper's re-send after `STALE_AFTER`, and a worker that died is counted again once that has passed). It still counts toward `owed_past_deadline` and `oldest_owed_seconds`, and `OldestErasureScrubRetryAgeSeconds` reports the cause. Every tick the sweeper emits `OldestErasureScrubRetryAgeSeconds` with `Stage` (the age of the oldest `scrub_retry_since`, 0 when none), and `RecipeWorkersStack.ts` adds an alarm on it, in namespace `Commise/RecipeErasure` (`ERASURE_METRIC_NAMESPACE`, `:341`) with the one dimension `Stage`, above one hour, inside the stack's `if (props.alarmsEnabled)` block (`:1650`) and on the stage's existing `alarmAction`, so it reaches the DD29 relay (ADR-0062). Main's `OldestErasureJobAgeSeconds` alarm (above one hour) also fires on any erasure that runs longer than an hour, such as a large kept set that is still making progress, and the runbook says so. A runbook step for this alarm is owed at this unit's build, because the erasure's one-month bound (`020-FR-018a`) holds only while staff act on it.
        - (P3) The photo plan is written to the job once (`WHERE photo_plan IS NULL`): for each kept recipe, a fresh owner media key and media key, and for each kept photo, a fresh object id or `removed`, and, once 020 ships and only when the photo's `check_key` is set, the planned key of its check copy: its planned key plus `.check.jpg` (`003A` data-model, Photo addresses). All keys are random version 4 UUIDs, never v7 (`003A` data-model, Photo addresses). A retry reuses the stored plan. The plan's recipes are the kept set from then on: a recipe that passes the kept rule only after the plan is written is not in it, and the final transaction deletes it (Order).
        - (P4) Each kept photo, and its thumbnail when it has one, is copied with its metadata stripped from its old key to its planned key, and a thumbnail's planned key is its photo's plus `.thumb.jpg` (`003A` data-model, Photo addresses). Once 020 ships, the photo's check copy (`recipe_photos.check_key`, `020` data-model §1), when the plan names one, is copied the same way to its planned key. The plan's keys are written once. (P4) writes a photo's thumbnail and check copy before the photo itself. After the stripped photo is written, it adds that photo's SHA-256 to the entry: this is the photo's new `content_sha256`, and it goes into the digest in step (14). The hash is of the stripped photo, never of its thumbnail or check copy. A repeat copy writes the same key, and a run skips a photo whose entry already holds its hash (Scrub budget). Nothing refers to the planned keys yet.
    - **Order of the erasure transactions** (`eraseRecipeRows`). The work runs in three kinds of transaction, so no single transaction grows with the kept set, which has no limit on Pro (DD33). Each starts only before the deadline (Scrub budget), and a run commits as many as its time allows. A **redaction transaction** redacts one other recipe in a kept recipe's R, a kept one included, just before that kept recipe's transaction (step 4). A **recipe transaction** erases one kept recipe, in id order: steps (2) to (6), the recipe's part of (7) (step 5a for its attestations and corrections, and step 10 as replaced, for its `recipe_versions` rows), (8), (9), (11), the outcome rewrite in (12), the recipe's part of (13), and (14). Every recipe transaction also runs main's step 7 (`:820-825`), and the final transaction runs it again after step (1), the cook's `collections` rows locked `FOR UPDATE` and step (2)'s recipe locks. Another cook's clone takes a key-share lock on its source collection through its foreign key, so no clone can start while the final transaction runs, and a clone made between two transactions is cleared by the next one. So no cloned collection keeps the cook's handle beside a member that reads "a former member". A redaction or recipe transaction that fails (a deadlock, a difference, or any other error) ends the pass, so the final transaction does not run in that run. The **final transaction** runs once a run's pass over the planned recipes reaches the end: step (1), then the cook's `collections` rows `FOR UPDATE`, then the locks of step (2) over every recipe the owner still holds, then main's step 7 (a clone inserts its collection and then its members, `collections.service.ts:382-405`, through the foreign keys at `collections.ts:61` and `:94-96`, and a pull adds its members before it updates the clone row, `collections.service.ts:460-466`, so this order cannot deadlock with either), in the same order, then the rest of step (7) (the removed set, its DELETE and the clone detach) and step (10), the claim deletion in (12), and the rest of (13). Under its step-(2) locks, before any delete, the final transaction checks every planned recipe the owner still holds: if one still passes the kept rule, it rolls back and records the stop (`recordErasureJobError`), and the next run erases that recipe first, so the final transaction never deletes a recipe the plan keeps. A planned recipe whose `owner_id` is already a token is skipped, so each recipe's own row records the progress, and a set `removed_recipe_ids` (main's write-once column, written in the final transaction, `accountErasureWorker.ts:772-775`) tells a re-claim that the final transaction committed. The steps:
        - (1) the `author_handles` tombstone, unchanged, so the lock order holds;
        - (2) the recipe transaction locks, `FOR UPDATE` and in this order, the recipe's `recipe_source_referrals` rows, then its `recipe_source_checks` rows, then the recipe row, and reads it. That is 020's writer order (`020` data-model, Who writes this row). The final transaction takes the same locks over every recipe the owner still holds, after the `author_handles` tombstone (step 1), so main's order holds there too (`accountErasureWorker.ts:619-620`, `:715-716`). The locks are `FOR UPDATE`, not `FOR SHARE`, because step (14) writes the check row, and two holders upgrading a share lock deadlock. A writer that takes these locks in the other order, such as a staff or bounce takedown whose cascade locks recipe, then check rows, then referrals, or another cook saving a copy in R, can deadlock with the erasure: Postgres detects it and aborts one side. The erasure's side rolls back, ends the pass (Order) and is retried. The recipe is erased only if it is in the photo plan (P3), still has `owner_id = {internal id}`, and still passes the kept rule: truly public, or elected and passing the donate rules (worker `:749-761`). Once 020 ships, "truly public" includes `SOURCE_CHECK_ALLOWS_SQL` (`020` data-model §8 and §9, DD34). While 020 enforces (blocking on), a recipe whose current digest has no allowing outcome is not kept, and the final transaction deletes it (`020-FR-018a`). That includes a public recipe whose latest edit is still being checked: `020-FR-064` would show readers its last approved version, but that version is a `recipe_versions` row this erasure deletes (Version history). In shadow or paused mode (`enforced = false`), `SOURCE_CHECK_ALLOWS_SQL` passes such a recipe, so it is kept, and step (14) re-keys its `checking` row. A planned recipe that no longer passes is skipped, and the final transaction deletes it. The check row step (14) carries is the one for the `checked_content_digest` this step reads. So no 020 refusal commits during the recipe's transaction: a reviewer's decision waits, and its compare-and-set then names the old digest and updates nothing. The recipe's photo ids and each scrubbed field's text must match what (P1) read and the stored photo plan. On a difference, which only a staff action or a bounce takedown (U4b) can cause, the transaction rolls back, the recipe's scrub results are deleted, and the error is recorded for retry as on main (`recordErasureJobError`). While no recipe transaction has committed, the rollback first clears the plan in its own statement (`UPDATE … SET photo_plan = NULL WHERE kept_recipe_ids IS NULL RETURNING photo_plan`) and only then deletes the copies the returned plan names, so the next run plans again. Each recipe transaction locks the job row `FOR UPDATE` right after step (2)'s locks and re-reads `photo_plan` there; unless the recipe's entry in it equals the entry this transaction applies, the transaction rolls back. Steps (3), (4) and (13) write the job row under that lock. So a second worker on the same job (a duplicate delivery: the claim accepts `running`, `:286`) never commits a recipe whose planned copies were deleted. Once one has committed, the plan stays, and the next run scrubs that recipe again. No path on main changes a kept recipe's photo set during an erasure: the only photo delete is the cook's own route (`photos.controller.ts:98`), which `ErasureLockGuard` refuses while the job runs (`erasureLock.guard.ts:80`), so a photo difference does not recur once the plan is kept;
        - (3) the recipe's id is added to `kept_recipe_ids` (set from NULL by the first recipe transaction), and the first recipe or final transaction that commits (a recipe transaction, or the final transaction before it deletes the cook's `owner_media_keys` row) writes `old_owner_media_key`. A set `kept_recipe_ids` tells the give-up and a re-claim that at least one recipe transaction committed. When the plan keeps no recipe, the final transaction sets it to `[]`;
        - (4) the own-site sets R, E and C (below) are computed for one kept recipe at a time, just before its recipe transaction, while its own source fields still hold the address. Each other recipe in R that still holds a host in H, a kept one included, first gets its own redaction transaction: it locks that recipe's referrals, then its check rows, then the recipe, as step (2) does; reads its current source fields, its evidence rows whose `own_site_redaction` is NULL, and its correction rows; writes the ids of those whose host is in H to `own_site_redaction_ids`; runs step (5) and the R part of step (14) for that recipe; clears `own_site_redaction_ids`; adds the recipe's id to `redaction_recipe_ids`; and commits. Then the kept recipe's own transaction redacts the kept recipe the same way, adds its id to `redaction_recipe_ids`, and also redacts any recipe that reaches the kept recipe or a member of R through `cloned_from_id`, was made since R was computed, and still holds a host in H. So a copy of an R member made while R is being redacted is redacted in the kept recipe's own transaction. A recipe that no longer holds a host in H is skipped, so a retry repeats nothing. A kept recipe redacted this way is compared in its own recipe transaction (step 2) with its source fields as redacted. Each recipe's evidence rows are rewritten in the same transaction as its own source fields, so the deferred `recipes_stated_source_has_evidence` check (`0090:151-165`) finds the same placeholder on both sides at each commit;
        - (5) the own-site redaction. It reads the cook's site claim for `own_site_redaction` before step (12) deletes the claim;
        - (6) one `UPDATE`, from a `{ id: token }` map built in Node, sets `owner_id` to the token, `author_handle` and `author_username` to NULL, and, on elected rows, `visibility = 'public'` and `status = 'published'`. It sets no `updated_at`;
        - (7) main's steps 2 onward run, with these changes:
            - step 5, the clone detach (`:785-790`), sets no `updated_at` on a row whose `owner_id` is an erasure token;
            - step 5a (`:799-810`) gives each attestation the token for its `recipe_ref`, and each source correction a token computed from the digest and the correction's own id, instead of one `attestationAccountToken` for the account (`:700`);
            - step 7 (`:820-825`) sets `collections.source_owner_handle` to NULL, not the pseudonym;
            - step 9 (`:835-841`) is deleted, because step (6) already clears the handle and username and its `owner_id = {internal id}` matches nothing after (6);
            - step 10 (`:843-851`) is replaced by deleting every `recipe_versions` row of the recipe, in its recipe transaction (Version history).
            - step 2's removed set and its DELETE (`:766`, `:814`) take every recipe the owner still holds (`owner_id = {internal id}`), not main's `ownerOnly` predicate, so the two still agree. Once the recipe transactions have run, a recipe still held is one the plan did not keep or one its recipe transaction skipped (step 2), including one that passed the kept rule only after the plan was written (P3). Main's other owner-only predicates now match exactly that set.
        - (8) the scrub results from (P2) are written to the columns under Recipe row, with no `updated_at`;
        - (9) the photo plan is applied to the recipe: it gets its fresh `owner_media_keys` row and `recipes.media_key`, each kept photo's `s3_key` and `thumbnail_key` take the planned keys, and, once 020 ships, its `content_sha256` takes the hash in `photo_plan` (`check_rendition_version` stays) and its `check_key` takes its planned check copy's key when the plan names one. A photo whose `check_key` is NULL (its check rendition failed) keeps it NULL. Each removed photo's row is deleted. The final transaction deletes the cook's own `owner_media_keys` row;
        - (10) the cook's own `ingredient_parse_corrections` and `ingredient_resolution_mappings` rows that (P2) flagged are deleted (Kept as they are);
        - (11) `recipe_public_ids` is renewed for each kept recipe whose title lost a name (`003A` data-model, Public id);
        - (12) on each kept recipe whose own-site hit a site claim cleared, the 020 outcome is rewritten to record only that a site claim cleared it and the date it was cleared, with no claim id, method or check time. An outcome a linked social account cleared is rewritten the same way: only that a linked account cleared it and the date it was cleared, with no link id, platform or check time. Every 020 decision record on a kept recipe drops the cook's app id (`020-FR-063`). The final transaction deletes the cook's site claim (`016-FR-069`, `020-FR-012g`). If 026 stores claims outside recipe-service, that service deletes the claim only after the final transaction commits;
        - (13) each recipe transaction deletes its recipe's `account_erasure_scrub_results` row and clears `own_site_redaction_ids`, and the final transaction clears `code_digest` and deletes the job's remaining scrub results (the correction and mapping rows). The append-only triggers are row triggers that are not deferred (`0086:88`, `0092:211`), so clearing the list after the updates is safe;
        - (14) `author_erased = true` is written last on the recipe. Once 020's digest exists (`020-FR-058`), the same `UPDATE` writes the new `checked_content_digest`, computed from the scrubbed text, the redacted source statement and the copies' hashes in `photo_plan`. That is FR-058's one exception, an update that also writes a new digest, so the NULL its triggers wrote in steps (6) to (11) does not survive the commit. The same step re-keys, in place, the one `recipe_source_checks` row step (2) locked for the recipe, as rewritten in step (12). First it deletes the recipe's other `recipe_source_checks` rows, every digest but the carried one (their parts, items, matches and referrals go with them by `ON DELETE CASCADE`), then that row's `recipe_source_check_parts`, `recipe_source_check_items` and `recipe_source_check_matches` rows and the recipe's `recipe_source_referrals`: they hold part digests, spans and listed markers taken from the text before the scrub, their foreign keys have no `ON UPDATE` action, and nothing that decides `allows` reads them (`020` data-model §3). Then one `UPDATE` sets the row's `content_digest` to the new digest, sets `judged_cited_host` to `redacted.invalid` when that host is in H, and replaces every mention of a host in H in `part_results` with `redacted.invalid` (Recipe row, own site). No row keeps the old digest. The outcome, its evidence reference and any person's clearance stay on the row, so `allows` does not change. In shadow or paused mode the carried row can be `checking` (step 2). It is re-keyed the same way, and the 020 worker, whose compare-and-set then updates nothing, checks the new digest (`020` data-model, Who writes this row). `recipe_source_decisions` rows keep their digest, because they record what was decided (`020` data-model §4). The recipe's `recipe_match_fingerprints` row is recomputed from the scrubbed text for the new digest, and its `recipe_source_keys` rows whose host is in H are deleted (`020` data-model §10). Each other recipe in R, a kept one included, gets the same in its redaction transaction (step 4). A kept recipe redacted this way carries that re-keyed row into its own recipe transaction (step 2), which re-keys it again to the scrubbed digest: the `UPDATE` that rewrites its `source_url` and `source_attribution` also writes its new digest, computed from its own unchanged text, its redacted source statement and its photos' `content_sha256`. Its current row is re-keyed in place the same way when it passed `SOURCE_CHECK_ALLOWS_SQL` or was `checking` when step (4) locked it, and its fingerprint and source keys are handled as above. So another cook's public copy stays readable with no new check. An R recipe whose current row is neither (it waits for a person, or is held) keeps its rows, with every host in H in them replaced by `redacted.invalid`. Its new digest has no row, so it stays held until its owner's next save starts a check, and `020-FR-064` keeps showing readers its last approved version meanwhile. That case is accepted and recorded in the owed ADR. The erasure's writes start no 020 check (owner ruling 2026-11-26; `021-FR-007`), so the kept recipe stays readable with no new check, and its deleted versions are never needed as the last approved version (`020-FR-064`).
        - Each recipe transaction commits on its own. A reader sees each kept recipe either with the cook's name or as "a former member", never in between, so the erasure writes no hide (owner ruling 2026-11-26). Between two recipe transactions some kept recipes read "a former member" while others still read with the cook's name. All of them carried the cook's name before, so that links nothing new, and no time is written (`016-FR-076`).
        - A reader sees that only if its read takes one snapshot. This unit moves the in-app detail read (`RecipesService.getById`, `recipes.service.ts:1297-1325` at 3451fc3f1, which reads `findById` and then `loadPhotoRows`) into one read-only `REPEATABLE READ` transaction (`{ isolationLevel: 'repeatable read', accessMode: 'read only' }`), through a new DAL reader that takes the transaction handle, as `create` takes `enlistIn` (`recipes.dal.ts:405`). `findById` stays as it is for the write paths. No food call runs inside the transaction. A read-only transaction at this level never fails to serialize, so it needs no retry. `003A` U4 reads the public page the same way, and `003A` U13 adds the public id inside this snapshot. The collection read needs the snapshot too. `CollectionsService.getCollection` (`collections.service.ts:199-219` at 3451fc3f1) reads the collection row with its `source_owner_handle` (`requireOwned`), its members with their authors (`listRecipes`, one statement, `collections.dal.ts:462-470`, mapped by `recipeRowToDomain`) and the source owners' usernames (`sourceOwnerUsernames`) in three statements. Step (7) changes the first and step (6) the second, so this unit moves the three reads into one read-only `REPEATABLE READ` transaction in the same way. A cover added to that embed later joins `listRecipes`' statement. Search already reads the author and the cover in one statement (`search.dal.ts:445-457`), and the owner's own list (`findAll`, scoped to the owner at `recipes.dal.ts:610`) is read only by the cook being erased, so neither changes.
        - **After the final transaction, still `running`**, as main runs its sweep after its transaction (`accountErasureWorker.ts:1332-1349`). Each step can be repeated safely, so a crash is recovered by the claim at `:286` and by the sweeper's re-send. A re-claimed job whose `removed_recipe_ids` is set skips to this clean-up and resumes from `kept_recipe_ids`, `redaction_recipe_ids` and `old_owner_media_key`. The sweeper's give-up (`erasureSweeper.ts:268-279`) skips a job whose `kept_recipe_ids` or `redaction_recipe_ids` is set, so a job with any committed recipe or redaction transaction is never marked `failed` with the cook's old photos or R's archived snapshots left behind. Main's oldest-job age metric (`erasureSweeper.ts:208`, `:225`) alarms on it instead. A job the give-up marks `failed` with `kept_recipe_ids` and `redaction_recipe_ids` NULL first has its `account_erasure_scrub_results` rows deleted and, when `photo_plan` is set, the copies its plan names deleted and `photo_plan` cleared, as the rollback in step (2) does. Neither give-up applies to a job in scrub retry (Scrub retry) or in send retry (Bounce window). The clean-up runs in this order:
            - (a) R's archived snapshots are rewritten and their earlier versions deleted;
            - (b) the old owner prefix is swept (Photos), and the copies the plan names for a planned recipe not in `kept_recipe_ids` are deleted;
            - (c) one CDN invalidation is sent;
            - (d) the job is completed as on main (`markErasureJobCompleted`, `accountErasureWorker.ts:332-338`), and `removed_recipe_ids`, `redaction_recipe_ids`, `photo_plan` and `publish_recipe_ids` are cleared in the same update. `kept_recipe_ids` is cleared too, except on a job that sends the erasure notice (Bounce window).
    - **Recipe row:**
        - `recipes.owner_id` becomes the token.
        - `author_handle` and `author_username` become NULL.
        - Every free-text field is scrubbed automatically, and no person checks it (`016-FR-037`, owner ruling 2026-11-26). Quantities, times and step order never change. Fields and columns:
            - title: `recipes.title` (the slug derives from it);
            - story: `recipes.description`;
            - steps: `recipe_steps.instruction`;
            - ingredient lines: `ingredients.display_text`, `source_line`, `source_phrase`, `note` (the "9 inch" dimension), `preparation` and `group_label`; and `unresolved_foods.name` and `source_phrase` on an `author_declared` row that a kept line binds to. Shared failure rows are never edited (`0051_ingredient_grain.sql:205-214`);
            - tags: `recipes.tags`; and `recipes.cuisine`;
            - notes, tips, photo captions and alt text: no column on main (`recipe_photos` has no text column). A feature that adds one adds it here;
            - derived fields, recomputed from the scrubbed lines and never scrubbed directly: `recipes.ingredient_names_text`, and `search_vector` by its trigger.
            - A guard test classifies every text, `text[]` and `jsonb` column of `recipes`, `recipe_steps`, `ingredients`, `recipe_photos` and `unresolved_foods` as scrubbed, derived or not free text, and fails on any new column.
        - On a kept "Written by you" recipe (`statement_kind = 'authored'`), the cook's own site address and its host are redacted, verified or not, in its recipe transaction (Order, step 4).
            - **Sets:** H is the hosts in the kept recipe's own `source_url` and in its evidence rows' `source_url` and `source_domain`. H never contains the placeholder host `redacted.invalid`, so a recipe already redacted is never redacted again. R (recipes) is the kept recipe, its clones and their clones (followed through `cloned_from_id`), and every recipe holding an evidence row whose `capture`, `source_key` and `recorded_at` match one of the kept recipe's rows. E (evidence rows) is every evidence row on a recipe in R whose host is in H and whose `own_site_redaction` is NULL. C (correction rows) is every correction row on a recipe in R whose `old_source_url` or `new_source_url` host is in H. A recipe row's `source_url` and `source_attribution` are rewritten only where its host is in H. This is safe because the evidence row that satisfied `recipes_stated_source_has_evidence` before the redaction has the same address, so it is in E. After the redaction it carries the same placeholder as the recipe row, and the check at commit (`0090:151-165`) passes.
            - **Columns:** `recipes.source_url` and `source_attribution`; in `recipe_source_evidence`: `source_url`, `source_key`, `source_domain`, `citation`, `paste_digest`, `image_url`, `credit_authors`, `credit_publisher`, `credit_copyright_notice` and `credit_copyright_holder`; in `recipe_source_corrections`: `old_source_url`, `new_source_url`, `old_source_attribution` and `new_source_attribution`; the same source fields in those rows' `recipe_versions.snapshot`; and their archived version objects, rewritten in place, with every earlier object version deleted. The archive bucket keeps earlier versions with no expiry (`DataStack.ts:667-677`). This covers the archived versions of every recipe in R, the kept recipe's deleted versions included. Files: `RecipeWorkersStack.ts` adds one grant to the erasure worker: `s3:ListBucketVersions` and `s3:DeleteObjectVersion` on the archive bucket only, under the same `recipes/*` prefix condition. This redaction and the archive sweep of the old owner prefix (Photos) both use it. It is withheld today (`:85-89`), and the ADR-0013 gap closes for these two uses only. `capture`, `source_kind`, `credit_license` and `recorded_at` stay.
            - **Value:** each non-NULL column becomes a fixed placeholder of its type: `https://redacted.invalid/` for an address and its key, `redacted.invalid` for a host, 64 zeros for the digest, `[redacted]` for text, and `{"[redacted]"}` for an array. NULL stays NULL. So every CHECK holds (`url_key_pair`, `web_has_url`, `capture_shape`, `recipes_source_kind_pairs_source_type`), `recipe_holds_third_party_source` keeps its answer, and `recipes_stated_source_has_evidence` (`0090:151-165`) finds the same placeholder on both sides at commit.
            - **Own-site fact:** a new column, `own_site_redaction`. Together with `recorded_at`, it says "source: own site, verified, date".
            - **Append-only:** `recipe_source_evidence_append_only` (`0086:78`, `0090`) and `recipe_source_corrections_append_only` (`0092:164-208`) each gain a second exception. It admits an UPDATE of a row whose id the running job lists in `own_site_redaction_ids`, when only the identifying columns named above change from their value to the placeholder (NULL stays NULL) and, on evidence, `own_site_redaction` goes from NULL to a value. Every other column must be unchanged. It reads no owner column. The ids are cleared at the end of the same transaction (Order, step 13). This overrides ADR-0095 §1 and ADR-0100 §3; the owed ADR records both.
            - **Out of scope:** the cloner's own copied free text, because copies stay. The source record (`016-FR-079`) has no table on main; whoever builds it adds it here.
            - Until the address is encrypted when stored (owed to `004`), the placeholder is the method (`016` counsel question 14).
        - `recipe_public_ids` is renewed when a name left the title.
        - `author_erased = true` is written last in the recipe's own erasure transaction, after the scrub, the photo repoint and the renewal (Order, step 14).
    - **Migration (recipe-service):**
        - `recipes.author_erased boolean NOT NULL DEFAULT false`.
        - A CHECK: `author_erased` implies `owner_id ~ '^erased_[0-9a-f]{32}$'`, `author_handle IS NULL` and `author_username IS NULL`.
        - The partial index `ON recipes (owner_id) INCLUDE (id) WHERE owner_id LIKE 'erased\_%'`.
        - A new migration replaces `recipes_first_published_at_ratchet()` as defined in `0092:59-88`, with one more branch. An UPDATE from NULL to `published` whose `NEW.owner_id` is an erasure token sets `first_published_at := NEW.created_at` and `source_confirmed_at := coalesce(OLD.source_confirmed_at, NEW.created_at)`. That keeps `recipes_first_published_has_source_confirmed` and `recipes_source_confirmed_ratchet` satisfied. Every other path is unchanged.
        - `recipe_source_evidence.own_site_redaction text NULL CHECK (own_site_redaction IN ('verified','unverified'))`; `account_erasure_jobs.own_site_redaction_ids jsonb NULL`; `account_erasure_jobs.photo_plan jsonb NULL`, its keys written once before the copies, and each copy's hash added after it (Order, P3, P4); `account_erasure_jobs.kept_recipe_ids jsonb NULL` and `redaction_recipe_ids jsonb NULL` (R), each added to by the redaction and recipe transactions, and `old_owner_media_key text NULL`, written by the first recipe or final transaction that commits (a recipe transaction, or the final transaction before it deletes the cook's `owner_media_keys` row); `code_digest text NULL`, written at confirm, or at erasure on a job that sends the notice (U4b), and cleared in the final transaction, and replaced by a re-send of the notice (Bounce window); `account_erasure_jobs.notice_sent_at timestamptz NULL` (Bounce window); `account_erasure_jobs.scrub_retry_since timestamptz NULL` (Scrub retry); the table `account_erasure_scrub_results` (Scrub budget); and the second append-only exception on `recipe_source_evidence` and `recipe_source_corrections` (Recipe row).
        - (`recipes.media_key` and `owner_media_keys` are `003A` U15's.)
    - **Version history:** every `recipe_versions` row of the kept recipe is deleted (`created_by`, `editor_handle`, `editor_username`, `snapshot`, `change_summary`, `s3_key`), with its pending archives (cascade), plus their archived objects. The archive sweep of the old owner prefix lists and deletes every version of them (Photos, and the one grant under Columns).
    - **Photos:**
        - Each kept recipe gets a fresh `owner_media_keys` row for its token and a fresh `recipes.media_key`. Kept photos are rewritten stripped under `recipes/{new owner media key}/{new media key}/photos/{new object id}` (`003A` data-model, Photo addresses).
        - `s3_key` and `thumbnail_key` take the new keys. `recipe_photos.created_at` and `updated_at` stay.
        - Then everything under the cook's old owner prefix is deleted: the current objects in the media bucket, and every version in the archive bucket (the one grant under Columns). The CDN is invalidated once with `/recipes/{old owner media key}/*`. Earlier versions of the deleted media objects expire a day later under the media bucket's rule (`DataStack.ts:633-641`). That day is accepted, with no grant on the media bucket, because the CDN serves only current versions and is invalidated. The cook's `owner_media_keys` row is deleted. A photo the automatic check removes loses its row in its recipe transaction, and its objects go with the old owner prefix.
    - **Attestations:** `recipe_statement_attestations.account_id` becomes the token for its `recipe_ref`. `recipe_source_corrections.actor_account_id` takes a token computed from the digest and the correction's own id. This supersedes ADR-0095 section 5, and an ADR is owed.
    - **No time groups a cook's recipes or dates the erasure:** no write of the erasure, the scrub, the renewal, the marker or the photo pass sets a timestamp column on a kept recipe or its child rows.
        - The scrub does not use `RecipesDal.update`, which sets `updated_at` (`recipes.dal.ts:754`).
        - The derived values: a donated recipe that was never published takes `first_published_at = created_at`, and `source_confirmed_at = created_at` unless it was confirmed earlier. A recipe created published already has all three equal: the insert sets neither (`recipes.dal.ts:408`), and both come from the insert's `now()` (`0092:72-81`). So donated and already-public recipes cannot be told apart (`003A` Q8). The step-5 clone detach leaves `updated_at` on kept rows (Order, step 7).
        - The media CDN removes S3's `Last-Modified` from every response (`removeHeaders: ['Last-Modified', 'x-amz-version-id']` on `MediaResponseHeadersPolicy`, added by `003A` U15; the media bucket is versioned, `DataStack.ts:621`, so S3 also sends a version id, which tells a reader nothing and is removed with it), because (P4) copies every kept photo in one burst and the copy time would date the erasure and group the recipes (`016-FR-076`).
    - **Bounce window (U4b):** on a job that sends the erasure notice, the completed job keeps `kept_recipe_ids`, so a bounce can find the recipes and take them down (`016-FR-012a`). When the send releases the `erasureNotice` hide, it writes `notice_sent_at` on the job. The erasure sweeper clears `kept_recipe_ids` and `notice_sent_at` from a `completed` job once the window has passed since `notice_sent_at`. A bounce that arrives before the final transaction commits first takes down, by the job's `owner_id`, the recipes that still belong to the cook, and then, in a later READ COMMITTED statement of the same transaction, reads `kept_recipe_ids` and takes those down. A recipe transaction that commits between the two statements is seen by the second, and one that holds a recipe's lock makes the first wait and then skip that row, so no kept recipe escapes the takedown. A takedown of a recipe not yet erased makes its recipe transaction skip it (Order, step 2). The send row (U4b) records the answer:
        - **Refused.** SES v2 `SendEmail` answers `MessageRejected`, a permanent rejection of this message. The job handles it as a bounce: the kept recipes are taken down, and any `kept_recipe_ids` is cleared once the takedown is written, with no window (owner ruling 2026-11-26).
        - **An error.** SES answers with any other error (`TooManyRequestsException`, `LimitExceededException`, `SendingPausedException`, `AccountSuspendedException`, `MailFromDomainNotVerifiedException`, `NotFoundException`, or `BadRequestException`, which cannot be told apart from a fault in our own request), a 5xx answer, or a network failure, each after the SDK's own retries. The row records it with no message id, and the worker rethrows. The redelivery sends again with a new receipt code, whose digest replaces the job's `code_digest` before the email is built. That is safe because no recipe transaction starts while the row holds an error, so no owner token was made from the old digest. A 5xx answer or a network failure may follow a send SES accepted: the cook then gets two emails, only the later code matches, and staff judge a request with the earlier code on its evidence (`016-FR-016`). The give-up (`redrainStuckJobs`) skips a job whose send row holds an error and no message id, as it skips scrub retry, because a mail service that is busy, paused or failing is retried (`016-FR-012a`, owner ruling 2026-11-26), and a take-down for our own outage would delete the recipes. A send that records a message id sets `attempts = 0`. Main's erasure age alarm (`OldestErasureJobAgeSeconds`, above one hour) and the erasure DLQ alarm fire while it lasts, and the runbook step owed at U3b's build covers it, because the `020-FR-018a` one-month bound holds only while staff act on it.
        - **No recorded answer.** A redelivery that finds a `calling` mark and no recorded answer (the worker stopped during the call) proceeds as sent, so the notice is never sent twice for that cause, and that crash window is accepted. A row with no mark (the worker stopped before the call) is sent. `notice_sent_at` is written and the window clears the ids.
        - **Pinned at U4b.** Which answer a malformed stored address and an address on the account's suppression list each produce is not assumed: U4b owes a test that pins both. If either produces an error, that address would hold the job in send retry with no end, so U4b's build adds a check of the stored address before the call, pinned by the same test, and treats an address that fails it as no address (`016-FR-012a`).
        - So no completed job keeps recipe ids beyond its bounce window. A job with no notice keeps no recipe ids after completion. The window's length is set at U4b's build, and it is at least the sending configuration's maximum delivery time.
    - **Other cooks' rows:** `collections.source_owner_handle` becomes NULL (`021` Edge Cases, "attribution stripped").
    - **Already handled on main:** ratings, `recipe_imports` (worker `:914-921`), parse jobs, the allowance ledger and private food lookups are deleted. `analytics_events` is anonymised.
    - **Kept as they are:**
        - `author_handles` keeps its tombstone, keyed by internal id, with no recipe id.
        - ADR-0027's `user_id` columns are retained, with one exception (owner ruling 2026-11-26): the erasure deletes the cook's own `ingredient_parse_corrections` and `ingredient_resolution_mappings` rows whose text the automatic scrub flags (Order, P2 and step 10). The rows are deleted, never re-keyed, because `user_id` is part of their authorization (`accountErasureWorker.ts:668-672`). Shared rows with no `user_id` stay. Main's header (`accountErasureWorker.ts:660-677`) and the `RETAINED_BY_RULING` entry (`erasureSweepCoverage.test.ts:290`) change with it, and the owed ADR records it.
        - Identity keeps `{id}` (R3).
    - **The job:** it keeps `owner_id`, `trigger_source`, `actor` and `old_owner_media_key` (the orphan sweeper's prefix). Each redaction and recipe transaction clears `own_site_redaction_ids` before it commits, and the final transaction clears `code_digest`. `redaction_recipe_ids`, `photo_plan` and `publish_recipe_ids` are cleared at completion. `kept_recipe_ids` is cleared at completion, or, on a job that sends the notice, when the bounce window closes. `scrub_retry_since` is cleared when the scrub passes (Scrub retry). Each recipe's `account_erasure_scrub_results` row is deleted in its recipe transaction and the rest in the final transaction (Order, step 13), or at a give-up before any recipe or redaction transaction committed. `removed_recipe_ids` is set by the final transaction and cleared at completion (d), so a re-claim skips to clean-up through every clean-up step.
    - **The owed ADR** (one ADR, written at this unit's build): ADR-0095 §1 and §5 and ADR-0100 §3 (the own-site redaction and the per-row tokens); ADR-0027 (the flagged correction rows, owner ruling 2026-11-26); and ADR-0078's outcome field, which on a kept recipe no longer names the claim after erasure; `020-FR-063`'s app id (kept under ADR-0027), which a record on a kept recipe no longer keeps; a linked social account's id on a kept recipe's outcome; the erasure's writes starting no 020 check; and the scrub retry that never gives up (owner rulings 2026-11-26); and the give-up counting only runs that made no progress (Scrub budget); the erasure split into one transaction per kept recipe and a final transaction (Order), which supersedes ADR-0074's "the existing erasure transaction keeps its shape"; the notice send retried with no give-up (Bounce window); and a copy in R whose check row waits for a person, which stays held until its owner's next save (Order, step 14).
    - **Tests:**
        - `erasureSweepCoverage.test.ts` gains a pinned `KEPT_RECIPE_DISPOSITION` for the id and handle rows. It cannot see S3 keys, snapshots or id lists.
        - A LOCAL e2e beside `handleResidueErasure.e2e.test.ts` erases a seeded cook and asserts the internal id appears in no column (text or jsonb) of any row reachable from a kept recipe, and in no S3 key under it. It also asserts that no `account_erasure_scrub_results` row of the job remains after the final transaction, that a job with no notice holds no recipe id at completion (`removed_recipe_ids` IS NULL included), that a notice job holds none once its bounce window has passed, and that the R8 record holds no recipe id.
        - The same LOCAL e2e asserts the `author_erased` CHECK and the partial index.
        - LOCAL e2e (own site):
            - Seed a "Written by you" recipe with own-site evidence (pasted page, credit, image); a clone that keeps `public_web` and the address; a clone of that clone with an archived version, and a staff correction row on the clone that names the address.
            - After the erasure, neither the address nor its host appears in any text, `text[]` or `jsonb` column of any recipe-service table (read from `information_schema`), nor in either bucket under the redaction set. A version listing under the redaction set's archive prefixes shows no earlier version.
            - The commit passed the deferred trigger, and each redacted row keeps `capture`, `source_kind`, `recorded_at` and `own_site_redaction`.
        - LOCAL e2e (dates):
            - Seed a donated draft, a donated private-published recipe and an already-public recipe, each with distinct times, and a kept recipe cloned from one of the cook's removed recipes.
            - After the erasure, every timestamp column of each kept recipe and of its photo, step and line rows equals its seeded value. The only exceptions are the draft's `first_published_at` and `source_confirmed_at`, which equal its `created_at`.
            - No value equals the `now()` of any erasure transaction.
        - LOCAL e2e (photos): no kept photo key contains the row id, the internal id, the owner token, an old media key or an old object id, and the old owner prefix is empty in both buckets. A version listing under the old owner prefix in the archive bucket shows no version.
        - Unit (residue tokens): the pure token functions give two attestations of one cook, on two recipes, different tokens, each equal to its `recipe_ref`'s owner token, and give two corrections by the same erased actor different tokens.
        - LOCAL e2e (residue): the stored attestation and correction tokens equal what those functions return for the seeded rows, and every `collections.source_owner_handle` that pointed at the cook's collections is NULL.
        - LOCAL e2e (pass): a deadlock on recipe 2 of 3 ends the pass, the final transaction does not commit in that run, and recipe 2 survives and is erased by the next run; a planned recipe that still passes the kept rule makes the final transaction roll back; a bounce whose takedown runs while a recipe transaction commits between its two statements still takes that recipe down; and a second worker whose rollback clears the plan never leaves a committed recipe pointing at deleted copies; a second worker that holds the old plan after the plan was cleared and written again rolls back its recipe transaction. The give-up never marks `failed` a job with `redaction_recipe_ids` set.
        - Unit (phases): a plan that keeps no recipe sets `old_owner_media_key`, and the old owner prefix is empty after (b); a crash after (P3) and before the commit is re-claimed, reuses the stored photo plan and leaves no copy outside it. A difference between (P1) and a recipe's locked rows rolls back that recipe's transaction and deletes its scrub results. Before any recipe transaction has committed it also deletes the plan's copies and clears the plan, and after one has, the plan stays. A crash in each of (a) to (d) after the commit leaves the job `running`, and the re-claim skips the transactions and finishes from the stored ids. A crash seeded after (b) and one seeded after (c) are each re-claimed without the final transaction running again. The give-up never marks `failed` a job whose `kept_recipe_ids` is set. The give-up of a job with `photo_plan` set and no `kept_recipe_ids` deletes the plan's copies, clears the plan and deletes its scrub results before marking it `failed`, and the give-up of a job with neither `photo_plan` nor `kept_recipe_ids` deletes its scrub results. The scrub validator rejects "Do not stir" to "Do stir", "Never add salt" to "add salt", "Don't overmix" to "overmix", "Stir until thick" to "Stir thick", "1 cup nuts, optional" to "1 cup nuts", "Salt or soy sauce" to "Salt soy sauce", a replacement that adds "not" in place of a removed name, "Beat 2 eggs" to "Beat eggs", "two cups" to "three cups", "1/2 cup" to "2 cup", "Bake 20 minutes" to "Bake 20", two steps swapped (one pair that differs in more than three words, and one pair that differs in one word), "Serves 4" to "Serves 6", "Gas mark 4" to "Gas mark 5", a replacement of four words, a replacement that holds a number or a removed name, "Ruth's" removed and "Ruth" put back, "2 cups flour" to "2 cups sugar" when another line holds "sugar", "half a cup sugar" to "a cup sugar", "two hundred grams" to "two grams", "one and a half cups" to "one cups", "Bake at 350F" to "Bake at", "½ cup" to "cup", "1/2 cup" to "1-2 cup", "Cook 20mins" to "Cook", "the 2nd rise" to "the rise" in a step, "Cook 0 minutes" to "Cook minutes", "Freeze at -18 °C" to "Freeze at °C" and to "Freeze at 18 °C", "Gas mark 4" to "Gas mark" in the story, and an emptied title, step or line. It accepts a story that the scrub empties, `016-FR-037`'s examples ("Maya's soup" to "Lentil soup" when a line holds "lentils", and "Grandma Ruth's trick" to "a family trick"), and a phone number removed from the story. It accepts "Ruth's or Ann's sauce" to "Family or friend sauce" and rejects it to "Family sauce", and a step that holds a phone number passes when the scrub leaves the number in place. On a scrub failure (rejected or unavailable), the job stays `running`, `scrub_retry_since` is set once, nothing from (P2) is written to a recipe, the results already saved stay, the message is not rethrown, the give-up never marks it `failed` at any attempt count or age, its plan's copies stay, and a passing scrub clears `scrub_retry_since` and sets `attempts` to 0. The sweeper emits `OldestErasureScrubRetryAgeSeconds` with `Stage`. A synth test in `infra/__tests__/RecipeWorkersStack.test.ts` pins its alarm: namespace `Commise/RecipeErasure`, metric name `OldestErasureScrubRetryAgeSeconds`, the one dimension `Stage` equal to the stage, statistic `Maximum`, threshold 3600, and the stage's alarm action. With `alarmsEnabled` false there is no such alarm. The same file asserts the erasure function's timeout is at least twice the worker's `ERASURE_PREPARE_RESERVE`.
        - Unit (scrub budget): a run that commits only a redaction transaction sets `attempts` to 0; with a fake Lambda context, no scrub or photo-check call starts after the deadline; a run that runs out of time after saving a new result sets `attempts` to 0, leaves `scrub_retry_since` NULL and returns without rethrowing; one that saves none enters scrub retry; a retry reuses each saved result whose `input_digest` matches and scrubs again one whose recipe changed; the rollback in step (2) deletes the changed recipe's results; a recipe with a passed text and an unchecked photo is not saved as passed; and (P4) skips a photo whose entry holds its hash, and resets `attempts` when it adds one; a (P4) deadline stop that adds no hash rethrows; an S3 copy that does not answer is aborted after 30 seconds and the run records its stop; and a run that commits at least one recipe transaction sets `attempts` to 0.
        - LOCAL e2e (scrub retry SQL), in `packages/services/recipe-workers/tests/e2e/` beside `queueCheck.e2e.test.ts`: `queueCheckReads` gives a job in scrub retry, with 10 or more attempts, older than an hour and idle past the lease, no `stuck` and no `exhausted` condition, and still counts it in `owed_past_deadline` and `oldest_owed_seconds`. It also gives a job whose send row holds an error and no message id, with 10 or more attempts, older than an hour and idle past the lease, no `stuck` and no `exhausted` condition, and still counts it in `owed_past_deadline` and `oldest_owed_seconds`. The sweeper's claim re-sends a scrub-retry job only once `now() - updated_at` reaches its wait: rows seeded at `attempts` 1, 2, 3 and 9, each just before and just after its wait of 15 minutes, 30, 1 hour and 24 hours, and at `attempts` 40, just before and just after 24 hours, which the claim reads with no overflow and no failed tick. It re-sends a job not in scrub retry after `STALE_AFTER`, as on main. A job with a saved scrub result and `scrub_retry_since` NULL, idle between the lease and `STALE_AFTER`, counts in no `claimed_too_long`, and the same job idle past `STALE_AFTER` counts in `claimed_too_long`.
        - Unit and LOCAL e2e (erasure transactions): a public read running at the same time as a recipe transaction returns either the named recipe or "a former member", never a token owner without the marker, and never the marker with an old photo key, and never the name with a new photo key, scrubbed text or a renewed id. The in-app detail read and `getCollection` each get the snapshot test `003A` U4 states for the public read. For `getCollection`: a collection cloned from the cook's collection before recipe transaction 1, read across each erasure transaction's commit, never shows the old `source_owner_handle` beside a member shown as "a former member". A clone made between two transactions copies the cook's name and shows it beside an erased member until the next transaction clears it, and that window is accepted (Order). A collection another cook clones from the cook's collection between recipe transaction 1 and the final transaction has `source_owner_handle` NULL after the erasure. With 020 blocking, a kept recipe of the cook that is not "Written by you" and sits in another kept recipe's R is redacted, keeps an allowing digest after its redaction transaction, and survives the final transaction. An authored own-site recipe and the cook's own kept clone of it complete in one run, with each evidence row redacted once. A copy of K2 made after R(K1) is read and before K2's redaction transaction ends with no host in H(K1). No hide row is written by the erasure. On a notice job, the completed row keeps `kept_recipe_ids` until the window has passed since `notice_sent_at`, then the sweeper clears it. The cook's flagged correction rows are gone, the cook's unflagged rows remain, and shared rows with no `user_id` remain. Once 020 ships: a kept recipe's outcome that a site claim cleared has no claim id, method or check time; one a linked social account cleared has no link id or platform; no 020 record on a kept recipe holds the cook's app id; and the recipe's `checked_content_digest` is not NULL, has an allowing outcome, and no 020 check was requested. A kept recipe has exactly one `recipe_source_checks` row, keyed to its new digest. Its `judged_cited_host` and `part_results` hold no host in H, and it has no parts, items, matches or referrals. Its `recipe_match_fingerprints` row matches the scrubbed text, and it has no source key with a host in H. Each kept photo's `content_sha256` is its stripped photo's hash, and its `check_key` lies under the new owner prefix, and a photo whose `check_key` was NULL keeps it NULL with no planned check copy. With 020 seeded in blocking mode, a public recipe whose latest edit is still being checked is deleted with the erasure. In shadow mode it is kept, and its `checking` row is re-keyed to the new digest. A reviewer's refusal that starts after step (2) waits, then updates no row. Another cook's public copy in R stays readable after the erasure: its `checked_content_digest` is not NULL and matches its redacted content, its re-keyed row allows, and no 020 check was requested. A kept set of three recipes, with a crash after the first recipe transaction: the re-claim skips the erased recipe, erases the other two, and the final transaction then deletes the removed set, and the give-up never marks that job `failed`. A recipe that passes the kept rule only after the plan is written is deleted by the final transaction, and the copies the plan names for a planned recipe that was not kept are deleted.
        - LOCAL e2e (timing), on a developer's machine, printing each time: one recipe transaction for a kept recipe of the largest shape (100 ingredient lines, `MAX_RECIPE_INGREDIENTS`; 200 steps, the import limit `MAX_IMPORT_STEPS`; 10 photos, `MAX_RECIPE_PHOTOS`; 50 tags, `MAX_RECIPE_TAGS`; one check row with its parts; and 50 `recipe_versions` rows with their attestations) commits within 5 seconds; one redaction transaction for a copy in R commits within 1 second; and the final transaction for 5,000 removed recipes of 20 lines, 10 steps and 2 photos each commits within 30 seconds. The margins against the 90 seconds after the deadline cover a slower stage database. The final transaction's work is main's delete, which grows with the removed set as on main. If it misses its bound, deleting the removed set in batches is owed before this unit ships.

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
- **Files:** `.../accountErasureWorker.ts` (collections delete); `packages/services/recipe-service/src/database/schema/collections.ts`
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
- **Dependencies:** U2, U3a/b/c, U4a, `016` L121-01 (the hide record and the rule 8 reading, shipped first)
- **Files:** the app account screens (distinct "close account" → closure; "erase / forget me" → the
  confirmation-gated erasure with per-recipe donate election) — web + mobile; the deletion-worker
  orchestration (recipe-job → **food `eraseUser`** → Clerk-delete) + the `user.deleted` echo guard; **the
  food-erasure leg** — the shipped `packages/services/food-service/src/foods/userErasure.service.ts`
  (`eraseUser`, currently DEAD CODE: no handler/subscription) must be invoked on erasure, either via a new
  food deletion Lambda subscribed to the fan-out or an M2M call from the deletion-worker (+ its CDK/IAM — the
  service explicitly deferred this wiring); **the R7 reconciliation job** — a NEW scheduled handler
  `packages/services/identity-webhooks/src/handlers/erasureReconciliation.ts` (distinct from the existing
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
  erasure leg. **Erasure notice (owner 2026-11-21, `016-FR-012a`).** On the webhook or admin path, the worker hides the kept public recipes (rule 8). It then sends the notice from identity's own email record, before identity's email is purged, and logs the message id, the variant and the outcome with no address. The hide writes an `erasureNotice` row (`016` data-model §16), so U4b depends on `016` L121-01. It unhides the recipes after the send. On a bounce matched by message id, or with no address for any reason other than an earlier closure, it takes them down. An account closed earlier keeps its public recipes as "a former member": no hide, no send, no bounce wait, and owner tokens computed from a throwaway code (`016-FR-012a`). An enforcement removal sends the enforcement variant with the decision's reasons and appeal, in every market. From the send the recipes are readable again: with the cook's name before the recipe's erasure transaction commits, and as "a former member" after it. The release of the hide writes the job's `notice_sent_at`. The job completes as on main, and the completed job keeps the kept recipe ids, never the code, until the bounce window closes (U3b, Bounce window), so a bounce in the window finds and takes them down. A later bounce finds nothing, and the recipes stay up as "a former member" (`016-FR-012a`). A unique send row per job id is written before the SES call, with no answer, and the call's answer is recorded on it: a message id, a refusal, or an error. The code is made for each send, and its digest is stored on the job before the email is built. The worker marks the row `calling` just before the SES call. A redelivery that finds a message id, or a `calling` mark with no recorded answer (the worker stopped during the call), sends nothing more and proceeds as sent: that crash window is accepted. A row with no mark (the worker stopped before the call) is sent. One that finds an error and no message id clears the answer and the mark, marks it `calling` again, and sends with a new code. A send SES refuses outright (`MessageRejected`) is handled as a bounce (U3b, Bounce window; owner ruling 2026-11-26). The give-up skips a job whose send row holds an error and no message id, and no recipe transaction starts while it does. U4b owes a test that pins which answer a malformed stored address and an address on the account's suppression list each produce (U3b, Bounce window). The send log holds the message id, the variant, the outcome and the job id. It never holds the address, the code or the digest.
- **Execution note:** UI feature-bearing — vitest component tests every state + Playwright (web) + Maestro (mobile) happy paths. Device runs happen once at the PR's final head.
- **Test scenarios:** closure and erasure presented as distinct, non-conflatable (erasure carries the phrase +
  election; closure doesn't); **the `user.deleted` echo fires while the first job is still RUNNING → zero
  second job row, no collision, donated recipe NOT deleted** (R9); webhook/admin erasure → default `delete`,
  alarmed; a dropped recipe leg raises the incomplete signal + is reconcilable. webhook erasure with an address → hidden, sent, unhidden, and the log holds no address; a recipe hidden during the send window reads closed through `contentOpen`; a closed account (no address) → no `erasureNotice` row, no send logged; named until its recipe transaction commits, then kept as "a former member"; and the owner token set; no address for another reason → taken down; bounce after the send → taken down; a send SES refuses with `MessageRejected` → taken down, and the job keeps no recipe ids afterwards; a send that fails with `TooManyRequestsException`, `SendingPausedException`, a 5xx answer or a network failure → not taken down, the error recorded on the send row with no message id, and the message rethrown; `TooManyRequestsException` then success → two SES calls, exactly one message id on the send row, and the job's `code_digest` is the digest of the code in the email SES accepted; a row marked `calling` with no recorded answer → no second call, proceeds as sent; a row with no mark → the send is made; the give-up never marks `failed` a job whose send row holds an error and no message id, at any attempt count or age, and a recorded message id sets `attempts` to 0; no recipe transaction starts while the send row holds an error; a DEPLOYED test against the SES mailbox simulator records which answer a malformed address and a suppressed address each produce; enforcement removal → enforcement variant with reasons and appeal, in every market.
- **Verification:** events never collapse; the deletion-worker guarantees recipe-first ordering server-side;
  the echo is a no-op against any existing job; a half-completed erasure is detected. Clerk self-deletion is off in production and in the sandbox. An operator confirms the dashboard setting and records it in the PR, and a deployed check reads a test user's `deleteSelfEnabled` through the Backend API and expects `false`.

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
  basis for community content), so the "Art. 17 satisfaction" claim is backed.
  _(Superseded 2026-11-21, owner ruling; `016-FR-037`, `016-FR-076`; see U3b.)_ After the erasure completes, the job row keeps no recipe ids, except a notice job, until its bounce window closes (U3b, Bounce window). The sealed records of `016-FR-052a` are the one allowed link between a kept recipe and the person, except the working data of an open takedown request the person made (`016-FR-052a` item 2). They live in their own store, not on the job row.
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
- **U3a rebuilds the most safety-critical path** (scoped delete + scoped clone-detach + owner-prefix S3 sweep +
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
  lawful bases. This plan states the engineering shape.

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
  identity `users.service.ts`, `users.ts`, `clerkAuth.service.ts`, `identityClient.ts`, `deletionWorker.ts`;
  food `operational.ts`, `provenance.ts`, `foodAuth.guard.ts`; recipe `accountErasureWorker.ts`,
  `erasureSweeper.ts`, `account.ts`, `collections.ts`, `recipes.ts`.
