# 06 — Identity service, identity-webhooks, shared packages, cross-service messaging/erasure edges

**Scope audited**: `packages/services/identity/**`, `packages/services/identity-webhooks/**`,
`packages/shared/**`, `packages/clients/usda`, plus the two cross-service edges those own — the
handle-sync SNS producer→consumer edge and the erasure fan-out to recipe + food.

**Governing decisions read before forming any opinion**: `CLAUDE.md` (auth architecture; the
"no trusted-header path" decision; ADR-0009 sign-out), ADR-0009, ADR-0012, ADR-0014, ADR-0015,
ADR-0016, ADR-0018, ADR-0019, `specs/governance-rules.md` GR-015 / GR-016.

Three decisions bind directly on findings below and are quoted where they do.

---

## F-D1

**Severity**: HIGH

**File**: `packages/services/identity/src/users/users.schema.ts:123` ·
`packages/services/identity/src/users/users.service.ts:220-224` ·
`packages/services/identity-webhooks/src/handlers/identityWebhook.ts:41,200-210` ·
`packages/services/identity-webhooks/src/common/idp-payload.schema.ts:50,65` ·
`packages/services/recipe-workers/src/common/messages.schema.ts:130-141` ·
`packages/services/recipe-workers/src/handlers/handle-sync-worker.ts:53-58,111-116`

**What breaks**: The suspected "handle-sync path drops `displayName`" is REAL, on two distinct inputs.
The producer and the consumer of the handle-sync message declare independent, DISAGREEING bounds, and
every message the consumer rejects is silently discarded — no retry, no DLQ, no metric, no alarm, just
`logger.warn('dropping unparseable message')`.

- **Input A — a user clears their name.** `PATCH /api/v1/users/me` with `{"displayName": ""}` is a
  VALID request: `patchUserMeRequestSchema.displayName` is `z.string().max(100).optional()` with no
  `.min(1)` (`users.schema.ts:123`). Identity writes `profiles.display_name = ''`, answers `200`, and
  publishes `{ userId, displayName: '', sourceTimestamp }` (`users.service.ts:222-224`). The consumer's
  `handleSyncMessageSchema.displayName` is `z.string().trim().min(1).max(100)`
  (`messages.schema.ts:134`), so `safeParse` fails `too_small`, `parseHandleSyncMessage` returns
  `undefined` (`handle-sync-worker.ts:55`), and the handler `continue`s past it
  (`handle-sync-worker.ts:113-116`) — deliberately NOT a `batchItemFailures` entry, so it never reaches
  the DLQ. `author_handles.display_name`, `recipes.author_handle` and `recipe_versions.editor_handle`
  keep the OLD name **permanently**. The user's former name stays attached to every public recipe they
  authored, and identity's own read (`GET /users/me`) says the rename succeeded.
- **Input B — a Clerk name longer than 100 characters.** The webhook derives
  `buildDisplayName(data) = `${first_name ?? ''} ${last_name ?? ''}`.trim()`
  (`identityWebhook.ts:41`). Each component is bounded at `MAX_DISPLAY_NAME_LENGTH = 100`
  INDEPENDENTLY (`idp-payload.schema.ts:50,65`), so the join can be **201** characters. That value
  passes identity's validation, is written to `profiles.display_name` (unbounded `text`) and published
  — then fails the consumer's `.max(100)` (`too_big`) and is dropped the same way.
  `idp-payload.schema.ts:48` asserts "the join is bounded by construction"; it is bounded at 201, not
  at 100, so the claim is false for exactly the values that break the edge. The consumer's own
  justification (`messages.schema.ts:62-75`) — "identity caps `displayName` at 100 … so a longer value
  could not have been set through identity's API" — is true of the PATCH producer and **false of the
  webhook producer**, which the comment does not consider.
- **Input C (cosmetic, same root cause)** — the consumer `.trim()`s and the producer does not, so
  `"  Bob  "` is stored by identity verbatim and by recipe as `"Bob"`. Two read models, two answers.

**Why it happens**: `HandleSyncMessage` is a cross-service bus contract with **two independent
representations**: a plain `interface` + builder in `@kitchensink/identity-core`
(`packages/shared/identity-core/src/handleSync.ts:11-35`, no zod at all) and an independently authored
zod in the consumer (`messages.schema.ts:130-141`). Nothing ties them. The consumer's own module header
(`messages.schema.ts:23-28`) records the gap — "the cross-service half of that contract is therefore
still two representations … the gap is recorded rather than papered over" — but records only the
duplication, not that the two shapes ALREADY disagree and that the disagreement is discarded silently.

**Smallest fix**: two lines and one disposition change, in that order of value.

1. Tighten the producer to the shape the consumer already requires:
   `users.schema.ts:123` → `displayName: z.string().trim().min(1).max(100).optional()`, and in
   `identityWebhook.ts` clamp/skip: derive with the shared `deriveDisplayName`, then publish only when
   the derived name is non-empty and `.slice(0, 100)` it (or reject at
   `idp-payload.schema.ts` with a joined-length refinement). This makes the two producers unable to
   emit a value the consumer refuses.
