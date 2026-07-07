# Product Forge Revalidation Log: Feature 001

**Branch**: `001-commise-recipe-app`
**Created**: 2026-05-09
**Status**: Approved with blocking corrections pending
**Mode**: Retroactive bootstrap pilot
**Milestone**: `M1` Rivendell
**Public Launch**: Beta (end of `M4`)
**Launch Plan**: [`v1-launch-plan.md`](../v1-launch-plan.md)

---

> **SUPERSEDED where noted (2026-07-06)** per the 2026-07-06 reconciliation. This is a **historical revalidation log** — its revision entries are preserved as-written and **not rewritten**. Two classes of reference below are stale and have been overtaken by the reconciliation pass:
>
> - **API prefix.** Every `/api/*` and `/api/v1/*` (and the never-adopted `/api/v1/v{N}/*`) reference is **SUPERSEDED → bare `/v1/*`**. Shipped identity (002) and food (003) services expose `@Controller('v1/...')`, so the canonical public prefix is `/v1/*`. The Revision 1/2 push to add an `/api/v1` segment is **REVERSED**.
> - **Shared types package.** Every `@kitchensink/shared-recipe-core` (a.k.a. `shared/recipe-core`) reference is **SUPERSEDED → `@kitchensink/recipe-core`** (folder `packages/shared/recipe-core`, `@commise` scope;.
>
> Each affected section carries an inline SUPERSEDED note repeating these mappings. History is annotated, not deleted.

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 001. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — the SpecKit + V-Model artifacts already existed before Product Forge was layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect the existing `spec.md`, `plan.md`, `v-model/`, and `data-model.md`.
2. Whether the new artifacts surface any gaps, contradictions, or stale assumptions in the upstream artifacts.
3. Whether the Must Have / Should Have / Could Have decomposition in `product-spec/product-spec.md` matches the user's true product priorities.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge bootstrap pilot)
**Trigger**: User-authorized pilot bootstrap of feature 001.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/)
- [product-spec/metrics.md](./product-spec/metrics.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                               |
| -------------------- | --------------------------------------------------------------- |
| competitors.md       | Web research + general product knowledge                        |
| ux-patterns.md       | Standard product UX literature                                  |
| codebase-analysis.md | `plan.md`, `data-model.md`, root `package.json`                 |
| tech-stack.md        | `plan.md`, `research.md` (RQ-1..RQ-9)                           |
| metrics-roi.md       | `spec.md` NFR section, `v-model/requirements.md`                |
| product-spec.md      | `spec.md` user stories + FR-001..045, `v-model/requirements.md` |
| user-journey.md      | `spec.md` user stories P1/P2/P3                                 |
| wireframes/          | `spec.md` FRs + clarifications C-001..007                       |
| metrics.md           | `spec.md` NFRs + Must Have story acceptance criteria            |

**User feedback**: User elected **skip-approval** mode (2026-05-09); no per-question revision cycle requested.

**Corrections applied**: None (skip-approval).

**Approval status**: Approved (skip-approval mode, 2026-05-09).

---

## Pending Reviewer Questions (Deferred — NOT blocking approval)

1. **MoSCoW decomposition**: `product-spec.md` classifies stories as Must / Should / Could / Won't. Are the priorities correct, or should any move tier?
2. **Personas**: Bootstrapped 3 personas (Home Cook, Meal Planner, Recipe Sharer). Are these the right primary personas?
3. **Net-new stories**: Any stories in `product-spec.md` flagged "Net-new — needs FR added" must be confirmed and pushed back into `spec.md` before implementation.
4. **Metrics**: Story-level metrics in `product-spec/metrics.md` and portfolio-level metrics in `research/metrics-roi.md` — confirm targets are realistic.
5. **Competitive thesis**: `research/competitors.md` differentiation thesis — confirm it matches product strategy.

---

## Approval Marker

> **APPROVED** by user on 2026-05-09 (skip-approval mode).
> Revision: 1
> Notes: Bootstrap artifacts accepted as-written. Per-question revision cycle waived. Cross-feature consistency findings folded in (see Revision 1 below). Pending reviewer questions remain as deferred follow-ups.

---

## Revision 1 — Cross-Feature Consistency Fold-In (2026-05-09)

> **SUPERSEDED (2026-07-06).** The CR-001 rows and correction checklist below standardize the public API on an `/api/v1/*` prefix — that is **REVERSED**: the canonical prefix is bare **`/v1/*`**. Likewise every `@kitchensink/shared-recipe-core` reference here is **SUPERSEDED → `@kitchensink/recipe-core`**. Entries preserved verbatim as history.

**Source**: [cross-feature-consistency-report.md](../cross-feature-consistency-report.md)

| ID     | Severity | Issue                                                                           | Decision for 001                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CR-001 | Critical | API prefix collision: `001` previously used `/api/*`; `002`-`010` used `/v1/*`. | ~~**001 is canonical.** Downstream features must align to `/api/v1/*`.~~ **SUPERSEDED** by portfolio standard S-001 (adopted during 002 revalidation, 2026-05-09). The canonical pattern is `/api/v1/v{N}/*` — both segments required. **001 must add the `/v1` segment**: `contracts/api.openapi.yaml` has been updated from `/api/*` to `/api/v1/*` for implementation handoff. This is a **blocking correction** for 001's engineering handoff. See `governance-rules.md` GR-002. |
| CR-002 | Critical | Missing shared `shared/recipe-core` type library.                               | **001 owns the contract.** A task to create and publish `@kitchensink/shared-recipe-core` must be added to `001/tasks.md` as the first implementation task, before any API or UI work. This is a **blocking correction** for 001's engineering handoff. See `governance-rules.md` GR-007.                                                                                                                                                                                            |
| WA-001 | Warning  | Node.js version mismatch (`002` says 22.x; root `>=24.x`).                      | No 001 impact. Recorded for `002` revalidation.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WA-003 | Warning  | FR numbering collisions across features.                                        | 001 retains `FR-001..045`. Cross-feature references to 001 FRs must use the `001-FR-NNN` format. A `specs/cross-feature-FR-index.md` must be created before Phase 2 begins. See `governance-rules.md` GR-003.                                                                                                                                                                                                                                                                        |
| WA-005 | Warning  | Offline/sync strategy only defined in `008`.                                    | 001 should reference `008`'s offline contract once `008` revalidation lands. A `docs/offline-strategy.md` must be created before any feature with offline requirements enters implementation. See `governance-rules.md` GR-005.                                                                                                                                                                                                                                                      |

**Corrections to 001 artifacts required before engineering handoff**:

- [x] `contracts/api.openapi.yaml` — updated all paths from `/api/*` to `/api/v1/*` (GR-002).
- [x] `tasks.md` — added contract-first task to create and publish `@kitchensink/shared-recipe-core` before API/UI implementation (GR-007).
- [x] `spec.md`, `plan.md`, and related Product Forge/V-Model docs — updated public API path references to `/api/v1/*`.

**Approval status**: Approved (skip-approval, 2026-05-09). Corrections above are now resolved for documentation handoff. Implementation remains `not-started`; release readiness still depends on real implementation and V-Model execution evidence.

---

## Revision 2 — Governance Correction (2026-05-10)

**Author**: Senior Product Owner (cross-feature governance)
**Trigger**: Director review rejection — release audits contradicted their own data; CR-001 decision in Revision 1 was incorrect.

> **SUPERSEDED (2026-07-06).** This revision adopts the `/api/v1/v{N}/*` portfolio pattern and the `@kitchensink/shared-recipe-core` package name — both **overtaken by the reconciliation pass**: canonical prefix is bare **`/v1/*`** and the package is **`@kitchensink/recipe-core`**. The corrections below are retained as history; do not treat the `/api/v1` handoff items as open work.

### Corrections Applied

1. **CR-001 decision reversed**: Revision 1 incorrectly stated "001 is canonical" and that downstream features should align to `/api/v1/*`. The portfolio standard S-001 (adopted during 002 revalidation on 2026-05-09) established `/api/v1/v{N}/*` as the canonical pattern. Feature 001 must add the `/v1` segment to its OpenAPI contract — it is not exempt from the standard it helped establish. The Revision 1 table entry has been corrected in-place with a strikethrough and supersession note.

2. **CR-002 framing corrected**: The original decision said "not a 001 bootstrap blocker." This is true for the bootstrap phase but was misleading about handoff. The correction clarifies that creating `@kitchensink/shared-recipe-core` is a **blocking** prerequisite for engineering handoff, not merely a follow-up task.

3. **Status updated**: Review status changed from "Pending initial human review" to "Approved with blocking corrections pending" to accurately reflect the current state.

### Blocking Corrections for Engineering Handoff

These items must be resolved before 001 enters implementation:

| Item                                                                   | Rule   | Status                 |
| ---------------------------------------------------------------------- | ------ | ---------------------- |
| Update `contracts/api.openapi.yaml` paths from `/api/*` to `/api/v1/*` | GR-002 | ✅ Resolved 2026-05-13 |
| Add `@kitchensink/shared-recipe-core` creation task to `tasks.md`      | GR-007 | ✅ Resolved 2026-05-13 |
| Update `spec.md` and `plan.md` API path references                     | GR-002 | ⬜ Pending             |

### Governance Reference

All cross-feature governance rules are now formally defined in [`../governance-rules.md`](../governance-rules.md). That document is the authoritative source for acceptance criteria and violation definitions.
