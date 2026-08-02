# Codebase Analysis: Nutrition Planning

**Branch**: `009-nutrition-planning` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](../research.md), root `package.json`, [AGENTS.md](../../../AGENTS.md)

---

## Monorepo Context

KitchenSink is a Turborepo + npm workspaces monorepo. Root workspaces from `package.json`:

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

Root scripts: `build`, `test`, `lint`, `typecheck`, `format`, `format:check`.

Node engine: `>=24.0.0`.

---

## Feature 009 Placement

Feature 009 is primarily a **domain extension** over existing recipe and meal-planning data flows:

- Consumes nutrition rollups from feature 006 meal planning
- Indirectly depends on feature 003 USDA nutrient data through 001/006 aggregation pipeline
- Adds trainer-client and premium recipe-swap flows tied to authentication and subscriptions dependencies

From plan artifacts, expected implementation surfaces:

1. API endpoints under nutrition-plans and trainer namespaces
2. Data model additions (`nutrition_plans`, link table, compliance snapshots, trainer-client relation)
3. Web/mobile views for goal setup, dashboard, and compliance breakdown

---

## Dependency Graph (Implementation-Level)

```text
003-usda-food-data
   ↓ (ingredient nutrient source)
001-commise-recipe-app
   ↓ (recipe-level nutrition)
006-meal-planning
   ↓ (meal_plan_entries nutrition_snapshot rollups)
009-nutrition-planning
   ├─ nutrition targets and compliance
   ├─ trainer-client assignment
   └─ recipe swap guidance
```

Key architectural benefit: 009 can operate from day-level rollups without rejoining ingredient-level tables in request paths.

---

## Conventions and Constraints

- `NFR-001`: strict TypeScript; no broad `any`
- `NFR-002`: JSDoc on exported interfaces/functions
- `NFR-003`: UI components expose accessible names for Playwright selectors
- `NFR-004`: status semantics must not rely on color alone

GDPR Article 9 (special category data) requires explicit consent handling and deletion semantics in domain logic.

---

## Gaps and Readiness Notes

1. Feature artifacts exist (`spec.md`, `plan.md`, `research.md`, `tasks.md`, V-Model corpus), but Product Forge layer was missing and is now bootstrapped.
2. Dietary-profile and deficiency-alert expectations are present in domain context but not formalized as distinct FR IDs.
3. Premium boundary alignment with `010-subscriptions` is required when implementing `FR-038` and `FR-039` UX entry points.

---

## Recommended Integration Contracts

- Treat 006 as the source of daily/weekly “actuals” for compliance calculations.
- Keep 009 target objects immutable per snapshot period where possible for auditable adherence history.
- Explicitly persist consent timestamp/version for trainer-client data flows.
