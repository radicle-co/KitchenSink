# Peer Review (Consolidated): Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Review date**: 2026-08-02
**Reviewer**: Adversarial design review against `CLAUDE.md`, `docs/CODING_STANDARDS.md`, and
`docs/engineering/ENGINEERING_EXCELLENCE.md`
**Artefacts reviewed**: requirements · system-design · architecture-design · module-design · hazard-analysis ·
acceptance-plan · system-test · integration-test · unit-test

> **Why this review looks different from the last one.** The previous nine peer-review files each reported
> **0 findings at every severity** — for a document set that contained corrupt requirement text, three
> mutually contradictory requirement counts, an empty implementation matrix, a dependency on a non-existent
> npm package, and file paths pointing at a directory that does not exist. A review that finds nothing in that
> is not a review. This one is run as an adversary and states what it actually found, including in work
> produced during this same regeneration.

## Summary

| Severity    | Count  | Open   |
| ----------- | ------ | ------ |
| Critical    | 0      | 0      |
| Major       | 3      | 0      |
| Minor       | 13     | 2      |
| Observation | 12     | 12     |
| **Total**   | **28** | **14** |

Counts are the **union** across this file and the nine per-artefact reviews, verified by extracting finding
IDs rather than by tallying prose. `MIN-001`..`MIN-007` and `OBS-001`..`OBS-006` are detailed below;
`MIN-008`..`MIN-013` and `OBS-007`..`OBS-012` are artefact-specific and detailed in their own review files,
indexed at the end of this document.

No open finding exceeds Minor. Nothing blocks implementation.

---

## Major findings (all resolved)

### MAJ-001 — The draft-and-confirm model is a large, schema-forced scope increase; it must not look like a preference

**Artefacts**: spec, architecture-design, plan
**Finding**: Introducing `import_drafts` + `import_jobs` + an async worker converts "import a URL" from one
endpoint into a multi-stage lifecycle with two new tables. A reviewer could reasonably read this as
gold-plating.
**Assessment**: It is **forced**, not chosen. The shipped `CreateRecipeRequest` and `recipes` table require
`servings`, three time fields, ≥1 ingredient, and ≥1 step, all NOT NULL with CHECK constraints; schema.org
guarantees none of them. Writing directly would require fabricating values — which the CHECK constraints would
silently accept, producing recipes that assert facts no source stated.
**Resolution**: Justification stated explicitly in `spec.md` (_The draft-and-confirm model_) and recorded in
`plan.md §10` Complexity Tracking. **Closed.**

### MAJ-002 — OCR at P1 concentrates most of the release's residual risk

**Artefacts**: hazard-analysis, tasks
**Finding**: Owner decision D-001 puts physical-copy import in the launch scope. It brings a new vendor
(Textract), a new IAM surface, S3 object lifecycle, a mobile camera path, and — most significantly — the
storage of **user photographs**, which can capture faces, handwriting, and surroundings. HAZ-035 and HAZ-036
are Critical and exist only because of this decision.
**Assessment**: Legitimate owner call, but the privacy exposure was not visible anywhere in the previous
document set.
**Resolution**: HAZ-035/036 added with explicit controls (deletion on every terminal path, never logging OCR
text) and bound to T-018/T-012. Stated plainly rather than buried. **Closed.**

### MAJ-003 — A gated P1 requirement is a contradiction unless the gating semantics are stated

**Artefacts**: requirements, spec
**Finding**: `REQ-005` / `REQ-IF-001` are labelled "P1 (gated)". P1 normally means release-blocking; gated
means it may not ship. Left implicit, this would produce exactly the release-planning ambiguity that made the
OCR priority contradiction fester for three months in the previous document set.
**Resolution**: `spec.md` adds a **Gating** section stating that FR-009 is the only gated requirement, that
release is explicitly **not** blocked on it, and that the channel ships disabled with tests running against a
contract fake. **Closed.**

---

## Minor findings

### MIN-001 — Requirement counts were wrong on first authoring _(closed)_

The regenerated `requirements.md` initially stated Test 40 / Inspection 13; the actual tallies are 41 / 12.
Caught by counting programmatically rather than by eye. **Corrected.** Worth noting that this is the identical
failure mode as the original document's 24-vs-28 discrepancy — count tables are unreliable when hand-written,
and should be derived.

### MIN-002 — Hazard severity tallies were wrong on first authoring _(closed)_

Stated Serious 27 / Minor 7; actual 29 / 5. **Corrected** by tallying from the table.

### MIN-003 — Test-scenario counts were wrong in three documents on first authoring _(closed)_

Acceptance (57 vs 58), system (68 vs 81), integration (63 vs 75). **All corrected** by counting. The recurrence
across four documents is the finding: summary counts must be verified, never asserted.

### MIN-004 — The OpenAPI contract path was wrong on first authoring _(closed)_

Initially recorded as `packages/services/recipe-service/contracts/api.openapi.yaml`; the file actually lives at
`specs/001-commise-recipe-app/contracts/api.openapi.yaml`. **Corrected** in plan, tasks, and
architecture-design. Verified by filesystem check.

### MIN-005 — Original task paths targeted a non-existent package tree _(closed)_

