# Tasks: Feature 009 — Nutrition Planning

**Feature**: `009-nutrition-planning`  
**Source**: [spec.md](spec.md) · [plan.md](plan.md) · [product-spec/product-spec.md](product-spec/product-spec.md)

---

## US Reference

| US     | Story                              | Priority | FR / REQ |
| ------ | ---------------------------------- | -------- | -------- |
| US-001 | Create Nutrition Plan              | Must     | FR-036   |
| US-002 | Link Meal Plan and View Compliance | Must     | FR-037   |
| US-003 | Trainer Creates Client Plan        | Must     | FR-038   |
| US-004 | Guided Recipe Swap Suggestions     | Must     | FR-039   |
| US-005 | Client Consent Gate                | Should   | REQ-008  |

---

## Dependency Graph (tasks in this file)

```
T-001
  └─► T-002
        ├─► T-003
        │     └─► T-004
        │           ├─► T-005
        │           │     ├─► T-012
        │           │     └─► T-014
        │           ├─► T-009
        │           │     └─► T-010
        │           │           ├─► T-011
        │           │           └─► T-015
        │           └─► T-007
        │                 └─► T-011
        ├─► T-006
        │     └─► T-007
        ├─► T-008 ──► T-004, T-006
        └─► T-013
              └─► T-003
```

---

## US-001 — Create Nutrition Plan (FR-036)

- [ ] **T-001** [P3] [US-001] Create nutrition planning DB migration — `packages/services/nutrition-service/src/database/migrations/009_nutrition_planning.sql`  
       **Depends on**: 006-meal-planning schema  
       **Implements**: FR-036  
       **Acceptance**: `nutrition_plans`, `meal_plan_nutrition_link`, `nutrition_compliance`, `trainer_clients` tables created with indexes; migration reversible; passes CI

- [ ] **T-002** [P3] [US-001] Define Drizzle schema and TypeScript types — `packages/services/nutrition-service/src/database/schema/nutrition.ts`  
       **Depends on**: T-001  
       **Implements**: FR-036  
       **Acceptance**: All four table schemas exported; enums (`ActivityLevel`, `Goal`, `ComplianceStatus`) typed; inferred types exported; `strict: true`

- [ ] **T-003** [P3] [US-001] Implement macro calculator service — `packages/services/nutrition-service/src/macro-calculator.service.ts`  
       **Depends on**: T-002  
       **Implements**: FR-036  
       **Acceptance**: Mifflin-St Jeor BMR ±1 cal; TDEE multipliers for 5 activity levels; macro splits for lose/maintain/gain; recipe/meal plan aggregation via 003/006; JSDoc; `strict: true`

- [ ] **T-004** [P3] [US-001] Nutrition plan CRUD API — `packages/services/nutrition-service/src/nutrition-plans.controller.ts`  
       **Depends on**: T-002, T-003, T-008  
       **Implements**: FR-036  
       **Acceptance**: GET/POST/PUT/DELETE `/api/v1/nutrition-plans`; returns `linkedMealPlans`; 403 for non-owner; Clerk session token; `class-validator` DTOs; GDPR middleware applied

- [ ] **T-009** [P3] [US-001] Web UI: nutrition plan creation — `packages/apps/commise/web/src/app/nutrition/plan/page.tsx`  
       **Depends on**: T-004  
       **Implements**: FR-036  
       **Acceptance**: Form fields (name, calories, protein, carbs, fat, activity, goal); optional TDEE calculator; plan list shows own + shared plans; accessible labels (NFR-003); status text + icon (NFR-004)

- [ ] **T-013** [P3] [US-001] Unit tests: macro calculator — `packages/services/nutrition-service/src/__tests__/macro-calculator.service.test.ts`  
       **Depends on**: T-003  
       **Implements**: SC-010  
       **Acceptance**: 3+ BMR reference cases; all 3 goal splits; edge cases (zero-weight, calorie floor); ≥90% coverage; all tests pass

---

## US-002 — Link Meal Plan and View Compliance (FR-037)

- [ ] **T-005** [P3] [US-002] Meal plan link and compliance API — `packages/services/nutrition-service/src/nutrition-plans.controller.ts`  
       **Depends on**: T-004  
       **Implements**: FR-037  
       **Acceptance**: POST `/api/v1/nutrition-plans/{id}/link` idempotent; validates meal plan ownership; GET `/api/v1/nutrition-plans/{id}/compliance` returns daily[] + weekly summary; date range params; 403 auth

- [ ] **T-010** [P3] [US-002] Web UI: compliance dashboard — `packages/apps/commise/web/src/app/nutrition/compliance/page.tsx`  
       **Depends on**: T-005, T-009  
       **Implements**: FR-037  
       **Acceptance**: Daily macro breakdown (planned vs actual); weekly summary; `on_track`/`over`/`under` with icon + text (NFR-004); date picker; no-data state; table fallback (NFR-003)

