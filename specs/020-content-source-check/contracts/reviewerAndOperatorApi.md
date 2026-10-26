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

| Method | Path                                                   | Purpose                                                                                                                                                              |
| ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/referrals?state=open&groupBy=`   | The queue, oldest first. `groupBy=cook\|import` groups related referrals, a curated book included, and lists the group's `deferred` ones too (spec FR-030a, FR-030b) |
| `GET`  | `/api/v1/source-check/referrals/{referralId}`          | The referral, the recipe text and photos (scoped read), every signal and where it is, the cook's statement and citation, and an appeal's reason                      |
| `POST` | `/api/v1/source-check/referrals/{referralId}/decision` | Decide it                                                                                                                                                            |

```text
decision request: {
  decision: 'approve' | 'notApprove'
  ground: 'rightsToUpload' | 'publishedSourceEvidence' | 'sourceNotConfirmed'   // closed set, cook-facing
        | 'ownWorkConfirmed' | 'publicSourceConfirmed'
  note: string          // required, non-empty, ≤ 2,000 characters: the reviewer's own words, staff only
  shownOutcome: 'possible' | 'detected' | 'unchecked'   // what the reviewer saw (compare-and-set, spec FR-016d)
  shownEvidenceRef: string
}
201: the referral with its decision
409 SOURCE_CHECK_REFERRAL_CLOSED   already decided, withdrawn, superseded, expired or resolved by the check
409 SOURCE_CHECK_OUTCOME_MOVED     the outcome or its evidence changed since the reviewer opened it: re-read
409 SOURCE_CHECK_SAME_REVIEWER     an appeal of this reviewer's own hold, while another reviewer is on duty (FR-026a)
422                                ground or note missing (an incomplete decision is never saved, 016-FR-053b)
```

- The decision locks the referral row, then the check row, and changes the outcome only by a compare-and-set on
  `shownOutcome` and `shownEvidenceRef` (spec FR-016d). A re-check that won the race makes this answer
  `SOURCE_CHECK_OUTCOME_MOVED`, never a clearance of an outcome the reviewer did not see.
- `approve` records the clearance with the outcome and evidence it cleared, recomputes `allows` and writes a
  `referralCleared` (or `appealOverturned`) decision. The recipe becomes publicly visible if it is still public and
  published.
- `notApprove` writes a `referralNotApproved` (or `appealUpheld`) decision. In the same transaction review ends and the
  recipe becomes the cook's private recipe, under ADR-0073's lock, even with no free slot (the cook is then over the
  limit). It issues a statement of reasons that says automated means flagged the recipe and a person decided, with a
  generic ground and no detail of what matched (spec FR-014a, FR-028). The same unchanged content cannot enter review
  again.
- The queue orders by `queue_since`, the time the recipe first entered review, so a cook's edits never push it back
  (spec FR-030a).
- **The note never reaches the cook.** The statement takes the ground's localised text and the facts from the check.
  A match fact is always the one generic fact (spec FR-027), so a reviewer cannot disclose another cook's private
  recipe through the statement.
- A `donation` referral (spec FR-018a) shows the erasure deadline. Its decision delivers no in-app statement, because
  the account is closed, and records `statement_undeliverable` if the account is gone before email can be sent.
- A queue entry shows `origin`, how long it has waited, and each part's result. No due time exists (spec FR-030).
- The referral detail carries every **match** from our own database (spec FR-049): its kind, similarity, the row of
  spec FR-047 that applied, its effect, and the earlier decision. A match against another cook's **private** recipe
  carries the decision only, never that recipe's content.
- The reviewer sees the cook's statement and citation. Only the model is kept from them (spec FR-027a).

## The forecast (spec FR-039a): information only

| Method | Path                            | Purpose                                                                                                                                                                                    |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/source-check/forecast` | Referrals per day by origin and by the part that was not green, minutes per referral measured, staff time needed, for ordinary publishing, a budget-spent month and a curated book backlog |

It gates nothing. There is no staffing route (owner, 2026-10-26: "we can deal with SLO/SLA later").

## Source decisions (spec FR-050)

| Method | Path                                                | Purpose                                                                |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/source-decisions?kind=&key=`  | Live decisions for a source key (`page`, `host`, `isbn`)               |
| `POST` | `/api/v1/source-check/source-decisions`             | Record `{ keyKind, keyValue, decision: 'approve' \| 'block', reason }` |
| `POST` | `/api/v1/source-check/source-decisions/{id}/retire` | Retire, with `{ reason }`. Never a hard delete                         |

- Review scope, staff only. Clearing or holding one recipe never writes a source decision by itself.
- Retiring or reversing a source decision changes no outcome already produced, and undoes no person's past decision.
  Only later checks see the change (spec FR-050).
- Retire is a `POST` to a sub-resource, not a `DELETE`, because the row is never deleted. The table is retire-only:
  the service role has no DELETE on it (data-model §10).

## The rightsholder list

| Method | Path                                       | Purpose                                                          |
| ------ | ------------------------------------------ | ---------------------------------------------------------------- |
| `GET`  | `/api/v1/source-check/markers?kind=`       | List live markers                                                |
| `POST` | `/api/v1/source-check/markers`             | Add `{ kind: 'host' \| 'imprint' \| 'template', value, reason }` |
| `POST` | `/api/v1/source-check/markers/{id}/retire` | Retire, with `{ reason }`. Never a hard delete                   |

## The blocking switch

`POST /api/v1/source-check/enforcement` with `{ mode: 'blocking' | 'paused', reason, evaluationRef? }`.

```text
201: the new mode
409 SOURCE_CHECK_MODE_MOVE_REFUSED   not a legal move (shadow → blocking, blocking → paused, paused → blocking)
422                                  blocking without an evaluationRef
409 SOURCE_CHECK_DELIVERY_MISSING    blocking while 016's statement delivery is not available
```

- `shadow` is not a value this route accepts. Nothing returns to shadow (spec FR-019). The database refuses the move
  too, by a trigger, so the route is not the only guard.
- `blocking` is refused without an `evaluationRef` naming an evaluation run that met SC-001, SC-002 and SC-015.
- `paused` is the rollback. It stops new holds and keeps existing ones, because each outcome carries the mode it was
  stamped with (data-model §3).
- Each call appends one `source_check_enforcement_events` row. The table is append-only.
