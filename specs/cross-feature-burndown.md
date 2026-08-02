# Cross-Feature Burndown Inventory

**Generated**: 2026-05-12
**Source**: [`cross-feature-consistency-report.md`](./cross-feature-consistency-report.md) (2026-05-09)
**Scope**: Features `001`–`010` cross-cutting findings only. Per-feature `verify-report.md` findings are tracked in [`v1-launch-plan.md`](./v1-launch-plan.md) milestone burn-downs.
**Total**: 2 CRITICAL · 6 WARNING · 4 INFO

---

## Summary

| Severity    | Count | IDs                                            |
| ----------- | ----- | ---------------------------------------------- |
| 🔴 CRITICAL | 2     | CR-001, CR-002                                 |
| ⚠️ WARNING  | 6     | WA-001, WA-002, WA-003, WA-004, WA-005, WA-006 |
| ℹ️ INFO     | 4     | IN-001, IN-002, IN-003, IN-004                 |

---

## Milestone Assignment

Findings are mapped to the canonical milestone ladder in [`v1-launch-plan.md`](./v1-launch-plan.md).

| ID     | Severity    | Title                                              | Owner Feature(s)         | Milestone        | Blocks                                        |
| ------ | ----------- | -------------------------------------------------- | ------------------------ | ---------------- | --------------------------------------------- |
| CR-001 | ✅ RESOLVED | API prefix collision (`/api/*` vs `/v1/*`)         | `001` (migrated)         | `M0` Shire       | resolved 2026-08-02 — see ADR-0011            |
| CR-002 | 🔴 CRITICAL | Missing `shared/recipe-core` type library          | `001` (owns extraction)  | `M0` Shire       | `006`, `007`, `009`, `010` entity work        |
| WA-001 | ⚠️ WARNING  | Node 22.x (002) vs ≥24.x (root)                    | `002`                    | `M0` Shire       | `002` Lambda deploy in `M1`                   |
| WA-002 | ⚠️ WARNING  | `006 → 007` DB ordering not flagged                | `007` (add note)         | `M3` Rohan       | `007` migration in `M3`                       |
| WA-003 | ⚠️ WARNING  | Cross-feature FR reference index missing           | governance               | `M0` Shire       | non-blocking, prevents future drift           |
| WA-004 | ⚠️ WARNING  | Notification system has no owner                   | `014` (resolves)         | `M8` Mordor      | `003`, `005`, `008`, `009` notification calls |
| WA-005 | ⚠️ WARNING  | Offline/sync strategy isolated to `008`            | cross-feature decision   | `M2` Moria       | mobile clients in `M3`–`M4`                   |
| WA-006 | ⚠️ WARNING  | EU AI Act disclosure not propagated to `006`/`009` | `005` (shared component) | `M5` Isengard    | premium AI launch (`005`/`006`/`009`)         |
| IN-001 | ℹ️ INFO     | `fdc_id` vs `usda_fdc_id` naming                   | `003`/`007` convention   | `M0` Shire       | none                                          |
| IN-002 | ℹ️ INFO     | `meal_plan_nutrition` table name similarity        | `006` (rename)           | `M3` Rohan       | none                                          |
| IN-003 | ℹ️ INFO     | `@RequirePremium()` shared location                | `010` (extract early)    | `M4` Helm's Deep | clean imports for `005`/`006`/`009`           |
| IN-004 | ℹ️ INFO     | Device-storage pattern only in `008`               | `008` (promote pattern)  | `M4` Helm's Deep | none                                          |

---

## Resolution Order

### Pre-`M1` blockers (resolve in `M0` Shire)

1. ~~**CR-001**~~ — **RESOLVED 2026-08-02.** `/api/v1/*` (not bare `/v1/*`) is canonical, per GR-002. The three services serve it, `specs/001-commise-recipe-app/contracts/api.openapi.yaml` and `specs/002-user-auth/contracts/identity-api.openapi.json` were migrated, and `docs/api-conventions.md` was created. The bare `/v1/*` paths remain as a deprecated alias for out-of-repo consumers — see [ADR-0011](../docs/architecture/decisions/0011-api-version-prefix.md).
2. **CR-002** — Add `packages/shared/recipe-core` extraction task to `specs/001-commise-recipe-app/tasks.md`. Define `Recipe`, `Ingredient`, `Step`, `Collection`, `User`, `Account`, `Food`, `MealPlan`, `NutritionPlan`, `GroceryList`.
3. **WA-001** — Align `002` to Node 24.x or document Lambda runtime divergence in `specs/002-user-auth/plan.md`.
4. **WA-003** — Create `specs/cross-feature-FR-index.md` (one-time scaffold; maintained as features land).
5. **IN-001** — Document snake_case FK convention in `docs/api-conventions.md`.

### `M2` Moria

- **WA-005** — Author `docs/offline-sync-strategy.md` defining: (a) which features need offline support, (b) shared persistence layer (IndexedDB web / AsyncStorage mobile), (c) sync reconciliation strategy. Required before mobile builds in `M3`.

### `M3` Rohan

- **WA-002** — Add explicit migration ordering note to `specs/007-grocery-lists/spec.md`.
- **IN-002** — Rename `meal_plan_nutrition` → `meal_plan_daily_nutrition` in `specs/006-meal-planning/plan.md` before `006` migrations land.

### `M4` Helm's Deep (beta gate)

- **IN-003** — Extract `@RequirePremium()` decorator + `PlanGuard` to `packages/shared/subscription/` early in `010` work so beta features can import.
- **IN-004** — Promote `008` device-storage adapters to `packages/shared/persistence/` for reuse.

### `M5` Isengard

- **WA-006** — Add EU AI Act disclosure scope to `specs/006-meal-planning/spec.md` and `specs/009-nutrition-planning/spec.md`. Implement disclosure component as shared UI in `packages/shared/ai-disclosure/`.

### `M8` Mordor

- **WA-004** — Resolved by `014-notification-service` ownership. Confirm `003`, `005`, `008`, `009` consume `014`'s notification API rather than ad-hoc implementations.

---

## Status

| ID     | Status | Notes                                                                                                   |
| ------ | ------ | ------------------------------------------------------------------------------------------------------- |
| CR-001 | CLOSED | Resolved 2026-08-02: canonical `/api/v1/*` shipped; bare `/v1/*` kept as a deprecated alias (ADR-0011). |
| CR-002 | OPEN   | —                                                                                                       |
| WA-001 | OPEN   | —                                                                                                       |
| WA-002 | OPEN   | —                                                                                                       |
| WA-003 | OPEN   | —                                                                                                       |
| WA-004 | OPEN   | Provisionally addressed by `014-notification-service` scope (verify in `M8`)                            |
| WA-005 | OPEN   | —                                                                                                       |
| WA-006 | OPEN   | —                                                                                                       |
| IN-001 | OPEN   | —                                                                                                       |
| IN-002 | OPEN   | —                                                                                                       |
| IN-003 | OPEN   | —                                                                                                       |
| IN-004 | OPEN   | —                                                                                                       |

Update this table as findings resolve. Closing a finding requires a linked PR or spec edit.
