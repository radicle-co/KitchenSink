# 0027 — An ingredient phrase is NOT personal data; the user id beside it is a DISTINCT-USER COUNTER

- **Status**: Accepted
- **Date**: 2026-08-25
- **Drivers**: Three tables in the recipe database had grown an account-erasure apparatus built on a single
  premise — that the ingredient text a cook types is personal data that a legal erasure request must reach.
  Two prior owner rulings and four migrations rest on it (`0021`, `0026`, `0029`, `0031`), and the apparatus
  had reached the point of shaping a wire contract, a queue message, three sweep statements, two CHECK
  constraints, three partial indexes and a repo-wide meta-gate. On **2026-08-25 the owner ruled the premise
  wrong**: an ingredient phrase — the original a cook typed, or a corrected one — is not private data.
- **Reverses**: the ruling recorded in `packages/services/recipe-service/src/database/migrations/0026_memo_owner_erasure.sql`
  (2026-08-23) — _"The owner ruled to KEEP the phrase and make it erasable"_ — and the premise of
  `0031_resolution_phrase_needs_owner.sql`, whose CHECK pair states _"a phrase and the person it belongs to
  exist together or not at all"_.
- **Relates to**:
  [ADR-0022](0022-in-stack-migration-trigger.md) — migration `0033` is CONTRACTING and the in-stack Trigger
  applies it before the new handler serves, so the rolling-deploy window is stated rather than waved away;
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md) — the verification gate's queue contract, whose
  `ownerId` field this removes;
  [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md) — the parse pipeline whose TOP tier is
  `ingredient_parse_corrections`, one of the two tables that retains a user id;
  `specs/governance-rules.md` **GR-004** — the canonical column name for a user reference is `user_id`, which
  both tables were in the letter of violating.

## ⚠️ Before you change this — the five "improvements" that are all wrong

1. **Do not re-add a sweep for these three tables.** `erasureSweepCoverage.test.ts` used to demand one, and
   the tables still carry a `user_id`, so putting the statements back is the obvious repair for a reader who
   has not read this file. It is the wrong one — see Decision §2. That gate now records them in
   `RETAINED_BY_RULING`, and an entry there is a decision, not an oversight.
2. **Do not restore the phrase copy on a corroboration binding.** `0031` removed it on **two** arguments and
   this ruling reverses only one. See Decision §4.
3. **Do not restore `NOT NULL` on `source_phrase` / `source_line`.** It would fail against real data AND
   contradict a live writer. See Decision §4.
4. **Do not "simplify" `erasureSweepCoverage.test.ts`'s two maps into one.** They make different claims and
   are verified differently. See Decision §5.
5. **Do not read the retained `user_id` as "a user id is not personal data".** It is a **retention decision
   under a stated purpose**, and its defence has a load-bearing dependency. See Residual risk.

## Context

### What the apparatus was, and how far it had spread

`ingredient_resolution_mappings` (0021) and `ingredient_parse_corrections` (0029) each hold a cook's
correction: the raw text, the corrected answer, and the id of the person who made it. Their sibling
`ingredient_resolution_memos` (0021) holds something different — a resolution a MODEL agreed with — and 0021's
header is explicit that it has _"no scope and no author, because nobody asserted it"_.

Reading the phrase as personal data produced, in order:

| Artefact          | What it did                                                                                                                                            | Where                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `0026`            | added `ingredient_resolution_memos.owner_id` — _"a person-to-row link it did not hold before"_ — purely so a sweep had a predicate                     | migration                      |
| `0026`            | relaxed the memo's `source_phrase` `NOT NULL` so the sweep could clear it                                                                              | migration                      |
| `0029`            | shipped `ingredient_parse_corrections_owner_line_pair`, a CHECK tying line to person                                                                   | migration                      |
| `0031`            | added the same CHECK to mappings and memos, and BACKFILLED both to satisfy it                                                                          | migration                      |
| steps 10–12       | three de-identifying `UPDATE`s inside the erasure transaction                                                                                          | `accountErasureWorker.ts`      |
| `ownerId`         | a field on the verification queue's wire contract, existing only to carry an owner to the memo writer                                                  | `verificationMessage.ts`       |
| 3 partial indexes | `idx_resolution_mappings_author`, `idx_parse_corrections_owner`, `idx_resolution_memos_owner` — each created with the sweep named as its justification | migrations                     |
| the pairing rule  | a repo-wide meta-gate assertion, plus its `MINIMUM_DE_IDENTIFYING_STATEMENTS` floor                                                                    | `erasureSweepCoverage.test.ts` |

