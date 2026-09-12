# 18 — Adversarial review: PR 91's scope

**Mode**: scope-guardian, adversarial. **Date**: 2026-08-14. **Target**: PR 91's settled scope (implementation
of 001/002/003 + all findings in this directory + 014's message substrate + food-service placeholder rows;
spec/plan/task-only for 004 and onward), attacked against the review corpus already in this directory
(`01`–`15`). The owner's decisions are taken as given; this document attacks the _shape_ of the work, not
whether the decisions are right.

**Inventory check performed first, because "attack the scope" requires knowing what's actually in it.**
`grep -cE "^## F-" 0{1,2,4,6}-*.md 03-*.md 05-*.md 07-*.md 08-*.md 09-*.md` gives F-R(10) + F-F(8) + F-U(16) +
F-I(6) + F-S(15) + F-D(11) + F-T(16) + F-SEC(14) + F-DB(16) = **112**, exactly matching the owner's stated
total — the inventory is not padded. The severity labels inside those same 112 findings, summed directly from
the files, come to roughly **6 CRITICAL / 35 HIGH / 45 MED / 23 LOW** (counting the four "Medium-High" and
three "Low-Medium" hybrids toward their nearer bucket) — not the "5 CRITICAL, 27 HIGH, 31 MED, 17 LOW" (= 80)
given in the scope statement handed to this review. That is a ~32-finding, ~29% gap between the scope
statement's own arithmetic and the corpus it describes. It doesn't change what needs fixing, but it is a
concrete signal that nobody has yet reconciled a single authoritative tally of "everything in scope" — which
matters directly for §"Smallest safe shape" below.

---

## Boundary coherence

**The boundary holds for most of the volume.** All of F-U (16, apps/UI), all of F-SEC (14, security), most of
F-D (11, identity/shared) and F-T (16, test coverage), and the non-ADR-0019-tagged majority of F-R (10,
recipe-service) and F-F (8, food-service) are self-contained fixes inside shipped 001/002/003 code with no
dependency on any 004+ decision. The reviewers were disciplined about saying so explicitly (01's "Areas that
are SOUND" preamble, 02's "What is already right and should not be improved," 15's "Where the model held").
For this majority, "implement 001/002/003 fully, spec-edit 004 onward" is a clean, executable partition.

**It does not hold for a specific, nameable cluster sitting at the recipe ↔ food ↔ notification seam.** Both
`01-recipe-service.md` and `02-food-service.md` — audits of in-scope, shipped code — close with a section
titled "ADR-0019 readiness," grading in-scope code against **004's** FR-046..FR-051 and **014's** message
contract:

- `01-recipe-service.md:537-549` grades seven ADR-0019 clauses; two are "**Not ready**," blocked by F-R7 (a
  new wire contract has no schema-package home yet — recipe-workers has no `contract/` directory,
  `01:405-410`) and by F-R5, which is not a routine fix but an explicit **"⛔ HALT / blocking question ...
  a cross-service, one-way-door decision I cannot resolve from the repo"** (`01:347-350`): whether the bulk
  import processor authenticates to food-service with a Clerk M2M principal, which needs food's
  `FOOD_AUTHORIZED_MACHINES` allowlist populated (a 003-adjacent, cross-service security decision).
- `02-food-service.md:598-691` runs the identical exercise for food-service: §5 (the shell/placeholder model)
  needs **no changes** — it already ships — but §4 (push status) is "**unimplementable until F-F3 is
  closed**," and item 4 (`02:656-669`) requires **"a monotonically-increasing `version integer` ... — this is
  a one-way door: it is a persisted-schema change on a table with data at rest ... Decide it before shells
  become load-bearing, not after."**

Both readiness tables are, by their own text, straddling the boundary: they are audits of **in-scope code**
whose "smallest fix" is gated on a decision that formally lives in **004/014's spec layer** — and the
adversarial passes (`12`, `13`, `14`) show that layer has not actually decided those questions. Concretely:

- **The supersession-sequence field.** `12-adversarial-status-shells.md` A-1 (lines 12–65) shows
  `supersedes.sequence` (014-FR-026) is unsited for food items (no durable counter exists on `food`, only
  `updated_at`) and **collides in name** with the already-shipped `PendingNotification.sequence`, a
  differently-owned field in the same envelope. This is not a 004-vs-011 ownership dispute; it is an
  internal-to-014 naming/durability decision, and 014's message substrate — the code the owner wants written
  now — cannot be built correctly without resolving it first.
- **The FR-045 self-contradiction.** `12-adversarial-status-shells.md` A-2 (lines 68–111) shows 014's own
  spec asserts, twelve lines apart, that supersession needs a watermark that **outlives** an ack and that
  supersession **dies with the pending entry** — and works the ADR's own motivating scenario (redelivered
  `processing` after an acked `succeeded`) to show the spec as written **admits the exact regression it was
  written to prevent**. "Latest-in-group-wins" is one of the four properties the owner named for the in-scope
  014 substrate; as specified today it is not implementable without first picking one of the two
  contradictory halves.
