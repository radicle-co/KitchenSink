# Pre-Implementation Review: Recipe Digitization & Family Circles

> Feature: `011-recipe-digitization` | Date: 2026-05-10
> Reviewer: Product Forge Pre-Impl Review Agent
> Status: **APPROVED WITH CONDITIONS**

## Summary

| Section             | Findings                                      |
| ------------------- | --------------------------------------------- |
| Design Review       | 4 issues (0 critical, 4 warning)              |
| Architecture Review | 3 issues (0 critical, 3 warning)              |
| Risk Assessment     | 9 risks (1 critical, 4 high, 3 medium, 1 low) |

**Recommendation:** **PROCEED WITH CONDITIONS** — implementation may begin in parallel with mitigation tasks listed in _Conditions for Approval_. The single critical risk (R-001 OCR accuracy ceiling) has a documented provider-pluggable mitigation path and is acceptable to enter Phase 6 with, provided NFR-001 / SC-001 acceptance gates are honored before release-readiness.

**Scope of this review:**

- Tasks: 92 (`T001`–`T092`).
- UI tasks present (Phase 7 — Frontend, `T057`–`T067`) → Design Review included.
- API + Backend + Lambda tasks present → Architecture Review included.
- External integrations (Clerk, Textract, S3, SQS, CloudFront, RDS) → Risk Assessment includes integration risks.

---

## Design Review

> Wireframe and high-fidelity mockup files (`product-spec/wireframes*`, `product-spec/mockups/`) do not exist in this feature's `product-spec/` directory. State completeness, UX pattern compliance, and accessibility pre-checks are evaluated against textual descriptions in `spec.md` (US-001…US-011, NFR-004), `product-spec/product-spec.md`, and `research.md` (UX patterns) instead of pixel-level designs. This is a known gap (D-001) and not a blocker.

### State Completeness

| Screen                                           | Happy |        Empty        | Loading | Error | Partial | Offline |
| ------------------------------------------------ | :---: | :-----------------: | :-----: | :---: | :-----: | :-----: |
| Upload entry (camera + file picker, web/mobile)  |  ✅   |         ✅          |   ✅    |  ✅   |   N-A   |   ⚠️    |
| Multi-photo bulk queue                           |  ✅   |         ✅          |   ✅    |  ✅   |   ✅    |   ⚠️    |
| Job list (history of digitizations)              |  ✅   |         ✅          |   ✅    |  ✅   |   N-A   |   ⚠️    |
| Side-by-side correction (US-002)                 |  ✅   |         N-A         |   ✅    |  ✅   |   ✅    |   ⚠️    |
| Low-confidence token highlight (US-008)          |  ✅   |         N-A         |   N-A   |  ✅   |   ✅    |   N-A   |
| Audience picker (Private + Circles, US-005)      |  ✅   | ✅ (no Circles yet) |   ✅    |  ✅   |   N-A   |   N-A   |
| Circle create (US-003)                           |  ✅   |         N-A         |   ✅    |  ✅   |   N-A   |   N-A   |
| Circle invite share + rotate link (US-003)       |  ✅   |         N-A         |   ✅    |  ✅   |   N-A   |   N-A   |
| Circle invite redemption / one-tap join (US-004) |  ✅   |         N-A         |   ✅    |  ✅   |   N-A   |   N-A   |
| Circle member list / management                  |  ✅   |         ✅          |   ✅    |  ✅   |   N-A   |   N-A   |
| Circle recipe list (member read view, US-006)    |  ✅   |         ✅          |   ✅    |  ✅   |   N-A   |   N-A   |

**Notes:**

- "Offline state" is marked ⚠️ for capture/queue/correction screens because mobile photo capture is realistic to attempt offline; spec/plan do not commit to an offline mode but the failure UX should be explicit. Captured as **D-002**.
- "Partial state" for the correction screen covers the OCR `awaiting-correction + low_quality` pathway (FR-011 / US-008); covered explicitly via T053 and T060.

### UX Pattern Compliance

