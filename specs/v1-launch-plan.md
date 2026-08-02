# KitchenSink v1 Launch Plan

**Version**: 1.0.0
**Ratified**: 2026-05-12
**Authority**: Director of Product (Sisyphus, acting)
**Scope**: Features `001`–`014`
**Status**: Active — supersedes ad-hoc launch sequencing
**Related governance**: [`governance-rules.md`](./governance-rules.md), [`cross-feature-consistency-report.md`](./cross-feature-consistency-report.md)
**Live verify state**: [`verify-snapshot.md`](./verify-snapshot.md) (refreshed each verification wave)
**Executive packet**: [`executive/README.md`](./executive/README.md)

---

## 1. Purpose

This document is the canonical launch plan for v1 of KitchenSink. It defines:

1. The complete v1 scope (all 14 features).
2. The milestone ladder (`M0`–`M8`) with internal codenames, feature assignments, entry criteria, artifact remediation work, and exit criteria.
3. The two public-facing launch gates: **Commise Beta** (end of `M4`) and **Commise 1.0** (end of `M6`).
4. Parallelization rules between milestones.
5. Milestone-to-feature traceability so each feature's `review.md` can reference its milestone.

If anything in this document conflicts with a per-feature `review.md`, **this document wins** for sequencing decisions; the per-feature `review.md` wins for product-content decisions.

---

## 2. v1 Scope

All 14 features are in v1 scope. No features are deferred to v2.

| Feature | Title                     | Owner Milestone   | Public Launch    |
| ------- | ------------------------- | ----------------- | ---------------- |
| `001`   | Commise Recipe App (core) | `M1` Rivendell    | Beta             |
| `002`   | Clerk User Auth           | `M0` Shire        | Beta             |
| `003`   | USDA Food Data            | `M1` Rivendell    | Beta             |
| `004`   | Recipe Importing          | `M1` Rivendell    | Beta             |
| `005`   | AI Integration            | `M5` Isengard     | 1.0              |
| `006`   | Meal Planning             | `M4` Helm's Deep  | Beta             |
| `007`   | Grocery Lists             | `M3` Rohan        | Beta             |
| `008`   | Cooking Mode              | `M3` Rohan        | Beta             |
| `009`   | Nutrition Planning        | `M5` Isengard     | 1.0              |
| `010`   | Subscriptions             | `M6` Gondor       | 1.0              |
| `011`   | Recipe Digitization       | `M2` Moria        | Beta             |
| `012`   | Creator Profiles          | `M7` Minas Tirith | Post-1.0 (in v1) |
| `013`   | Cooking School            | `M7` Minas Tirith | Post-1.0 (in v1) |
| `014`   | Notification Service      | `M8` Mordor       | Post-1.0 (in v1) |

---

## 3. Milestone Ladder

Internal codename convention: `Milestone <Cool Name>` (Tolkien locations, west-to-east journey).

Each milestone has three required sections: **Entry**, **Artifact Remediation**, **Exit**. A milestone is not done until every Exit criterion is satisfied with linkable evidence.

### 3.1 `M0` — Milestone Shire

**Features**: `002` Clerk User Auth
**Theme**: Foundational identity. Nothing else can be built without this.

**Entry**:

- This launch plan ratified (this document committed to `main`).
- All engineering tracks aware of milestone assignments.

**Artifact Remediation**:

- Burn down `002` `verify-report.md`: 6 critical / 2 warning → 0 / 0.
- Regenerate `002` V-Model artifacts; close 278 untested rows + 59 missing trace refs in `traceability-matrix.md`.
- Execute `002` V-Model test suite (`acceptance-plan.md`, `system-test.md`, `integration-test.md`, `unit-test.md`); attach executed evidence.

**Exit**:

