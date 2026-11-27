# 0102: A public version of an imported recipe is stored as Commise-written text, with its own provenance, credit, source record and fingerprint

- **Status:** Accepted
- **Date:** 2026-11-27
- **Amends:** [ADR-0093](0093-imported-recipes-go-public-only-as-a-commise-written-version.md) §4, the bullet "The
  writer sees the recipe's facts only, never the source's wording" (decision 1). ADR-0093 §5, the bullet that makes a
  site paid when "Its domain is on the paid list" (decision 2). The same paid-list rule is stated in `016-FR-080` and
  `004-FR-014`, and this decision applies to them too.
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md) §3: a third path that does not retry a ceiling denial
  (decision 9).
- **Relates to:** [ADR-0101](0101-a-paste-spends-its-import-unit-when-it-is-saved.md): when a paste pays.
  [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) §6 and
  [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md): the evidence record and
  the statement record this feature extends. [ADR-0074](0074-content-source-check.md): the hold every public door
  passes. [ADR-0073](0073-free-tier-private-slots.md): slots. [ADR-0072](0072-bulk-recipe-import.md): the import
  route and its 30-day purge. [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): expand-only
  migrations. [ADR-0062](0062-stage-scoped-metrics-and-alarm-relay.md): metrics carry `Stage`.
- **Drivers:** spec [003B](../../../specs/003B-public-rewrite/spec.md), its
  [data model](../../../specs/003B-public-rewrite/data-model.md) and its
  [research](../../../specs/003B-public-rewrite/research.md). Owner rulings: 2026-11-15 (the licence and its credit
  "Commise and contributors", one public version per page, no caps), 2026-11-17 (the writer reads the facts sheet and
  the source step text, the credit wording, and no unit for a public version), 2026-11-19 (who holds the attempt count).
  Some decisions rest on spec defaults that carry no owner ruling: decision 4's label on C-11, decision 6 on C-14
  (the source record is kept) and C-26 (key custody), decisions 7 and 9 on C-25 (the job window), and decision 8 on
  C-15 (the spend).

## Context

ADR-0093 made a Commise-written version the only public form of an imported recipe, and left the build to spec 003B.
The spec settles how that version is written, checked, stored and shown. Several of its choices are stored values and
columns that cannot change once rows exist, and two of them change sentences in ADR-0093. The data model says every
one-way door goes in an ADR before code. This is that ADR. The data model stays the authority for each column's full
rule. This ADR names the doors and the decisions behind them.

## Decision

### 1. The writer reads the facts sheet and the source step text