2. Change the consumer's disposition for a **schema** failure (as opposed to malformed JSON): push
   `record.messageId` onto `batchItemFailures` so it retries into the DLQ and its alarm.
   `handle-sync-worker.ts:36` reasons correctly that "a retry can't fix bad JSON"; producer/consumer
   contract skew is not bad JSON, and it is exactly what a DLQ exists to surface.

The durable fix is F-D7.

**Verified (how)**: Read all six files. Ran the two schemas against the four inputs under the
repo's installed `zod@4.4.3`:

```
empty (PATCH displayName:"")     REJECTED: too_small
121 chars (Clerk first+last)     REJECTED: too_big
padded "  Bob  "                 OK -> "Bob"
producer accepts ""            : true
```

---

## F-D2

**Severity**: HIGH

**File**: `packages/services/identity-webhooks/src/common/erase-identity.ts:44-70` ·
`packages/services/identity-webhooks/src/handlers/deletion-worker.ts:93-127` ·
`packages/shared/identity-core/src/profileScrubPolicy.ts:52-53,85-91` ·
`packages/services/identity/src/users/avatar-object-store.ts:6-9,36-64` ·
`packages/infra/global/lib/platform/data-stack.ts:329-336`

**What breaks**: A GDPR Art. 17 erasure leaves the user's avatar image — a photograph of the person —
readable in S3 indefinitely, in **both** erasure paths, for two independent reasons. The
erasure-reconciliation sweep then reports the erasure COMPLETE, because it only checks the recipe and
food legs.

- **Path 1 — the `user.deleted` webhook erasure performs no S3 delete at all.** `eraseFromWebhook`
  (`deletion-worker.ts:93-127`) calls `eraseIdentityRow` then `fanOutOrThrow`. `eraseIdentityRow`
  (`erase-identity.ts:44-70`) computes `computeProfileScrub('erasure', …)` — whose directive carries
  `removeAvatarObject: true` (`profileScrubPolicy.ts:52-53`) — and **never reads that field**. There is
  no S3 client, no bucket name and no `s3:DeleteObject` grant anywhere in `identity-webhooks`
  (verified by search over `src/`). This path erases a user who was **never closed**, so no earlier
  closure removed the object.
- **Path 2 — even the closure delete does not delete the bytes.** `MediaBucket` is
  `versioned: true` with **no** `lifecycleRules` (`data-stack.ts:329-336`).
  `S3AvatarObjectStore.deleteAllForUser` issues `DeleteObjectsCommand` with no `VersionId`
  (`avatar-object-store.ts:54-56`), which on a versioned bucket inserts **delete markers** and retains
  every prior version. The subsequent `ListObjectsV2` finds nothing, so the store logs
  `{ deleted: N }` and every caller believes the object is gone. Any principal with
  `s3:GetObjectVersion` — which the identity task role has via `grantReadWrite`
  (`identity-service-stack.ts:180`) — can still read the image.

**Why it happens**: The governing docstring covers only one of the two erasure entry points.
`avatar-object-store.ts:6-9` states:

> "Only the identity SERVICE (ECS, granted `s3:*Object`/`s3:List*` on the media bucket via
> `grantReadWrite`) performs avatar S3 deletion; the identity-webhooks Lambdas have no S3 grant, which
> is why **the 12-month sweep relies on closure having already removed the object**."

That premise holds for `tombstone-sweep` (the user closed 12 months earlier). It does **not** hold for
the KTD-2 `user.deleted` full erasure in `deletion-worker.ts`, which was added later and reaches
`eraseIdentityRow` with no prior closure. The Specification pattern is also breached: the policy module
emits `removeAvatarObject: true` and one of its two consumers silently drops that field.

**Smallest fix**: two independent changes; both are needed.

1. Delete the object **versions**, not the current keys: in
   `avatar-object-store.ts:44-61`, use `ListObjectVersionsCommand` and pass `{ Key, VersionId }` per
   entry to `DeleteObjectsCommand` (also covering delete markers). One-file change, no infra edit.
2. Give the erasure path the capability it is already told to use. Cheapest correct form without a new
   grant: have `deletion-worker`'s erasure branch enqueue/call identity's own avatar purge, or — if a
   grant is acceptable — add `mediaBucket.grantReadWrite` + `MEDIA_BUCKET_NAME` to the deletion-worker
   and tombstone-sweep Lambdas and call the same store from `eraseIdentityRow`'s callers, honouring
   `directive.removeAvatarObject`. Whichever is chosen, `erasure-reconciliation.ts`'s
   `isErasureComplete` should gain the avatar-residue leg so the detective control can see it.

