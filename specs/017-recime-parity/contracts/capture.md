# Contract: Capture (FR-001…FR-015)

**Owner service**: `packages/services/recipe-service`
**Authoring rule (ADR-0014 / GR-015 §15)**: zod is authored **in-service** at
`src/recipes/import/import.schema.ts`, beside the controller it validates, then **copied** to
`packages/schemas/recipe`. Clients import from the schema package and declare **no wire types**. A consumer
whose shape differs DERIVES it with `Pick`/`Omit`/`Partial`.
⛔ `openapi.yaml` is **derived output** for `oasdiff`/docs — never a codegen input.

**Prefix (GR-002)**: every path begins `/api/v1/`.

## Endpoints

| Method | Path                                   | Purpose                           | FR                             |
| ------ | -------------------------------------- | --------------------------------- | ------------------------------ |
| `POST` | `/api/v1/recipes/captures`             | Start a capture from any channel  | FR-001, FR-012, FR-014, FR-015 |
| `GET`  | `/api/v1/recipes/captures/{id}`        | Poll outcome + per-tier record    | FR-002, FR-008, SC-009         |
| `POST` | `/api/v1/recipes/captures/{id}/select` | Choose among multi-recipe results | FR-006                         |

## Request — `POST /captures`

```text
{
  sourceRef: string            // URL, or an opaque reference to user-supplied bytes
  channel: 'chooser' | 'share_sheet' | 'extension' | 'migration'
}
```

`channelClass` is **derived server-side**, never client-supplied — a client that could declare itself
`user_supplied_bytes` would forge the `016-FR-028` classification the §512(c) posture rests on.

## Response — `GET /captures/{id}`

```text
{
  id: string
  outcome: 'pending' | 'draft' | 'no_recipe' | 'unreadable' | 'failed'
  resolvedTier: 1|2|3|4|5 | null
  candidates: Array<{ index: number; title: string }>      // FR-006, ≥2 means selection required
  tiers: Array<{
    tier: 1|2|3|4|5
    attempted: boolean
    yielded: boolean
    insufficiency: string | null
  }>
  draftId: string | null
}
```

## Acceptance and completion (clarification Q5)

`POST /captures` returns **as soon as the capture is durably accepted** — it does not wait for extraction
(FR-013). Acceptance is what the share sheet confirms; extraction completion is announced separately.

```text
POST /captures  ->  201 { id, outcome: 'pending' }        // < 2s, SC-003a, every tier
                    ...
completion      ->  published via shared/messaging's publisher port
                    Increment 1: in-app recent-captures surface  (REQUIRED — R-08)
                    Increment 7: 014-FR-001 push                 (ADDITIVE)
```

⛔ A capture that resolves `no_recipe` or `unreadable` **also** publishes completion. Silence is
indistinguishable from a lost capture, and acceptance must never depend on a channel the user can switch off.

## Retry and resume (clarification Q4)

Each tier commits its `capture_tier_results` row **before** the next begins. On SQS redelivery the worker
resumes at the first tier with no row (FR-011a). Quota (`004-FR-022`) is charged **once at accept**, never per
attempt (FR-011b). ⛔ The waterfall is **not** idempotent-by-replay and must not be made so — replay re-pays
for billed tiers, and ADR-0024's settle is deliberately never retried.

## Invariants the contract must enforce

1. **`no_recipe` ≠ `unreadable`** (FR-008). Collapsing them is the competitor's documented failure.
2. `tiers` is ordered and contiguous from 1 — a gap means the waterfall short-circuited incorrectly (FR-002).
3. `resolvedTier` non-null **iff** `outcome === 'draft'`.
4. ⛔ **No media is ever returned or stored** — `tiers` carries outcomes, not frames (FR-011, `016-FR-027`).
5. `cost_micros` is **not exposed** on the wire. It is operator telemetry for FR-039, not user-facing.
6. Quota (`004-FR-022`) and attestation (`016-FR-014`) apply identically on every channel (FR-015).

## Errors

Envelope per `@kitchensink/nest-error-envelope`. `429` on quota. A ceiling denial or unreadable spend counter
is **transient** — the message retries under the DLQ policy — because `unresolved` must never be reported as a
verified negative (ADR-0024).
