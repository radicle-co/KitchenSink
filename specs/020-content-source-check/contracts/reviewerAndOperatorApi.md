# Contract: Reviewer, list and operator surfaces (spec FR-011, FR-016, FR-019, FR-026–FR-032, FR-039a, FR-049, FR-050)

**Owner service**: `packages/services/recipe-service`. The reviewer UI is a queue inside 016's reviewer dashboard
(web only, operator tooling, `016-FR-053a`). It inherits 016's open decision A-11 on `002`'s "no admin UI" exclusion.

## Authorization

- **Reviewers are employees**, never users or the community (spec FR-026b; owner, 2026-10-26: "the person reviewing
  these recipes are employees - not users"). Referral routes need 016's dedicated **review scope** (`016-FR-053g`),
  from the token's signed `public_metadata`, and that scope is granted only to staff accounts. Shared or role
  credentials cannot reach them (`016-FR-053f`), and every action records the individual employee.
- The reviewer's read of a held recipe and its photos is a **new, scoped read** of a cook's content by staff. It needs
  the security review the plan names before it ships. It is logged per read, and it returns the recipe only while a
  referral or audit on it is open. Photos are served to the
  reviewer through short-lived signed URLs, not the public delivery path.
- Marker and enforcement routes need an admin scope distinct from the review scope.

## Referrals

| Method | Path                                                   | Purpose                                                                                                                                         |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/referrals?state=open&groupBy=`   | The queue, oldest first. `groupBy=cook\|import` groups related referrals, a curated book included (spec FR-030a)                                |
| `GET`  | `/api/v1/source-check/referrals/{referralId}`          | The referral, the recipe text and photos (scoped read), every signal and where it is, the cook's statement and citation, and an appeal's reason |
| `POST` | `/api/v1/source-check/referrals/{referralId}/decision` | Decide it                                                                                                                                       |

```text
decision request: {
  decision: 'clear' | 'hold'
  ground: string        // required, non-empty: the terms clause or reason relied on
  facts: string         // required, non-empty
}
201: the referral with its decision
409 SOURCE_CHECK_REFERRAL_CLOSED   already decided, withdrawn, superseded or resolved by the check
409 SOURCE_CHECK_SAME_REVIEWER     an appeal of this reviewer's own hold, while another reviewer is on duty (FR-026a)
422                                ground or facts missing (an incomplete decision is never saved, 016-FR-053b)
```

- `clear` sets `cleared_by = 'reviewer'`, recomputes `allows` and writes a `referralCleared` decision. The recipe
  becomes publicly visible if it is still public and published.
- `hold` writes a `referralHeld` decision and issues a statement of reasons that says automated means found the
  signals and a person decided.
- A queue entry shows `origin`, how long it has waited, and each part's result. No due time exists (spec FR-030).
- The referral detail carries every **match** from our own database (spec FR-049): its kind, similarity, relation and
  the earlier decision. A match against another cook's **private** recipe carries the decision only, never that
  recipe's content.
- The reviewer sees the cook's statement and citation. Only the model is kept from them (spec FR-027a).

## The forecast (spec FR-039a): information only

| Method | Path                            | Purpose                                                                                                                                                                                    |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/source-check/forecast` | Referrals per day by origin and by the part that was not green, minutes per referral measured, staff time needed, for ordinary publishing, a budget-spent month and a curated book backlog |

It gates nothing. There is no staffing route (owner, 2026-10-26: "we can deal with SLO/SLA later").

## Source decisions (spec FR-050)

| Method   | Path                                               | Purpose                                                                |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/v1/source-check/source-decisions?kind=&key=` | Live decisions for a source key (`page`, `host`, `isbn`)               |
| `POST`   | `/api/v1/source-check/source-decisions`            | Record `{ keyKind, keyValue, decision: 'approve' \| 'block', reason }` |
| `DELETE` | `/api/v1/source-check/source-decisions/{id}`       | Retire, with `{ reason }`. Never a hard delete                         |

- Review scope, staff only. Clearing or holding one recipe never writes a source decision by itself.

## The rightsholder list

| Method   | Path                                 | Purpose                                                          |
| -------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GET`    | `/api/v1/source-check/markers?kind=` | List live markers                                                |
| `POST`   | `/api/v1/source-check/markers`       | Add `{ kind: 'host' \| 'imprint' \| 'template', value, reason }` |
| `DELETE` | `/api/v1/source-check/markers/{id}`  | Retire, with `{ reason }`. Never a hard delete                   |

## The blocking switch

`POST /api/v1/source-check/enforcement` with `{ mode: 'shadow' | 'blocking', reason, evaluationRef? }`.

- `blocking` is refused without an `evaluationRef` naming an evaluation run that met SC-001, SC-002 and SC-015.
- `blocking` is refused while 016's statement delivery is not available (research R-14).
- Each call appends one `source_check_enforcement_events` row.