- `002/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `002/v-model/release-audit-report.md` is no longer blocked under [GR-001](./governance-rules.md#gr-001-release-readiness-gate).
- Clerk hosted sign-in/sign-up flow demonstrably works on web and mobile in `dev` and `staging`.

---

### 3.2 `M1` — Milestone Rivendell

**Features**: `001` core recipe app, `003` USDA food data, `004` recipe importing
**Theme**: Recipes and ingredients. The product without these is not the product.

**Entry**:

- `M0` Exit met.

**Artifact Remediation**:

- **`001`**:
    - Resolve the two architectural blockers called out in `specs/001-commise-recipe-app/review.md`: API URL prefix collision (see [GR-002](./governance-rules.md#gr-002-api-url-prefix-standard)) and missing `shared/recipe-core` type library (see [GR-007](./governance-rules.md#gr-007-shared-type-library-ownership)).
    - Burn down `verify-report.md`: 5 critical / 2 warning → 0 / 0.
    - Close 337 untested + 178 missing trace refs.
- **`003`**: Burn down 1 critical / 2 warning → 0 / 0. Close 131 untested + 107 missing trace refs.
- **`004`**: Burn down 1 critical / 2 warning → 0 / 0. Close 93 untested + 43 missing trace refs.
- V-Model regen + test execution for all three.

**Exit**:

- `001`, `003`, `004` `verify-report.md` all show `0 CRITICAL, 0 WARNING`.
- All three release-audit reports unblocked.
- Demonstrable end-to-end against real data: create a recipe, attach an ingredient pulled from USDA, import a recipe from a URL.
- `shared/recipe-core` type library exists and is consumed by every downstream feature spec that references recipe entities.

---

### 3.3 `M2` — Milestone Moria

**Features**: `011` Recipe Digitization
**Theme**: OCR / photo-to-recipe. Runs **in parallel** with `M3`.

**Entry**:

- `M1` recipe data model frozen (so the OCR pipeline targets a stable schema).
- Engineering capacity confirmed for a parallel track. If capacity is unavailable, `M2` runs **after** `M3` instead.

**Artifact Remediation**:

- ~~Generate `011/verify-report.md`~~ — **it exists** (verified 2026-08-02), alongside `sync-verify-report.md`, `analyze-report.md`, and `pre-impl-review.md`; the 2026-05-12 claim that it was absent is stale.
- Burn down findings to `0 CRITICAL, 0 WARNING`.
- Close 128 untested + 117 missing trace refs in `011/v-model/traceability-matrix.md`.
- V-Model regen + test execution.
- Add a documented OCR-accuracy benchmark on a labeled corpus to test evidence; baseline accuracy floor must be set before promotion to Beta.

**Exit**:

- `011/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `011/v-model/release-audit-report.md` unblocked.
- Photo-to-recipe demonstrably works on web and mobile against the labeled corpus at the documented accuracy floor.

---

### 3.4 `M3` — Milestone Rohan

**Features**: `008` Cooking Mode, `007` Grocery Lists
**Theme**: The two surfaces a user touches per recipe. Runs **in parallel** with `M2`.

**Entry**:

- `M1` Exit met.

**Artifact Remediation**:

- **`008`**: Burn down 4 critical / 2 warning → 0 / 0. Close 76 untested + 70 missing trace refs.
- **`007`**: Burn down 4 critical / 2 warning → 0 / 0. Close 113 untested + 48 missing trace refs.
- V-Model regen + test execution for both.
- Confirm offline-mode contract per [GR-005](./governance-rules.md#gr-005-offline-and-sync-strategy) (`008` is the named owner).

**Exit**:

- Both `verify-report.md` files show `0 CRITICAL, 0 WARNING`.
- Both release-audit reports unblocked.
- Real user can step through Cooking Mode for a recipe and generate a grocery list from a recipe or selection.

---

### 3.5 `M4` — Milestone Helm's Deep → **Commise Beta**

**Features**: `006` Meal Planning
**Theme**: Closes the planning loop. Last feature before public Beta.

**Entry**:

- `M2` Exit met.
- `M3` Exit met.

**Artifact Remediation**:

- Burn down `006/verify-report.md`: 4 critical / 3 warning → 0 / 0.
- Close 121 untested + 41 missing trace refs.
- V-Model regen + test execution.

**Exit (per-feature)**:

- `006/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `006/v-model/release-audit-report.md` unblocked.

**Exit (milestone — Beta gate)**:

- All Beta-launch criteria in [`beta-exit-criteria.md`](./beta-exit-criteria.md) §"Beta Launch Readiness" are met.

---

### 3.6 `M5` — Milestone Isengard

**Features**: `005` AI Integration, `009` Nutrition Planning
**Theme**: Intelligence and nutrition. Built **after** Beta is in market so we can size cost and tune from real signal.

**Entry**:

- Commise Beta in market for at least 14 calendar days with telemetry collected against the metrics defined in [`beta-exit-criteria.md`](./beta-exit-criteria.md) §"Beta Exit Criteria for 1.0 Promotion".
- AI cost-per-active-user projection from Beta usage available.

**Artifact Remediation**:

- **`005`**:
    - Burn down `verify-report.md`: 3 critical / 3 warning → 0 / 0. Close 176 untested + 12 missing trace refs.
    - Confirm [GR-010 EU AI Act compliance propagation](./governance-rules.md#gr-010-eu-ai-act-compliance-propagation) hooks are present.
    - AI cost guardrails (per-user quotas, per-call ceiling, model fallback) MUST appear in test evidence.
- **`009`**: Burn down 3 critical / 2 warning → 0 / 0. Close 187 untested + 14 missing trace refs.
- V-Model regen + test execution for both.

**Exit**:

- Both `verify-report.md` files show `0 CRITICAL, 0 WARNING`.
- Both release-audit reports unblocked.
- AI features stable in Beta cohort with cost-per-active-user inside the projected band.
- Nutrition tracking demonstrably accurate against a USDA-backed reference set.

---

### 3.7 `M6` — Milestone Gondor → **Commise 1.0**

**Features**: `010` Subscriptions
**Theme**: Monetization. Last feature before 1.0 promotion.

**Entry**:

- `M5` Exit met.
- Beta exit criteria in [`beta-exit-criteria.md`](./beta-exit-criteria.md) met.

**Artifact Remediation**:

- Burn down `010/verify-report.md`: 1 critical / 6 warning → 0 / 0. Close 127 untested + 36 missing trace refs.
- Confirm subscription gating mechanism per [GR-012](./governance-rules.md#gr-012-subscription-gating-mechanism).
- **Ship `010-FR-044` — the subscription tier as a signed token claim.** Without it `@RequirePremium()` is enforceable only inside the identity service. It needs no merchant capability, and it unblocks all entitlement gating: `012-FR-034`/`035`/`039`, 013 course access control, and the three rows 006 deferred (`006-FR-025`–`027`).
- **Decide the marketplace-payments question.** This is the _compensation_ half only — anything that moves money **to a creator**: tips (`012-FR-031`–`033`), purchased access (`012-FR-036`), creator-priced tiers (`012-FR-037`–`038`), earnings (`012-FR-040`), and `013-FR-010`'s 20%/80% share. Either bring it into 010's scope here or stand up a dedicated payments feature; `M7` monetization is blocked on the answer, but `M7` _gating_ is not.
- V-Model regen + test execution.
- Add a payments-compliance review: PCI scope assessment, SCA support, refund / cancel / dunning flows tested against sandbox cards on web and mobile (incl. App Store / Play Store IAP if applicable).

**Exit (per-feature)**:

- `010/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `010/v-model/release-audit-report.md` unblocked.

**Exit (milestone — 1.0 gate)**:

- All 1.0-promotion criteria in [`beta-exit-criteria.md`](./beta-exit-criteria.md) §"1.0 Promotion Readiness" are met.
- Beta-to-1.0 user migration plan executed.

---

### 3.8 `M7` — Milestone Minas Tirith

**Features**: `012` Creator Profiles, `013` Cooking School
**Theme**: Audience-side surfaces. Post-1.0 but still in v1 scope.

**Entry**:

- 1.0 GA stable for at least one billing cycle.

**Artifact Remediation**:

- **`012`**:
    - ~~Generate `plan.md`, `tasks.md`, `review.md`, `verify-report.md`~~ — **all four now exist** (verified 2026-08-02); the 2026-05-12 claim that none existed is stale.
    - Burn down findings to `0 CRITICAL, 0 WARNING`.
    - Close 102 untested + 32 missing trace refs.
    - Integrate creator monetization tier with `010` subscription gating.
    - ~~**Author FRs for the monetization surface.**~~ Done 2026-08-02 — `012-FR-031` … `012-FR-040` (tip jar, premium recipes, paid follows, earnings surface) authored as **DRAFT**.
    - ⚠️ **Marketplace payments are unspecified — this blocks creator COMPENSATION, not gating.** 010 provides no one-time payments, per-item purchases, creator-defined tiers, revenue splitting, or payouts (its scope is `010-FR-040`…`044`). Blocked: `012-FR-031`–`033`, `012-FR-036`–`038`, `012-FR-040`, and `013-FR-010`. **Not blocked**: `012-FR-034`/`035`/`039` and 013 course access control, which need only `010-FR-044`. Marketplace payments need their own spec, including the money-transmission and tax posture that splitting third-party revenue implies.
- **`013`**:
    - ~~Generate `plan.md`, `tasks.md`, `review.md`, `verify-report.md`~~ — **all four now exist** (verified 2026-08-02); the 2026-05-12 claim that none existed is stale.
    - Burn down findings to `0 CRITICAL, 0 WARNING`.
    - Close 204 untested + 34 missing trace refs.
- V-Model regen + test execution for both.
- Confirm audience and sharing model per [GR-014](./governance-rules.md#gr-014-audience-and-sharing-model).

**Exit**:

- Both `verify-report.md` files show `0 CRITICAL, 0 WARNING`.
- Both release-audit reports unblocked.
- Creators can publish; school courses can be enrolled in; both gated behind appropriate subscription tiers.

---

### 3.9 `M8` — Milestone Mordor → **v1 Complete**

**Features**: `014` Notification Service
**Theme**: Cross-cutting plumbing. Largest test-evidence gap in the package; the long pole.

**Entry**:

- `M7` Exit met.
- If a notification surface inside `M3`–`M7` is judged blocking before `M7` exit, `M8` MAY be resequenced to start earlier with explicit Director-of-Product approval recorded in this document.

**Artifact Remediation**:

- ~~Generate `plan.md`, `tasks.md`, `review.md`, `verify-report.md`~~ — **all four now exist** (verified 2026-08-02); the 2026-05-12 claim that none existed is stale.
- Burn down findings to `0 CRITICAL, 0 WARNING`.
- Close 620 untested + 31 missing trace refs (largest gap in the portfolio).
- Confirm notification system ownership per [GR-011](./governance-rules.md#gr-011-notification-system-ownership).
- Integrate notification hooks back into `006`, `007`, `008`, `010`, `012`, `013`.
- V-Model regen + test execution.

**Exit**:

- `014/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `014/v-model/release-audit-report.md` unblocked.
- Push, email, and in-app notifications demonstrably live across all integrated surfaces.
- **v1 COMPLETE**.

---

## 4. Parallelization Rules

| Pair                 | Allowed in parallel?           | Reason                                                          |
| -------------------- | ------------------------------ | --------------------------------------------------------------- |
| `M0` ↔ anything      | No                             | Auth gates everything.                                          |
| `M1` ↔ anything else | No                             | Recipe data model must freeze before downstream surfaces lock.  |
| `M2` ↔ `M3`          | **Yes** (decision: 2026-05-12) | Independent surfaces; both depend only on `M1`.                 |
| `M3` ↔ `M4`          | No                             | Meal planning consumes both cooking and grocery surfaces.       |
| `M4` ↔ `M5`          | **No**                         | Beta must produce real signal before AI sizing is locked.       |
| `M5` ↔ `M6`          | No                             | Subscription gating depends on the AI/nutrition tiers it gates. |
| `M6` ↔ `M7`/`M8`     | No                             | 1.0 must be GA-stable before audience-side surfaces ship.       |
| `M7` ↔ `M8`          | **Yes**, capacity permitting   | Independent post-1.0 surfaces.                                  |

---

## 5. Public Launch Progression

1. **Commise Beta** — limited launch at end of `M4`. Invite/waitlist gated. Includes features `001`–`004`, `006`, `007`, `008`, `011`. **Does not** include AI (`005`), nutrition (`009`), or paid tier (`010`).
2. **Commise 1.0** — promotion at end of `M6`. Adds `005`, `009`, `010`. Public sign-up open.
3. **Post-1.0 v1 increments** — `M7` adds `012` + `013`; `M8` adds `014`. v1 is "complete" only when `M8` exits.

---

## 6. Decision Log

| Date       | Decision                                                                                                                                                                                                                                                                            | Decided by          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 2026-05-12 | Full `001`–`014` package stays in v1 scope (no deferral to v2).                                                                                                                                                                                                                     | Director of Product |
| 2026-05-12 | Auth (`002`) ships first; recipes/ingredients (`001`, `003`, `004`) ship next.                                                                                                                                                                                                      | Director of Product |
| 2026-05-12 | `005` AI work is concentrated in `M5`, after Beta — no AI carve-out into earlier milestones.                                                                                                                                                                                        | Director of Product |
| 2026-05-12 | `011` Recipe Digitization assigned to `M2`, runs in parallel with `M3`.                                                                                                                                                                                                             | Director of Product |
| 2026-05-12 | Commise Beta is the public-launch event at end of `M4`; `006` is in Beta.                                                                                                                                                                                                           | Director of Product |
| 2026-05-12 | Commise 1.0 is the public-launch event at end of `M6`; gated by Beta exit criteria.                                                                                                                                                                                                 | Director of Product |
| 2026-05-12 | Internal milestone naming convention adopted: `Milestone <Cool Name>` (Tolkien locations).                                                                                                                                                                                          | Director of Product |
| 2026-08-02 | GR-002 upheld portfolio-wide with **no exceptions**: `007`–`014` normalized to `/api/v1/*`; `004` and `006` correcting in their own branches; shipped `main` migrating under separate work. 006's PRF-006-16 (plain-segment) is superseded — a feature spec does not own a service. | Owner               |
| 2026-08-02 | GR-003 upheld as _locality + qualified cross-refs_; FR IDs **not** renumbered to 1-based, matching `004`/`005`/`006` precedent. `007`↔`008` FR-032/033 collision fixed by qualification.                                                                                            | Owner               |

---

## 7. Per-Feature `review.md` Header

Every per-feature `review.md` MUST carry a "Milestone Assignment" section near the top with the following keys, sourced from §2 of this document:

```markdown
## Milestone Assignment

- **Milestone**: `M<n>` <Codename>
- **Public launch**: Beta | 1.0 | Post-1.0 (in v1)
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: <YYYY-MM-DD>
```

If sequencing changes, this document is updated first; per-feature `review.md` files follow.

---

## 8. Open Items

- [ ] Numerical thresholds in [`beta-exit-criteria.md`](./beta-exit-criteria.md) (DAU/WAU floor, crash-free %, NPS target, retention curve, AI cost-per-active-user band) — owned by Engineering Leadership + Product, due before `M4` exit.
- [ ] Engineering capacity confirmation for `M2`/`M3` parallel execution — owned by Engineering Leadership, due before `M1` exit.
- [ ] Beta invite/waitlist mechanism (Clerk instance/allowlist segmentation vs feature-flag) — owned by Engineering Leadership, due before `M4` exit.
- [ ] Payments compliance review scope (PCI level, tax jurisdictions, refund policy) — owned by Legal + Engineering Leadership, due before `M6` entry.