`packages/api/recipe/**` and `packages/shared/db/**` do not exist. **Corrected** to the real
`packages/services/recipe-service/**` and `packages/apps/commise/features/recipes/**`, verified against `main`.

### MIN-006 — Two chosen libraries are dormant ⚠️ **OPEN**

`microdata-node` (last published 2022-06) and `gray-matter` (2023-07) fall short of "well-maintained" in the
CLAUDE.md library-first gate, though both are stable, focused, and handle frozen formats.
**Disposition**: Accepted with rationale recorded in `plan.md §4`, mitigated by both sitting behind ports and
by their output being sanitized and Zod-validated. **Re-evaluate at implementation time**; if either shows a
vulnerability or a parsing gap, the port makes replacement local.

### MIN-007 — The SC-002 corpus size is a judgement, not a derivation — **CLOSED (D-009)**

50 pages with the stated stratification is defensible for a consumer application, but it is not derived from a
statistical power calculation, and the resulting percentage carries a confidence interval nobody has computed.
**Disposition**: **Held at 50 with a refresh cadence added instead** (D-009). Owner-ratified 2026-08-02 on the
reasoning that staleness, not sample size, is the live risk: the number is stable enough to catch a regression,
but a frozen corpus silently stops measuring the current web. Quarterly review, triggered early by a >10pp
strategy-mix shift. Revisit the size only if extraction accuracy becomes contested.

---

## Observations (all open, none blocking)

### OBS-001 — The service's OpenAPI contract lives under feature 001's folder

`specs/001-commise-recipe-app/contracts/api.openapi.yaml` is a **service-wide** artefact sitting in a
**feature-scoped** directory, so 004 must reach into 001's folder to extend it. Correct for now (one service,
one contract) but structurally odd. A future cleanup should relocate it to the service package. Out of scope.

### OBS-002 — The FR numbering collision is mitigated, not eliminated

004's `FR-008..FR-014a` still collide with 001's shipped `FR-008..FR-014`. The `004-` prefix convention
resolves ambiguity for cross-feature references, but a reader inside either document can still be confused. A
clean renumber would be better and is deliberately deferred to avoid breaking existing links and the index.

### OBS-003 — `import_channel` and `source_type` are correctly distinct but subtly so

The distinction (provenance channel vs policy classification) is right and is documented, but it is the kind of
pairing a future contributor collapses "for simplicity", which would couple metrics to policy and break the
C-004 CHECK domain. Worth a schema comment at implementation time, not just a plan note.

### OBS-004 — `Idempotency-Key` places a burden on clients — **CLOSED (D-008)**

Requiring the header is correct per `ENGINEERING_EXCELLENCE §1`, but if client adoption proves poor the
practical outcome is `400`s rather than safety. A server-derived fallback was considered and **rejected**: it
would create a second idempotency path, and it could not help photo or file imports, which have no natural key
and are precisely the channels where a duplicate costs money. Decision: **required, no fallback** — one
mechanism, failing loudly. Owner-ratified 2026-08-02.

### OBS-005 — The heuristic extractor's confidence score is ordinal, not calibrated

It is a count of agreeing signals normalised to `[0,1]`, not a probability. Using it to **order** or **flag**
fields in the UI is sound; using it as a numeric threshold (e.g. "auto-accept above 0.8") would be unjustified.
Nothing currently does, and nothing should without calibration against the corpus.

### OBS-006 — Honouring `robots.txt` may block imports users are entitled to make

HAZ-021's control refuses a source whose `robots.txt` disallows crawling. But a user importing a page they can
personally read is arguably not crawling. The conservative choice is right for launch given the attribution and
TOS posture, and it may cause avoidable friction on sites with blanket disallow rules. Revisit with data.

---

## Review method

Each artefact was read against: its parent artefact (for derivation fidelity), the shipped codebase on `main`
(for reality), the three governing standards documents (for compliance), and an adversarial pass asking "what
would make this fail in production, and what claim here is unverified?". Numeric claims were checked by
counting rather than by reading. Dependency claims were checked against the npm registry. Path claims were
checked against the filesystem.

## Per-artefact review index

| Review file                          | Findings                              |
| ------------------------------------ | ------------------------------------- |
| `peer-review-requirements.md`        | MAJ-003 · MIN-001 · MIN-008 · OBS-002 |
| `peer-review-system-design.md`       | MIN-009 · OBS-007                     |
| `peer-review-architecture-design.md` | MAJ-001 · MIN-004 · MIN-010 · OBS-005 |
| `peer-review-module-design.md`       | MIN-011 · OBS-003 · OBS-008           |
| `peer-review-hazard-analysis.md`     | MAJ-002 · MIN-012 · OBS-006           |
| `peer-review-acceptance-plan.md`     | MIN-003 · MIN-007 · OBS-009           |
| `peer-review-system-test.md`         | MIN-003 · OBS-010                     |
| `peer-review-integration-test.md`    | MIN-003 · OBS-011                     |
| `peer-review-unit-test.md`           | MIN-013 · OBS-012                     |

`MIN-002` (hazard severity tallies) and `MIN-005` (task file paths) are cross-artefact and recorded only here.
