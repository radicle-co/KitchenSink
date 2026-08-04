# Sync-Verify Report: 007-grocery-lists

**Scan Date**: 2026-06-02
**Base Path**: `specs/007-grocery-lists/`
**Mode**: READ-ONLY (pre-implementation)
**Layers**: L1, L2 (CRITICAL), L3, L4, L7; L5 SKIPPED; L6 INFO

---

## Summary

| Layer | Status | Key Findings |
|-------|--------|-------------|
| L1 — Product Spec & Research | ✅ PASS | All Must Have stories present (US-001..US-004, US-011, US-012). Research artifacts grounded. |
| L2 — Feature Spec (spec.md) | ✅ PASS | 6 FRs (FR-028..FR-033), 4 NFRs, 3 Scenarios (SC-004, SC-008, SC-009). No Must Have gaps. |
| L3 — Technical Plan (plan.md) | ✅ PASS | Data model covers 4 tables + indexes. API surface defined. Architecture decisions resolved. |
| L4 — Tasks & V-Model | ✅ PASS | 46/46 tasks present (T-001..T-046). Dependency ordering coherent. V-model artifacts complete. |
| L5 — Implementation Traceability | ⏭️ SKIPPED | Skipped per directive. |
| L6 — Code-Level Traceability | ℹ️ INFO | Zero implementation found for feature 007. Expected pre-handoff; all T-IDs not-started. |
| L7 — Cross-Cutting Consistency | ✅ PASS | All 4 required dependency specs exist on disk. FR/NFR/SC IDs consistent across all artifacts. |

**Overall verdict**: 0 CRITICAL / 3 WARNING / 4 PASS / 2 INFO

---

## L1: Product Specification & Research

### Evidence
- `product-spec/product-spec.md` — 175 lines, `Status: Pre-handoff`
- `product-spec/user-journey.md` — 5 user journeys (A–E)
- `product-spec/metrics.md` — 12 story-level metrics mapped to US-NNN
- `research/` — 6 artifacts (competitors, ux-patterns, codebase-analysis, tech-stack, metrics-roi)

### Must Have Coverage
| US ID | Description | FRs | Status |
|-------|-------------|-----|--------|
| US-001 | Generate List from Meal Plan | FR-028 | ✅ Present |
| US-002 | Deduplicate and Sum Ingredient Quantities | FR-028 | ✅ Present |
| US-003 | Mark "Already Have" Items | FR-029 | ✅ Present |
| US-004 | Review List in Aisle-Oriented Grouping | FR-028, FR-029 | ✅ Present |
| US-011 | Access Shopping Lists from Dedicated Page | FR-032 | ✅ Present (added 2026-05-10) |
| US-012 | Navigate Between Meal Plans and Shopping Lists | FR-033 | ✅ Present (added 2026-05-10) |

### Should Have / Could Have
- US-005..US-008 (Should Have) → mapped to FR-030–FR-031
- US-009 (Could Have: Sharing) → no explicit FR in `spec.md` (see WARNING W-001)
- US-010 (Could Have: Voice Add) → deferred to post-MVP in `review.md`

### Findings
- ✅ No Must Have gaps
- ⚠️ **W-001**: Sharing narrative exists in `product-spec/` and wireframes but has no explicit FR in `spec.md` (non-critical per `verify-report.md` rationale).
- ℹ️ **W-003**: Voice Add deferred to post-MVP; no tasks reference it.

---

## L2: Feature Specification (spec.md)

### Evidence
- File: `spec.md` (92 lines; last updated 2026-05-10)
- FRs: FR-028 (generation), FR-029 (pantry), FR-030 (store config), FR-031 (order handoff), FR-032 (dedicated page), FR-033 (cross-links)
- NFRs: NFR-001 (strict TS), NFR-002 (JSDoc), NFR-003 (a11y), NFR-004 (color independent)
- Scenarios: SC-004 (5s generation), SC-008 (<10m workflow), SC-009 (dedicated page reachable)

### Must Have → FR Traceability
| Must Have US | Mapped FR | In spec.md? | In tasks.md? |
|--------------|-----------|-------------|--------------|
| US-001 | FR-028 | ✅ Yes | ✅ T-004, T-006, T-025, T-029, T-030, T-034 |
| US-002 | FR-028 | ✅ Yes | ✅ T-003, T-004, T-030 |
| US-003 | FR-029 | ✅ Yes | ✅ T-005, T-011, T-012, T-026, T-031, T-038 |
| US-004 | FR-028/FR-029 | ✅ Yes | ✅ T-025, T-041 |
| US-011 | FR-032 | ✅ Yes | ✅ T-039, T-046 |
| US-012 | FR-033 | ✅ Yes | ✅ T-040 |

