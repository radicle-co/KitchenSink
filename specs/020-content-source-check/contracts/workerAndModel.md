# Contract: Worker message, model calls and statement template (spec FR-005–FR-010, FR-020–FR-023b, FR-028, FR-029, FR-045–FR-055)

## 1. The queue message

recipe-service sends one message per `(recipeId, contentDigest)` that needs a model check. It is sent in the same
transaction that writes the check row, its part rows, the match fingerprint and the source keys. It carries **no recipe
text and no photo**, so no user content sits in a queue or a DLQ.

```text
SourceCheckRequested {
  recipeId: string (uuid)
  contentDigest: string     // 'v1:' + hex
}
```

- No message is sent for a rule-only `detected`. recipe-service decided it in the save (spec FR-013), and no model
  answer can change it.
- Own queue, own DLQ, own Lambda, own reserved concurrency (from `consumerConcurrency.ts`). The DLQ handler writes
  `unchecked` (`checkFailed`) for the parts still pending, so no recipe waits forever. The sweeper enforces the 24-hour
  limit and re-drives what the fan-in missed (spec FR-022). Its schedule ships disabled outside prod (ADR-0060).

### The worker's steps, always in this order (Command + Idempotent Receiver + Observer)

1. **Re-derive.** Read the recipe's checked content from the database, and recompute the content digest with the one
   `checkedContentDigest` function. A mismatch means the content changed since the send. The message ends with no
   spend, because a newer message owns the new digest.
2. **Look up our own database** (spec FR-053). Exact fingerprint, then near-copy candidates through `pg_trgm` with
   `SET LOCAL pg_trgm.similarity_threshold`, confirmed by shingle Jaccard, then source keys and source decisions.
   Candidates follow spec FR-046b. The result is held in memory and written with the outcome. This needs no model and
   reserves nothing.
3. **Claim each part** that has no finished model set under its model key (ADR-0024 layer 0a, spec FR-005b). One
   statement per part, with a lease. Zero rows returned means another worker holds a live lease or the evidence exists.
   That part costs nothing here.
4. **For each claimed part: reserve, call, settle.** Settle is never retried.
5. **Write each finished model set**, then run the **fan-in** in the same transaction. It marks every `pending` part
   row with that part digest and model key as `ran`. Then it works out the outcome of every `checking` row that now has
   no `pending` part (data-model §3a).
6. **Write this recipe's outcome**, by compare-and-set on `state = 'checking'`, once none of its parts is pending: the
   judged items (rule items from the save, model items projected with their marker digests), the part results, the
   matches, `evidence_ref` and `allows`. If another worker's fan-in already wrote it, zero rows change and the message
   ends.

⛔ **The steps do not change with what the lookup finds** (spec FR-051, owner ruling 3). The worker never skips or
shortens a model call because a match already decided a part. Two reasons: the same-items rule needs the copy's own
model items (spec FR-047a), and the time to an outcome must not show whether a match exists. A unit test runs the
handler with and without a match and asserts the same sequence of port calls.

### The photo read is scoped to this function (spec FR-023b)

- The worker reads each photo's **check rendition** from the shared media bucket, read-only, on the check-rendition
  prefix only.
- The grant sits on the shared verification role, so it carries
  `Condition: { ArnEquals: { 'lambda:SourceFunctionArn': <the source-check function's ARN> } }`. Lambda adds that key
  to every AWS call function code makes, so no other function on the role can use the grant.
- The statement lives in its own `iam.Policy`, and the ARN is built from the function's fixed name, so the role's
  default policy does not depend on the function. That avoids a CDK dependency cycle between the function and its
  role.
- The bucket uses S3-managed keys, so no `kms:Decrypt` grant is needed.
- An infra guard asserts the condition, the prefix and the read-only action set, and fails any other statement on the
  role that reads the bucket.

## 2. The model calls

- Call site: `source-check`, a new entry in `SPEND_CALL_SITES`, through `gatedLlm.ts` (reserve, call, settle). Settle is
  never retried.
- Grantee: the existing verification role. No second grantee (ADR-0024 layer 4b).
- Model: an in-region model from the registry that takes images (research R-05). A guard pins this call site to an
  in-region registry entry (spec FR-033).
- One recipe is **one text call plus one call per photo**, each only for a part with no finished set. Each call has its
  own reservation.
- **A ceiling denial is not retried** (spec FR-020, ADR-0024 §3). The worker marks that part `budgetSpent` with the
  period captured at reserve, and goes on with the other parts. The outcome is `unchecked` (`budgetSpent`) unless the
  rules already blocked, and it reads as spent only while its period is current. An unreadable counter is not a
  denial: it is transient, fails closed, and the message retries under `maxReceiveCount`.

### The model key (spec FR-005)

A finished model set is reused only under the same key: the part's digest, the model id, the system prompt's SHA-256,
the output schema version, and for a photo the rendition version. Any of them changing produces a new set. A unit test
pins each prompt's SHA-256 and the schema version together, so a prompt edit cannot ship under the old key.

