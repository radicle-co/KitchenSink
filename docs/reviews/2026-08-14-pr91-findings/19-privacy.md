# 19 — Adversarial privacy / GDPR review: D1–D4 (on-device OCR, server OCR, placeholder shells, live nutrition)

**Posture**: adversarial. Default assumption is that a decision creates a compliance problem; where an
attack failed, the code that defeated it is cited. Every claim about behaviour was opened and read.

**Scope**: owner rulings D1–D4 (2026-08-14) assessed against the shipped code on
`chore/code-quality-enforcement-phase-1-2`, plus `specs/011-recipe-digitization/spec.md` (C-005, FR-036),
`specs/004-recipe-importing/spec.md` (FR-018, FR-046–FR-051, D-005, D-014),
`docs/plans/2026-07-18-002-feat-account-closure-anonymization-plan.md`,
`docs/runbooks/gdpr-erasure-of-copies.md`, and the shipped erasure/export paths in
`packages/services/{identity,identity-webhooks,recipe-service,recipe-workers,food-service}`.

**Calibration**: pre-launch, no production users. Severities below are stated for today, with the
obligation that attaches at first real user named explicitly. Nothing here is a live breach.

**Finding classes**: (i) **confirmed defect** — code does the wrong thing today; (ii) **owner decision** —
a legitimate choice with a compliance consequence that must be made deliberately; (iii) **fine** — recorded
in "Clean areas".

---

## P-1 — "Erase my account" never reaches identity or Clerk; it erases the recipe domain only

**Issue.** The user-facing irreversible-erasure control calls exactly one endpoint — the recipe service's
`POST /api/v1/account/erasure`. Nothing on that path touches the identity database, the Clerk identity, the
avatar object in S3, or the food service. After a user completes the confirmation-phrase gate and is signed
out, their email, name, Clerk account, profile row and avatar still exist, and they can sign back in.

