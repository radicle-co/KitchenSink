# Downstream Gaps — Feature 005

Feature 005 is a **composition** layer: it calls the services that own domain data rather than writing
their tables (`plan.md` §1.4). Where the owning service does not exist yet, the call site is **stubbed**
and registered here.

**This register exists so a stub cannot quietly become permanent.** Each row is a requirement on another
feature. A stub is removed only when its owning feature ships the endpoint — never by inventing a local
table in 005, which is exactly the mistake the previous plan revision made (it declared foreign keys to
`meal_plans` and `shopping_lists`, tables no service creates).

**Status**: Active | **Created**: 2026-08-02

---

## Register

| ID     | Stubbed call site                            | Needs                                          | Owner   | 005 behaviour while stubbed                                                                                            |
| ------ | -------------------------------------------- | ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| DG-001 | `POST /api/v1/ai/generate/meal-plan`         | A meal-plan service that can persist a plan    | **006** | `501 Not Implemented`, `feature: 'meal-planning'`. No row written.                                                     |
| DG-002 | `POST /api/v1/ai/generate/shopping-list`     | A grocery-list service that can persist a list | **007** | `501 Not Implemented`, `feature: 'grocery-lists'`. No row written.                                                     |
| DG-003 | MCP tools `meal_plans_list`, `meal_plan_get` | Read access to meal plans                      | **006** | Tools are **not advertised** in `tools/list` until 006 ships.                                                          |
| DG-004 | Premium entitlement check (FR-019, D-002)    | A subscription tier lookup                     | **010** | Reads `accounts.subscription_tier`, which identity already ships. Revisit when 010 defines the authoritative contract. |
| DG-005 | Notification on generation complete          | Notification delivery infrastructure           | **014** | No notification sent. GR-011 makes 014 the owner; 005's spec does not yet declare the dependency.                      |

---

## Rules

1. **A stub returns `501`, never a fake success.** A caller must be able to tell "not built yet" from
   "worked". Silent success is how a preview ends up degraded behind green checks (ADR-0010's failure
   mode).
2. **A stub writes no `ai_generation_records` row.** No provider was called, no cost incurred, nothing to
   audit.
3. **An unavailable MCP tool is not advertised.** `tools/list` must not offer a tool that always fails —
   an agent would burn turns discovering it doesn't work.
4. **Each row cites the owning feature.** When that feature enters implementation, its spec must carry the
   requirement; this register is the source for that hand-off.
5. **Removing a stub requires deleting its row here**, so the register stays truthful.

## Notes

- **DG-004** is softer than the others: the capability exists (identity ships `accounts.subscription_tier`),
  so 005 is not blocked. What is missing is 010's authoritative entitlement _contract_. 005 reads the
  column today and should migrate when 010 defines the interface.
- **DG-005** is a spec inconsistency as much as a gap: GR-011 assigns notification delivery to 014 and
  names 005 as a feature that must depend on it, but 005's own dependency table never mentions 014. Resolve
  when 005's spec is next revised.
