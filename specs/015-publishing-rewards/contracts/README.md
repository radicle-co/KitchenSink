# Phase 1 — Interface Contracts: 015 Publishing Rewards

**Created**: 2026-08-22

⚠️ **These are DESIGN artifacts, not the shipping contract.** Per **ADR-0014**, a service owns its wire types:
the authoritative zod is authored in-service at
`packages/services/recipe-service/src/rewards/rewards.schema.ts`, beside the controller it validates, and a
committed **copy** lives at `packages/schemas/recipe`. `openapi.yaml` is **derived output** for `oasdiff`,
docs and integrators — it is **never a codegen input**, because deriving types through JSON Schema loses
`readonly`, branded and template-literal types and flattens discriminated unions.

This directory therefore describes the intended surface so it can be reviewed before task `E046` authors the
real thing. Nothing here is imported by any client.

## Endpoints

### `POST /api/v1/recipes/{recipeId}/publish`

Makes a recipe public and, where eligible, grants the reward.

**Request**: `{ attestation: { authored: true, acceptedAt: string } }`

`attestation` is **required and per-recipe** (`FR-002`). A blanket terms acceptance MUST NOT substitute.

**Responses**

| Status | Meaning                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- |
| `200`  | Published. Body states whether a grant was made and, if not, **why** (`FR-008`, `FR-011`) |
| `400`  | Attestation absent or declined — publication does not proceed (`FR-002`)                  |
| `403`  | Provenance forbids publication (`imported_physical`, `imported_paid`) — reason stated     |
| `404`  | Not found, or not the owner (IDOR-safe: indistinguishable from absent)                    |

⚠️ **A `200` with `granted: false` is a normal, expected outcome, not an error.** Ineligibility, the
`FR-007c` ceiling, and the `FR-010` rate limit all publish successfully without granting. Modelling any of
them as a failure status would contradict `FR-007c`, `FR-010` and `FR-011`.

**Response body shape**

```
{
  listingId: string,
  granted: boolean,
  grant?: { kind: 'slot', amount: number },
  reason?: string,          // present iff granted === false; user-facing, localized key
  balance: { slots: number, ceiling: number, position: number }
}
```

### `DELETE /api/v1/recipes/{recipeId}/publish`

Unpublishes. **MUST NOT** reverse any grant (`FR-012`), and MUST NOT warn of forfeiture at any point.

| Status | Meaning                          |
| ------ | -------------------------------- |
| `200`  | Private again; balance unchanged |
| `404`  | Not found or not owner           |

**Contract constraint** (`FR-029`): this path MUST require no more steps than publish. Asserted by `TC064`.

### `GET /api/v1/rewards/me`

Balance, schedule position, and the append-only ledger (`FR-009`, `FR-007a-i`).

```
{
  balance: { slots: number, ceiling: number, position: number },
  nextGrant: { amount: number } | null,     // null once the ceiling is reached
  ledger: Array<{ grantedAt, kind, amount, listingId, reversedAt?, reversalReason? }>
}
```

⛔ **`FR-010c`: on a read failure this endpoint's consumers MUST render _unavailable_, never a zero balance.**
A zero silently tells a user they cannot make a recipe private when in fact they can. The client contract is
therefore three-state — `loaded | unavailable | loading` — and MUST NOT collapse `unavailable` to `0`.

## Not in this surface

- Contributor standing and impact signals are rendered by **012** (`FR-032`); 015 emits facts through
  `standing.port.ts` and owns no public profile endpoint.
- No endpoint grants, reverses, or adjusts a reward directly. Grants are a consequence of publishing; reversal
  is a consequence of a takedown (`FR-016`), owned by **016**.