### Edge Cases Coverage
- Empty meal plan → returns empty list
- Store API outage → list preserved, graceful error
- Standalone list (no meal plan) → supported
- Meal plan deleted after generation → list persists with degraded link text

### Findings
- ✅ All Must Have stories traceable to FRs
- ✅ All FRs covered by at least one task
- ✅ All required dependency specs exist on disk
- ✅ Edge cases addressed without requiring new FRs

---

## L3: Technical Plan (plan.md)

### Evidence
- File: `plan.md` (338 lines; 8 sections)
- 4 core tables: `grocery_lists`, `grocery_list_items`, `user_pantry_items`, `grocery_product_map`
- 6 API endpoints defined (POST/GET/PUT/DELETE/PATCH)
- Section 8: 6 resolved questions (Walmart first, polling not webhooks, standalone lists, pantry TTL 7 days)

### Plan ↔ Spec Alignment
| Spec Artifact | plan.md Coverage |
|---------------|------------------|
| FR-028 | Section 1 (architecture), Section 2 (data model), Section 4 (API: T-006, T-008) |
| FR-029 | Section 2 (user_pantry_items), Section 4 (T-011/T-012), Section 5 (pantry UX) |
| FR-030 | Section 5 (store config), Section 6 (Walmart/Instacart adapters) |
| FR-031 | Section 6 (order handoff), Section 4 (T-015) |
| FR-032 | Section 8 (resolved question 4), Section 7 (Web UI T-039) |
| FR-033 | Section 8 (resolved question 5), Section 7 (T-040) |
| NFR-001 | Section 4 (strict mode), T-037 explicit validation task |
| NFR-002 | Section 6.4 (JSDoc on domain service interfaces) |
| NFR-003 | Section 5 (Playwright a11y selectors), T-045 mention |
| NFR-004 | Section 5 (icon + text pairing) |
| SC-004 | Section 8 (performance target), T-036 |
| SC-008 | Section 7 (T-034 acceptance), T-045 |
| SC-009 | Section 7 (T-039), Section 8 (resolved Q4) |

### Findings
- ✅ Data model satisfies all functional requirements
- ✅ API design covers CRUD + pantry + ordering flows
- ✅ Resolved questions documented with rationale
- ℹ️ **W-005**: `STORE_INTEGRATION_ENABLED` feature flag referenced but not yet in env schema (expected for future phase)

---

## L4: Tasks & V-Model Traceability

### Evidence
- `tasks.md` — 46 tasks (T-001..T-046), dependency ordering diagram present
- `v-model/requirements.md` — 16 REQ entries + NF/IF/CN requirements
- `v-model/acceptance-plan.md`, `architecture-design.md`, `system-design.md`, `module-design.md`, `integration-test.md`, `unit-test.md`, `system-test.md`, `hazard-analysis.md`, `trace.md` all present

### Task Completeness
| Range | Coverage | Status |
|-------|----------|--------|
| T-001..T-005 | DB, schema, utilities, services | ✅ 5/5 present |
| T-006..T-012 | Core API endpoints | ✅ 7/7 present |
| T-013..T-018 | Store adapters (Walmart, Instacart) | ✅ 6/6 present |
| T-019..T-020 | Order status, premium guard | ✅ 2/2 present |
| T-021..T-024 | NestJS wiring, DTOs | ✅ 4/4 present |
| T-025..T-028 | Web UI | ✅ 4/4 present |
| T-029..T-038 | Tests & validation | ✅ 10/10 present |
| T-039..T-040 | Dedicated page, cross-links (post-review additions) | ✅ 2/2 present |
| T-041..T-044 | Mobile UI | ✅ 4/4 present |
| T-045..T-046 | Mobile E2E tests | ✅ 2/2 present |

### Findings
- ✅ No missing tasks for Must Have scope
- ✅ Dependency ordering matches architecture (DB → service → API → UI → tests)
- ✅ Mobile parity tasks mirror web tasks with noted interaction differences
- ✅ Store adapter note explicitly states mock-only until API key available
- ℹ️ **W-006**: T-039/T-040 are labeled in dependency diagram as parallel to T-025..T-028 but are physically located after T-045 in `tasks.md` (minor ordering inconsistency; not critical since dependency graph is canonical)

---

## L5: Implementation Traceability

**SKIPPED** per directive.

---

## L6: Code-Level Traceability (INFO)