- **F-D7** (`06-identity-shared.md:357-390`, MEDIUM, "root cause of F-D1; blocks ADR-0019's stated
  requirement for 014") is an in-scope fix (`packages/shared/identity-core`, `packages/services/recipe-workers`)
  whose author writes, unprompted, that a fuller version of the fix "**should be sequenced with 014's
  `@kitchensink/schema-notifications`**" — i.e. even this shared-package fix cannot be fully closed without a
  014-side decision that doesn't exist yet.
- **F-DB16** (`09-data-model.md:909-`) — "the food contract has a batch WRITE but no batch STATUS READ" — is
  framed entirely around what 004's (unbuilt, spec-only) bulk importer will need. Building it now, absent a
  settled 004 shape, is speculative work against a caller that may not exist in the form assumed.

**A second, quieter boundary problem: parts of the review corpus were scoped against an earlier, broader idea
of "PR 91" than the one actually settled.** `07-test-coverage.md:1` is dated "**ahead of PR 91**" and its
F-T15 (`07:378-396`) argues its fix must land "**before PR 91 lands, so the import UI inherits a proven
pattern**" — i.e. it assumes 004's import UI ships as code in this PR. `10-import-ux.md` is a ~550-line UI
design specification for "**the UI for feature 004's import spine**" with zero numbered findings (it
therefore adds nothing to the 112 count), written as implementation guidance. Under the settled scope, 004 is
spec/plan/task-only — no import UI ships here. F-T15's and F-T16's underlying code fixes are still legitimately
in-scope (they target the already-shipped `IngredientStatusPoller`/`ingredientCatalogPick.spec.ts` async-status
pattern in 001-003), but their stated urgency ("before PR 91's import UI") is stale, and `10`'s entire content
needs to be redirected into `specs/004-recipe-importing/` as spec material rather than left as an orphaned
implementation doc nobody will execute as written.

**Verdict**: the boundary is coherent for roughly 100 of the 112 findings and incoherent, in a way that
requires case-by-case adjudication, for a small but high-consequence cluster (F-R5, F-R7, F-F3-item-4, F-D7,
F-DB16, plus 12's A-1/A-2 which the owner's own scope pulls into "message substrate" work) sitting exactly on
the recipe↔food↔notification seam — the one part of the system ADR-0019 was written to unify and which the
adversarial passes show it did not actually settle.

---

## Findings that don't fit or conflict

1. **F-DB12 and F-DB15 (`09-data-model.md:656-705`, `:873-906`) must not ship as written.** Both are `DROP
INDEX` recommendations on the two hottest tables in the two in-scope services (`recipes`, `food`), and both
   carry the reviewer's own caveat verbatim: _"I could not run `EXPLAIN (ANALYZE, BUFFERS)` — the task forbids
   connecting to the live DB ... Before merging this change, capture a plan ... The `DROP` half in particular
   should not ship on reasoning alone."_ Folding these into a 112-item mechanical burn-down is exactly the
   failure mode the reviewer flagged against: the `CREATE INDEX CONCURRENTLY` half is safe to land now, the
   `DROP INDEX` half is not, and nothing in the scope statement distinguishes them.
2. **FR-045's watermark contradiction (12-A-2) is not spec-only busywork — it gates real 014 code.** As
   argued above, building "latest-in-group-wins" against the FR as currently worded reproduces, by the
   reviewer's own worked example, the exact regression the feature exists to prevent. This is the sharpest
   case of a "fix" that must happen in spec prose before a single line of the in-scope substrate is written,
   even though 014 is otherwise spec-only outside the substrate.
3. **F-R8 is superseded by F-R2, inside the same 112.** F-R8's own text (`01-recipe-service.md:459-463`)
   says: _"The `updateResolution` predicate proposed in F-R2 fixes this site as a side effect, which is the
   better single change."_ Landing both as independent line items risks a redundant guard or, worse, landing
   only F-R8's narrower patch and missing F-R2's broader one. One of the 112 is not actually a distinct fix.
4. **F-F2 and F-DB2 are the same defect, filed twice, with two independently worded fixes.** F-F2
   (`02-food-service.md:105-`, "backpressure permanently corrupts food rows; blocks ADR-0019 §5") and F-DB2
   (`09-data-model.md:101-`, "an enqueue shed by backpressure leaves a permanently-PENDING orphan shell,
   nothing sweeps it") describe the identical orphan-shell mechanism from two review passes. They are not
   contradictory, but landing them as two unrelated tickets risks one being implemented (say, F-F2's
   admission-before-commit reorder) while the other's complementary sweep (F-DB2) is dropped as "already
   fixed," when in fact both were recommended as belonging together.
5. **The nutrient-matching fix (15-A-1, `15-adversarial-food-recipe-model.md:91-133`) is a high-consequence
   change with no test oracle yet.** It touches a shared, ownerless, cross-user catalog row
   (`food.food_nutrients`) that silently stores kJ as kcal (a ×4.184 error) today; the review's own "Tests
   owed" section calls for a property test that does not exist. A plausible-looking one-line fix here can
   silently miscompute calories platform-wide, and in a 140-item pass it is one bullet among many, not a
   flagged high-risk change.
6. **F-DB1's W1 recommendation (`09-data-model.md:37-100`, restated in `15`'s hand-off table, owner `sre-1`)
   is an IAM/RDS credential-grant change, not a code diff.** _"The per-stage DB credential for the food schema
   is not granted to the recipe service's task role"_ is the right fix, but it is an infrastructure
   access-control change with its own blast radius and rollback story, sitting inside a PR whose stated thesis
   is a code-level findings burn-down. It should be tracked and executed as what it is, not folded into the
   same review pass as a docstring fix.

---

## Sequencing within one PR

The scope, read plainly, is three different kinds of work wearing one PR: **(a)** a findings burn-down across
shipped 001-003 code, **(b)** standing up a brand-new durable/guaranteed-delivery message substrate that has
never run in this codebase, and **(c)** a portfolio-wide spec/plan/task rewrite across ten features. Each has a
different residual-risk profile and a different reviewer discipline — (a) is "does this diff match the cited
evidence," (b) is "does this new system actually hold its stated guarantees under redelivery/failover," (c) is
"is this prose internally consistent," and the adversarial passes (`11`–`15`) prove (c) is nowhere near done
even for the ADR the rest of the PR leans on.

**The strongest counter-argument is the owner's own standing directive: never split PRs, land on the open
branch.** For a solo owner with agent assistance, a second PR does not reduce review load, it duplicates the
context-switch onto the same one person. Taken as a hard constraint, the answer is not fewer PRs — it's commit
sequencing that gives the single reviewer of this PR the same stratification a split would have given for
free:

1. **Mechanical burn-down first** — the ~100 findings that don't touch a persisted schema and don't touch the
   recipe↔food↔notification seam (all of F-U, F-SEC, most of F-D/F-T, the non-ADR-0019 parts of F-R/F-F).
   Low-risk, independently verifiable against existing tests, safe to land in bulk commits.
2. **One-way-door / persisted-schema changes as their own single-purpose commits**, additive first (F-DB3's
   CHECK, F-DB4/F-DB10/F-DB11's indexes, F-DB13's constraint), destructive last and only with the `EXPLAIN`
   evidence F-DB12/F-DB15 say is missing attached to the commit. Do not fold these into the bulk commit above
   — they are exactly the changes a fatigued reviewer will wave through on volume (see next section).
3. **A narrow spec fix to `specs/014-notification-service/spec.md` (FR-045, FR-026) before any substrate
   code is written**, per the "Findings that don't fit" section above. This is the one 004/011/014 spec touch
   that gates in-scope code and must not be silently deferred into "spec-only, no code, later."
4. **The 014 message substrate**, built against the corrected FR-045/FR-026, and against nothing else from
   004's still-contested import spine (§4/§5's food-item emission ownership is itself disputed — `12-A-5`
   shows the food service structurally cannot name a recipient, and the codebase already records that as a
   corrected mistake at `food-service/src/db/schema/operational.ts:64-71`). Keep the substrate's scope to
   exactly the four named properties; do not let it grow the recipe-service or food-service emitter wiring
   that F-R5/F-R7/F-F3 show is still blocked on an unresolved credential/contract decision.
