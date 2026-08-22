# Phase Digest — Plan (015 Publishing Rewards)

**Phase**: 5 (Plan) · **Date**: 2026-08-22 · **Artifact**: [`../plan.md`](../plan.md)

## Key decisions

1. **Amend, don't replace, `evaluateVisibility`.** The C-004 `user_created` + `private` branch changes from
   `isPremium` to `isPremium || hasAvailablePrivateSlot`. The policy stays **pure** — the caller resolves the
   balance, because slots are DB state and `isPremium` is a token claim. Two different entitlement sources
   that must not be collapsed into one boolean.
2. **Slot balance is DERIVED, not a stored counter** — `SUM(amount) WHERE kind='slot' AND reversed_at IS
NULL`. Makes `FR-007b` permanence structural rather than a discipline anyone can break.
3. **The ratchet (`FR-007i`) is a DB CHECK constraint**, not application logic — `contributor_standing.tier
    > = highest_tier_reached`.
4. **Reward schedule is table-driven data**, not branches, so changing it never means editing control flow.
5. **New `rewards/` module mirrors the shipped `ratings/` layout**; four new pure policies join the existing
   `recipes/domain/` evaluators. No new architectural shape introduced.
6. **Migration `0024_publishing_rewards.sql`, EXPAND-ONLY** (ADR-0022 precondition). Latest shipped is 0023.

## Artifacts produced

- `plan.md` — architecture, data model, pure-module table, test strategy, blockers, risks.
- No ADRs. Nothing here contradicts or extends an existing ADR; ADR-0014 (service-owned contracts) and
  ADR-0022 (in-stack migration trigger) are **consumed as-is**.

## Open risks

1. **The cliff** — slots are a finite bootstrap; recognition (the handoff target, `FR-007j`) depends on 008
   and 012, neither implemented. Shipping slots broadly without dates for those builds the exact
   overjustification failure the spec records.
2. `evaluateVisibility` is called by create/update/clone-default/set-visibility — a wrong amendment silently
   changes clone and import behaviour. Mitigate by making the input field **required** so every call site is
   a compile error.
3. `/rewards/me` is on a hot path; a per-request ledger `SUM` will not hold.
4. Concurrent sessions are editing this repo; re-check `visibilityPolicy.ts` against `main` before coding.

## Handoff notes for tasks

- **Sequence the C-004 amendment first**, behind a flag — independently shippable and revertible (it is D4a).
- **US1–US3 are buildable; US5 is not** (no cook/save data source exists anywhere in the service). Task
  breakdown must not emit implementable tasks for `FR-007f`/`FR-007g`/`FR-007h` beyond the port/adapter seam.
- TDD red-first per tier; the invariant guard (`ratchet.test.ts`, `SC-008`) is a **set-equality** test in the
  style of `natEgressConsumers.test.ts`, not a spot check.
- Web + mobile land in the same release (`FR-023`); unpublish step-count parity (`FR-029`) is asserted, not
  reviewed.

## Prior lessons applied

**None forwarded.** There is no `research/README.md` with a "Prior lessons that apply" section for this
feature — its research was a bespoke behavioural/legal dossier, not a Product Forge research run. No lessons
were invented to fill the gap.