### Evidence
- `packages/apps/commise/` exists with `web/` and `mobile/` (React / React Native)
- `packages/services/` is workspace-registered and ships five services (`identity`, `identity-webhooks`, `food-service`, `recipe-service`, `recipe-workers`); 007 **plans to add** `grocery-service`, which does not exist yet. The empty leftover is `packages/api/`, which is **not** a workspace root.
- Searched entire `packages/` for `grocery`, `pantry`, `culinary`, `aggregator` — **0 matches**
- No Drizzle schema files, no migration files, no NestJS controllers/services/modules

### Task → Code Mapping
| Task ID | Expected Path | Exists? | Status |
|---------|--------------|---------|--------|
| T-001 | DB migration file | ❌ No | Not started (expected) |
| T-002 | Drizzle schema (`grocery_lists`, `grocery_list_items` etc.) | ❌ No | Not started |
| T-003 | `culinary-units.ts` shared utility | ❌ No | Not started |
| T-004 | `aggregator.service.ts` | ❌ No | Not started |
| T-005 | `pantry.service.ts` | ❌ No | Not started |
| T-021 | `GroceryListsModule` NestJS module | ❌ No | Not started |
| T-025 | `pages/meal-plans/[id]/grocery-list.tsx` (Web) | ❌ No | Not started |
| T-039 | `pages/shopping-lists/index.tsx` (Web) | ❌ No | Not started |
| T-041 | `screens/GroceryListScreen.tsx` (Mobile) | ❌ No | Not started |

### Findings
- ℹ️ **INFO**: Zero implementation code found for feature 007. Consistent with `.forge-status.yml` showing `implement: not-started`. All T-IDs are not started.
- ℹ️ **INFO**: Monorepo has `packages/apps/commise/{web,mobile}` but no API backend yet. The codebase is in early setup (auth scaffolding only).

---

## L7: Cross-Cutting Consistency

### Dependency Spec Existence
| Spec | Relationship | File Exists? | Plan References? | Tasks Reference? |
|------|-------------|--------------|------------------|------------------|
| 006-meal-planning | Required | ✅ Yes | ✅ Yes | ✅ T-006, T-040 |
| 001-commise-recipe-app | Required | ✅ Yes | ✅ Yes | ✅ (ingredient source) |
| 003-usda-food-data | Required | ✅ Yes | ✅ Yes | ✅ T-003, T-004 |
| 002-user-auth | Required | ✅ Yes | ✅ Yes | ✅ T-021 (Guards) |
| 010-subscriptions | Referenced | ✅ Yes | ✅ Yes | ✅ T-020 |

### ID Consistency
| ID | spec.md | product-spec.md | plan.md | tasks.md | v-model/requirements.md |
|----|---------|-----------------|---------|----------|------------------------|
| FR-028 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-001–003) |
| FR-029 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-004–005) |
| FR-030 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-006–007) |
| FR-031 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-008) |
| FR-032 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-014) |
| FR-033 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-015) |
| NFR-001 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-NF-001) |
| NFR-002 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-NF-002) |
| NFR-003 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-NF-003) |
| NFR-004 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-NF-004) |
| SC-004 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-003) |
| SC-008 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-CN-003) |
| SC-009 | ✅ | ✅ | ✅ | ✅ | ✅ (REQ-CN-004) |

### apps/X Reference Notes
- ✅ **RESOLVED (2026-08-02)**: the API-location ambiguity is closed. `packages/api/` is an empty leftover and is **not** a workspace root; 007's backend is `packages/services/grocery-service/`, matching the shipped `packages/services/<domain>-service` convention (`food-service`, `recipe-service`) and 005's `ai-service`. All paths in `plan.md`, `tasks.md`, and `research/` were updated accordingly.

### Findings
- ✅ All required dependency specs present on disk
- ✅ FR/NFR/SC IDs fully consistent across all layers
- ✅ User journeys (A–E) map to FRs without gaps
- ✅ Wireframes referenced in product-spec and user-journey docs
- ✅ v-model requirements ↔ spec.md ↔ product-spec ↔ tasks.md ↔ plan.md all aligned

---

## Recommendations

1. **Before implementation**: Ensure `006-meal-planning` grocery-list generation hook exists (T-006 depends on meal plan APIs).
2. **Post-implementation re-scan**: Re-run L5 and L6 after T-001..T-012 complete to validate code ↔ tasks traceability.
3. **Store adapter caution**: Walmart API key and Instacart partner agreement are still external blockers. Keep store tasks mock-only until credentials available.
4. ~~**Monorepo path drift**~~ — **CLOSED (2026-08-02)**. Canonical API location is `packages/services/grocery-service/`; `packages/api/` is an empty leftover, not a workspace root.

---

*Report generated on 2026-06-02. READ-ONLY scan. No files modified.*
