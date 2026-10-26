# Contract: Worker message, model calls and statement template (spec FR-006–FR-010, FR-020–FR-023a, FR-028, FR-029)

## 1. The queue message

recipe-service sends one message per `(recipeId, contentDigest)` that needs a model check. It carries **no recipe
text and no photo**, so no user content sits in a queue or a DLQ.

```text
SourceCheckRequested {
  recipeId: string (uuid)
  contentDigest: string     // 'v1:' + hex
  ruleSetVersion: string
}
```

- The worker reads the checked text from the database and each photo's check rendition from the photo bucket, and
  recomputes the digest
  with the one `checkedContentDigest` function. A mismatch (the content changed since the send) ends the message with
  no spend: a newer message owns the new digest.
- **Claim before reserve, per part** (ADR-0024 layer 0a): for the text and for each photo, one statement claims that
  part. Zero rows returned means another delivery holds it, or an evidence set for that part, rule set and model already
  exists. Either way, that part costs nothing, and only the parts that changed are called.
- Own queue, own DLQ, own Lambda, own reserved concurrency. A DLQ handler writes `unchecked` (`checkFailed`) so no
  recipe waits forever, and a sweeper enforces the 24-hour limit (spec FR-022). The sweeper's schedule ships disabled
  outside prod (ADR-0060).
- The worker gains **read** access to the check renditions in the photo bucket, and nothing else in it.

## 2. The model calls

- Call site: `source-check`, the sixth entry in `SPEND_CALL_SITES`, through `gatedLlm.ts` (reserve, call, settle;
  settle is never retried).
- Grantee: the existing verification role. No second grantee (ADR-0024 layer 4b).
- Model: an in-region model from the registry that takes images (research R-05), so no residency approval is needed.
- One recipe is **one text call plus one call per photo**. Each call has its own reservation. A photo call that the
  ceiling denies does not stop the others, but the set is then not `ran`, so the outcome is `unchecked`.

### Reserving a photo call at its worst case (spec FR-023a)

- Each photo is sent as its **check rendition**, which recipe-service made with `sharp` at upload confirm, at a fixed
  maximum size. The worker does no image processing.
- The model's documented token cost for an image of that maximum size is the photo's **token ceiling**. The bake-off
  measures it, and a unit test pins the ceiling against the resize bound.
- Reservation for one photo call = (system prompt + photo ceiling) × input price + output cap × output price.
- Worst case for one recipe = the text call's reservation + 10 × the photo call's reservation (`MAX_RECIPE_PHOTOS`).
- A photo with no check rendition (it failed to render at confirm) is not sent. The outcome is `unchecked`
  (`checkFailed`). The rendition's bound is asserted at confirm, so an over-bound rendition cannot exist.

### Prompt builders

- `buildSourceCheckTextPrompt(text: CheckedText)` and `buildSourceCheckPhotoPrompt(photo: CheckedPhoto)`, where
  `CheckedText` and `CheckedPhoto` are branded types that only `checkedContentOf(recipe)` produces. Each parameter list
  is pinned with `Exact<Parameters<…>, [CheckedText]>` or `[CheckedPhoto]`, so a second parameter fails the build
  (spec FR-008, SC-008). Each system prompt is pinned by length and SHA-256.
- Caps: explicit `maxTokens`, and a hard input cap. Over the cap: no call, outcome `unchecked` (`tooLong`) unless the
  rules found blocking evidence.

### Model output (zod-parsed; anything else is a `failed` run)

Text call:

```text
{
  evidence: Array<{                      // at most 12 items
    kind: 'publisherImprint' | 'copyrightNotice' | 'pageReference' | 'paidSiteTemplate' | 'modelJudgement'
    field: 'title' | 'description' | 'tags' | 'ingredient' | 'step'
    quote: string                        // at most 200 characters
  }>
}
```

Photo call:

```text
{
  signals: Array<                        // at most 5; empty means "nothing seen"
    'photoCopyrightText' | 'photoWatermarkOrLogo' | 'photoPrintedPage' | 'photoIsbnOrBarcode' | 'photoPublisherName'
  >
}
```

- Each text `quote` is NFKC-normalised, whitespace-collapsed and searched for in the same normalised field. Not found:
  dropped and counted. Found: stored as an item with its span.
- A photo signal is stored in that photo's own evidence set, keyed by its `content_sha256`, with no span. It is never proven, and the outcome function
  treats it as "for a person" whatever its kind (spec FR-006).
- The photo output schema has no free-text field, so the model cannot return a style judgement (spec FR-006a).
- The model cannot return `isbn` or `citedPaidSiteHost` for text. Only the rules produce those.

## 3. The outcome function

`sourceCheckReadingOf(parts, judgedSourceType, matches)` in `recipe-core`, pure, an exhaustive switch over the closed
unions.

Each part is first judged green or not (spec FR-013a). For the text, a model quote that code could not find
(`unproven_quotes > 0`) makes it not green. The source reference is judged by the rules only. Section J's matches
(`matchEffectOf`, spec FR-047) can then make a part green by a person's earlier approval, or not green. Then:

| Input                                                                                                                   | Outcome                       |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| any proven blocking text item, or a cited host on the paid-site list                                                    | `detected`                    |
| every part green, directly or by a person's earlier approval                                                            | `clear`                       |
| some part not green because something was raised (an item, an unproven quote, a photo signal, a source reason, a match) | `possible`                    |
| otherwise a part was not read: budget denied, over the cap, or failed                                                   | `unchecked` (with the reason) |

- "Any item for a person" includes an unproven quote, a not-green source reference, and a not-green match.
- `clear` needs every part green, directly or by a person's earlier approval. A property test over every combination
  of part results asserts it (SC-013).
- A photo item can only ever reach the second row. A unit test asserts that no input whose only items are photo items
  yields `detected` or `clear` (SC-012).
- `possible` and `unchecked` both create a referral when the recipe is published (spec FR-016, FR-020).

## 4. The statement-of-reasons template

A fixed, localised template (spec FR-029). Its slots:

| Slot      | Filled from                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------- |
| action    | Always "publication withheld"                                                                   |
| ground    | The terms clause on rights to upload, or the ground the reviewer chose                          |
| facts     | One line per evidence item: its kind's localised name and its field (or "photo N")              |
| automated | "An automated check found this", and, for a person's hold, "A person reviewed it and decided"   |
| redress   | Keep private, change the statement, appeal (once per version), or the contact routes after that |

No slot takes model text. Delivery goes through 016's generalised statement delivery, in-app and email
(`016-FR-018a`), recorded per channel on `recipe_source_decisions`.