| UX Recommendation (from `research.md`)                                                                        | Addressed in Plan/Tasks? | Notes                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | :----------------------: | -------------------------------------------------------------------------------------------------------------- |
| Side-by-side correction (left = original photo with pinch-to-zoom, right = parsed fields with inline editing) |            ✅            | T060 implements correction screen; US-002 AC requires simultaneous visibility.                                 |
| Low-confidence tokens highlighted by **colour AND icon/label** (NFR-004)                                      |            ✅            | T061 + FR-025; explicit non-color-only encoding.                                                               |
| Bulk-mode queue advances automatically                                                                        |            ✅            | T058 + US-007; queue surfaces remaining count.                                                                 |
| Confidence indicators on low-quality tokens                                                                   |            ✅            | US-008, FR-008, FR-009, FR-010 covered by T052.                                                                |
| "Accept all" for clean scans (US-009)                                                                         |        ⚠️ Partial        | US-009 listed in Should Have; no dedicated frontend task line beyond correction screen. Captured as **D-003**. |
| Frictionless one-tap invite acceptance (US-004)                                                               |            ✅            | T065 covers redemption; idempotency in T032.                                                                   |

### Accessibility Pre-Check (against NFR-004 / WCAG 2.1 AA)

| Check                                         | Status | Notes                                                                                                     |
| --------------------------------------------- | :----: | --------------------------------------------------------------------------------------------------------- |
| Color contrast (text on backgrounds)          |   ⚠️   | No mockups to evaluate; axe-core in CI (T067) catches programmatic checks; manual contrast review needed. |
| Touch target sizes (≥44×44 mobile)            |   ⚠️   | Not specified; correction-screen inline editing is touch-heavy. Add as design constraint.                 |
| Focus order logical                           |   ⚠️   | Side-by-side correction is the highest risk surface; needs explicit focus-trap + tab order plan.          |
| Screen reader landmarks defined               |   ✅   | NFR-004 + T067 require axe-core CI; manual VoiceOver/TalkBack on correction + Circle invite flows.        |
| Error messages descriptive                    |   ✅   | RFC7807 mandated by spec; correction validation surfaces field-level messages.                            |
| Form labels present                           |   ✅   | Correction fields are labeled inputs (US-002 AC).                                                         |
| Color-only encoding for low-confidence tokens |   ✅   | NFR-004 / FR-025 require colour **and** icon/label.                                                       |

### Component Reuse

| Existing Component / Pattern                      | Applicable For                                     |                         Reuse Planned?                         |
| ------------------------------------------------- | -------------------------------------------------- | :------------------------------------------------------------: |
| Clerk session-token middleware (from feature 002) | All `circles-api` + `digitization-api` controllers |                      ✅ T003, T026, T037                       |
| Drizzle migration tooling                         | Schema changes (T008–T018)                         |                               ✅                               |
| `packages/ui` shared components                   | Web correction screen, audience picker, Circle UI  |   ⚠️ Implicit; not explicitly enumerated in tasks. **D-004**   |
| RFC7807 error filter                              | All new API surfaces                               | ✅ T039 implied via NestJS conventions; verify in code-review. |
| `@aws-lambda-powertools/logger` + Sentry          | OCR Lambda observability                           |                          ✅ T077–T080                          |

### Design Findings

| ID    | Severity | Finding                                                                                                                                                 | Recommendation                                                                                                                                                                                                             |
| ----- | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | WARNING  | No wireframes or mockups exist in `product-spec/` (only textual descriptions). Visual fidelity, spacing, and contrast cannot be verified before coding. | Either (a) accept "code-first sketches reviewed in code-review" as the design gate and document it explicitly, or (b) produce low-fi wireframes for the correction screen and Circle invite flow before T060 / T065 begin. |
| D-002 | WARNING  | Offline behavior for capture/queue/correction is undefined. Mobile users attempting capture without connectivity will hit ambiguous failures.           | Add explicit offline-failure copy + retry behavior to upload/queue UI tasks (T057, T058). At minimum, fail fast with a clear "You're offline — your photo will not be saved" message.                                      |
| D-003 | WARNING  | "Accept all" for clean scans (US-009) is a Should-Have but has no dedicated task line in Phase 7.                                                       | Add a sub-task under T060 (correction screen) or a new T060a explicitly implementing the accept-all action and binding to the bulk-save endpoint.                                                                          |
| D-004 | WARNING  | Reuse of `packages/ui` shared components is implicit, not enumerated. Risk of duplicating components inside the digitization feature.                   | In T057–T067, require each task author to first check `packages/ui` for existing form, button, and modal primitives. Document any new primitives introduced and propose promotion to `packages/ui`.                        |

---

## Architecture Review

### Structural Checks

