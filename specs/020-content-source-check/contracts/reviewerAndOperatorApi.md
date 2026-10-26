# Contract: Reviewer, list and operator surfaces (spec FR-011, FR-016, FR-019, FR-026–FR-032, FR-039a)

**Owner service**: `packages/services/recipe-service`. The reviewer UI is a queue inside 016's reviewer dashboard
(web only, operator tooling, `016-FR-053a`). It inherits 016's open decision A-11 on `002`'s "no admin UI" exclusion.

## Authorization

- Referral routes need 016's dedicated **review scope** (`016-FR-053g`), from the token's signed `public_metadata`.
  Shared or role credentials cannot reach them (`016-FR-053f`), and every action records the individual operator.
- The reviewer's read of a held recipe and its photos is a **new, scoped read** of content the reviewer does not own.
  It is audited, and it returns the recipe only while a referral or audit on it is open. Photos are served to the
  reviewer through short-lived signed URLs, not the public delivery path.
- Marker and enforcement routes need an admin scope distinct from the review scope.

## Referrals

| Method | Path                                                   | Purpose                                                                                                                                         |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/referrals?state=open&groupBy=`   | The queue, ordered by time left before `dueAt`. `groupBy=cook\|import` groups related referrals (spec FR-030a)                                  |
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
- A queue entry shows `origin`, `dueAt`, how long it has waited, and whether it is overdue.
- The reviewer sees the cook's statement and citation. Only the model is kept from them (spec FR-027a).

## Staffing and the forecast (spec FR-039a, FR-039b, SC-011)

| Method | Path                            | Purpose                                                                                                                                       |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/forecast` | Referrals per day by origin over a window, minutes per referral measured, reviewer time needed, and the same for the last budget-spent period |
| `PUT`  | `/api/v1/source-check/staffing` | Record the named reviewers and weekly hours. Each change is a new ledger row                                                                  |

## The rightsholder list

| Method   | Path                                 | Purpose                                                          |
| -------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GET`    | `/api/v1/source-check/markers?kind=` | List live markers                                                |
| `POST`   | `/api/v1/source-check/markers`       | Add `{ kind: 'host' \| 'imprint' \| 'template', value, reason }` |
| `DELETE` | `/api/v1/source-check/markers/{id}`  | Retire, with `{ reason }`. Never a hard delete                   |

## The blocking switch

`POST /api/v1/source-check/enforcement` with `{ mode: 'shadow' | 'blocking', reason, evaluationRef?, staffingRef? }`.

- `blocking` is refused without an `evaluationRef` naming an evaluation run that met SC-001 and SC-002.
- `blocking` is refused without a `staffingRef` whose hours cover the forecast as SC-011 requires.
- `blocking` is refused while 016's statement delivery is not available (research R-14).
- Each call appends one `source_check_enforcement_events` row.
