# Wire Contracts — Legal Compliance Framework

**Feature**: [016](../spec.md) · **Plan**: [plan.md](../plan.md) · **Data model**: [data-model.md](../data-model.md)

## Ownership and authoring — read before writing a line of this

Per `GR-015` / `GR-017` and ADR-0014, and stated explicitly because GR-017 §17-e.12 records that skipping the
client half is the portfolio's **most common violation** (measured: not one of fourteen `tasks.md` files
carried a schema-package, `CONTRACT_HASH` or receipt-validation task):

| Concern            | Location                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authored zod**   | `packages/services/identity/src/{legal,consent,notices,dsar}/*.schema.ts`, beside the controller it validates                              |
| **Committed copy** | `packages/schemas/identity` — `z.infer` types, `CONTRACT_HASH`, derived `openapi.yaml`                                                     |
| **Clients**        | `@commise/features-account`, web, mobile — **declare zero wire types**; divergent consumer shapes are derived with `Pick`/`Omit`/`Partial` |
| **Intake Lambda**  | `packages/services/identity-webhooks/src/handlers/noticeIntake.ts` — validates with the **same** zod                                       |

`z.strictObject()` on every mutating body (`GR-016`). One rejection path per ingress with the cause in a
`reason` (`GR-018`). `openapi.yaml` is **derived output** — never a codegen input.

---

## A. Public — no account required

