# Phase Digest — Tasks (015 Publishing Rewards)

**Phase**: 5B (Tasks) · **Date**: 2026-08-22 · **Artifact**: [`../tasks.md`](../tasks.md)

## Key decisions

- **49 tasks across 9 groups**; 21 are `Test-first: true` and ordered before their implementation pair.
- **47/47 functional requirements traced** in [`../traceability.yml`](../traceability.yml). 15 carry a
  `blocked_on` field — that is a fact about the world, not a coverage gap.
- **Group D (the C-004 amendment) is sequenced first** and behind a flag, because it _is_ D4a: independently
  shippable, independently revertible, and the precondition for the reward meaning anything.
- **`hasAvailablePrivateSlot` is a REQUIRED field, deliberately.** An optional field with a default would let
  the four existing `evaluateVisibility` call sites compile unchanged and silently keep the old behaviour.
  Required makes every call site a compile error — the compiler does the audit.
- **Group I emits a seam and nothing else.** Only `I090` (the outbound port interface) is buildable; I091–I094
  are explicitly marked ⛔ BLOCKED with no paths, rather than being written as if they were actionable.

## Artifacts produced

- `tasks.md` — 49 tasks, unique IDs, `Paths:` + `Size:` on every task.
- `traceability.yml` — live matrix, 47 requirements → tasks, with `blocked_on` where real.

## Open risks

1. **Group I is 5 of 9 groups' worth of value and none of it is buildable.** The recognition layer is the
   spec's load-bearing currency (`FR-007j` handoff) and its data source does not exist.
2. **`evaluateVisibility` has 4 call sites** — create, update, clone-default, set-visibility. `TC034`
   regression-tests clone/import specifically because that is where a wrong amendment hides.
3. **No XL tasks in the buildable set** (A001 is XL but is 016's work, not 015's). Largest buildable is M.
4. **`E048` (materialized balance) is a correctness risk**, not just performance — a drifting materialization
   silently grants or denies privacy. Reconciliation is asserted, not assumed.

## Handoff notes

- Start with **Group D** (C-004 amendment), then **B** (data model), then **C** (policies), then **E**.
- Commit granularity: one commit per test/impl pair, so the red→green transition is visible in history.
- **Do not start Group A items as engineering work** — A001/A002 are 016's deliverables and A003 is an owner
  decision.
- ⛔ **Implementation is stopped by owner directive.** This digest closes Phase 5B; Phase 6 does not begin.