The writer (spec 027's step-writing engine) reads the facts sheet and the source's step text (`027-FR-035`), with
the output language (`003B-FR-030b`), and nothing else: never the page address, the cook's statement, the source
title or a headnote. Reuse of the source's wording is caught by the fingerprint check (decision 6), and the
two-way fact check and the cook's review still run. No Anthropic model writes a public version. The writer never
fetches a page.

### 2. A paid-list domain alone is not a clear paid signal

A source is paid only when a clear signal is read: `isAccessibleForFree` false, or a metered paywall. A domain on the
paid list of `004-FR-014` is a known paid site, but the list alone is not a clear signal. A page on that list with no
clear signal, and a signal that cannot be read, take the rewrite path to public with the paid credit (no site named)
and no paid hold, and the source is classified `thirdParty`. The source record keeps the list fact for monitoring.

### 3. A public version is `source_type = 'commise_written'`

- The value `commise_written` joins the `source_type` CHECKs. A public version has no `source_kind` and no
  `statement_kind`. The pair `public_web` with `imported_public` is not used: it reads as a web copy.
- `recipes.source_record_id` (uuid, foreign key to `recipe_source_records`, no cascade) says the text derives from a
  source record. It is set on a public version and on a cook's copy of one.
- `recipes.source_page_key` (text) holds the page key on a public version only. A partial
  `UNIQUE (source_page_key) WHERE source_page_key IS NOT NULL` gives one public version per page and is Publish's
  idempotency key. The key is released in the transaction of its cause: delete, a spec 020 rejection, or a publisher
  opt-out.
- Three CHECKs hold the shape, under these names: `recipes_public_version_has_record`,
  `recipes_page_key_only_public_version` and `recipes_record_source_types` (a record only on `commise_written` or
  `user_created`).
- A cook's copy of a public version is `user_created`. It keeps `source_record_id` and `public_credit`, has no page
  key, and starts private. Every public door refuses a `user_created` recipe that has `source_record_id`, and the
  guard keys on that column, never on `cloned_from_id`.

### 4. The label and the licence are derived, never stored

The rights label "Steps written by Commise" is derived in recipe-core from `source_type` (`rightsLabelOf`). The licence
`cc-by-sa-4.0`, credited "Commise and contributors", is derived from `source_record_id IS NOT NULL` (`licenceOf`), so
a cook's copy keeps the licence and does not take the label. There is no column for either. The label is open to the
web (`021-FR-002`). It is never "Written by you" or "Adapted by you".
Publish is the cook's acceptance of the licence for their later edits. It is recorded as one
`recipe_statement_attestations` row: mode `implicit`, choice `publicConfirm`, action `create`, wording
`publicVersionConfirm.v1`.

### 5. The credit is stored on the recipe

`recipes.public_credit` (text, `free` or `paid`) is set in the Publish transaction from the credit the cook was shown,
with two CHECKs: the value, and `(public_credit IS NOT NULL) = (source_record_id IS NOT NULL)`. Display reads this
column. `free` names and links the site's registrable domain, read through the source record. `paid` names no site and
its structured data carries no `isBasedOn`. A copy inherits the value at clone.

### 6. The source record and the wording fingerprint

- **`recipe_source_records`** is one row per third-party import item, written in the transaction of the item's save
  or the job's creation. It is append-only for every role by trigger, holds no cook id, and is not cascaded from any
  recipe, so it outlives the private copy and the public version. Erasure has nothing to sweep in it, and the table is
  listed as retained by ruling. It holds the classification and its inputs, the page key, the registrable domain, the
  page's publication date and language, and the fingerprint. It never holds source text. A paste with no page address
  writes no record and is Private only.
- **Fingerprint format 1.** The comparison form is 027 research R3's. The record stores keyed hashes of each word 5-shingle of the source steps and each word
  2-shingle of the source title, and one hash of the normalised title. Each hash is the first 8 bytes of an
  HMAC-SHA-256, stored as a signed `bigint`. `fingerprint_format` and `fingerprint_key_version` are stored with them.
  A later format keeps the reader of every earlier one, because no text is kept to recompute from.
- **Key custody.** The key is one AWS Secrets Manager secret owned by this feature. It holds every key version.
  Rotation adds a version and never deletes one. A check uses the stored key version's key. A missing key version is an
  operator fault: a later write that leaves the recipe public answers a retryable `503 { code: 'checkUnavailable' }`
  and raises an alarm, and Publish answers the same `503` and leaves the job `ready`, with no attempt spent.
- The wording check runs inside every write that leaves a public version published and public, when its steps or
  title changed or the write is the move into published and public (an edit, a version restore, `setVisibility`, a
  draft's publish). One pure function, `wordingCheckDue`, decides.

### 7. The writer job keeps the source steps only while it can still use them

- **`public_version_jobs.path`** is `public`, `both` or `later`. It is stored at Start, never changed, and never
  inferred from `private_recipe_id` or the item key.
- **The attempt count has one holder, chosen by `path`.** The job has no `attempts` column.
  `recipe_import_items.public_attempts` holds it for `public`, and `recipes.public_attempts` holds it for `both` and
  `later` (each `smallint`, 0 to 3). Saving an item into a private recipe copies the count across. Edits never reset
  it.
- **`public_version_jobs.source_steps`** (jsonb, `{ text }[]`) holds the source step text the writer reads, beside
  `facts_snapshot`. It is never returned by a read and never logged. The job's text (`source_steps`, `facts_snapshot`,
  `output`) is cleared in the update that moves the job into a final state or cancels it. A job sweep on the
  band-drain tick ends every expired job, so while the sweep runs the job's text is gone at most 73 h 15 min after
  Start (FR-033's bound, derived in the data model). The item's own draft, `recipe_import_items.payload`, is not
  touched by the job or the sweep. Only the save clears it. An explicit discard deletes it with the import. Otherwise
  ADR-0072's 30-day purge removes it.
- **The AI-use counters** `public_writer_calls` (integer) and `public_writer_cost_micro_usd` (bigint) are held by
  the import item when the job has one, and by the job when it has none. Calls add one on each claim. Cost is added at
  the spend settle. They feed the AI-use metric (spec 003B FR-086), which carries `Stage`.
- Finished jobs are deleted 7 days after `finished_at`. The table is user-keyed and is covered by erasure and by the
  test-principal purge.

### 8. Spend is operating cost under its own call site

The writer reserves and settles against the one ADR-0024 pool under the call site `import-public-rewrite`, under the
one verification role. It is operating cost, never a cook's AI use, and it spends no import unit (ADR-0101). One
public version per page and three attempts per holder bound it under the pool's ceiling. There is no daily cap.

### 9. A ceiling denial ends the job, and is never retried

This is ADR-0024 §3's third path that does not retry a ceiling denial, beside the parse-job line and the content
source check. A denial ends the job `budgetSpent` at once, refunds the reservation, and acknowledges the message, so
it is never redelivered. An unreadable counter and a transport failure still retry: the message is not acknowledged
and the worker re-claims the job without spending an attempt.

## Consequences

- A public version's facts come from the source, and its words come from Commise. Nothing stored keeps the source's
  text after the job ends, so the wording check reads hashes only.
- Each public version points to one source record, and one record has at most one live public version.
- A fingerprint key version can never be removed. Losing one makes every recipe checked with it fail closed to
  `checkUnavailable` until the key is restored.
- A cook's copy of a public version cannot go public. Making it public as the cook's own adaptation is parked with
  `021-FR-005`.
- The writer is the first operating-cost consumer that a cook's choice starts. It competes with parse and match for
  the one pool.

## One-way doors

- The `source_type` value `commise_written`, `recipes.source_record_id`, `recipes.source_page_key` with its partial
  unique index, and the three named CHECKs.
- The derived label "Steps written by Commise" and the licence `cc-by-sa-4.0`, which installed clients localize and
  published pages carry.
- `recipes.public_credit` and its value set.
- `recipe_source_records`, its append-only trigger, and fingerprint format 1 with its stored key versions.
- `public_version_jobs.path` and its value set, the two `public_attempts` columns, `source_steps`, and the two
  AI-use counters on the item and the job.
- The call site name `import-public-rewrite` in the spend registry.
- The wording key `publicVersionConfirm.v1` in the closed list of Public confirmations.
- The job `state` values, which reach the wire as `publicVersionJob.state`, and the `engine_version` format
  `{modelId}#{promptSha256}`, which is copied onto the public version.
- The routes and refusal codes of the public-version API. Their authority is
  [`contracts/publicVersion.api.md`](../../../specs/003B-public-rewrite/contracts/publicVersion.api.md).
- The `source_class`, `classification` and `language` value sets of `recipe_source_records`.

## Alternatives

- **A writer that reads the facts only (ADR-0093 §4 as written).** Replaced by the owner ruling of 2026-11-17
  (`027-FR-035`). The fingerprint check is what catches reuse of the source's wording.
- **Store the label and licence as columns.** Rejected: both follow from `source_type`, and a second store can
  disagree with it.
- **Keep the source text to compare later edits against.** Rejected: a hash set answers the same closeness measures
  with no text kept.
- **Infer the job's path from `private_recipe_id`.** Rejected: that column goes to NULL when the copy is deleted, and
  the path then reads as `public`.
- **Retry a ceiling denial for the writer.** Rejected: it holds the cook's import until the next month while they wait
  on the screen.