### Reserving a photo call at its worst case (spec FR-023a)

- Each photo is sent as its **check rendition**, which recipe-service made with `sharp` at upload confirm, at a fixed
  maximum size. The worker does no image processing.
- The model's documented token cost for an image of that maximum size is the photo's **token ceiling**. The bake-off
  measures it, and a unit test pins the ceiling against the resize bound.
- Reservation for one photo call = (system prompt + photo ceiling) × input price + output cap × output price.
- Worst case for one recipe = the text call's reservation + `MAX_RECIPE_PHOTOS` × the photo call's reservation.
- A photo with no check rendition is not sent, and that part is `noRendition`, which reads `unchecked`
  (`checkFailed`). The rendition's bound is asserted at confirm, so an over-bound rendition cannot exist.

### Prompt builders

- `buildSourceCheckTextPrompt(text: CheckedText)` and `buildSourceCheckPhotoPrompt(photo: CheckedPhoto)`, where
  `CheckedText` and `CheckedPhoto` are branded types that only `checkedContentOf(recipe)` produces. Each parameter list
  is pinned with `Exact<Parameters<…>, [CheckedText]>` or `[CheckedPhoto]`, so a second parameter fails the build
  (spec FR-008, SC-008). Each system prompt is pinned by length and SHA-256.
- Caps: explicit `maxTokens`, and a hard input cap. Over the cap: no call, the part is `tooLong`, and the outcome is
  `unchecked` (`tooLong`) unless the rules blocked.

### Model output (zod-parsed; anything else is a `failed` part)

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
  dropped and counted. Found: stored in the shared set as a span, with no quote text.
- **Every model item weighs `forAPerson`**, proven or not (spec FR-010, review H4). The weight table's `model` arm has
  no other value, and a CHECK on the judged items repeats it.
- A photo signal is stored in that photo's own shared set, with no span. It is never proven.
- The photo output schema has no free-text field, so the model cannot return a style judgement (spec FR-006a).
- The model cannot return `isbn` or `citedPaidSiteHost`. Only the rules produce those.

## 3. The outcome function

`sourceCheckReadingOf(parts, ruleItems, judgedSourceType, matches)` in `recipe-core`, pure, an exhaustive switch over
the closed unions. Its parts compose as follows:

1. **Weight each item** by the decision table of spec FR-010 over kind × detector × label.
2. **Judge each part green or not** on its own content (spec FR-013a). An unproven quote makes the text not green.
   The source reference is judged by the rules only.
3. **Apply the matches** (spec FR-047). `matchEffectOf` gives each candidate its effect by the first row of the
   ordered table that applies. Per part, the effects combine as a lattice join: `notGreen` beats `green`, and `green`
   beats `none` (spec FR-047c). A green effect needs three things: a person's latest decision on the matched digest,
   the same-items rule, and a candidate that is not itself green only by a match (spec FR-047a, FR-047b).
4. **Pick the outcome**, in this order:

| Input                                                                                                                   | Outcome                       |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| any blocking rule item (a listed marker in the text, or a cited host on the paid-site list)                             | `detected`                    |
| every part green, directly or by a match                                                                                | `clear`                       |
| some part not green because something was raised (an item, an unproven quote, a photo signal, a source reason, a match) | `possible`                    |
| otherwise a part was not read: budget denied, over the cap, failed, or no rendition                                     | `unchecked` (with the reason) |

- `detected` comes only from rule items, so recipe-service decides it in the save, and the worker never produces it.
- `clear` needs every part green. A property test over every combination of part results asserts it (SC-013).
- A photo item can never reach the first row. A unit test asserts that no input whose only items are photo items
  yields `detected` or `clear` (SC-012).
- A property test over the rows of FR-047 asserts that no match greens a part without a person's latest decision, the
  same-items rule and a non-transitive approval (SC-016).
- `possible` and `unchecked` both create a referral when the recipe is published and the outcome is decided (spec
  FR-016, FR-020).
- The function returns two views: the staff view (every part result, match effects included) and the cook view
  (parts over the cook's own content, plus the one note of spec FR-051).

## 4. The statement-of-reasons template

A fixed, localised template (spec FR-029). Its slots:

| Slot      | Filled from                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| action    | Always "publication withheld"                                                                                                    |
| ground    | The localised text of the decision's ground, from the closed set (spec FR-027)                                                   |
| facts     | One line per evidence item: its kind's localised name and its field (or "photo N"). A match is the one generic fact, never named |
| automated | "An automated check found this", and, for a person's hold, "A person reviewed it and decided"                                    |
| redress   | Keep private, change the statement, appeal (once per version), or the contact routes after that                                  |

No slot takes model text, and no slot takes the reviewer's note. Delivery goes through 016's generalised statement
delivery, in-app and email (`016-FR-018a`), recorded per channel on `recipe_source_decisions`. A statement that cannot
be delivered because the account was erased first is recorded as undeliverable (spec FR-036).