### Why the user id could not simply go with it

Two of the three tables use that column for something the erasure story never depended on. `0021`'s own
header calls the partial unique index over it **"THE CORROBORATION COUNTER"**: _"a second INDEPENDENT user
corroborates" is implemented as a count of live author-scoped rows for a phrase, and that equals a count of
DISTINCT AUTHORS only because this index makes a second live row from one author impossible._ That count is
what promotes a correction from personal (`scope = 'author'`) to global.

And `resolutionMappings.dal.ts` names it twice more: _"Three `WHERE` clauses ARE the authorization, and none
of them is a branch."_ Two of the three are this column — the supersede predicate (`zero rows returned IS the
denial`) and the read predicate that keeps one cook's correction from binding another. Sweeping it would
un-authorize a cook from their own corrections and silently dissolve every promotion.

So the column stays and the sweep goes. The two are genuinely separable because they were never the same
requirement — the erasure reading arrived later, in `0026`, and attached itself to a column that already
existed for a different job.

## Decision

### 1. The phrase is retained; the memo tier loses its person link outright

`source_phrase` and `source_line` are kept, unerasable, on all three tables. `ingredient_resolution_memos`
loses `owner_id`, its partial index and its CHECK.

⛔ The asymmetry between "rename the column" (two tables) and "drop the column" (one) is the whole shape of
this decision and is not an inconsistency. A memo is the model's conclusion, so there is **no correction
there to count**; `owner_id` was write-only (nothing ever `SELECT`ed it, and its only index was partial and
built for the sweep predicate), and `0026` added it solely to enable erasure. A column that exists only for a
repealed purpose is removed, not renamed into a counter it cannot serve.

### 2. No erasure sweep targets any of the three tables

Steps 10, 11 and 12 come out of `eraseRecipeRows`. ~~Steps 1–9 are untouched: they cover `recipes`,
`account_erasure_jobs`, `recipe_ratings`, `collections` and `author_handles`~~, all of which hold genuinely
personal content (recipe text a cook wrote, their collections, their ratings, their cleartext handle).

⚠️ STALE (2026-09-04) — the STEP NUMBERS and the table list, not the ruling. The ruling ("no sweep targets
the three tables") still holds and is restated in the sweep's own docstring. But `eraseRecipeRows` has grown
since: it now numbers **fourteen** steps, and the surviving core is steps **1–11** (which also cover
`recipe_versions.editor_handle`, omitted from the list above). Three genuinely new sweeps landed AFTER this
ADR and are not exceptions to it —
`packages/services/recipe-workers/src/handlers/accountErasureWorker.ts:559` (step 12,
`DELETE FROM recipe_parse_jobs`, the cook's pasted text — U8/U9, migration 0039),
`:573` (step 13, the unreferenced private authored foods in `ingredients` — ADR-0029 §6, migration 0040) and
`:595` (step 14, `UPDATE analytics_events SET user_id = NULL, query_text = NULL` — ADR-0030 §2, migration
0043, deliberately STRICTER than this ruling because a typed search query is the user's own words).

### 3. `author_id` / `owner_id` → `user_id` on both correction tiers

One name for one concept across both tables. This is also a correction to a standing rule rather than a
preference: **GR-004** fixes `user_id` as the canonical column name for a user reference and AC-004-c requires
it, so both tables were in the letter of a violation.

⚠️ `scope` and `origin` keep their `'author'` VALUE. After the rename `author` names exactly one thing — a
REACH — and `user` names exactly one thing: a person. The overload is what was removed, not the vocabulary.

⚠️ **This does NOT make the recipe database GR-004-compliant, and the migration header should not be read as
claiming it does.** Three spellings for a user reference survive: `owner_id` (`recipes`, `collections`,
`account_erasure_jobs`), `created_by` (`recipe_versions`), and `user_id` (`recipe_ratings`, `author_handles`,
and now the two correction tiers). Two tables of six are corrected. Renaming `recipes.owner_id` is a
different change with a different blast radius — it is load-bearing in the erasure sweep, the visibility
policy and every recipe read path — and it is not attempted here.

⚠️ STALE (2026-09-04): the DENOMINATOR moved, not the decision. The recipe database now has **11**
user-bearing tables, not six-plus-two: `recipe_parse_jobs.owner_id` (0039), `ingredients.food_owner_id`
(0040) and `analytics_events.user_id` (0043) landed later. Four spellings survive, not three.

⛔ **`user_id` stays NULLABLE.** A `corroboration` binding has no user, because nobody wrote it — two people's
agreement produced it — and the partial indexes' `user_id IS NOT NULL` half is what excludes those rows from a
uniqueness they have no user to be unique per.

### 4. Two things `0031` did that SURVIVE this reversal, for reasons that were never about privacy

⛔ **`promoteByCorroboration` still writes no phrase onto the corroboration binding.** `0031` removed that copy
on two arguments. This ruling reverses one of them (there is no retention window to close). The other stands
entirely on its own: the copy **bought nothing**. `0021` keeps a phrase to make the key derivation a two-way
door (`SET normalized_key = f(source_phrase)`), and the binding CITES two rows that each carry their own — so
a backfill for the binding runs through `corroborated_a` either way. Both DALs' input types have no member
for a phrase, so a caller cannot supply one.

⛔ **`source_phrase` / `source_line` stay NULLABLE**, and restoring `NOT NULL` would be wrong twice over. A
LIVE writer inserts NULL there (the binding above), and `0031`'s backfills already nulled the column on every
corroboration binding and every ownerless memo — `ALTER … SET NOT NULL` fails outright if any row violates it,
so the statement would fail on every `pr-{N}` database `0031` has run against.

⚠️ **This reversal restores the RULE, not the DATA.** `0031`'s own header says the backfilled phrases _"are
not recoverable, which is the whole point of the change"_. They are gone.

### 5. `0029`'s pair CHECK goes too — a judgement, flagged as one

`ingredient_parse_corrections_owner_line_pair` is not `0031`'s, and the ruling did not name it. It is dropped
anyway, and the reasoning is worth being able to overrule cheaply: **its only recorded justification is the
one being repealed** — _"an owner id left beside another cook's line would aim the NEXT erasure at the wrong
person"_. There is no next erasure. Leaving it would put two tiers that `0029` deliberately shaped as siblings
(_"the SUBJECT differs but the scope rule is identical knowledge"_) under different constraints for no stated
reason, and a constraint whose justification has been repealed is exactly the stale invariant a later reader
reasons wrongly from.

### 6. `erasureSweepCoverage.test.ts` gains a SECOND map and a FOLD, and loses one floor

The gate now recognises three verdicts, not two, and the third needs a different kind of check:

- an **exemption** claims a MECHANISM ("erasure still reaches this data by some other means") and is verified
  against that mechanism;
- a **retention** claims CONTENT ("the only user-derived thing left here is an opaque identifier") which no
  mechanism can discharge, so it is verified by pinning the table's ENTIRE current column set, and its reason
  must cite an ADR file that exists on disk.

⛔ One map with two meanings would be one map with two unenforceable meanings. The column pin is the only
mechanical check on what a retention actually claims: it is what stops a genuinely personal column accreting
beside the retained id and never being noticed.

Discovery also became a **fold** over the ordered migrations (honouring `DROP COLUMN` and `RENAME COLUMN`)
rather than a union over history. The union had always been wrong in one direction nobody had hit — a dropped
column would leave the gate demanding a sweep for something that does not exist. A fold can fail in a
direction a union cannot, so it is bounded two ways: the fold's result must be a SUBSET of the union, and the
non-vacuity floor is set against the current count (8) rather than a historical one.

⚠️ STALE (2026-09-04): the floor is now `MINIMUM_OWNER_BEARING_TABLES = 9`
(`packages/infra/global/__tests__/erasureSweepCoverage.test.ts:352`), and the ZERO-SLACK property this
paragraph relies on has been lost: the recipe schema's current user-bearing count is **11** (adding
`recipe_parse_jobs` from 0039 and `analytics_events` from 0043 to the nine the constant was last raised
for), so a fold could now spuriously drop two tables without going red. The bound stated here is real but
weaker than described; raising the constant is owed.

⚠️ **`MINIMUM_DE_IDENTIFYING_STATEMENTS` was DELETED, and that is the one place this gate got weaker.**
Recorded plainly: the sweep now issues zero de-identifying statements, so any positive floor would be false
and a floor of `0` would be a constant named MINIMUM that enforces nothing. The pairing assertion becomes a
standing rule that fires the day such a statement returns; the parser-breakage detection it guarded moves to
three fake-driven cases that assert the parser's EXACT output structure rather than a count — strictly
stronger than a floor, on that one axis.

### 7. `ownerId` is removed from the verification queue contract

Its only consumer was `verifyLine.ts` feeding the memo writer. It is removed rather than deprecated because
removal is safe in **both** deploy directions: `verifyIngredientLineMessageSchema` is a `z.object`, so a
message from the previous producer still carrying it has the key STRIPPED rather than being refused, and the
field was already `.optional()`, so a new producer omitting it parses against an older worker. It also
strictly reduces what a DLQ message holds — the contract's own docstring asks that every field be weighed
against exactly that.

## Alternatives considered and REJECTED

**Keep the sweep but stop nulling the phrase.** Rejected: the sweep's only remaining effect would be to null
the `user_id`, which is the counter and the authorization predicate. It would produce the worst of both — a
table that reports as swept while the count silently degrades every time somebody erases their account.

**Store a keyed hash (HMAC) of the user id instead of the ULID.** This preserves distinct-counting exactly and
removes re-identifiability, so it looks like it dominates. It does not: `user_id` is not only a counter, it is
an **authorization predicate** (`supersedeOwnMapping`'s `WHERE … user_id = :caller`, and the read predicate).
Running authorization against a keyed hash means a key rotation silently un-authorizes every cook from their
own corrections, with no error and no signal. Rejected.

**Amend `0031` in place** rather than adding `0033`. Rejected on a measured fact: `0031` is pushed to
`origin/chore/code-quality-enforcement-phase-1-2` (PR #91) and the `deploy-recipe (pr-91)` sandbox job
succeeded after it landed, so ADR-0022's Trigger applied it to that database. `lambdas/migrate/handler.ts`
tracks applied migrations **by name only** — no checksum — so an amended `0031` would be SKIPPED there while
every fresh database got the amended file. That is how two environments come to disagree about a schema with
nothing reporting it.

**Expand-then-contract**, shipping the worker change one release ahead of `0033`. This is ADR-0022's standing
precondition and it was NOT taken; the reasoning and its cost are in `0033`'s header. In short: it means two
merges to carry one owner ruling under a standing directive to land on the open branch, the exposure is
sandbox and `pr-{N}` only (recipe-service is not deployed to production), and the failure direction is a
retry rather than a silent under-delivery.

## Consequences

- ~~The erasure transaction is three statements shorter and touches five tables instead of eight.~~
  ⚠️ STALE (2026-09-04): true of the change itself, false as a description of the sweep today. The
  transaction now issues fourteen numbered steps across **nine** tables — `recipes`,
  `account_erasure_jobs`, `recipe_ratings`, `collections`, `recipe_versions`, `author_handles`,
  `recipe_parse_jobs`, `ingredients` and `analytics_events`
  (`packages/services/recipe-workers/src/handlers/accountErasureWorker.ts:485-599`). None of the three
  additions touches the tables this ADR retained.
- A cook who erases their account leaves their ingredient corrections and their opaque id behind, and those
  corrections keep counting toward promotion. That is the intended behaviour, not a leak.
- `ingredient_resolution_memos` rows are now impersonal by construction: a key, a food id, a phrase and the
  model that agreed.
- Adding any column to `ingredient_resolution_mappings` or `ingredient_parse_corrections` now costs one line
  in `RETAINED_BY_RULING`. That friction is deliberate — it is the only moment anybody is forced to ask
  whether the new column is personal data.
- `CONTRACT_HASH` did NOT move. The rename stops at the persistence and policy layers; the prose in
  `ingredients.schema.ts` that mentions an absent `authorId` request field describes the DTO, not the column,
  and is left for a change that already moves the hash.

## ⛔ Residual risk

**A user id survives a GDPR erasure request, deliberately.** The retained `user_id` is an opaque app ULID and
is pseudonymous personal data on its own terms (GDPR Recital 26). This ADR is a **retention decision under a
stated purpose** — counting distinct users so a correction can be promoted from personal to global — and not a
claim that the column is out of scope.

⚠️ **The defence has a load-bearing dependency, and it is NOT the one an obvious reading assumes.** The recipe
database holds no mapping from a ULID to a person (there is no local users table, D2), so on its own the
retained id is a bare token. That mapping lives in the identity service — and **the identity service does not
delete it.** `eraseIdentityRow` (`@kitchensink/identity-db`) states outright: _"The row itself is NEVER
hard-deleted (R1) and its `identityId` is left intact (so it stays resolvable)."_ What erasure there does is
scrub the profile (name and picture destroyed, email replaced by a ULID-keyed placeholder), purge the
`accounts`/`profiles` rows, and set `status = 'erased'` — the last of which is load-bearing for the R10
anti-resurrection guard, which is why the row cannot simply be deleted. The Clerk account itself IS deleted
first (`deleteUser(tombstone.identityId)` precedes the DB scrub).

So the honest position is: after erasure the recipe-side `user_id` links to an identity row that carries **no
PII** and a Clerk `sub` that no longer resolves to an account at Clerk. Re-identification would require a
source outside this system that maps the ULID or the `sub` back to a person.

⚠️ **Two places the retained identifier ALSO survives, named so this survey is complete rather than
convenient.** Neither is created by this change; both are in scope of the deliberate retention:

- `mappingPromotionAudit.ts` emits `corroboratingAuthorIds` — raw user ULIDs — to the structured log sink on
  every promotion. That is a durable copy outside every sweep, under CloudWatch/Sentry retention. It is the
  audit trail a sock-puppet investigation reads, which is why it carries the ids at all.
- `identity`'s append-only `lifecycle_events` retains the ULID for the same auditability reason, and
  `eraseIdentityRow` deliberately APPENDS to it rather than clearing it.

⚠️ **One sentence above is a claim about a third party and is phrased as one deliberately.** What this system
does is call `deleteUser(tombstone.identityId)` before the DB scrub. What Clerk retains after that call
returns — backups included — is not observable from here and is not asserted.

**Re-open this ADR if any of these change:** the identity row starts retaining PII past erasure; a restored
backup reintroduces a ULID→person mapping; any other store gains one; or the retention purpose stops being
served (if corroboration is ever replaced by a mechanism that does not need per-user distinctness, the column
loses its justification and should go).

**A second, smaller residual:** `RETAINED_BY_RULING` converts two tables from "RED unless swept" to "green
forever". The column pin proves nothing new accreted; it cannot prove the retained identifier is still serving
the purpose claimed for it. And the next engineer whose table goes red will see these entries and may copy the
pattern — the ADR-citation requirement raises the cost of doing that thoughtlessly, it does not eliminate it.
That is the same residual `EXEMPT_FROM_SWEEP` already carried and this repository already accepted.
