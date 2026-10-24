# Product Forge Revalidation Log: Feature 006

**Branch**: `006-meal-planning`
**Created**: 2026-05-09
**Status**: Pending initial human review
**Mode**: Retroactive bootstrap
**Milestone**: `M4` Helm's Deep
**Public Launch**: Beta (end of `M4`)
**Launch Plan**: [`v1-launch-plan.md`](../v1-launch-plan.md)

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 006. Each revision captures user feedback, corrections applied, and explicit approval status.

This feature was **retroactively bootstrapped** — `spec.md`, `plan.md`, `research.md`, `tasks.md`, and `v-model/requirements.md` existed before Product Forge artifacts were generated. Revalidation focuses on:

1. Whether `research/` and `product-spec/` faithfully represent existing upstream artifacts.
2. Whether any contradictions or missing requirements are surfaced without inventing behavior.
3. Whether MoSCoW prioritization and UX scope (weekly/monthly planner, drag-drop scheduling, nutrition goals, family sizing, leftovers) match product intent.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus-Junior
**Trigger**: User-requested retroactive Product Forge bootstrap for feature `006-meal-planning`.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [research/README.md](./research/README.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/metrics.md](./product-spec/metrics.md)
- [product-spec/README.md](./product-spec/README.md)
- [product-spec/wireframes/README.md](./product-spec/wireframes/README.md)
- [product-spec/wireframes/planner-week.md](./product-spec/wireframes/planner-week.md)
- [product-spec/wireframes/planner-month.md](./product-spec/wireframes/planner-month.md)
- [product-spec/wireframes/plan-create.md](./product-spec/wireframes/plan-create.md)
- [product-spec/wireframes/plan-templates.md](./product-spec/wireframes/plan-templates.md)
- [product-spec/wireframes/plan-shopping-handoff.md](./product-spec/wireframes/plan-shopping-handoff.md)

**Synthesis sources**:

| Bootstrapped File               | Primary Source(s)                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `research/competitors.md`       | Existing `research.md` RQ-1 + requested competitor set (Plan To Eat, Mealime, PlateJoy, eMeals) |
| `research/ux-patterns.md`       | Existing `research.md` RQ-2/RQ-4/RQ-5 + `plan.md` drag-drop/calendar architecture               |
| `research/codebase-analysis.md` | Root `package.json`, `AGENTS.md`, `plan.md`, `tasks.md`                                         |
| `research/tech-stack.md`        | Existing `research.md` RQ-4..RQ-9 + `plan.md` integration choices                               |
| `research/metrics-roi.md`       | `spec.md` NFR-001..004 + SC-008 + `tasks.md` coverage                                           |
| `product-spec/product-spec.md`  | `spec.md` FR-022..027 + acceptance scenarios + edge case                                        |
| `product-spec/user-journey.md`  | `spec.md` user story + acceptance scenarios 1..5 + `plan.md` API flow                           |
| `product-spec/metrics.md`       | `spec.md` FR/NFR/SC + `tasks.md` implementation/test coverage                                   |
| `wireframes/*`                  | User-provided wireframe set + `spec.md` FRs + `plan.md` component model                         |

**User feedback**: _Pending at the time of Revision 0._

**Corrections applied**: None in Revision 0.

**Approval status**: ⏳ Superseded by Revision 1.

---

### Revision 1 — Codebase Reconciliation (2026-08-02)

**Trigger**: Owner-requested review of feature 006 against latest `main`, followed by a directive to fix the documents
in their entirety, treating **the codebase as the source of truth unless it is obviously wrong**.

**Context**: Revision 0 was produced on 2026-05-09, **before features 001, 002 and 003 shipped**. Its five pending
reviewer questions had remained open for nearly three months, and in the interim the platform moved far enough that six
documents were internally consistent with each other and collectively wrong about the system.

#### The five Revision-0 questions — now answered

| #   | Question                              | Decision                                                                                                                                                                                                                                                                                                                                    | Recorded as     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | MoSCoW priorities correct for launch? | **Revised.** Premium AI moves from Should/Could to **Phase 2, deferred**; the Home widget is promoted to Must (001 already ships a placeholder for it); templates become Should.                                                                                                                                                            | product-spec.md |
| 2   | Promote templates to an FR?           | **Yes.** Templates are **FR-028**. Cheap, because a template is a projection of a plan that already exists, and it addresses the main reason users abandon meal planners.                                                                                                                                                                   | C-006-008       |
| 3   | Leftovers and family sizing as FRs?   | **Split.** Family sizing is **FR-030** (entry `servings` — no separate household model). Leftovers are **out of scope**: they need a consumption model no requirement drives.                                                                                                                                                               | C-006-008       |
| 4   | Weekly/monthly parity?                | **Confirmed**, and extended: parity is required across **web and mobile**, not just across views. Mobile replaces the week grid with a day list (FR-034).                                                                                                                                                                                   | C-006-010       |
| 5   | Premium paywall/upsell UX?            | **Deferred — and the question was unanswerable as posed.** The premium gate cannot be enforced today: `subscriptionTier` lives in the identity `accounts` table, while the token's `public_metadata` carries only `scopes`/`permissions`. A guard reading `tier` from the token would deny every user. No premium surface ships in Phase 1. | C-006-009       |

Question 5 is the one worth dwelling on: it assumed a mechanism that does not exist. Answering it as asked would have
produced a designed paywall on top of an entitlement that cannot be checked.

#### Corrections applied

Every artifact in the feature was rewritten or regenerated. The load-bearing changes:

| Area             | Revision 0                                               | Revision 1                                                                      |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Owning package   | `packages/api/` (an empty non-workspace)                 | `@kitchensink/meal-plan-service` + 3 companion packages (C-006-001)             |
| Nutrition        | Per-ingredient USDA fetch + snapshot table + Redis cache | Pure fold over recipe-level nutrition, one batch call, no cache (C-006-003/005) |
| Data model       | FKs to `users` and `recipes`                             | ULID owner, no FK; no cross-database FK (C-006-002)                             |
| Orphan handling  | Cascade/flag with no detection mechanism                 | Detected at read time; no event bus needed (C-006-006)                          |
| Lock/finalize    | Implemented **and** listed as an open question           | Dropped (C-006-007)                                                             |
| Premium AI       | Should/Could-have, designed                              | Phase 2, deferred, blockers named (C-006-009)                                   |
| Mobile           | Absent                                                   | Full parity — wireframe, 29 component tests, 6 Maestro flows (C-006-010)        |
| Home widget      | Not mentioned                                            | FR-035, retiring the placeholder 001 already ships (C-006-011)                  |
| Tests            | Phase 8, after implementation                            | 24 test-first pairs; all six mandated categories present                        |
| Success criteria | 1                                                        | 5, three machine-checked                                                        |

#### Verification

`verify-report.md` and `sync-report.md` were re-run with a **new L8 layer that reads the repository**. The previous runs
were doc↔doc only, which is why both reported PASS over a plan targeting a directory that does not exist.

#### Owner rulings — 2026-08-02

The three MAJOR peer-review findings were put to the owner and all three are closed. Recording the rulings, because two
of them changed what the review was even about:

1. **PRF-006-11 — plan span.** _Ruling: not a concern._ The 90-day maximum stands with **no separate latency target**;
   the p95 target stays at 30 days. Consequence, recorded rather than buried: the 90-day k6 profile now asserts
   **bounded fan-out only** and carries no p95. That is arguably the better test anyway — bounded fan-out goes red the
   moment an N+1 regresses, which is the failure that actually matters here.
2. **PRF-006-12 — cross-feature acceptance.** _Ruling: the premise was wrong._ The recipe service and 006 have the
   **same owner**, so there is no second party to obtain acceptance from and no `006 → 001` registry row is needed. The
   finding is closed as invalid rather than satisfied. What survives is the part that was never about ownership: T001–T003
   modify a **deployed** service, so the change stays strictly additive and is covered by contract tests that fail in the
   recipe service's own CI.
3. **PRF-006-13 — the cross-feature FR index.** _Ruling: fix it._ Applied. Beyond flipping the three rows to `Deferred`,
   the registry gained a **Status Values** section (every row previously said `Active`, so the column carried no
   information), a **Deferral Notes** entry recording the mutual 006 ↔ 010 dependency, and **Review Rule 5** requiring
   future deferrals to flip their rows in the same change set. The first three are one-off corrections; the rule is the
   durable fix.

**PRF-006-16** (endpoint path) closed alongside them: as owner of the recipe service, the path is settled on the
platform's plain-segment convention, `POST /api/v1/recipes/nutrition-batch`, applied across all ten references.

#### The four MINOR findings — also closed, rather than deferred into implementation

The natural move was to push these into the build. They were resolved instead, because three of the four turned out to
be more than bookkeeping:

- **PRF-006-14 (derived scenario counts)** — enumerated every id rather than trusting the abbreviated ranges. **Every
  published figure was wrong**: 357 scenarios, not 341. The release audit had also double-counted 19 tests by listing
  Playwright/Maestro/k6 as rows alongside the System total that already contains them.
- **PRF-006-15 (component-matrix arithmetic)** — recounted cell-by-cell: **81 component tests (40 web, 41 mobile)**,
  not 63/34/29. Low by 29%. That one mattered: SC-006-004 measures 100% coverage against this denominator, so the
  wrong number would have read as complete with 18 tests missing.
- **PRF-006-17 (idempotency retention)** — needed a real decision, not a note. `pg_cron` is not enabled here and every
  other scheduled task on this platform is a Lambda or ECS task, which REQ-NF-009 forbids for this feature. Resolved
  with **24 h retention and a bounded (`LIMIT 50`), owner-scoped opportunistic prune** in the write's own transaction —
  no infrastructure, self-limiting, and it cannot hold data past an erasure.
- **PRF-006-18 (thin GDPR erasure coverage)** — added **ATS-006-I2** (mobile entry point reaching the _same_ mechanism,
  which a web-only scenario cannot catch) and **ATS-006-I3** (re-driven partial erasure).

`plan.md` also now **decides the Fargate task sizing**, so the per-PR cost figure derives from a stated configuration
instead of an analogy (PRF-006-21).

**T068–T070 stay in `tasks.md`**, reframed as _post-deploy confirmations_ — re-reconcile the counts against the real
test files once they exist, and confirm cost from billing data.

**Approval status**: ✅ Revision 1 complete. **All 13 peer-review findings closed; no warnings open.** Implementation
may begin at T001.

---

## Approval Marker

> **CLEARED TO IMPLEMENT (2026-08-02).** Revision 1 is complete and internally verified. All four pre-implementation
> gates (PRF-006-11, -12, -13, -16) are closed by owner ruling; the remaining four MINOR findings are during-
> implementation work and gate nothing. Formal sign-off on the artifact set itself is still the owner's to give.

When approved, replace this block with:

```
> APPROVED by <reviewer> on <date>.
> Revision: <N>
```