5. **The portfolio-wide 004-013 spec rewrite proceeds independently**, but should not attempt to "finish" or
   silently ratify ADR-0019 as part of this pass. The adversarial reviews found it self-contradictory in
   multiple load-bearing places (`11`'s A-1/A-2/A-3/A-5/A-6/A-9, `13`'s A-6/A-7/A-9, `14`'s P-3/P-4/P-5/P-8) —
   rewriting six features' tasks/plans against a still-contested ADR risks doing the 90-file rewrite twice.

---

## Review-risk hot spots

At ~140 discrete changes for a solo reviewer, even an optimistic ten minutes of real diff-reading per item is
23+ hours of sustained review attention against a "land it" directive — the realistic failure mode is that
review quality degrades across the pass, and nothing in the PR's shape marks which items need full attention
versus a skim. The changes most likely to slip through precisely because they are buried in volume:

- **The persisted one-way-door schema changes** (F-DB3, F-DB4, F-DB10/11, F-DB13, F-F3's version column) —
  these are where "looks right in the diff" and "is right" diverge most, and F-DB13 alone bundles two
  independent problems (unsynchronized denormalization + missing non-negativity constraints) as one finding,
  easy to review — and easy to half-apply — as a single item.
- **F-DB12/F-DB15's `DROP INDEX` pair** — a `DROP` reads as a two-line cleanup in a diff, not as the
  highest-blast-radius change in the pack, even though it explicitly lacks the measured evidence the reviewer
  said was required before merge.
- **The nutrient-matching fix (15-A-1)** — silently affects platform-wide calorie accuracy on a shared row,
  has no property test yet, and is one bullet among ~140.
- **F-R5/F-F3's credential and sequence decisions** — small code diffs (mint a token, add a column) carrying
  large architectural consequences (which principal, what durability guarantee) buried in prose above the
  diff; exactly the shape a fatigued reviewer approves because the diff itself is short.
- **The apps/UI findings' safety net is itself part of the batch being fixed.** F-T16
  (`07-test-coverage.md:400-419`) shows the mobile `IngredientStatusPoller` — the async-status UI pattern
  this PR's food/message-substrate work directly touches — has zero tests today. If the test-debt fix (F-T16)
  and the behavioral fix it's meant to guard land in the same sweep, the independent check that would catch a
  regression in that vertical doesn't exist yet at the moment the regression could be introduced. Land F-T16
  (and F-T9, F-T4, F-T11 — the CI-gate findings that determine whether any of this is actually enforced) early
  enough in the sequence that later commits are checked by it, not concurrent with it.

---

## Smallest safe shape

Within the no-split constraint, "smallest safe" is achieved by scope subtraction plus the commit strata above,
not by a second PR:

1. Reconcile the scope statement's own severity arithmetic (5/27/31/17 = 80) against the corpus's actual
   ~6/35/45/23 = 112 before treating "all findings" as a checklist — a 29% undercount in the headline tally is
   a sign the full inventory hasn't been reconciled once yet, and a bad place to start a mechanical burn-down.
2. Explicitly carve out F-R5 and F-F3-item-4 (and anything else reviewer-tagged HALT / "decide before X
   becomes load-bearing") from this PR's code scope. Leave the flags in place; do not resolve a security- or
   schema-relevant one-way door by picking an implementation because it was finding #N of 140. File the actual
   decision as a named owner ruling — the pattern ADR-0017's amendment used honestly for its own unmeasured
   trigger (`14-adversarial-premises.md` P-15's "Premises that held" entry praises exactly this) — separate
   from this PR.
3. Land the two-line FR-045/FR-026 spec fix in `specs/014-notification-service/spec.md` as a precondition
   commit before any substrate code, per §"Sequencing" above.
4. Split F-DB12/F-DB15 into their additive half (land now) and their destructive half (defer until `EXPLAIN
(ANALYZE, BUFFERS)` evidence exists, per the reviewer's own instruction).
5. Redirect `10-import-ux.md` into `specs/004-recipe-importing/` as spec content; keep F-T15/F-T16's code
   fixes but drop their stale "before PR 91's import UI" framing.
6. Add one paragraph — to the PR description or a short ADR note — stating plainly that ADR-0019 is **not**
   being finalized by this PR: the adversarial passes found it self-contradictory in several load-bearing
   places, and this PR deliberately fixes what it can verify (shipped code, generic substrate mechanics)
   without pretending to have resolved 004/011's ownership disputes. This costs nothing and prevents the next
   reader from citing PR 91 as having settled questions it didn't.

---

## What held

- **The 112-finding inventory is accurate and not padded.** `grep -cE "^## F-"` across the nine source files
  sums to exactly 112, matching the owner's stated total.
- **The boundary works for most of the volume.** All of F-U, F-SEC, most of F-D/F-T, and the
  non-ADR-0019-tagged majority of F-R/F-F/F-DB are genuinely self-contained 001-003 fixes with no 004+
  dependency, and the reviewers said so explicitly rather than leaving it implicit (01's "Areas that are
  SOUND," 02's "What is already right and should not be improved," 15's "Where the model held").
- **Where a finding does need a 004/011/014 decision, the review docs mostly say so rather than guessing.**
  F-R5's HALT flag, F-R7's and F-F3's "decide before X becomes load-bearing," F-D7's "should be sequenced
  with 014's schema-notifications" — the corpus is honest about its own boundary problems, which is what makes
  this attack answerable with citations instead of speculation.
- **The reviewers already flagged their own unverifiable recommendations as caveats, not as fact.**
  F-DB12/F-DB15's `EXPLAIN` caveat and F-F1's "estimate from structure size, not a measurement" mean the
  "don't fix as written" cases in this review are the reviewers' own stated limits, correctly read.
- **The food-service placeholder/shell scope is well-founded and low-risk relative to the rest of the PR.**
  Five independent passes (`02`, `09`, `12`, `14`, `15`) converge on the same conclusion — ADR-0019 §5's shell
  model is _already shipped_ in food-service (003) and needs hardening (F-F2/F-DB2's backpressure orphan,
  F-DB6's typeahead leak, F-DB15's index shape), not invention.
- **F-I1 (the 8-slot/9-service ALB ceiling) is a clean, self-contained, high-value fix.** It is fully inside
  the in-scope infra footprint (the allocator is shared, live code all three shipped services depend on) and
  requires no 004+ decision to land safely now — a finding that looks cross-cutting but isn't.
