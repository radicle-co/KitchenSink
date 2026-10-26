# Contract: The cook's source-check surface (spec FR-013–FR-017, FR-037)

**Owner service**: `packages/services/recipe-service`.
**Authoring rule** (ADR-0014, GR-015): zod is authored in-service at `src/recipes/sourceCheck/sourceCheck.schema.ts`,
beside its controller, then copied to `packages/schemas/recipe`. Clients import from the schema package and declare
no wire types.
**Prefix** (GR-002): every path begins `/api/v1/`.

## 1. The recipe response gains `sourceCheck` (owner only)

`GET /api/v1/recipes/{id}` and the editor's save responses carry `sourceCheck` **only when the caller owns the
recipe**. Any other viewer never sees it, and never sees a held recipe at all (it answers `404`, as for a draft).

```text
sourceCheck: null                         // no check owed: private, or a private-only label
           | {
               textDigest: string         // the digest this outcome belongs to (opaque to clients)
               state: 'checking' | 'decided'
               outcome: 'clear' | 'possible' | 'detected' | 'unchecked' | null   // null while checking
               reason: 'budgetSpent' | 'tooLong' | 'checkFailed' | null          // set iff outcome is 'unchecked'
               publiclyVisible: boolean   // the read rule's answer for this recipe now
               needsConfirmation: boolean // possible or unchecked, and not yet confirmed
               evidence: Array<{
                 kind: 'isbn' | 'publisherImprint' | 'copyrightNotice' | 'pageReference'
                     | 'paidSiteTemplate' | 'citedPaidSiteHost' | 'modelJudgement'
                 blocking: boolean        // from the code table, for this recipe's label
                 field: 'title' | 'description' | 'tags' | 'ingredient' | 'step' | 'citation'
                 start: number            // span in the field's text, so the client can highlight it
                 end: number
               }>
               appeal: null | { state: 'open' | 'upheld' | 'overturned' | 'withdrawn', dueAt: string, decidedAt: string | null }
               statementId: string | null // the statement of reasons, when one was issued
             }
```

- The evidence spans index the recipe text the owner already holds. The response carries no marker text it does not
  need.
- Every enum is closed. A new value is a contract change and a new localisation key, so the sets are one-way doors.
- `publiclyVisible` lets the client say "Public" or "Checking before it goes public" without re-deriving the rule.

## 2. Confirm the statement

`POST /api/v1/recipes/{id}/source-check/confirmation`

```text
request:  { textDigest: string }
200:      the recipe response, with sourceCheck.needsConfirmation = false
409 SOURCE_CHECK_STALE         the digest is not the recipe's current one (the text changed)
409 SOURCE_CHECK_NOT_CONFIRMABLE  the outcome is clear or detected, or the check is still running
404                            not the caller's recipe
```

- Idempotent: a second confirmation of the same digest answers `200` and changes nothing.
- The confirmation is recorded with the evidence that was shown (spec FR-017).

## 3. Appeal a `detected` outcome

`POST /api/v1/recipes/{id}/source-check/appeal`

```text
request:  { textDigest: string, reason?: string (≤ 2,000 characters) }
201:      the recipe response, with sourceCheck.appeal.state = 'open'
409 SOURCE_CHECK_STALE         the text changed
409 SOURCE_CHECK_NOT_APPEALABLE the outcome is not detected, or it is already overturned
409 SOURCE_CHECK_APPEAL_OPEN   an appeal for this digest is open
404                            not the caller's recipe
```

## 4. What does NOT change

- `POST`/`PATCH /api/v1/recipes` and `PATCH /api/v1/recipes/{id}/visibility` never fail because of an outcome (spec
  FR-014, FR-018). They answer as today; the response's `sourceCheck` says what happens next.
- The `status` and `visibility` enums do not gain values.
- The `source` field on create keeps its two members (ADR-0023).