| Check                                                   | Status | Evidence                                                                                                                                             |
| ------------------------------------------------------- | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separation of concerns (controller/service/repo layers) |   ✅   | `plan.md` Phase 1 + tasks T026–T036 (Circles), T037–T048 (Digitization API) split controllers, services, and DB repositories.                        |
| Dependency direction correct (no circular deps)         |   ✅   | `@kitchensink/shared-audience` is a leaf consumed by 001/006/007/011 APIs; OCR Lambda writes to DB via internal client, not reverse-imported by API. |
| API contracts complete (request/response schemas)       |   ✅   | `plan.md` API Contracts section enumerates every endpoint with auth, FR, and pagination.                                                             |
| Data model consistent with `spec.md` entities           |   ✅   | `circles`, `circle_members`, `circle_invites`, `digitization_jobs`, recipe `audience` JSONB, `recipe_versions` all map to FR-006…FR-036.             |
| Migration strategy defined                              |   ✅   | T008–T018 enumerate Drizzle migrations with explicit indexes and transactional boundaries for FR-033 / FR-035.                                       |
| Error handling patterns defined                         |   ✅   | RFC7807 mandated by spec; circuit-breaker + DLQ for OCR (FR-013, NFR-001).                                                                           |
| Authentication/authorization approach defined           |   ✅   | Clerk session token (002 inheritance) on every endpoint; invitation token redemption requires authenticated user.                                    |
| Caching strategy defined                                |   ✅   | CloudFront for archived originals; no application-tier cache required at v1.                                                                         |

### Integration Point Validation

| Integration Point                                               |                              Plan Coverage                               | Risk Level |
| --------------------------------------------------------------- | :----------------------------------------------------------------------: | :--------: |
| Clerk (web + mobile + API session-token verification, from 002) |                          ✅ Covered (inherited)                          |     L      |
| AWS Textract (OCR provider)                                     |            ✅ Covered (T050 adapter, provider-pluggable seam)            |   **H**    |
| AWS S3 (presigned PUT for upload, archive originals)            |                         ✅ Covered (T039 + T086)                         |     M      |
| AWS SQS + DLQ (job dispatch + version-archive queue)            |                         ✅ Covered (T049, T085)                          |     M      |
| AWS CloudFront (CDN for archived originals)                     |                            ✅ Covered (T086)                             |     L      |
| AWS RDS PostgreSQL 16 (pg_trgm, JSONB, tsvector)                |                          ✅ Covered (T008–T018)                          |     M      |
| Feature 001 recipe persistence (`audience`, `recipe_versions`)  |               ✅ Covered (T015, T016, smoke test in spec)                |   **H**    |
| `@kitchensink/shared-audience` consumed by 001/006/007          | ✅ Covered (T019–T025); contract published before consumers depend on it |     M      |
| Feature 010 entitlement flag (Q-002 deferred)                   |              ⚠️ Partial — not implemented in v1; soft-gated              |     L      |

### NFR Coverage

| NFR                                                                                 | Plan Approach                                                      | Adequate? |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | :-------: |
| NFR-001: OCR p95 ≤ 10 s                                                             | Textract async + Lambda + SQS; CloudWatch latency dashboard (T077) |    ✅     |
| NFR-002: API p95 ≤ 300 ms (read), ≤ 800 ms (write)                                  | RDS indexes (T008–T018); cursor pagination on jobs/list            |    ✅     |
| NFR-003: Audit logging on Circle membership ops                                     | T034 + integration test in T070                                    |    ✅     |
| NFR-004: WCAG 2.1 AA, axe-core CI, manual VoiceOver/TalkBack on correction + invite | T067 + T076                                                        |    ✅     |
| NFR-005: Workspace + TS path aliases for new packages                               | T001 + T006                                                        |    ✅     |
| NFR-006: Queue health (depth, DLQ depth, retries)                                   | T077–T080 CloudWatch dashboards                                    |    ✅     |
| NFR-007: Invite token security (hashed, rotatable)                                  | T013 + T032; tokens stored as hashes                               |    ✅     |
| NFR-008: 90-day `raw_ocr_json` purge                                                | T082–T084 daily purge job                                          |    ✅     |

### Architecture Findings