**Legal basis / principle at stake.** Art. 17(1) (erasure across the controller's own systems); Art. 12(2)
(the controller shall facilitate the exercise of rights); Art. 5(1)(a) — the UI states an outcome the system
does not deliver.

**What the code actually does.**

- `packages/apps/commise/web/src/components/auth/AccountEraseForm.tsx:6` — module doc: _"`POST
/api/v1/account/erasure` permanently destroys the account and its personal data."_
- `packages/apps/commise/features/account/src/danger/messages.ts:28` — _"the IRREVERSIBLE action (GDPR
  erasure + Clerk delete; data destroyed)"_.
- `packages/clients/recipe-service/src/hooks.ts:956-964` — `useRequestAccountErasure` issues
  `client.requestAccountErasure(request)` and nothing else. Both call sites (web `AccountEraseForm`,
  mobile `AccountDangerZone`) use only this hook.
- `packages/services/recipe-workers/src/handlers/account-erasure-worker.ts:402-478` — the worker's entire
  transaction is recipe-database SQL (`:445` `DELETE FROM recipe_ratings`, `:460` `DELETE FROM recipes …`,
  `:463` `DELETE FROM collections …`, `:467-471` author-handle pseudonymisation, `:474` `DELETE FROM
author_handles`), plus S3/CDN at `:508-559`, `:653`. Grep for `identity|clerk|Clerk` in that file returns
  one unrelated comment (`:140`).
- Contrast the closure control, which _does_ call identity:
  `packages/apps/commise/web/src/components/auth/AccountCloseForm.tsx:28` imports
  `createProfileServiceClient`. The erase form imports no identity client at all.
- Identity exposes **no** erasure route. `packages/services/identity/src/users/users.controller.ts:30-34`
  is `DELETE /api/v1/users/me` → closure (`users.service.ts:262-333`, which sets
  `status: 'tombstoned'` and **keeps `users.name`** —
  `packages/shared/identity-core/src/profileScrubPolicy.ts:74-82`).
  `packages/services/identity/src/admin/admin.controller.ts:47-88` has suspend/unsuspend/reactivate and no
  erase.
- The real erasure primitive exists and is well built — it is just unreachable from the product. It runs
  only from the Clerk `user.deleted` webhook
  (`packages/services/identity-webhooks/src/handlers/deletion-worker.ts:181-191` →
  `:93-127` `eraseFromWebhook` → `common/erase-identity.ts:44-70`) or from the **12-month** tombstone sweep
  (`handlers/tombstone-sweep.ts:17` `TOMBSTONE_ERASURE_MONTHS = 12`, `:88-91`, `:101`, `:116`, `:123`).
  Both then fan out over signed HTTP (`common/erasure-fanout.ts:96-122`, `:33`
  `/api/v1/internal/account/erasure`) to recipe and food.

So the erasure architecture is _inverted_ relative to its own design: identity is meant to be the entrypoint
that fans out, and the app wired the leaf instead.

**Severity.** **High today** (no production users); **Critical at the first real user** — an honoured
erasure request would leave the data subject's directly-identifying data (email, name, avatar, live Clerk
login) in place while telling them it was destroyed.

**Smallest fix.** Do not build a second orchestration. Add one identity route —
`POST /api/v1/users/me/erasure` — whose body is the existing sweep sequence (Clerk `deleteUser`,
`eraseIdentityRow(db, { triggerSource: 'user', actor: userId })`, then `enqueueErasureLegs`), and have
`AccountEraseForm` / `AccountDangerZone` call _that_, passing the donate election through to the recipe leg.
The recipe endpoint stays as the internal fan-out target it already is. `R9` in the CR-002 plan
(`docs/plans/2026-07-18-002-feat-account-closure-anonymization-plan.md:132`) already specifies the
collision rule for two entrypoints.

**Owner decision needed?** No — this is a defect against the project's own stated design.

---

## P-2 — On-device OCR (D1) relocates the obligation rather than reducing it, and lands the mobile path with **no** retention rule at all

**Issue.** D1's claim is "no image leaves the device". True, and worth having. But the extracted **text** is
submitted and stored, and text from a handwritten family recipe card is personal data at least as often as
the image is — and considerably more searchable. A card reading _"Grandma Ruth's mincemeat — Dad can't have
this, too much sodium since the stroke"_ yields, after OCR, a free-text string naming a third party and
disclosing a health condition (Art. 9). The image was one opaque blob under one retention rule; the text
becomes a title, a description, step bodies and ingredient names spread across several tables under several
different rules.

The specific gap: `C-005`/`FR-036` are the only retention obligations 011 carries, and both are **keyed to a
column name**. When the mobile path produces no `raw_ocr_json`, the obligation evaporates by construction,
not by decision.

**Legal basis / principle at stake.** Art. 4(1) (the text is personal data); Art. 5(1)(c) minimisation;
Art. 5(1)(e) storage limitation; Art. 9(1) where the card carries health or religious content.

**What the code/spec actually does.**

- `specs/011-recipe-digitization/spec.md:42` (C-005) — _"Purge `raw_ocr_json` after 90 days; retain
  `parsed_json` for the lifetime of the job."_
- `:284` (FR-036) and `:312` (NFR-008 measurement) — the sweep is defined as
  `digitization_jobs WHERE created_at < now() - 90d AND raw_ocr_json IS NOT NULL`. It cannot fire on a
  record that has no such column.
- `parsed_json` — the field that actually holds the reconstructed recipe text — is retained **for the
  lifetime of the job**, i.e. indefinitely, with no purge (`:42`, `:284`). The 90-day rule protects the
  _less_ sensitive artifact and leaves the more useful one unbounded.
- The spec has **not** been updated for D1/D2 at all: `FR-006` still reads _"Invoke OCR provider (Textract
  default)"_ (`:206`), `FR-001` still requires _"pre-signed S3 PUT URL"_ (`:196`), `FR-002` still says
  _"Camera capture (iOS + Android)"_ (`:197`). Repo-wide grep across `specs/**` and
  `docs/architecture/decisions/**` for `on-device|Vision|ML Kit|Tesseract|raw text` returns **no** hit
  describing D1 or D2.
- No implementation exists to check against: `git grep raw_ocr_json -- packages/` returns nothing, and
  neither `tesseract` nor `textract` appears in any `package.json`.
- 004 has no raw-text channel to receive the submission. `FR-046` enumerates the import methods as _"URL,
  structured file, photo, and — when its capability flag is on — Instagram"_
  (`specs/004-recipe-importing/spec.md:203-204`). A raw-text channel is a new member of that list, a new
  `sourceType`, and a new entry in the chooser's unavailable-state logic.

**Severity.** **Medium today** (unbuilt), **High at implementation** — this is the moment the retention model
is written, and writing it against a column name that will not exist is how an indefinite retention of
family-health free text ships behind a green "FR-036 done" checkbox.

**Smallest fix.** Re-key the retention rule from a **column** to a **category**: _"any verbatim
machine-extracted source text — however produced, on-device or server-side — is purged N days after the
import job reaches a terminal state; the normalised recipe fields are retained for the recipe's lifetime."_
Then state, once, which of `title`/`description`/`steps`/`notes` are normalised fields (retained) and which
are verbatim capture (purged). Update `FR-036`/`NFR-008`'s measurement query to select on that category.

**Owner decision needed?** **Yes** — two things: (a) does `parsed_json`-equivalent free text get a retention
bound at all, or is "lifetime of the recipe" the accepted answer; (b) which fields are classified as verbatim
capture.

---

## P-3 — D1 + D2 create two different processing operations, two retention regimes and two disclosure obligations for one user action

**Issue.** Under D1 the mobile user's phone does the OCR and submits text into 004's draft model. Under D2
the web user uploads an image which is stored and processed server-side under 011's job model. Same feature,
same button, same user intent — but the platforms diverge on: whether an image is stored at all, what the
retention clock is, what has to be deleted on erasure, and what the Art. 13 notice must say.

**Legal basis / principle at stake.** Art. 5(1)(e) storage limitation; Art. 12/13 transparency (the notice
must describe the actual processing, which now differs per platform); Art. 17 (two deletion surfaces, only
one of which has an object store); Art. 25(1) (privacy by design — the asymmetry is incidental, not chosen).

**What the code/spec actually does.**

- 004's regime: `specs/004-recipe-importing/spec.md:318-321` (FR-018) — drafts expire **7 days**; the OCR
  source image _"MUST"_ be deleted on confirm, discard or expiry, whichever is first, and _"there is no state
  in which an image outlives the draft that references it"_. `:720-724` (D-005) fixes this at ≤7 days in
  production.
- 011's regime: `specs/011-recipe-digitization/spec.md:42`, `:284` — raw OCR 90 days, parsed output for the
  lifetime of the job. `:227` (FR-018) additionally requires the original photo to be _"retained in S3 after
  save / discard for archive"_ — which **directly contradicts** 004's FR-018 for the same artifact.
- So the web (D2) path inherits a spec pair that says both "delete the image within 7 days" and "retain the
  image for archive". Nothing in code resolves it; neither module is built.
- The mobile (D1) path inherits neither, because the artifacts both rules name do not exist on it.

An extra hazard specific to D2 that neither spec addresses: a **photograph** of a recipe card frequently
captures more than the card — a hand, a face reflected in a surface, a medication bottle on the counter, the
next card in the pile. That is exactly the incidental-Art.-9 case the 90-day rule was written for, and it now
applies to only one of two platforms.

**Severity.** **Medium today**; **High at implementation**, because the divergence is cheap to remove now and
expensive later (two pipelines, two sweeps, two erasure legs, two notice paragraphs).

**Smallest fix — and it collapses P-2 as well.** Tesseract.js is a **WASM** library; its primary deployment
target is the browser. Running it client-side on web makes the two platforms symmetric: no image leaves the
device on _either_ platform, there is no server-side image to store, retain, sweep or erase, `FR-018`'s
image-lifetime rule becomes vacuous, and both platforms submit through the single raw-text channel. The
Lambda in D2 exists only to serve users whose device cannot run it — make that the documented fallback rather
than the default, and the asymmetry shrinks to a bounded exception. If the Lambda stays the default, then
011's `FR-018` (retain for archive) and 004's `FR-018` (delete within 7 days) must be reconciled explicitly,
and 011's `FR-001`/`FR-002`/`FR-006` rewritten for D1/D2 before any of it is built.

**Owner decision needed?** **Yes** — browser-WASM OCR vs. Lambda OCR for web, and the contradiction between
the two `FR-018`s.

---

## P-4 — A user's raw typed ingredient string becomes a permanent, ownerless, globally-searchable row that no erasure path can remove

This is the sharpest finding. The prompt located it in the food service; the exposure is actually in the
**recipe** service, and the food service is clean on that axis. Both are immortal.

**Issue.** `addByName` takes the caller's raw string and writes it, verbatim, into two shared ownerless
catalogs. The food-service copy is hidden from other users until it resolves. The **recipe-service copy is
not hidden at any point** and is returned to every other authenticated user's ingredient autocomplete
immediately. Neither copy has an owner column, neither is reconciled to the USDA name once resolution
completes, and **no runtime code path anywhere deletes a row from either catalog**.

**Legal basis / principle at stake.** Art. 17(1) (right to erasure — the data is not erasable by any
mechanism that exists); Art. 5(1)(c) (a permanent global record is not necessary to resolve one user's
ingredient); Art. 5(1)(e) (no retention limit, by construction); Art. 25(1)/(2) (personal free text is
published to an indefinite number of users with no intervention by the individual); Recital 26
(identifiability by any means reasonably likely — free text like _"Aunt Ruth's mincemeat spice"_ or
_"Dad's low-sodium seasoning"_ identifies a natural person on its face, without needing a join).

**(a) Can a user's free text become permanently visible to all other users? Yes — via the recipe service.**

- `packages/services/recipe-service/src/ingredients/ingredients.service.ts:368-381` — `addByName` trims the
  caller's string, forwards it to food-service, then writes it locally:
  `this.dal.createFoodBacked({ name: trimmed, foodId: added.id, foodResolutionStatus: … })`.
- `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:329-335` — the insert:
  `INSERT INTO ingredients (name, food_id, food_resolution_status, is_user_entered, search_vector) VALUES
(${input.name}, …, to_tsvector('english', ${input.name}))`. The raw string is also indexed for FTS.
- `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:149-167` — the search every other
  user hits: `FROM ingredients WHERE search_vector @@ plainto_tsquery(…) OR ${query} <% name OR name ILIKE
${pattern}`. **No owner filter, no `is_user_entered` filter, no `food_resolution_status` filter.**
- Reached at `packages/services/recipe-service/src/ingredients/ingredients.controller.ts:115-117`
  (`GET /api/v1/ingredients/search`) and `:158-160` (`GET /api/v1/ingredients/suggest`).
- The table has no owner column — `packages/services/recipe-service/src/database/schema/ingredients.ts:48-88`
  — and the service comment states the design plainly: _"ownerless and shared by every user"_
  (`ingredients.service.ts:260-261`).

**Attack that failed — the food service does gate its shells.**
`packages/services/food-service/src/foods/dao/food-search.dao.ts:221` and `:255` both hard-filter
`WHERE status = 'RESOLVED' AND name IS NOT NULL`; `foods.service.ts:97-103` and `:127-131` refuse to return a
name for `PENDING`/`UNRESOLVED`; the batch path returns `name` only when `RESOLVED` (`:270-280`). So a food
shell's raw string is not readable by other users. Credit where due — and it makes the recipe-side omission
look like an oversight rather than a decision.

**(b) What happens to the row on account erasure? Nothing, deliberately, and it is tested.**

- `packages/services/recipe-workers/src/handlers/account-erasure-worker.ts:378` — _"`ingredients` (shared,
  owner-less) is deliberately untouched."_
- `packages/services/recipe-workers/__tests__/integration/erasure/account-erasure.integration.test.ts:183`
  seeds `INSERT INTO ingredients (id, name, is_user_entered) VALUES (…, 'Shared Salt', true)` and `:286`
  asserts `expect(await count('ingredients', 'id', SHARED_INGREDIENT_ID)).toBe(1)` after erasure. The
  survival of a user-entered row through erasure is a **pinned, asserted invariant**.
- Food side: `packages/services/food-service/src/foods/user-erasure.service.ts:51-55` → the entire erasure is
  `packages/services/food-service/src/foods/dao/fetch-requesters.dao.ts:82-86`,
  `db.delete(fetchRequesters).where(eq(fetchRequesters.requesterId, requesterId))`. One table. The DAO
  comment at `:72-76` states _"foods stay shared reference data"_.

**(c) Is there a path by which it constitutes personal data surviving an erasure request? Yes, two.**

1. **Content-as-identifier.** The string itself is user-authored free text. Nothing constrains it beyond
   `z.string().max(200).trim().min(1)`
   (`packages/services/food-service/src/foods/foods.schema.ts:254`, `:34`) — no PII screening, no length
   floor, no moderation. A user typing a person's name, an address fragment, or a health note into the
   ingredient field creates a permanent public row containing it.
2. **Never reconciled to the golden record.** `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:363-382`
   (`updateResolution`) updates status, the four macros and portions — it does **not** touch `name` or
   `search_vector`. So even after USDA resolves the food to a proper name, the recipe catalog keeps the
   user's original typed text forever. On the food side, `food.name` _is_ rewritten by the merge
   (`packages/services/food-service/src/foods/dao/food.dao.ts:343-373`), but `normalized_name` is
   deliberately never rewritten (`worker/food-consumer.service.ts:272-273` — the fan-out key must stay
   stable), so the normalised user string persists there too.

The one _bounded_ linkage is `fetch_requesters`, and it is genuinely well-minimised — see Clean areas.
The consequence of that minimisation, though, is that once the food drains there is **no** forensic path from
a PII-bearing row back to its author: nobody can find it, and nobody can remove it.

**(d) Does the immortality make this an Art. 17 failure? Yes.**

Repo-wide, the only `DELETE` against `food` is a one-shot migration —
`packages/services/food-service/src/db/migrations/0002_fetch_requesters_rekey.sql:66`,
`DELETE FROM "food" WHERE "status" = 'PENDING';` — gated by `schema_migrations` and not callable at runtime.
Terminal lifecycle is a tombstone, not a delete: `packages/services/food-service/src/foods/dao/food.dao.ts:303-333`
sets `NOT_FOUND`/`FAILED` + `tombstoned_at`, and `:254-266` **reactivates** the same row on a later same-name
add. There is no `DELETE FROM ingredients` in recipe-service application code either (only test teardown).
So for this class of data the system has no erasure capability of any kind — not "an erasure that misses it",
but no mechanism that could be invoked.

D3 makes this materially worse in one specific way: it moves shell creation from an explicit user action
("add this ingredient") to an **automatic side effect of importing a recipe**. Under D1 that import is OCR
text off a handwritten card. So the chain is: handwritten family card → on-device OCR → ingredient string →
`addByName` → permanent global row → every user's autocomplete → survives erasure. Each link is shipped or
decided; nothing in between filters.

**Severity.** **High today** (the write path, the leak and the erasure exemption are all shipped and tested);
**Critical at the first real user**, because it is an Art. 17 request the system is structurally unable to
honour.

**Smallest fix.** Three changes, in priority order:

1. **Stop the leak.** Filter `IngredientsDal.search`/`suggest` to exclude rows the caller did not create —
   simplest form: return `is_user_entered = false` rows to everyone, and `is_user_entered = true` rows only
   to their creator. This requires (2).
2. **Give the row a provenance column.** `ingredients.created_by` (and, on the food side, retain the
   originating requester on the `food` row rather than only in the drained `fetch_requesters`). Without it,
   an erasure job cannot find these rows even if it wanted to — which is the actual reason the current worker
   "deliberately" skips them.
3. **Reconcile the display name on resolution.** Have `updateResolution` overwrite `name` +
   `search_vector` from the golden record when status becomes `RESOLVED`. The pick-by-id path already refuses
   caller-supplied names for exactly this reason (`ingredients.service.ts:258-262`, `:289`, `:309-315`) —
   `addByName` bypasses that existing protection. This alone converts most rows from user text to USDA text
   within the resolution window.

Then erasure can do the right thing for what remains: delete `is_user_entered`/unresolved rows created by the
erased user that no _other_ user's recipe references, and leave genuinely shared reference data alone.

**Owner decision needed?** **Yes** — on the retention policy for a user-created row that another user's
recipe has since come to depend on. (Recommendation: reconcile-then-keep for resolved rows, delete for
never-resolved ones; the latter carry the most user text and the least shared value.)

---

## P-5 — The freeform dedup index makes the first user to type a string the permanent global owner of it

**Issue.** Distinct from P-4 and with a different fix. `ingredients` carries a case-insensitive **unique**
index over user-entered names, so there is exactly one global row per freeform string. The first user to type
_"nonna's soffritto"_ creates the singleton; every later user's recipe line binds to that same row.

**Legal basis / principle at stake.** Art. 5(1)(c) minimisation; Art. 17 — the row cannot be deleted on that
user's request without breaking other users' recipes, which is precisely the entanglement the design creates.

**What the code actually does.**

- `packages/services/recipe-service/src/database/schema/ingredients.ts:82-84` —
  `uniqueIndex('idx_ingredients_freeform_name').on(sql`lower(${table.name})`).where(sql`${table.isUserEntered} = true`)`.
- `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:258-266` `findFreeformByName`,
  `:279-294` `createFreeform` — dedup-return on the shared singleton.
- Per-recipe copies do exist and _are_ erased with the recipe:
  `packages/services/recipe-service/src/database/schema/ingredients.ts:113` `ingredientName`, `:109`
  `displayText`, cascade-deleted per `account-erasure-worker.ts:375-378`. The catalog singleton is what
  survives.

**Severity.** **Medium** — a narrower surface than P-4, but it is the reason P-4's fix cannot simply be
"delete the user's rows".

**Smallest fix.** Scope freeform rows per owner: make the unique index `(lower(name), created_by)` and treat
freeform ingredients as private-by-default catalog entries. Deduplicating _user free text globally_ buys very
little (these rows carry no nutrition — `caloriesPer100g` etc. are NULL for freeform) and costs the ability
to erase.

**Owner decision needed?** Yes, jointly with P-4 item (2).

---

## P-6 — D4's live nutrition reference silently rewrites a data subject's historical health record

**Issue.** A live reference is correct for a _recipe_ — a recipe is a template, and its nutrition should
reflect the best current data. It is wrong for a _logged meal_, which is a factual record of what a person
consumed on a date. D4 as stated does not distinguish them, and feature 009 consumes recipe nutrition as
Art. 9 health data.

**Legal basis / principle at stake.** Art. 5(1)(d) accuracy — a record that mutates retroactively is not
"accurate having regard to the purposes"; Art. 16 rectification — a data subject cannot rectify a value they
do not control and that will be overwritten anyway; Art. 15 — an export that returns today's numbers does not
describe what was processed then; Art. 9 amplifies all three because the downstream artifact is health data a
trainer may act on.

**What the code/spec actually does.**

- Today nutrition is a **copy**, not a live reference:
  `packages/services/recipe-service/src/database/schema/ingredients.ts:58-62` stores per-100g macros on the
  catalog row, populated on resolution; `packages/services/recipe-service/src/ingredients/ingredients.service.ts:395-412`
  (`refreshStatus`) → `dal/ingredients.dal.ts:363-382` (`updateResolution`) writes the golden-record values
  in. `packages/services/recipe-service/src/database/schema/recipes.ts:124` carries a denormalised
  `lead_calories_per_serving` _"recomputed on every write"_ (`:119`). So values already mutate — but only on
  an explicit poll or write, never behind the user's back.
- 006/009's design of record is the **opposite** of D4: a point-in-time
  `meal_plan_entries.nutrition_snapshot` JSONB (`specs/009-nutrition-planning/research.md:291`, `:309-312`,
  `:318`), precisely so compliance maths is stable.
- 009's own research already names the hazard: `research.md:370-372` — _"if a recipe's USDA data is updated
  … the `nutrition_snapshot` on `meal_plan_entries` becomes stale, which means 009's compliance calculations
  will be wrong"_ — and mitigates with a refresh pipeline **plus a "last calculated" timestamp**. D4 removes
  the snapshot and keeps only the mutation.
- The Art. 9 classification is settled, not arguable:
  `specs/009-nutrition-planning/research.md:143` and `specs/009-nutrition-planning/spec.md:118-119`, `:171-172`;
  `docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md:138`, `:207`.

**Severity.** **Medium today** (009 unbuilt); **High once 009 ships**, and higher again if the trainer-sharing
path lands, because a third party then reads a health record that changes under them.

**Smallest fix.** Scope D4 explicitly: _"a **recipe's** nutrition is a live reference to the catalog. Any
**logged or planned consumption** captures a point-in-time snapshot at the moment it is recorded, with a
`computed_at` timestamp, and is never retroactively rewritten."_ That preserves D4's actual benefit (recipes
improve as USDA data improves) and keeps 006/009's shipped design intact. Surface `computed_at` in the UI and
in the Art. 15 export.

**Owner decision needed?** **Yes** — confirm D4 is scoped to recipe display and does not delete the
`nutrition_snapshot` design.

---

## P-7 — Dropping Textract changes the processor set, and there is nowhere in the repo that records one

**Issue.** The question "does anything need updating?" has a worse answer than "yes": **there is no privacy
policy, no Art. 30 record of processing activities, and no processor/sub-processor list anywhere in the
repository.** Nothing needs updating because nothing exists. That is the finding.

**Legal basis / principle at stake.** Art. 30 (records of processing — the small-organisation exemption in
Art. 30(5) does not apply here, because the processing is not occasional and includes Art. 9 data);
Art. 13(1)(e) (categories of recipients must be disclosed); Art. 28 (a written processor arrangement per
processor); Art. 5(2) accountability.

**What the repo actually contains.**

- `find . -iname "*privacy*"` outside `node_modules` → **nothing**. `find` for `*dpa*` / `*processor*` →
  **nothing**.
- The only DPA references are residual notes in a plan and a research doc:
  `docs/plans/2026-06-15-001-feat-auth-tracing-user-create-fixes-plan.md:281`, `:294` (_"Confirm the
  `radicle-co` Sentry DPA covers processing this identifier"_ — still open) and
  `specs/009-nutrition-planning/research.md:184-187` (trainer DPAs, prospective).
- The actual processor set, derivable from code rather than from any document: **Clerk** (auth/identity —
  `packages/services/identity/src/auth/*`), **AWS** (RDS/S3/SQS/Lambda/CloudWatch), **Sentry** (org
  `radicle-co` — `packages/apps/commise/mobile/app.json:41-43` plus the service scrubbers), **Vercel**
  (hosting + Web Analytics — `docs/runbooks/gdpr-erasure-of-copies.md:38-74`). USDA is outbound-only and
  receives no personal data.
- Textract → Tesseract.js on Lambda is therefore **not** removing a vendor; AWS is already a processor for
  everything. It removes one named AWS _service_ from the set that sees user images. Real, but smaller than
  D2's framing suggests — and it is entirely offset if D3/D1's images stay on-device (P-3).

**Severity.** **Medium today**; the Art. 30 and Art. 13 obligations attach at the **first real user**, not at
launch of any particular feature. The Sentry DPA question has been open since 2026-06-15.

**Smallest fix.** One `docs/privacy/processing-register.md` with three tables — processing activities
(purpose, categories, lawful basis, retention), processors (vendor, what they see, DPA status, region), and
international transfers — generated from what the code already proves. It is a day's work now and a scramble
later. Separately: close the Sentry DPA item.

**Implementation note for D2, worth catching before it ships.** `tesseract.js` fetches its language
`traineddata` from a remote CDN by default. In a Lambda that processes user-uploaded recipe images, that is a
new outbound edge to a third party on a personal-data path. Bundle the `.traineddata` in the deployment
artifact and pin `langPath`/`corePath` to local files. Neither `tesseract` nor `textract` is currently a
dependency in any `package.json`, so this is a greenfield choice.

**Owner decision needed?** **Yes** — who authors the Art. 30 register and the user-facing notice, and when.

---

## P-8 — Privacy is sold, not defaulted: photo/OCR import is premium-only and free-tier recipes cannot be made private

**Issue.** A free-tier user cannot make their own recipe private, and cannot use the photo/OCR channel at
all. The most privacy-sensitive import in the product — a photograph of a handwritten family card — is
therefore available only to paying users, and a free user who types the same recipe in by hand gets a
**public** recipe by policy.

**Legal basis / principle at stake.** Art. 25(2) — _"by default, personal data are not made accessible
without the individual's intervention to an indefinite number of natural persons."_ A tier gate on the
private setting is exactly the arrangement that phrasing addresses. Art. 5(1)(f) integrity/confidentiality.

**What the code actually does.**

- `packages/services/recipe-service/src/recipes/domain/visibility-policy.ts:74-75` — requested `private` on
  `user_created`: _"Free-tier user-created recipes are public-only; upgrade to premium to make them
  private."_ `:13` states the same rule in the module contract.
- `specs/004-recipe-importing/spec.md:670-677` (D-014) — _"Creating a recipe that is not public requires a
  subscription … photo/OCR import and attested paid-source entry become premium-only."_
- The `imported_physical` class is protected regardless of tier —
  `visibility-policy.ts:64`, `:88` make it private-only — so a _successfully classified_ OCR import is safe.
  The exposure is the classification, not the policy.

**Why D1/D2 sharpen this.**

1. D-014's own justification is now obsolete. It reads: _"it confines Textract spend to paying users, which
   retires the cost concern D-001 opened"_ (`specs/004-recipe-importing/spec.md:673-675`). On-device OCR has
   **zero** marginal cost and self-hosted Tesseract has near-zero. The stated reason for gating the
   privacy-sensitive channel has been removed by D1/D2, and the gate has not been revisited.
2. D1 introduces a classification hazard with a direct privacy outcome. `sourceType` is _"declared by the
   invoking surface and whitelisted server-side … never inferred from the payload"_
   (`specs/004-recipe-importing/spec.md:211-216`, FR-047). A mobile raw-text submission is, on the wire,
   indistinguishable from typed text. If the new channel declares anything other than `imported_physical`,
   a free-tier user's OCR'd handwritten family recipe lands as `user_created` and is **public-only** by the
   policy above.

**Severity.** **High as a design risk** — item (2) is a one-line decision that determines whether family
recipe cards become publicly readable.

**Smallest fix.** (a) Fix the classification first: the raw-text channel MUST declare
`sourceType = 'imported_physical'`, and that must be asserted by a test, not by a comment. (b) Revisit D-014
now that its cost rationale is gone — at minimum, decouple _the private setting_ from the tier even if the
_channel_ stays gated.

**Owner decision needed?** **Yes**, on both halves.

---

## P-9 — The `recipes` table defaults to `visibility = 'public'`, `status = 'published'`

**Issue.** Defence-in-depth inversion. The policy module is correct, but the storage default means any writer
that omits the column publishes the row. A new import channel — of which D1 adds one — is exactly the kind of
new writer that can omit it.

**Legal basis / principle at stake.** Art. 25(2) data protection by default.

**What the code actually does.**
`packages/services/recipe-service/src/database/schema/recipes.ts:95` —
`visibility: text('visibility').notNull().default('public')`; `:99` —
`status: text('status').notNull().default('published')`.

**Severity.** **Low–Medium** today (every current writer goes through `evaluateVisibility`); the severity is
entirely about the next writer.

**Smallest fix.** Flip the storage defaults to `'private'` / `'draft'` in a migration and let the policy
module be the only thing that promotes. A writer that forgets then fails closed. (This is a data-model change
— hand it to `db-arch-1` / `staff-architect` for the migration ordering.)

**Owner decision needed?** No, but it is a schema change and needs the usual review.

---

## P-10 — The Art. 15/20 export covers the recipe domain only

**Issue.** A subject-access or portability request answered with the shipped export returns recipes,
collections, ratings, photos, versions and author handles — and omits the data subject's identity profile
(email, name, avatar, lifecycle history) and their food-service footprint.

**Legal basis / principle at stake.** Art. 15(1) (access to _all_ personal data undergoing processing);
Art. 20(1) (portability).

**What the code actually does.**

- `packages/services/recipe-service/src/account/account.controller.ts:64-68` — `GET /api/v1/account/export`,
  owner from the verified token only (`:53-55`).
- `packages/services/recipe-service/src/account/dto/export.dto.ts:12-20` — the export document's members:
  `AuthorHandleExport`, `CollectionExport`, `CollectionMembershipExport`, `PhotoExport`, `RatingExport`,
  `RecipeExport`, `VersionExport`. No ingredient, no identity, no food member.
- Identity and food expose no export route (grep for `export|portability` over
  `packages/services/identity/src` and `packages/services/food-service/src` finds no controller).
- `docs/runbooks/gdpr-erasure-of-copies.md:146` still asserts _"Data-subject access/export (Art. 15/20) — a
  separate feature (no export endpoint exists)"_ — stale in the _optimistic_ direction, which is the more
  dangerous one for a DPO reading it.

**Severity.** **Medium**; the obligation attaches at the first real request (one month to respond, Art. 12(3)).

**Smallest fix.** Add the identity leg — the export is a read-only mirror of the erasure fan-out, so it can
reuse the same signed-service-call topology (`common/erasure-fanout.ts:96-122`) in the read direction, with
identity as the aggregator. Food's contribution is one table.

---

## P-11 — Avatar objects survive a webhook-triggered erasure

**Issue.** The scrub policy declares that both lifecycle events delete the avatar S3 object. Closure does it.
The erasure paths do not, because they run in a Lambda package that has no S3 client at all.

**Legal basis / principle at stake.** Art. 17(1) — an avatar is personal data, frequently a photograph of the
data subject.

**What the code actually does.**

- `packages/shared/identity-core/src/profileScrubPolicy.ts:52-53` — `removeAvatarObject: true` with the
  comment _"Both events delete the avatar S3 object; the caller performs it where it holds S3 capability"_;
  set for closure (`:79`) and erasure (`:89`).
- Closure honours it: `packages/services/identity/src/users/users.service.ts:304-313` →
  `packages/services/identity/src/users/avatar-object-store.ts:36-58` (paginated `ListObjectsV2` +
  `DeleteObjects` over `avatars/{userId}/`).
- Erasure does not: `packages/services/identity-webhooks/src/common/erase-identity.ts:44-70` is DB-only, and
  grep for S3 across `packages/services/identity-webhooks/src` finds no client, no bucket, no delete.
- The 12-month sweep path is covered **incidentally** — it only selects `status = 'tombstoned'`
  (`handlers/tombstone-sweep.ts:88-91`), and closure already swept the objects. The uncovered case is a
  `user.deleted` webhook erasure of an account that was **never closed** (admin deletion in the Clerk
  dashboard, or the corrected P-1 flow once it exists).

**Severity.** **Medium** today; it becomes the default path the moment P-1 is fixed, so fix them together.

**Smallest fix.** Move the avatar-object deletion behind the same signed-service call the fan-out already
uses (identity exposing an internal erasure leg), or give the deletion-worker the S3 capability and call
`deleteAvatarPrefix` alongside `eraseIdentityRow`. The policy object already says which one is right.

---

## P-12 — Privacy-critical documentation asserts the opposite of the shipped code, in both directions

**Issue.** Four load-bearing comments/documents are stale. A DPO, an auditor, or the next engineer reading
them would describe the system incorrectly to a regulator — in two cases understating what is built, in one
case overstating it.

**Legal basis / principle at stake.** Art. 5(2) accountability — the controller must be able to _demonstrate_
compliance, and the demonstration artifacts are wrong.

**What the code actually says.**

- `packages/services/food-service/src/foods/user-erasure.service.ts:10-18` — _"`eraseUser` remains dead code
  until then … Wiring (deferred to infra)."_ It is wired:
  `packages/services/food-service/src/foods/service-erasure.controller.ts:32-57`.
- `packages/services/identity-webhooks/src/handlers/tombstone-sweep.ts:46-49` — _"the deletion-worker's
  `erasure` branch is currently a no-op that logs. Wiring the real fan-out happens in U4b."_ It is fully
  wired (`handlers/deletion-worker.ts:161-179` → `common/erasure-fanout.ts:96-122`).
- `packages/services/identity-webhooks/src/handlers/tombstone-sweep.ts:119-120` — _"a gap the (unbuilt) U4b
  erasure-reconciliation is designed to detect."_ Built:
  `packages/services/identity-webhooks/src/handlers/erasure-reconciliation.ts:43`, `:111-116`.
- `docs/runbooks/gdpr-erasure-of-copies.md:146` — _"no export endpoint exists"_. One does (P-10). And `:10-11`
  — _"The cross-service erasure itself (identity + recipe + food) is CR-002 (unbuilt)"_ — it is built.

**Severity.** **Low–Medium**. Cheap to fix, and it is the artifact a regulator reads first.

**Smallest fix.** Correct the four comments and the runbook header in this PR; they are one-line edits.

---

## P-13 — The mobile app declares no camera/photo-library purpose strings and no iOS privacy manifest, which D1 requires

**Issue.** D1 puts the camera and the photo library on the mobile critical path. The Expo config declares
neither permission nor a privacy manifest.

**Legal basis / principle at stake.** Art. 13 (information at the point of collection — the OS prompt string
is, in practice, the first notice the user reads); Apple App Store privacy-manifest and purpose-string
requirements; Google Play Data Safety.

**What the config actually contains.** `packages/apps/commise/mobile/app.json:15-33` — the `ios.infoPlist`
block carries only `CFBundleURLTypes`; there is no `NSCameraUsageDescription`, no
`NSPhotoLibraryUsageDescription`, and no `PrivacyInfo.xcprivacy`. `plugins` (`:38-54`) are Sentry,
`expo-image` and `@clerk/expo` — no camera or ML plugin.

**Severity.** **Low today** (D1 is unbuilt); it is a hard blocker at store submission.

**Smallest fix.** Add the purpose strings and a privacy manifest alongside the camera/OCR plugin, and route
the strings through the localization path per the standing rule. Also confirm the temporary image file the
camera writes into the app sandbox is deleted after OCR — D1's "no image leaves the device" guarantee says
nothing about how long it stays _on_ it.

---

## Clean areas

Verified and found sound. These are not "not looked at" — each was attacked and the attack failed.

- **Food-service shell exposure.** Search hard-filters `status = 'RESOLVED' AND name IS NOT NULL` on both
  query paths (`packages/services/food-service/src/foods/dao/food-search.dao.ts:221`, `:255`); single-food and
  status reads refuse to return a name for `PENDING`/`UNRESOLVED`
  (`foods.service.ts:97-103`, `:127-131`); the batch path gates on `RESOLVED` (`:270-280`). A food shell's raw
  user string is not readable by other users. (The recipe-side copy is the leak — P-4.)
- **`fetch_requesters` minimisation.** The user→food demand link is deleted as soon as the food drains
  (`packages/services/food-service/src/foods/dao/fetch-requesters.dao.ts:65-69`) and wholesale on erasure
  (`:82-86`); the controller comment (`foods.controller.ts:162-166`) treats creating one as carrying a privacy
  cost. This is genuine data minimisation, and the only per-user data the food service holds.
- **Erasure request authorisation.** The owner is taken from the verified token and never from the request
  body or a query parameter, on both the user path
  (`packages/services/recipe-service/src/account/account.controller.ts:53-55`, `:70-88`) and the internal
  service path (`account/service-erasure.controller.ts:53`). The strict schema refuses a smuggled `ownerId`.
  No DSAR-redirection surface.
- **Erasure completion durability.** Once triggered, the erasure is hard to lose: outbox + SQS + DLQ
  (`packages/services/recipe-workers/infra/lib/recipe-workers-stack.ts:280-299`), a 5-minute stuck-job
  sweeper (`src/handlers/erasure-sweeper.ts:69`, `:84`, `:102`, `:238-244`), an hourly S3 orphan sweeper
  (`src/handlers/erasure-orphan-sweeper.ts:88`, `:143-150`, `:218`), a nightly cross-service reconciliation
  with an `ErasureIncomplete` metric (`identity-webhooks/src/handlers/erasure-reconciliation.ts:43`,
  `:65-70`, `:111-116`, `:134-158`), and a job-age alarm
  (`recipe-workers-stack.ts:140`, `:754-759`). This is a real Art. 17 completion contract, better than most.
- **Vercel Web Analytics.** The default-deny `beforeSend` redaction
  (`packages/apps/commise/web/src/lib/analyticsRedaction.ts`, reasoned in
  `docs/runbooks/gdpr-erasure-of-copies.md:38-74`) drops the entire query string rather than allow/deny-listing
  it, which is what keeps `/discover`'s free-text query and its `dietaryFlags` — plausibly Art. 9 — off the
  wire. The conclusion that analytics sits outside the Art. 17 surface is correctly reasoned and correctly
  fenced with its own invalidating conditions.
- **Log/Sentry pseudonymisation.** Person-linked ids are hashed at the log boundary
  (`gdpr-erasure-of-copies.md:31-36`), with the free-text ULID residual explicitly recorded rather than
  claimed away.
- **`imported_physical` is private-only.** `packages/services/recipe-service/src/recipes/domain/visibility-policy.ts:64`,
  `:88` — a recipe card, cookbook page or handwritten note cannot be made public by any caller. Correct, and
  the right default for D1/D2's inputs (the risk is misclassification, not the policy — P-8).
- **Anti-resurrection.** A tombstoned/erased user is refused at auth
  (`packages/services/identity/src/users/users.service.ts:133-135`,
  `src/users/resolveUser.ts:41-42`) and the erasure state is a distinct `user_status` enum member
  (`packages/shared/identity-db/src/schema/users.ts:15`), so the sign-in/reconciliation resurrection the
  CR-002 audit found is closed.
- **Art. 30 audit trail.** `lifecycle_events` is append-only with `trigger_source`/`actor`
  (`packages/shared/identity-db/src/schema/lifecycleEvents.ts:12-26`,
  `packages/services/identity/src/database/migrations/0011_lifecycle_events_audit.sql:7`), which is the
  correct Art. 17(3)/Art. 30 posture — retaining a pseudonymous ULID to prove the erasure happened. It will
  eventually need its own stated retention limit, but it is right today.
- **Restore → re-erase procedure.** `docs/runbooks/gdpr-erasure-of-copies.md:93-122` is specific, actionable,
  and correctly identifies the manual-snapshot hazard (`§4`) as the only unbounded residual. Better than the
  norm.

---

## Not examined

- **Out-of-repo data stores and settings**: Clerk's own retention and DPA terms; Sentry org/project retention
  (`radicle-co`); Vercel account settings; the actual AWS snapshot inventory. All three are named as
  out-of-repo residuals by the runbook and all three remain open.
- **Actual localized copy** for the erase/close dialogs. I read the message _interfaces_ and module JSDoc
  (`features/account/src/danger/messages.ts`, `AccountEraseForm.tsx:6`) but the resolved en strings are
  supplied at app level and I did not locate them. P-1's transparency claim rests on the documented contract;
  the rendered strings should be checked against reality when P-1 is fixed.
- **Feature 006 meal-planning** as it exists on its own worktree — assessed only through 009's research
  references to `nutrition_snapshot`.
- **Security controls protecting the data** (encryption at rest/in transit, key management, IAM scoping,
  the `ServiceErasureGuard` token verification itself). Boundary — refer to `ciso` /
  `ssec-1-security-engineer`. Note in particular that P-4's fix touches an authorization surface.
- **Fairness/model-training questions** — no personal data feeds model training today; if 005 changes that,
  refer to `ai-eth-1`.
- **Non-personal-data retention bugs found in passing** and deliberately not written up here:
  `packages/services/food-service/src/foods/dao/source-call-log.dao.ts:114-118` (`pruneAged`) has no
  production caller, so `source_call_log` grows unbounded despite
  `packages/services/food-service/src/db/schema/operational.ts:104` claiming it is _"pruned on a periodic
  sweep"_. That table records outbound USDA calls, not personal data — it is a reliability/cost issue for
  `sre-1`, not a privacy one.
- **Whether prod currently holds real user data.** Taken from the brief as "no production users". If that is
  wrong, P-1, P-4 and P-11 change severity immediately, and the CR-002 plan's own release note
  (`docs/plans/2026-07-18-002-feat-account-closure-anonymization-plan.md:462-465`) already asks for this to be
  confirmed independently.

---

**Priority order for remediation**: P-1 (erasure never reaches identity) → P-4 (immortal ownerless user text)
→ P-8 (sourceType classification for the raw-text channel) → P-3/P-2 (collapse the platform asymmetry before
either OCR path is built) → P-11 + P-12 (fix alongside P-1) → P-6 (scope D4 before 009) → P-7, P-10, P-5, P-9,
P-13.

**Confidence: High** on P-1, P-4, P-5, P-9, P-10, P-11, P-12, P-13 (all read directly from shipped code, with
several confirmed by the project's own tests). **Medium** on P-2, P-3, P-6, P-8 — these assess unbuilt
decisions against specs, so the finding is about what the specs will cause rather than what code does.
**Legal review recommended** before launch on P-7 (Art. 30 register, Art. 13 notice, processor arrangements)
and on P-8's tier-gated privacy setting, which is a policy question with case-law exposure rather than an
engineering one.