Hosted on the `identity-webhooks` API Gateway, **not** the identity ECS service, so an outage of the app is
not an outage of the ability to receive notices (`NFR-006`, [R1](../research.md#r1)).

### `POST /api/v1/notices`

Submit a notice about specific content. `FR-016`.

**Request**

```jsonc
{
    "reporter": { "name": "string", "email": "string" },
    "target": { "contentType": "recipe|creator_profile|lesson", "contentId": "string" },
    "grounds": "copyright|trademark|privacy|illegal_content|terms_violation|other",
    "statement": "string", // the reporter's own words
}
```

**`202 Accepted`**

```jsonc
{ "reference": "string", "submittedAt": "2026-08-22T09:00:00.000Z" }
```

Acknowledgement is issued on acceptance, not on adjudication — `SC-002` measures reference-in-hand within 3
minutes of arrival, and adjudication is human and asynchronous.

**Rejections** — one path, cause in `reason` (`GR-018`): `400` invalid shape; `429` rate-limited. ⛔ A `429`
MUST still record the notice as `declined` with a reason ([R8](../research.md#r8)) — rate limiting throttles
processing, it never refuses receipt.

### `GET /api/v1/notices/{reference}`

Reporter-facing status. Returns state and decision date only — never the uploader's identity.

```jsonc
{
    "reference": "string",
    "state": "received|under_review|actioned|no_action|declined|counter_noticed|restored|upheld",
    "decidedAt": "string|null",
}
```

---

## B. Authenticated — identity service

### `GET /api/v1/legal/documents/{documentId}?version=&locale=`

Render a legal document. `documentId` ∈ `terms|privacy|community|infringer`. Omitting `version` returns the
currently effective one; passing a version returns exactly that version, which is what makes `FR-003`'s
"render any version a given user accepted" real.

### `GET /api/v1/legal/acceptance-status`

```jsonc
{
    "current": true,
    "outstanding": [{ "documentId": "terms", "version": "2026-09-01", "material": true }],
}
```

Derived by `acceptancePolicy.ts`, never stored ([data-model §1](../data-model.md)). `outstanding` non-empty
with `material: true` is what gates content creation (`FR-001`, `FR-006`).

### `POST /api/v1/legal/acceptances`

```jsonc
{ "documentId": "terms", "version": "2026-09-01", "locale": "en-US" }
```

`201`. Append-only; re-accepting the same version is idempotent and does not create a second row.

### `GET /api/v1/consents` · `PUT /api/v1/consents/{purpose}`

`PUT` body `{ "granted": true｜false }`. Withdrawal sets `withdrawn_at`; the row is never deleted (`FR-035`).
A special-category purpose may only ever carry `lawfulBasis: "consent"` — enforced in `consentPolicy.ts`
(`FR-036`).

### `POST /api/v1/dsar/exports` · `GET /api/v1/dsar/exports/{id}`

`202` with `{ "id", "deadlineAt" }`. `GET` returns state and, when `ready`, a **time-limited derived link** —
the link is never stored (`FR-034`, [R7](../research.md#r7)).

### `POST /api/v1/notices/{id}/counter-notices`

The uploader's challenge. Authenticated, and only the content's owner may submit (`FR-019`).

---

## D. Reviewer — identity service, behind the review scope

Guarded by the existing `ScopesGuard` / `@RequireScopes` with a **dedicated review scope**, so reviewing
notices confers exactly that and nothing else (`FR-053g`). Every call is attributed to the individual
authenticated operator (`FR-053f`) — `FR-017` requires knowing _who_ decided, so shared credentials must not
reach these routes.

### `GET /api/v1/admin/notices?state=&overdue=`

The triage queue, **ordered by time remaining against `decision_due_at`**, not by raw age (`FR-053a`) — a
20-hour-old copyright notice outranks a 3-day-old terms report.

```jsonc
{
    "items": [
        {
            "reference": "string",
            "state": "received|under_review|actioned|...",
            "grounds": "copyright|...",
            "target": { "contentType": "recipe", "contentId": "string" },
            "submittedAt": "string",
            "decisionDueAt": "string",
            "overdue": false,
        },
    ],
}
```

### `POST /api/v1/admin/notices/{id}/decisions`

Author a decision. ⛔ `z.strictObject()` with **every field required** — `FR-053b` forbids persisting a
decision without an action, a ground and the facts. There is no draft state, because a draft is exactly what
gets mistaken for a decision.

```jsonc
{
    "action": "removed|disabled|demoted|restricted|no_action",
    "ground": "string",
    "facts": "string",
    "automatedMeans": false,
    "includeDerivedCopies": true,
}
```

Response carries the delivery state per channel, so an undelivered email is visible immediately rather than
discovered by an alert later.

### `GET /api/v1/admin/accounts/{id}/standing`

Strike history and the repeat-infringer recommendation together (`FR-053d`).

```jsonc
{
    "strikes": [{ "noticeReference": "string", "accruedAt": "string", "reversedAt": "string|null" }],
    "liveStrikeCount": 2,
    "windowMonths": 12,
    "recommendation": "terminate|no_action",
}
```

⛔ The policy **recommends**; it never executes. Termination is a separate deliberate call (`FR-053d`).

### `POST /api/v1/admin/legal-holds` · `DELETE /api/v1/admin/legal-holds/{id}`

Place or lift a hold that suspends the retention purge. `reason` and `placedBy` are required and substantive —
a hold without a recorded reason is the retention defect it exists to prevent (`FR-052c`).

### Read-only by construction

⛔ There is **no** endpoint in this section that updates an acceptance record, a reporter's statement, or a
delivered statement of reasons (`FR-053e`). Their absence is the enforcement — a record an operator can
rewrite is not evidence, and this is the surface where adding such a route would be easiest and worst.

---

## C. Internal — service-to-service

Reuses the existing fan-out path and its token, not a new mechanism
(`common/erasureFanout.ts`, `common/serviceErasureToken.ts` — [R2](../research.md#r2)).

### `POST /api/v1/internal/content/action`

Identity → the owning service, when a decision requires content to change.

```jsonc
{
    "contentType": "recipe",
    "contentId": "string",
    "action": "removed|disabled|demoted|restricted",
    "includeDerivedCopies": true, // FR-022 — removing only the original is NOT compliance
    "noticeReference": "string",
}
```

Response reports what was actioned, **including the derived copies**, so
`notice_decisions.derived_copies_actioned` records a fact rather than an intention.

### `POST /api/v1/internal/content/de-identify`

Erasure's counterpart: strip an erased user's identifying attribution from surviving clones while retaining a
non-identifying provenance marker (`GR-014` AC-014-i, `001-FR-005d`).

---

## Contract-skew guards

Three, per `GR-015` §15-c — each is a task, not an intention:

1. **`CONTRACT_HASH` boot assertion** in the identity service and in the intake Lambda.
2. **Receipt validation** in every client of these endpoints, including `@commise/features-account`.
3. **Outbound validation** against the callee's zod on both internal endpoints above, in both directions.