| ID    | Severity | Finding                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                |
| ----- | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-001 | WARNING  | Workspace globs (`packages/api/*`, `packages/shared/*`) and TS project references for the four new packages are deferred to T001 / T006. If any earlier task is mistakenly merged before T001, the monorepo state will be inconsistent.   | Enforce strict task ordering: T001 must land in its own commit/PR before any T002–T005 scaffold PR. Add a CI guard that fails if a `packages/api/*` package is added without a matching workspace entry.                                      |
| A-002 | WARNING  | Circle owner-transfer race (US-010 / FR-035) and Circle-deletion → recipe rewrite (FR-033) require transactional guarantees across `circles`, `circle_members`, and `recipes`. Plan calls these out but does not specify isolation level. | Specify SERIALIZABLE (or REPEATABLE READ with explicit `SELECT … FOR UPDATE` on owner row) for these two paths. Capture in T033 / T036 task notes and add an integration test that exercises a concurrent owner deletion + invite redemption. |
| A-003 | WARNING  | OCR provider abstraction (T050) is mentioned but the interface contract (input shape, confidence schema, language detection output) is not enumerated in `plan.md`. Future provider swap (Q-001) cannot proceed without it.               | Before T051, write the `OcrProvider` TypeScript interface in `digitization-ocr/src/providers/ocr-provider.interface.ts` and require T050 to implement it. Document the contract in `plan.md` Phase 1 Design Notes.                            |

---

## Risk Assessment

### Risk Register

| ID    | Category    | Risk                                                                                                                                 | Likelihood | Impact |   Severity   | Mitigation                                                                                                                                                                                                                                |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | :--------: | :----: | :----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | Technical   | Textract handwriting accuracy below SC-001 threshold on aged paper / faded ink, blocking P10 Sage's primary use case.                |     H      |   H    | **Critical** | Provider-pluggable seam (A-003); manual accuracy benchmark on a representative photo set before release-readiness; fallback to manual entry path with original photo retained; defer hard threshold tuning to V-Model acceptance (Q-003). |
| R-002 | Integration | Textract cost spike from bulk imports (US-007, P8 Alex 20+ photos/session).                                                          |     M      |   H    |   **High**   | Per-user/session soft cap (FR-019 placeholder); CloudWatch billing alarm; entitlement flag from feature 010 if shipped.                                                                                                                   |
| R-003 | Technical   | Schema regret on `recipes.audience` JSONB contract once consumed by 001/006/007 — breaking change is expensive across four packages. |     M      |   H    |   **High**   | Publish `@kitchensink/shared-audience` v1 contract behind explicit version export; consumer features pin via TS path alias; document migration path in `shared-audience/README.md` before T021 lands.                                     |
| R-004 | Integration | DLQ build-up on transient OCR failures masking a real provider outage.                                                               |     M      |   M    |    Medium    | DLQ depth alarm at >0 sustained 15 min (T079); runbook for redrive in observability docs (T081); failure-mode tests in T056.                                                                                                              |
| R-005 | Scope       | Accessibility regression in side-by-side correction screen (highest-risk surface for focus order, screen reader, touch targets).     |     M      |   H    |   **High**   | axe-core in CI (T067); manual VoiceOver/TalkBack pass before release-readiness; D-002/D-003 mitigations; explicit focus-trap design in T060.                                                                                              |
| R-006 | Integration | Invite link leakage (C-001 reusable, no expiry) — link shared publicly grants Circle access.                                         |     M      |   M    |    Medium    | Owner-revocable link rotation (FR-032); audit log on every redemption (NFR-003); rate-limit redemption per IP; FR-031/FR-032 already encode this.                                                                                         |
| R-007 | Scope       | Growth/cap monitoring — soft caps only (C-003), risk of one Circle reaching pathological size before mitigation.                     |     M      |   M    |    Medium    | Outlier monitor (≥100 members or ≥1k recipes) → alert; capture in observability dashboards (T080); document escalation path.                                                                                                              |
| R-008 | Rollback    | Circle-deletion → recipe rewrite (FR-033, C-002) is hard to reverse if executed against the wrong Circle ID.                         |     L      |   H    |   **High**   | Soft-delete Circle (`deleted_at`) for 30 days before permanent rewrite; require typed confirmation; emit audit event with full rewrite count; integration test in T070.                                                                   |
| R-009 | Rollback    | OCR Lambda cold-start regressions on Node 24 runtime.                                                                                |     L      |   L    |     Low      | Provisioned concurrency on critical SQS handler if p95 exceeds NFR-001; defer to release-readiness Lambda config (T088).                                                                                                                  |

### Severity Distribution

- **Critical**: 1 (R-001)
- **High**: 4 (R-002, R-003, R-005, R-008)
- **Medium**: 3 (R-004, R-006, R-007)
- **Low**: 1 (R-009)

### Rollout Strategy