**Verified (how)**: Read all five files. Searched `packages/services/identity-webhooks/src` for
`S3|s3|deleteAllForUser|avatar` — only log-scrubber key names and the Clerk `image_url` field match; no
S3 client. Confirmed `versioned: true` and the absence of `lifecycleRules` on `MediaBucket`. Delete-marker
semantics on a versioned bucket are standard S3 behaviour for a `DeleteObjects` without `VersionId`.

---

## F-D3

**Severity**: HIGH

**File**: `packages/services/identity/src/admin/admin.service.ts:61-95` (vs `:108-166`) ·
`packages/services/identity-webhooks/src/handlers/erasure-reconciliation.ts:111-116` ·
`packages/services/identity-webhooks/src/handlers/tombstone-sweep.ts:88-91` ·
`packages/services/identity/src/users/users.service.ts:133`

**What breaks**: `suspendUser` and `unsuspendUser` write `users.status` with **no lifecycle-state
guard** — only a "row exists" check. Their sibling `reactivateUser` guards carefully
(`admin.service.ts:118-124`, rejecting anything that is not `tombstoned`, "erased is irreversible by
design"). The two unguarded methods can therefore drive the account state machine anywhere, and three
invariants fall out of it:

- **An erased account can be resurrected.** `POST /api/v1/admin/users/{id}/unsuspend` on a user whose
  `status = 'erased'` sets `status = 'active'` (`admin.service.ts:90`). The R10 anti-resurrection guard
  in `resolveOrCreateFromClaims` (`users.service.ts:133`) keys on
  `status === 'tombstoned' || status === 'erased'`, so it stops firing. The row is a scrubbed `{id}`
  shell with a `@erased.invalid` placeholder email that is now presented as an ACTIVE account.
- **A half-erased account can be dropped from the ONLY detective control.** `suspendUser` on an
  `erased` user sets `status = 'suspended'`. The erasure-reconciliation sweep scans
  `and(eq(users.status, 'erased'), …, isNull(users.reconciledAt))`
  (`erasure-reconciliation.ts:115`). The account no longer matches, so a stuck recipe or food leg stops
  feeding `ErasureIncomplete` forever — the exact "half-erased-forever failure this control exists to
  catch" that `erasure-reconciliation.ts:28-37` says a time window was rejected to avoid.
- **The 12-month retention erasure can be silently cancelled.** `unsuspendUser` on a `tombstoned` user
  sets `status = 'active'` but leaves `deletedAt` set and enqueues **no** Clerk unban (unlike
  `reactivateUser:144-161`). The tombstone sweep selects
  `and(eq(status,'tombstoned'), lte(deletedAt, cutoff))` (`tombstone-sweep.ts:91`) and no longer
  matches, so the KTD-3 auto-erasure never runs; meanwhile the DB says `active` and Clerk still has the
  identity banned.

Additionally, neither method writes a `lifecycle_events` row, while closure, reactivation and erasure
all do (R8). An admin suspending an account leaves no audit record.

**Why it happens**: authorization was correctly centralised into `ScopesGuard` +
`@RequireScopes('admin:users')` (`admin.controller.ts:20-22`), and the per-method `assertAdmin` was
removed — but the **state** precondition was never added alongside it. `reactivateUser` grew one because
its own flow required it; the two older methods predate the `tombstoned`/`erased` states entirely and
were never revisited when those states became load-bearing.

**Smallest fix**: add the same guard `reactivateUser` already has, to both methods —
in `suspendUser` and `unsuspendUser`, after the `NotFoundException`:

```ts
if (existing.status === 'tombstoned' || existing.status === 'erased') {
    throw new ConflictException(
        `User ${targetSub} is '${existing.status}'; suspension does not apply to a closed or erased account`,
    );
}
```

Follow-up (separate, larger): write the R8 `lifecycle_events` row for both transitions, and express the
whole thing as a State/statechart so an illegal transition is unrepresentable rather than guarded four
times.

**Verified (how)**: Read `admin.service.ts` end to end and both sweep selectors. The suspend/unsuspend
methods contain exactly one precondition each (`if (!existing) throw new NotFoundException`), lines 67
and 85.

---

## F-D4

**Severity**: HIGH

**File**: `packages/services/identity-webhooks/src/common/erasure-fanout.ts:154-170` ·
`packages/services/identity-webhooks/src/handlers/erasure-reconciliation.ts:65-70,127-129` ·
`packages/services/identity-webhooks/src/handlers/deletion-worker.ts:49-82`

**What breaks**: The suspicion "the erasure fan-out may parse responses unsafely" is CONFIRMED, and it
fails **open** on the leg that matters. `callLeg` reads the response as
`(await response.json().catch(() => ({}))) as Record<string, unknown>` (`erasure-fanout.ts:158`) and
then narrows two fields with ad-hoc `asString` / `asNumber` helpers (`:183-190`). Concretely:

- A 2xx whose body is **not JSON** (an intermediary's HTML, an empty body, a truncated response) is
  swallowed into `{}` — no error, no signal. `asNumber(undefined)` returns `undefined`.
- `isErasureComplete` then computes
  `foodComplete = result.food.ok && (result.food.deletedRequesterRows ?? 0) === 0`
  (`erasure-reconciliation.ts:67`). `undefined ?? 0` is `0`, so **an unreadable food response is
  indistinguishable from "food is clean"**.
- The sweep therefore calls `stampReconciled` (`:129`), writing `users.reconciled_at`. The scan filters
  `isNull(users.reconciledAt)` (`:115`), so that identity **permanently leaves the nightly sweep**. The
  residue signal `deletedRequesterRows` — which the food contract calls "the RESIDUE SIGNAL the
  erasure-reconciliation sweep reads … part of the contract, not a debugging nicety"
  (`packages/schemas/food/src/schemas/service-erasure.schema.ts:20-24`) — is lost, and the only control
  that would ever notice is switched off for that user.
- Same file, secondary: `fanOutOrThrow` treats any 2xx as success (`deletion-worker.ts:53`), so a
  recipe leg answering `{ status: 'failed' }` — a value its own published contract admits
  (`packages/schemas/recipe/src/schemas/account.schema.ts:182`) — is logged as
  "erasure fan-out complete".

**Why it happens**: ADR-0015 names this exact file and this exact requirement, and it is not met.
Decision 4:

> "Nothing reaches a database or another service unvalidated. On a service-to-service edge — recipe →
> food, and identity's erasure fan-out
> (`packages/services/identity-webhooks/src/common/erasure-fanout.ts`) →
> `POST /api/v1/internal/account/erasure` on recipe and food — the outbound body is validated against
> the callee's schema-package zod before the call, and **the inbound response is validated on
> receipt**."

Both callees publish exactly the zod required: `foodServiceErasureAcceptedResponseSchema`
(`packages/schemas/food/src/schemas/service-erasure.schema.ts:29-34`, `deletedRequesterRows: z.number()`)
and `serviceErasureAcceptedResponseSchema`
(`packages/schemas/recipe/src/schemas/account.schema.ts:177-186`), each exported from its package
barrel. `identity-webhooks/package.json` declares neither schema package as a dependency, so nothing
even made the correct import available. (There is no outbound-body half to fix: both routes take **no**
request body by design — `account.schema.ts:36-39` — so the outbound half of decision 4 is vacuous here
and correctly so.)

**Smallest fix**: add `@kitchensink/schema-food` and `@kitchensink/schema-recipe` (zod-only leaf
packages, no service graph — safe in a Lambda bundle) to `identity-webhooks/package.json`, then replace
`erasure-fanout.ts:158-167` with a `safeParse` against the leg's published schema, returning
`{ service, ok: false, httpStatus, detail: 'response failed contract' }` on failure. `undefined`
residue then fails CLOSED: the leg is `ok: false`, `isErasureComplete` is `false`, the identity stays in
the sweep and feeds `ErasureIncomplete`. Separately, tighten `fanOutOrThrow` to require
`result.recipe.jobStatus !== 'failed'`.

**Verified (how)**: Read `erasure-fanout.ts`, `erasure-reconciliation.ts`, `deletion-worker.ts`, both
published schemas and both barrels (`packages/schemas/food/src/schemas.ts:13`,
`packages/schemas/recipe/src/schemas.ts:11`). Read ADR-0015 in full and quoted decision 4. Confirmed
`identity-webhooks/package.json:42-60` lists no `@kitchensink/schema-*` dependency. Confirmed food
currently returns a real number (`food-service/src/foods/service-erasure.controller.ts:56`), so the
break is the unparseable-body path and future drift, not a live shape mismatch today.

---

## F-D5

**Severity**: MEDIUM

**File**: `packages/services/identity/src/users/avatar-upload.controller.ts:65` ·
`packages/infra/global/lib/platform/data-stack.ts:329-336`

**What breaks**: `POST /api/v1/users/me/avatar/presign` returns
`publicUrl = https://{bucket}.s3.amazonaws.com/{key}` (`avatar-upload.controller.ts:65`). `MediaBucket`
is created with `blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL` (`data-stack.ts:330`) and there is
no CloudFront distribution over it anywhere in the repo — `recipe-service-stack.ts` states outright
that "no CloudFront construct exists in this repo's CDK". So the URL the service hands back answers
`403 AccessDenied` to every caller. The upload itself succeeds (the presigned `PUT` is signed with the
task role's credentials), the client then `PATCH`es `avatarUrl` to that URL — which
`patchUserMeRequestSchema` accepts, since `z.url()` only checks syntax
(`users.schema.ts:125`) — and every surface renders a broken image, permanently, with no error anywhere
in the stack.

**Why it happens**: the presign controller composes the URL from `bucket` + `key` directly rather than
from a configured CDN base, the way recipe does (`search.dal.ts:227-233` resolves keys against
`cloudfrontUrl` and degrades to omitting the URL when it is absent). Nothing asserts that the returned
`publicUrl` is fetchable, so no test tier can see it.

**Smallest fix**: make the read origin configuration, not a construction:
read `MEDIA_CDN_BASE_URL` and return `${cdnBase}/${key}`; when it is unset, return no `publicUrl` and
have the client re-presign a GET — i.e. mirror recipe's degrade-to-absent behaviour rather than emitting
a URL that is known not to resolve. This is a two-way door (nothing is persisted by the presign route
itself), but note that any `avatarUrl` already persisted through `PATCH /users/me` is stale data that a
backfill must fix.

**Verified (how)**: Read the controller, `data-stack.ts` (`MediaBucket`, `BLOCK_ALL`, no
`publicReadAccess`, no bucket policy) and searched all three infra `lib/` trees for a CloudFront
distribution — none exists. NOT verified against a running stage; I did not fetch a real `publicUrl`.

---

## F-D6

**Severity**: MEDIUM

**File**: `packages/services/identity-webhooks/package.json:48` ·
`packages/services/identity-webhooks/src/handlers/identityWebhook.ts:10-13` ·
`packages/services/identity/package.json:10` ·
`packages/infra/global/__tests__/app-service-dependency.test.ts`

**What breaks**: One deployable service depends on another deployable service's source.
`identity-webhooks` declares `"@kitchensink/identity-service": "*"` and imports
`@kitchensink/identity-service/users/handle-sync-publisher` from a Lambda handler. The Lambda's own
bundler comment names it as an inlined dependency: "every dependency (svix, drizzle, **the
@kitchensink/identity-service source**, Sentry, …) must be inlined here" (`esbuild.mjs:8-11`). Today the
imported module's own graph is only `@aws-sdk/client-sns`, so nothing heavy is actually bundled — the
exposure is that the next non-type import from that package silently drags `@nestjs/*`, `drizzle-orm`
and `pg` into a Lambda asset, and that identity-service's package graph becomes a build input of a
Lambda that has nothing to do with the HTTP service.

**Why it happens**: the repo already ruled this class of edge out — but only for apps.
`users.schema.ts:5-21` records the removal of exactly this inversion for web and mobile, and
`app-service-dependency.test.ts` enforces it. That gate's scope is `APPS_ROOT = 'packages/apps'` against
`SERVICES_ROOT = 'packages/services'`, so a `packages/services/* → packages/services/*` edge is
structurally invisible to it, exactly as the pre-existing app edges were invisible to
`boundariesRatchet.mjs` ("they were declared, so it was structurally blind to them").

**Smallest fix**: move `handle-sync.publisher.ts` into `@kitchensink/identity-core` — which both
packages already depend on and which already owns `HandleSyncMessage` and `buildHandleSyncMessage`
(`packages/shared/identity-core/src/handleSync.ts`). Then delete the
`"./users/handle-sync-publisher"` entry from `identity/package.json:10` and the
`"@kitchensink/identity-service": "*"` dependency from `identity-webhooks/package.json:48`. The Port
(`HandleSyncPublisher`) / Adapter (`createSnsHandleSyncPublisher`) split is preserved verbatim; only its
home changes. Optionally widen the gate to forbid `services/* → services/*` once the edge is gone.
This is pre-existing on `main`, not introduced by this PR.

**Verified (how)**: Read both manifests, the import site, `esbuild.mjs`, and the gate's scope
constants. `git show main:…/identityWebhook.ts | rg identity-service` confirms the edge predates this
branch.

---

## F-D7

**Severity**: MEDIUM (root cause of F-D1; blocks ADR-0019's stated requirement for 014)

**File**: `packages/shared/identity-core/src/handleSync.ts:11-35` ·
`packages/services/recipe-workers/src/common/messages.schema.ts:23-28,130-141`

**What breaks**: The only cross-service bus contract that exists today is declared **twice** and in two
different mechanisms — a hand-written `interface` on the producer side with no runtime validator at all,
and an independently authored zod on the consumer side. That is precisely the shape ADR-0019 forbids
for the status messages 014 will consume:

> "The status envelope, its stage vocabulary, and its supersession key are **one contract**, authored
> once and generated into the schema package per ADR-0014. Two services emitting near-identical status
> shapes from hand-written types is the drift GR-015 exists to prevent."

GR-015 §15-b.4 is explicit that location does not launder authorship — "The rule is about who authors a
wire shape, not about which directory it lives in" — so a bus shape hand-declared in
`packages/shared/*` and re-declared in a consumer is the same violation as a client declaring an HTTP
body. Note this is NOT true of `packages/shared/recipe-core`: `recipeRequestBounds.ts:1-23` is an owner
ruling, carries value constraints only, and explicitly forbids adding request envelopes — that file is
correct and should be left alone. `identity-core/handleSync.ts` is the outlier.

**Smallest fix**: author `handleSyncMessageSchema` **once** — as zod in `identity-core` beside
`buildHandleSyncMessage`, with `buildHandleSyncMessage` returning `z.infer` of it — and have
recipe-workers import it instead of re-declaring (`messages.schema.ts:130-141` becomes a re-export).
That single change also fixes F-D1 by construction: the producer cannot emit a value the consumer
refuses, because there is one bound. If a `@kitchensink/schema-*` home is preferred per ADR-0014, that
is a larger move and should be sequenced with 014's `@kitchensink/schema-notifications`.

**Verified (how)**: Read both declarations. The consumer's header already records the duplication as a
known gap (`messages.schema.ts:23-28`); what it does not record is that the two shapes disagree — see
F-D1's empirical run.

---

## F-D8

**Severity**: MEDIUM

**File**: `packages/services/identity/src/queue/deletion-enqueue.error.ts:22-27` ·
`packages/services/identity/src/users/users.service.ts:133,322-326`

**What breaks**: The recorded residual risk on a failed lifecycle enqueue understates its blast radius.
The module records:

> "⛔ RESIDUAL RISK, RECORDED HONESTLY: this makes the failure LOUD, not self-healing. … the cheapest
> correct form needs no new column — `users.status='tombstoned'` IS already a durable marker, so a
> sweep in `identity-webhooks` … can ask Clerk whether each tombstoned identity is actually banned …
> That is a follow-up feature with its own tests, deliberately not smuggled in here."

I am **not** re-raising the missing sweep — it is a governing decision, deliberately deferred, and
§4 says HALT. What is NOT recorded is the cross-service half. Identity itself denies a tombstoned
principal (`users.service.ts:133`), which makes the note read as though the exposure is bounded to the
minted-JWT nuisance. It is not: `recipe-service` and `food-service` verify the same Clerk token
independently and consult **no** identity account status — a search for `tombstoned`/`'erased'` across
both services' `src/` returns only recipe-row soft-delete and food-catalog tombstones, no account gate.
So while the ban is unqueued, the user's still-live Clerk session retains **full read/write access to
recipes and the ingredient catalog**, indefinitely, on an account the user believes is closed. The
window is not the 60-second token TTL; the Clerk session keeps refreshing because it was never banned.

**Smallest fix**: no code change — amend the residual-risk note in
`deletion-enqueue.error.ts:22-27` to state the true blast radius (identity denies; recipe and food do
not), so whoever sizes the deferred sweep prices it correctly. If a code change is wanted before that
sweep lands, the cheap one is for `deleteUserMe` to fan the closure out to the same
`/api/v1/internal/account/erasure`-style edge the erasure path already has — but that is a design
change, not a smallest fix, and belongs with the sweep.

**Verified (how)**: Read the error module, `users.service.ts`, and searched both downstream services'
`src/` for any account-status gate. None found.

---

## F-D9

**Severity**: LOW

**File**: `packages/shared/identity-core/src/displayName.ts:28-33` vs
`packages/services/identity-webhooks/src/handlers/identityWebhook.ts:41`

**What breaks**: The "ONE display-name rule" exists twice. `deriveDisplayName` trims each component
then joins the non-blank ones; `buildDisplayName` template-joins then trims the whole. They agree on
every case except interior whitespace: `first_name = 'John '`, `last_name = ' Smith'` yields
`'John Smith'` from the shared rule and `'John   Smith'` from the webhook's copy. That value is then
persisted and published, so the same user gets a different handle depending on which producer route
fired.

**Why it happens**: `displayName.ts:1-10` states the rule was extracted "so BOTH the identity service
(`resolveOrCreateFromClaims`) and the recipe service's write-time handle fallback compute it
identically". The webhook — the third producer, and the one that writes `profiles.display_name` on
every Clerk rename — was not repointed at it.

**Smallest fix**: delete `buildDisplayName` and call
`deriveDisplayName({ firstName: data.first_name ?? undefined, lastName: data.last_name ?? undefined })`.
One import, one call site (`identityWebhook.ts:104,171`).

**Verified (how)**: Read both functions and traced all three producer call sites.

---

## F-D10

**Severity**: LOW

**File**: `packages/services/identity-webhooks/src/handlers/tombstone-sweep.ts:45-50,118-120`

**What breaks**: Two docstrings on the GDPR erasure path describe a system that no longer exists:

- `:47-49` — "the deletion-worker's `erasure` branch is currently a no-op that logs. Wiring the real
  fan-out happens in U4b." It is not a no-op: `deletion-worker.ts:161-179` fans out to recipe and food
  and throws to force redelivery.
- `:120` — "a gap the **(unbuilt)** U4b erasure-reconciliation is designed to detect". It is built:
  `handlers/erasure-reconciliation.ts` exists, is scheduled, and emits `ErasureIncomplete`.

`CLAUDE.md` §4 makes a file's own header a HALT gate — an engineer reading these before touching the
erasure path would reason from a false model of what is and is not wired, on the most destructive
operation in the system.

**Smallest fix**: update both comments to point at `deletion-worker.ts`'s `erasure` branch and at
`erasure-reconciliation.ts`. Comment-only.

**Verified (how)**: Read `tombstone-sweep.ts`, `deletion-worker.ts` and `erasure-reconciliation.ts`.

---

## F-D11

**Severity**: LOW (defence-in-depth; not currently exploitable)

**File**: `packages/services/identity/src/auth/middleware/auth.middleware.ts:56-75` ·
`packages/services/identity/src/config/env.schema.ts:63-74`

**What breaks**: The dev-auth bypass — which authenticates any request as a fixed principal with **no**
Clerk verification and no DB read-through — gates on `NODE_ENV !== 'production'`
(`auth.middleware.ts:57`). Every other security-relevant "is this a real environment" decision in the
service gates on `isDeployedStage(STAGE)`, which `env.schema.ts:63-67` says exists precisely because
"three security-relevant decisions must agree on it — this schema's 'Clerk config is required'
refinement, `config/cors.ts`'s fail-closed branch, and `observability/auth-trace.ts`'s sink selection.
Each used to carry its own copy of the set." The bypass is a fourth such decision that does not use it,
and it keys on a different variable. It is not currently exploitable — `NODE_ENV: 'production'` is set
unconditionally on the ECS task (`identity-service-stack.ts:211`) — so this is one env-var edit away
from total auth bypass on a deployed stage, guarded by a variable that is not the repo's deployment
discriminator.

**Smallest fix**: `if (process.env['NODE_ENV'] === 'production' || isDeployedStage(process.env['STAGE'] ?? 'dev')) return undefined;`
— one line, and it makes the fourth decision agree with the other three.

**Verified (how)**: Read the middleware, `env.schema.ts`, and confirmed
`identity-service-stack.ts:211` sets `NODE_ENV: 'production'` for every stage.

---

## Answer: feature 014's notification envelope and ADR-0019's `supersedes = { key, sequence }`

**014 has NO implementation. Nothing in `packages/` implements a notification envelope, a status
message, a supersession key, or a sequence.** Proven by search, not assumed:

- `packages/services/` contains `food`, `food-service`, `identity`, `identity-webhooks`,
  `recipe-service`, `recipe-workers` — no notification service.
- `packages/schemas/` contains `food`, `identity`, `recipe` only. `@kitchensink/schema-notifications`
  does not exist, which `specs/governance-rules.md:821` already records.
- A repo-wide search for `statusEnvelope` / `StatusEnvelope` / `status-envelope` returns nothing, and
  `supersed` matches only documentation (ADR-0014/0017/0019, specs, `CODING_STANDARDS.md`) plus one
  unrelated migration README.

**So ADR-0019's optional `supersedes = { key, sequence }` can be added with zero risk of breaking an
existing producer — there are none.** Two things follow that the 014 authors should know:

1. **There is no envelope to extend, and no precedent worth copying.** The only live bus contract is
   `HandleSyncMessage`, which is a bare `{ userId, displayName, sourceTimestamp }` with no envelope, no
   key, no sequence — and which is declared twice and already drifted (F-D1/F-D7). If 014 models its
   envelope on it, it inherits the defect. ADR-0019 already requires the opposite: one contract,
   authored once, generated per ADR-0014.
2. **The forward-compatibility property ADR-0019 needs is already the house default for queue
   consumers, and it is the right one.** Both existing consumers use `z.object` (strip) rather than
   `strictObject`, for the stated reason that "a producer deployed ahead of a consumer must be able to
   add a field without poisoning the queue"
   (`recipe-workers/src/common/messages.schema.ts:17-21`; same in
   `identity-webhooks/src/common/deletion-queue.schema.ts:43-46`). An optional `supersedes` added later
   is therefore additive for a consumer already deployed. **The trap F-D1 proves is the opposite
   direction**: a producer emitting a value the consumer's _field-level_ bound refuses is dropped
   silently even though the object shape is forward-compatible. 014's `sequence` must therefore be
   bounded identically on both sides from day one (a monotonic integer bound is the obvious one), and
   the consumer's disposition for a schema failure must be DLQ, not drop.

---

## Things I examined and judged FINE — stated so the absence of a finding is a result, not a gap

- **Clerk token verification** (`packages/shared/clerk-verify/src/clerkVerify.ts`). Networkless, PEM
  pinned, fail-closed on a missing key, opaque single error type, `sub` required, and grants read ONLY
  from signed `public_metadata` (`:298-309`) — never from a top-level claim. The self-owned `azp`
  pattern boundary is anchored, dot-escaped and ReDoS-safe (`:122-141`), and the azp-less admission gate
  keys on a positive `client_type: 'native'` signal rather than on absence (`:155-157,222-240`).
- **azp fail-open is closed at config.** `hasExactlyOneAzpMode` is enforced in `env.schema.ts:108-114`
  for every deployed stage, and `CLERK_AZP_PATTERN` is rejected on prod (`:99-105`). CORS derives from
  the same resolver so the two boundaries cannot drift (`config/cors.ts:120-144`), and the absence of
  configuration DENIES rather than reflecting.
- **No forgeable auth input.** `AuthMiddleware` is bearer-only with no `x-authorizer-context` path
  (`auth.middleware.ts:106-110`), matching `CLAUDE.md`'s recorded decision; `extractBearerToken` is the
  linear-parse form; `bearer-only-precondition.test.ts` AST-parses `src/` to keep the no-cookie premise
  true. Public-path matching fails closed on anything it does not recognise.
- **Webhook ingress.** `verifyWebhook` returns `unknown` on purpose (`svix.ts:6-15`), the envelope parse
  is split from the union parse so "unhandled" and "invalid" stay distinct
  (`idp-payload.schema.ts:136-150`), and the rejection statuses (401 signature / 200 shape) are argued
  from "would a redelivery ever succeed" with the prior wrong reasoning recorded
  (`handler-pipeline.ts:136-164`). Only zod issue paths and codes are logged, never the body.
- **Deletion-queue validation.** `idpDeletionMessageSchema` closes the "most destructive operation is
  the `default` arm" hole correctly, and the throw-not-acknowledge disposition is argued from producer
  ownership (`deletion-queue.schema.ts:21-25`).
- **`UserDAO.syncNameAndPicture`.** The Clerk-mirror gating is right, the per-field independence is
  right, and both tables move in one transaction (`user.dao.ts:84-167`). The A→B→A and
  self-service-override failure modes are both handled and both documented with their history.
- **LIKE-pattern escaping.** `escapeLikeMetacharacters` is a correct single left-to-right pass
  (`like-pattern.ts:46-59`); the second copy in food is flagged rather than hidden and the rule-of-three
  reasoning is sound.
- **`@kitchensink/nest-error-envelope`.** The mechanism/contract split is correct and argued, it is
  server-only, nothing reaches a client bundle, and `error-envelope-parity.test.ts` checks the claim
  mechanically rather than asserting it in prose.
- **`packages/clients/usda`.** GR-015 §15-d reference implementation, and the new header block
  (`schemas.ts:16-35`) correctly forbids converging it. The `withoutTrailingSlashes` ReDoS fix is right.
- **`packages/shared/recipe-core/src/recipeRequestBounds.ts`.** Value Object per owner ruling, value
  constraints only, explicitly forbids adding request envelopes — GR-015-compliant.
- **`computeProfileScrub`.** A clean pure Specification, correctly consumed by both lifecycle paths for
  the DB half. (Its `removeAvatarObject` field is the one thing dropped — F-D2.)

---

## Not examined

- **`packages/services/food-service/**`and`packages/services/recipe-service/**` internals**, and
  `packages/clients/food-service` / `packages/clients/recipe-service` — covered by another reviewer. I
  read only what the cross-service edges required: both internal-erasure controllers' return shapes,
  both published erasure schemas, and both services' _absence_ of an account-status gate (F-D8).
- **`packages/services/recipe-workers/**`beyond`common/messages.schema.ts`and`handlers/handle-sync-worker.ts`\*\* — read only as the consumer half of the handle-sync edge.
- **`packages/apps/**`and`packages/shared/ui`\*\* — out of scope.
- **CDK infra beyond four targeted reads** (`data-stack.ts` MediaBucket, `identity-service-stack.ts`
  NODE_ENV + bucket grants, and the absence of a CloudFront distribution). I did not review
  `webhooks-stack.ts`, alarm thresholds, IAM policies generally, or the infra test suites.
- **Test suites**. I did not run any tier and did not audit test quality; every claim above is from
  reading source, plus one standalone `zod@4.4.3` probe for F-D1. In particular I did NOT verify
  whether existing tests would catch F-D1–F-D4 (my reading suggests they do not, since each failure is
  a producer/consumer or infra interaction rather than a single unit's behaviour, but I did not confirm
  it).
- **Runtime/deployed behaviour**. Nothing was checked against a live stage: not the avatar `publicUrl`
  403 (F-D5), not S3 delete-marker retention (F-D2 path 2, asserted from bucket configuration + standard
  S3 semantics), not the fan-out against a real recipe/food origin.
- **`packages/services/identity/contract/**`(the OpenAPI generator) and the contract-skew boot
assertion** — read only enough to confirm`main.ts`'s ordering constraints are intact.
- **`identity-webhooks/handlers/reconciliation.ts` (the provisioning sweep), `log-forwarder.ts`,
  `migrate.ts`, and `common/identityClient.ts`** — not read.
- **ADR-0012 (MCP agent credential bridge) and ADR-0016 (notification retention/dedup/Valkey)** were
  read but govern nothing in the code under review — 014 has no implementation (see above), and no MCP
  credential surface exists in these packages.
- **ADR-0018 (per-sender webhook dedup tables)** — read; identity's current dedup is the single
  `webhook_events` table keyed on `svix-id` (`identityWebhook.ts:252,291`), which is the pre-018 shape.
  I did not determine whether ADR-0018 binds identity retroactively or only prospectively on new
  senders, so I am recording the observation rather than a finding.
