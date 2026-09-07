# Contract: Household (FR-030…FR-034)

**Owner service**: `packages/services/recipe-service` · zod at `src/household/household.schema.ts`, copied to
`packages/schemas/recipe`. Pure invariants live in `packages/shared/household-core` so both apps agree.

## Endpoints

| Method   | Path                                        | Purpose                                              | FR             |
| -------- | ------------------------------------------- | ---------------------------------------------------- | -------------- |
| `GET`    | `/api/v1/household`                         | The caller's active household + members + seat state | FR-030, FR-034 |
| `POST`   | `/api/v1/household/invitations`             | Invite a member                                      | FR-032, FR-034 |
| `POST`   | `/api/v1/household/invitations/{id}/accept` | Accept                                               | FR-032         |
| `DELETE` | `/api/v1/household/members/{userId}`        | Remove, or leave when self                           | FR-032         |

## Response — `GET /household`

```text
{
  id: string
  displayName: string
  members: Array<{ userId: string; role: 'owner'|'member'; state: 'invited'|'active' }>
  seats: { allowance: number; used: number }
}
```

## Invariants

1. **Exactly one active household per account**, created implicitly at signup — the endpoint never 404s for an
   authenticated caller, and no client needs a "no household" branch (R-07).
2. **The last active owner cannot leave.** `DELETE` on the sole owner is `409`, not a silent orphan.
3. `seats.allowance` is read from the signed `public_metadata` claim `010-FR-044` already publishes.
   ⛔ Never from a client-supplied tier — that is the forgeable-header class PR #39 removed.
4. Exceeding seats is a **`409` with a stated reason** (FR-034), never a silent no-op.
5. Lapse follows `010-FR-043`: shared content is **retained**, not destroyed.
6. Removing a member leaves household content intact; the member keeps their own recipes (FR-032).

## Role policy — a pure module, not a Guard (R-09)

Enforcement lives in `recipe-service/src/household/domain/householdPolicy.ts`, shaped exactly like its three
siblings (`visibilityPolicy`, `provenancePolicy`, `mappingScopePolicy`):

```text
evaluateHouseholdAction(input: {
  role: 'owner' | 'member'
  state: 'invited' | 'active' | 'removed' | 'left'
  action: 'mutate' | 'complete' | 'delete' | 'invite' | 'remove' | 'deleteHousehold'
  isSelf: boolean                      // for `remove` — leaving is removing yourself
}): { allowed: boolean; reason: string }
```

| Action                                                          | `member` | `owner`                      |
| --------------------------------------------------------------- | -------- | ---------------------------- |
| `mutate` — create/edit plans, lists, aisle taxonomy             | ✅       | ✅                           |
| `complete` — finish/archive a list, plan, or taxonomy (FR-030c) | ✅       | ✅                           |
| `delete` — delete a plan, list, or taxonomy                     | ⛔       | ✅                           |
| `invite` / `remove`                                             | ⛔       | ✅                           |
| `deleteHousehold`                                               | ⛔       | ✅                           |
| `remove` where `isSelf` (leaving)                               | ✅       | ✅ unless sole owner → `409` |

⛔ **Do not turn this into `RolesGuard` + `@RequireRole`.** That is route-level, and every member may reach
these endpoints — what is authorized is an **action on a resource given a role**, which a route guard cannot
express. This is the same distinction **ADR-0023** ruled on for provenance grants.

**Confirmed 2026-08-22**: the split stands, and applies uniformly to grocery lists, meal plans and the aisle
taxonomy — one truth table, no per-resource exceptions.

### Sole-owner departure (FR-032a…FR-032c)

`DELETE /household/members/{userId}` on the sole owner returns `409` for a **voluntary** leave. It is not the
whole rule: **GDPR erasure cannot be refused**, so when the sole owner is erased, ownership transfers
automatically to the longest-tenured active member — deterministically, ties broken by a stable secondary key,
written **before** the departing membership row is removed, and idempotent under redelivery. If the owner was
the only member, the household goes with them. The household's `display_name` is re-derived if it carried the
erased owner's handle.

⛔ Do not implement this as a nomination prompt. It would make a legal right conditional on a user action that
may never come.

## Cross-feature effect

`006-FR-029` (owner-scoped reads/writes) is **replaced** by household scoping. Migration is EXPAND-FIRST:
dual-write, flip reads, drop owner scoping a release later.
⚠️ `006-FR-032`'s `Idempotency-Key` was designed for one owner and does **not** cover two members editing one
entry concurrently — U-4, owned by `006`.