Profile: 1 Critical + 4 High → **Feature flag + canary (1% → 10% → 50% → 100%)** is required.

- Feature flag scope:
    - `digitization.enabled` gates `/api/v1/recipes/digitize/*` endpoints + the upload UI entry point.
    - `circles.enabled` gates `/api/v1/circles/*` + audience picker Circle options.
- Canary cohort: internal team users + a small set of opted-in P10 Sage proxies (≤ 1% of user base).
- Promotion gates between rings:
    - p95 OCR latency ≤ NFR-001 over the ring window.
    - DLQ depth = 0 sustained over the ring window.
    - Zero P0/P1 accessibility findings.
    - Manual accuracy benchmark ≥ SC-001 on the canary photo set.
- Rollback: flip flags off; no schema rollback required because audience JSONB and Circle tables are additive (Circle deletion paths remain inert when flag is off).

### Risk Mitigations Required Before Coding

1. **R-001** — write the `OcrProvider` interface contract before T051 (also satisfies A-003).
2. **R-003** — publish `@kitchensink/shared-audience` v1 contract surface in T019/T021 with an explicit version export and a `README.md` migration note before any consumer (001/006/007) imports it.
3. **R-005** — add an explicit focus order + focus-trap design note to T060 before starting frontend implementation.
4. **R-008** — confirm soft-delete window for Circles (default 30 days) and add to T036 task notes; integration test must execute against a soft-deleted Circle.

---

## Conditions for Approval

- [x] **C-A-001** Resolved by **T093** + plan.md "OcrProvider Interface Contract" section (added 2026-05-10). _(Mitigates A-003, R-001.)_
- [x] **C-A-002** Resolved by **T094** (CI workspace-registration guard). _(Mitigates A-001.)_
- [x] **C-A-003** Resolved by **T095** + plan.md "Transactional Isolation" section (added 2026-05-10). _(Mitigates A-002.)_
- [x] **C-D-001** **Decision (2026-05-10):** Accept **code-first review at code-review phase** as the design gate. Rationale: no wireframes were produced during product-spec; producing them now would block T057–T067 with no proportional risk reduction (correction screen uses standard form patterns, invite flow is a single CTA). Code-review phase will surface visual/IA issues before verify. User may override by requesting wireframes before T057. _(Mitigates D-001.)_
- [x] **C-D-002** Resolved by **T096** (offline-failure copy + retry on T057/T058). _(Mitigates D-002.)_
- [x] **C-D-003** Already resolved by existing **T062** (Accept-All CTA for US-009 already in tasks.md). No new task required. _(Mitigates D-003.)_
- [x] **C-D-004** Resolved by **T097** (PR-template note + `packages/ui` INDEX.md requirement on T057–T067). _(Mitigates D-004.)_
- [x] **C-R-001** Resolved by **T098** (Circle 30-day soft-delete + hard-delete worker + integration test). _(Mitigates R-008.)_
- [x] **C-R-002** Resolved by **T099** (feature flags `digitization.enabled` / `circles.enabled`) + **T100** (canary promotion gates documented at release-readiness). Note: original C-R-002 referenced T088 but T088 is the S3 bucket task — feature flags moved to T099/T100 to avoid conflation.

## Pre-Implementation Checklist

- [x] All CRITICAL design findings resolved (none — only WARNING).
- [x] All CRITICAL architecture findings resolved (none — only WARNING).
- [ ] All Critical-severity risks have documented mitigations (R-001 mitigation requires C-A-001 to land before T051).
- [x] Rollout strategy agreed upon (feature flag + canary, documented above; user confirmation pending at release-readiness gate).
- [ ] `tasks.md` updated with new sub-tasks from this review (C-A-001, C-A-002, C-A-003, C-D-002, C-D-003, C-D-004, C-R-001, C-R-002).

---

## Notes

- Wireframe / mockup absence (D-001) is the largest information gap. Implementation may proceed code-first only if the team explicitly accepts that trade-off; record the acceptance below.
- All deferred clarifications (Q-001…Q-009 from `review.md`) are honored: provider choice is provider-pluggable (R-001 / A-003); accuracy threshold is owned by V-Model acceptance; language scope is Latin-script at launch.
- This review is non-blocking on code start for tasks that do not depend on the conditions above (e.g., T001 setup, T008–T018 schema, T019–T025 shared-audience scaffolding may proceed). Frontend correction screen (T060) and OCR persistence (T054) should wait for their respective conditions.
