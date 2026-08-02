# Codebase Analysis: Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [tasks.md](../tasks.md), root `package.json`, [AGENTS.md](../../../AGENTS.md)

---

## Monorepo Fit

Root workspaces from `package.json`:

```json
"workspaces": [
    "packages/tools/*",
    "packages/services/*",
    "packages/shared/*",
    "packages/utils/*",
    "packages/infra/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/apps/commise/ui",
    "packages/apps/commise/i18n",
    "packages/apps/commise/features/*",
    "packages/clients/*"
]
```

007 depends on existing and planned service layers without requiring workspace topology changes.

---

## Expected Feature Placement

Based on `plan.md` + `tasks.md` locations:

| Concern                        | Proposed Placement                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Grocery API module             | `packages/apps/commise/api/src/grocery-lists/`                                          |
| Store API clients              | `packages/apps/commise/api/src/grocery-lists/store-clients/`                            |
| Shared unit conversion utility | `packages/shared/culinary-units/src/index.ts` (as planned)                                      |
| Web grocery list UI            | `packages/apps/commise/web` routes/components                                           |
| Mobile parity UI               | `packages/apps/commise/mobile` screens/components (if included in implementation scope) |

---

## Dependency and Integration Surface

Feature-level dependencies from `spec.md`:

- **006-meal-planning**: source meal plans for list generation
- **001-commise-recipe-app**: ingredient source records
- **003-usda-food-data**: normalized ingredient identity/unit context
- **002-user-auth**: authenticated access
- **010-subscriptions**: premium gating for FR-031 ordering flow

Runtime integration path from `plan.md`:

1. Meal plan read
2. Ingredient aggregation + dedupe
3. Unit normalization
4. Pantry subtraction
5. Store mapping
6. Ordering handoff

---

## Architectural Strengths

1. **Clear staged pipeline** in plan/tasks makes verification and observability straightforward.
2. **Shared utility strategy** for unit conversion avoids divergence across 003/006/007.
3. **Explicit API endpoint plan** in tasks supports deterministic test-case authoring.
4. **Premium gating separation** avoids coupling basic list generation to ordering monetization path.

---

## Gaps and Risks (Documentation-Level)

1. **No explicit collaboration/sharing FR** despite domain expectation and requested wireframe coverage.
2. **Store mapping freshness policy** exists in tasks, but operational ownership (refresh jobs/SLAs) should be made explicit during implementation.
3. **Cross-platform parity scope** (web vs mobile) should be reaffirmed for FR-044-equivalent expectations in this feature.
4. **No implementation package yet** for grocery APIs, so code↔task verification remains expected-gap.

---

## Tooling and Execution Context

- Node engine at root: `>=24.0.0`
- Monorepo scripts: `build`, `test`, `lint`, `typecheck`, `format`
- AGENTS baseline command guidance: `npm test && npm run lint`

These provide sufficient CI hooks for future 007 implementation verification.