- [ ] **T-014** [P3] [US-002] Integration tests: compliance API — `packages/services/nutrition-service/tests/compliance.integration.test.ts`  
       **Depends on**: T-005  
       **Implements**: FR-037, SC-010  
       **Acceptance**: Create plan → link meal plan → verify compliance shape; status computed correctly; date filtering; 403 unauthorized; accuracy within 5%

---

## US-003 — Trainer Creates Client Plan (FR-038)

- [ ] **T-006** [P3] [US-003] Trainer-client relationship service — `packages/services/nutrition-service/src/trainer-clients.service.ts`  
       **Depends on**: T-002, T-008  
       **Implements**: FR-038  
       **Acceptance**: POST `/api/v1/trainer/invite` creates `pending` row; client accept → `active`; client revoke → `revoked`; trainer access gated on `active`; premium check (010)

- [ ] **T-007** [P3] [US-003] Trainer nutrition plan APIs — `packages/services/nutrition-service/src/trainer.controller.ts`  
       **Depends on**: T-006, T-004  
       **Implements**: FR-038  
       **Acceptance**: POST `/api/v1/trainer/clients/{clientId}/nutrition-plan` (trainer_id set, is_public false); client POST `/api/v1/nutrition-plans/{id}/accept`; GET `/api/v1/trainer/clients/{clientId}/compliance`

- [ ] **T-011** [P3] [US-003] Web UI: trainer-client management — `packages/apps/commise/web/src/app/nutrition/trainer/page.tsx`  
       **Depends on**: T-007, T-010  
       **Implements**: FR-038  
       **Acceptance**: Trainer invites client; trainer sees client list with compliance summary; trainer creates plan for client; client sees pending invites (accept/decline); client revokes access; premium gate

---

## US-004 — Guided Recipe Swap Suggestions (FR-039)

- [ ] **T-012** [P3] [US-004] AI recipe swap suggestions service — `packages/services/nutrition-service/src/swap-suggestions.service.ts`  
       **Depends on**: T-005  
       **Implements**: FR-039  
       **Acceptance**: Surfaces swaps when compliance shows gap/excess; calls 005 AI with macro delta; shows recipe name, improvement, confidence; premium-gated; non-blocking async; teaser for non-premium

---

## US-005 — Client Consent Gate (REQ-008)

- [ ] **T-008** [P3] [US-005] GDPR Article 9 consent middleware — `packages/services/nutrition-service/src/gdpr-consent.middleware.ts`  
       **Depends on**: T-002  
       **Implements**: REQ-008  
       **Acceptance**: Consent record verified before any nutrition write; captured at first plan creation (T-009); captured at trainer invite acceptance (T-006); delete triggers erasure cascade; no data if consent revoked; audit trail

---

## US-001 — E2E Testing

- [ ] **T-015** [P3] [US-001] E2E tests: nutrition plan flow — `packages/apps/commise/web/tests/e2e/nutrition-planning.spec.ts`  
       **Depends on**: T-010  
       **Implements**: FR-036, FR-037  
       **Acceptance**: Scenario 1: create plan → visible on dashboard; Scenario 2: link meal plan → compliance shows planned vs actual with indicators; Scenario 3 (premium): trainer plan → client views; `getByRole`/`getByLabel` queries (NFR-003); passes in CI

---

## Summary

| Task  | Description                       | Phase         | Effort | Depends on          |
| ----- | --------------------------------- | ------------- | ------ | ------------------- |
| T-001 | DB migration                      | Database      | S      | 006 schema          |
| T-002 | Drizzle schema                    | Database      | S      | T-001               |
| T-003 | Macro calculator service          | Backend       | M      | T-002               |
| T-004 | Nutrition plan CRUD API           | Backend       | M      | T-002, T-003, T-008 |
| T-005 | Meal plan link & compliance API   | Backend       | S      | T-004               |
| T-006 | Trainer-client relationship       | Backend       | M      | T-002, T-008        |
| T-007 | Trainer nutrition plan APIs       | Backend       | M      | T-006, T-004        |
| T-008 | GDPR consent middleware           | Cross-cutting | S      | T-002               |
| T-009 | Web UI: plan creation             | Frontend      | M      | T-004               |
| T-010 | Web UI: compliance dashboard      | Frontend      | M      | T-005, T-009        |
| T-011 | Web UI: trainer-client management | Frontend      | M      | T-007, T-010        |
| T-012 | AI recipe swap suggestions        | Backend       | L      | T-005               |
| T-013 | Unit tests: macro calculator      | Testing       | S      | T-003               |
| T-014 | Integration tests: compliance API | Testing       | M      | T-005               |
| T-015 | E2E tests: nutrition plan flow    | Testing       | M      | T-010               |

**Total tasks**: 15  
**Effort**: S×4 · M×10 · L×1
