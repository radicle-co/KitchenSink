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
               contentDigest: string      // the digest this outcome belongs to (opaque to clients)
               state: 'checking' | 'decided'
               outcome: 'clear' | 'possible' | 'detected' | 'unchecked' | null   // null while checking
               reason: 'budgetSpent' | 'tooLong' | 'checkFailed' | null          // set iff outcome is 'unchecked'
               publiclyVisible: boolean   // the read rule's answer for this recipe now
               clearedBy: 'reviewer' | 'curatorGrant' | null
               evidence: Array<
                 | { field: 'title' | 'description' | 'tags' | 'ingredient' | 'step' | 'citation'
                     kind: 'isbn' | 'publisherImprint' | 'copyrightNotice' | 'pageReference'
                         | 'paidSiteTemplate' | 'citedPaidSiteHost' | 'modelJudgement'
                     weight: 'blocking' | 'forAPerson'
                     start: number, end: number }          // span in the field's text, for highlighting
                 | { field: 'photo'
                     kind: 'photoCopyrightText' | 'photoWatermarkOrLogo' | 'photoPrintedPage'
                         | 'photoIsbnOrBarcode' | 'photoPublisherName'
                     weight: 'forAPerson'                   // always: a photo signal is never blocking
                     photoId: string }
               >
               referral: null | {
                 origin: 'check' | 'appeal'
                 state: 'open' | 'cleared' | 'held' | 'withdrawn' | 'superseded' | 'resolvedByCheck'
                 dueAt: string            // ISO 8601: the expected wait the cook is shown (spec FR-016c)
                 decidedAt: string | null
               }
               canAppeal: boolean         // detected, or held by a person, and no appeal used for this digest
               statementId: string | null // the statement of reasons, when one was issued
             }
```

- The evidence is a discriminated union on `field`. A photo item has no span and `weight` is the literal
  `'forAPerson'`, so a client cannot render a photo signal as a block.
- The response carries no marker text the owner does not need, and never the shared `shadow` referral state.
- Every enum is closed. A new value is a contract change and a new localisation key, so the sets are one-way doors.
- `publiclyVisible` lets the client say "Public", "Checking before it goes public" or "A person will check this"
  without re-deriving the rule.

## 2. Appeal a hold

`POST /api/v1/recipes/{id}/source-check/appeal`

```text
request:  { contentDigest: string, reason?: string (≤ 2,000 characters) }
201:      the recipe response, with sourceCheck.referral.origin = 'appeal', state = 'open'
409 SOURCE_CHECK_STALE          the content changed
409 SOURCE_CHECK_NOT_APPEALABLE the outcome is not detected and no person held it, or it is already cleared
409 SOURCE_CHECK_APPEAL_USED    an appeal for this digest was already made (spec FR-026a)
409 SOURCE_CHECK_REFERRAL_OPEN  a person is already deciding this digest
404                             not the caller's recipe
```

There is **no confirmation route**. A cook cannot lift a `possible` or `unchecked` hold (owner ruling, 2026-10-26).

## 3. Change the statement: a one-way downgrade (spec FR-015a)

`POST /api/v1/recipes/{id}/source-statement`

```text
request:  {
  sourceType: 'imported_physical' | 'imported_paid'   // nothing else is representable
  citation: string (1–500 characters)                 // book title and page, or the paid site
}
200:      the recipe response: label changed, visibility private, sourceCheck null
409 PRIVATE_SLOTS_EXHAUSTED         no private slot free (ADR-0073 owns this code)
409 SOURCE_STATEMENT_NOT_DOWNGRADE  the label is already private-only
404                                 not the caller's recipe
```

- The label and the visibility change in one transaction, under ADR-0073's per-user lock. The new label is
  private-only, so no check is owed, and an open referral closes as `withdrawn`.
- The new statement and citation are recorded as the recipe's attestation (`004-FR-014a`).
- This route needs ADR-0023 amended first (spec FR-044). Nothing else can change a label after a save.

## 4. What does NOT change

- `POST`/`PATCH /api/v1/recipes` and `PATCH /api/v1/recipes/{id}/visibility` never fail because of an outcome (spec
  FR-014, FR-018). They answer as today. The response's `sourceCheck` says what happens next.
- Setting a held recipe back to draft or private is the ordinary write. It closes an open referral as `withdrawn`.
- The `status` and `visibility` enums do not gain values.
- The `source` field on create keeps its two members (ADR-0023).
