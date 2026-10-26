# Contract: Reviewer, list and operator surfaces (spec FR-011, FR-019, FR-026–FR-032)

**Owner service**: `packages/services/recipe-service`. The reviewer UI is a queue inside 016's reviewer dashboard
(web only, operator tooling, `016-FR-053a`). It inherits 016's open decision A-11 on `002`'s "no admin UI" exclusion.

## Authorization

- Appeal routes need 016's dedicated **review scope** (`016-FR-053g`), from the token's signed `public_metadata`.
  Shared or role credentials cannot reach them (`016-FR-053f`), and every action records the individual operator.
- The reviewer's read of a held recipe is a **new, scoped read** of a recipe the reviewer does not own. It is
  audited, and it returns the recipe only while an appeal or audit on it is open.
- Marker and enforcement routes need an admin scope distinct from the review scope.

## Appeals

| Method | Path                                               | Purpose                                                        |
| ------ | -------------------------------------------------- | -------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/appeals?state=open`          | The queue, ordered by time left before `dueAt`                 |
| `GET`  | `/api/v1/source-check/appeals/{appealId}`          | The appeal, the held recipe (scoped read), evidence and reason |
| `POST` | `/api/v1/source-check/appeals/{appealId}/decision` | Decide it                                                      |

```text
decision request: {
  decision: 'uphold' | 'overturn'
  ground: string        // required, non-empty: the terms clause or reason relied on
  facts: string         // required, non-empty
}
201: the appeal with its decision
409 SOURCE_CHECK_APPEAL_CLOSED   already decided or withdrawn
422                              ground or facts missing (an incomplete decision is never saved, 016-FR-053b)
```

- `overturn` sets `overturned_at`, recomputes `allows` and writes an `appealOverturned` decision. The recipe becomes
  publicly visible if it is still public and published.
- `uphold` writes an `appealUpheld` decision and issues a statement of reasons naming that a person decided.

## The rightsholder list

| Method   | Path                                 | Purpose                                                          |
| -------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GET`    | `/api/v1/source-check/markers?kind=` | List live markers                                                |
| `POST`   | `/api/v1/source-check/markers`       | Add `{ kind: 'host' \| 'imprint' \| 'template', value, reason }` |
| `DELETE` | `/api/v1/source-check/markers/{id}`  | Retire, with `{ reason }`. Never a hard delete                   |

## The blocking switch

`POST /api/v1/source-check/enforcement` with `{ mode: 'shadow' | 'blocking', reason, evaluationRef? }`.

- `blocking` is refused without an `evaluationRef` naming an evaluation run that met SC-001 and SC-002.
- `blocking` is refused while 016's statement delivery is not available (research R-14).
- Each call appends one `source_check_enforcement_events` row.
