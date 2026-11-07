# Contract: The cook's source-check surface (spec FR-013–FR-017, FR-037)

**Owner service**: `packages/services/recipe-service`.
**Authoring rule** (ADR-0014, GR-015): zod is authored in-service at `src/recipes/sourceCheck/sourceCheck.schema.ts`,
beside its controller, then copied to `packages/schemas/recipe`. Clients import from the schema package and declare
no wire types.
**Prefix** (GR-002): every path begins `/api/v1/`.

## 1. The recipe response gains `sourceCheck` (owner only)

`GET /api/v1/recipes/{id}` and the editor's save responses carry `sourceCheck` **only when the caller owns the
recipe**. Any other viewer never sees it, and never sees a recipe that is checking or in review at all (it answers
`404`, as for a draft).

```text
sourceCheck: null                         // only when the current digest has no check row: never headed public
           | {
               contentDigest: string      // the digest this state belongs to (opaque to clients)
               cookState: 'checking' | 'public' | 'inReview' | 'notApproved'   // spec FR-014a
               holdsSlot: boolean         // inReview and private: "holds a slot until a person checks it" (ADR-0073 §11)
               publiclyVisible: boolean   // the read rule's answer for this recipe now
               evidence: Array<{          // only when cookState is 'notApproved' by the rules (detected); else []
                 field: 'title' | 'description' | 'tags' | 'ingredient' | 'step' | 'citation'
                 kind: 'isbn' | 'publisherImprint' | 'copyrightNotice' | 'paidSiteTemplate' | 'citedPaidSiteHost'
                 start: number, end: number       // span in the field's text, for highlighting
               }>
               referral: null | {
                 origin: 'check' | 'appeal'
                 state: 'open' | 'cleared' | 'notApproved' | 'withdrawn' | 'superseded' | 'resolvedByCheck'
                                          // a deferred referral (spec FR-030b) reads 'open': the cook sees no cap
                 queueSince: string       // ISO 8601: when it first entered review. No decision time is promised
                 decidedAt: string | null
               }
               rejection: null | {        // only when a PERSON did not approve it (spec FR-027)
                 reason: 'book' | 'paidSite' | 'notYours' | 'printedPage' | 'other'   // recipe.review.reason.*
                 note: string | null      // the reviewer's note, word for word
               }
               canAppeal: boolean         // not approved, and no appeal used for this digest
               statementId: string | null // the statement of reasons, when one was issued
             }
```

- **`sourceCheck` is present whenever the current digest has a check row**: a recipe checking, in review, public after
  a check, not approved (which is private, and still carries `cookState: 'notApproved'`, `canAppeal` and
  `statementId`), or a bulk-imported recipe, public or private, whose check has run (spec FR-003b). It is `null` only for a recipe never
  headed public, such as a plain private recipe or a draft the cook never meant to publish.
- **One message for every cause while in review** (owner ruling, 2026-10-26, spec FR-016c). For `inReview` the response carries no
  outcome value, no reason, no part results and no evidence. Every cause, from a page reference to a photo signal, a
  match in our database (public or private), a source decision, a spent budget or a failed check, gives the same
  response. The client shows "In review: a person will check this before it goes public".
- **`notApproved` by the rules** carries the rule evidence the cook's own text holds, because the rules read only the
  cook's own content and the statement of reasons names it. A model item is never shown, because it does not reject the recipe automatically. It holds the recipe for a person.
- **`notApproved` by a person** carries `rejection`: the one reason the reviewer chose and their note, word for word
  (owner ruling, 2026-10-26, spec FR-027). It never names or links another recipe, and `notYours` can only come from a
  match against a public recipe. "In review" and "Checking" stay generic.
- **Checking.** Before the outcome's `reveal_at`, the response reads `cookState: 'checking'` and `publiclyVisible:
false`, whatever the worker has written (spec FR-051's timing floor). A rule-only `detected` is decided in the save,
  so its response is `notApproved` at once.
- A contract test runs one case per cause, including a public and a private earlier recipe, and asserts byte-equal
  responses apart from ids and times (SC-017).
- The response never carries the shared `shadow` referral state. In shadow mode nothing is held, so `cookState`
  follows the stored visibility.
- Every enum is closed. A new value is a contract change and a new localisation key, so the sets are one-way doors.
- `cookState` lets the client say "Checking", "Public", "In review" or "Not approved" without re-deriving the rule. It
  comes from the same classifier as the hold Specification (spec FR-018).

### Refusals the cook can meet (spec FR-018)

```text
403 SOURCE_DETECTED_NO_PRIVATE_SLOT   a publish the rules block, by a free cook with no free private slot. Carries
                                      the evidence and ADR-0073's used and limit. Nothing is saved. Saving it as a
                                      draft is always allowed, because a draft uses no slot (001-FR-003b).
403 SOURCE_CHECK_NOT_APPROVED         a change to public of content whose review ended without approval
403 PRIVATE_SLOTS_FULL                a move from In review to Private with no free slot (ADR-0073 owns this code)
```

- **All three are `403`, never `409`.** These refusals reach the existing recipe and visibility routes, which
  installed apps already call. The recipe client treats any unknown `409` as a version conflict, so an older app would
  open the conflict view. ADR-0073 chose `403` for `PRIVATE_SLOTS_FULL` for the same reason. An older app shows its
  generic refusal; a new one reads the code.
- All three apply only while blocking is on. The editor outbox treats each as final and parks the record for the
  cook (ADR-0057, ADR-0073's owed outbox rule), never re-sending it.
- Saving a change to the text, photos or source of a recipe in review is never refused. It starts a new check and
  replaces the open referral, and the editor warns before the save.

## 2. Appeal a "not approved" decision

`POST /api/v1/recipes/{id}/source-check/appeal`

```text
request:  { contentDigest: string, reason?: string (≤ 2,000 characters) }
201:      the recipe response, with sourceCheck.referral.origin = 'appeal', state = 'open'. The recipe stays private
          while the appeal waits; an overturn makes it public
409 SOURCE_CHECK_STALE          the content changed
409 SOURCE_CHECK_NOT_APPEALABLE the recipe is not "not approved", or it is already cleared
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
200:      the recipe response: label changed, visibility private, sourceCheck null. A not-approved recipe is already
          private, so it needs no free slot
403 PRIVATE_SLOTS_FULL              no private slot free (ADR-0073 owns this code)
409 SOURCE_STATEMENT_NOT_DOWNGRADE  the label is already private-only
404                                 not the caller's recipe
```

- The label and the visibility change in one transaction, under ADR-0073's per-user lock. The new label is
  private-only, so no check is owed, and an open referral closes as `withdrawn`. The source statement is part of the
  content digest (spec FR-005a), so the digest changes in the same transaction.
- The new statement and citation are recorded as the recipe's attestation (`004-FR-014a`).
- This route needs ADR-0023 amended first (spec FR-044). Nothing else can change a label after a save.

## 4. What does NOT change

- `POST`/`PATCH /api/v1/recipes` and `PATCH /api/v1/recipes/{id}/visibility` fail because of an outcome only in the
  refusals of section 1 (spec FR-018). Otherwise they answer as today, and the response's `sourceCheck` says what
  happens next.
- Setting a recipe in review back to Draft, or to Private, is the ordinary write. It closes the open referral as
  `withdrawn`. Private needs a free slot, as always.
- The `status` and `visibility` enums do not gain values.
- The `source` field on create keeps its two members (ADR-0023).
