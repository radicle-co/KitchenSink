# Contract: Worker message, model call and statement template (spec FR-007–FR-010, FR-020–FR-023, FR-028, FR-029)

## 1. The queue message

recipe-service sends one message per `(recipeId, textDigest)` that needs a model check. It carries **no recipe
text**, so no user content sits in a queue or a DLQ.

```text
SourceCheckRequested {
  recipeId: string (uuid)
  textDigest: string        // 'v1:' + hex
  ruleSetVersion: string
}
```

- The worker reads the checked text from the database and recomputes the digest with the one `checkedTextDigest`
  function. A mismatch (the text changed since the send) ends the message with no spend: a newer message owns the new
  digest.
- **Claim before reserve** (ADR-0024 layer 0a): one statement claims the work. Zero rows returned means another
  delivery holds it, or an evidence set for this digest, rule set and model already exists. Either way, no spend.
- Own queue, own DLQ, own Lambda, own reserved concurrency. A DLQ handler writes `unchecked` (`checkFailed`) so no
  recipe waits forever, and a sweeper enforces the 24-hour limit (spec FR-022). The sweeper's schedule ships disabled
  outside prod (ADR-0060).

## 2. The model call

- Call site: `source-check`, the sixth entry in `SPEND_CALL_SITES`, through `gatedLlm.ts` (reserve, call, settle;
  settle is never retried).
- Grantee: the existing verification role. No second grantee (ADR-0024 layer 4b).
- Model: an in-region model from the registry (research R-05), so no residency approval is needed.
- Prompt builder: `buildSourceCheckPrompt(text: CheckedText)`, where `CheckedText` is a branded type that only
  `checkedTextOf(recipe)` produces. Its parameter list is pinned with
  `Exact<Parameters<typeof buildSourceCheckPrompt>, [CheckedText]>`, so a second parameter fails the build (spec
  FR-008, SC-008). The system prompt is pinned by length and SHA-256.
- Caps: explicit `maxTokens`, and a hard input cap. Over the cap: no call, outcome `unchecked` (`tooLong`) unless the
  rules found blocking evidence.

### Model output (zod-parsed; anything else is a `failed` run)

```text
{
  evidence: Array<{                      // at most 12 items
    kind: 'publisherImprint' | 'copyrightNotice' | 'pageReference' | 'paidSiteTemplate' | 'modelJudgement'
    field: 'title' | 'description' | 'tags' | 'ingredient' | 'step'
    quote: string                        // at most 200 characters
  }>
}
```

- Each `quote` is NFKC-normalised, whitespace-collapsed and searched for in the same normalised field. Not found:
  dropped and counted. Found: stored as an item with its span.
- The model cannot return `isbn` or `citedPaidSiteHost`. Only the rules produce those.
- Whether an item blocks comes from the code table (spec FR-010), never from the model.

## 3. The outcome function

`sourceCheckReadingOf(evidence, judgedSourceType, modelRun)` in `recipe-core`, pure, an exhaustive switch over the
closed unions:

| Input                                         | Outcome                             |
| --------------------------------------------- | ----------------------------------- |
| any blocking item                             | `detected` (whatever the model run) |
| no blocking item, model run `ran`, no items   | `clear`                             |
| no blocking item, model run `ran`, some items | `possible`                          |
| no blocking item, model run `budgetSpent`     | `unchecked` (`budgetSpent`)         |
| no blocking item, model run `tooLong`         | `unchecked` (`tooLong`)             |
| no blocking item, model run `failed`          | `unchecked` (`checkFailed`)         |

## 4. The statement-of-reasons template

A fixed, localised template (spec FR-029). Its slots:

| Slot      | Filled from                                                                                 |
| --------- | ------------------------------------------------------------------------------------------- |
| action    | Always "publication withheld"                                                               |
| ground    | The terms clause on rights to upload (its key, resolved to the counsel-approved wording)    |
| facts     | One line per blocking evidence item: its kind's localised name and its field                |
| automated | "An automated check made this decision", plus, for an upheld appeal, "A person reviewed it" |
| redress   | Keep private, change the statement, appeal (or, after an upheld appeal, contact routes)     |

No slot takes model text. Delivery goes through 016's generalised statement delivery, in-app and email
(`016-FR-018a`), recorded per channel on `recipe_source_decisions`.
