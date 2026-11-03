# Data Model — Legal Compliance Framework

**Feature**: [016](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

All nine tables live in the existing `kitchensink_identity` database and are declared **once**, in
`packages/services/identity/src/database/schema/legal.ts` (`GR-021`: one declarer per table name). No name
below collides with a shipped table. Timestamps are `timestamptz`; identifiers are ULIDs as `text`
(`GR-019`: no sentinels — an id is required except on create, where it is generated).

_(amended 2026-11-03, owner ruling, ADR-0082)_ Sections 10 to 15 are new. Section 14 is a tenth identity table.
Sections 10 to 13 and 15 are **owned by recipe-service or the service that fetches**, not identity. They are specified
here because 016 owns the rule each one records. `staff-architect` confirms the placement and the shapes at PLANNING
and BLUEPRINT. The product is not live and holds no user data, so no backfill is owed. Every change to a shipped
table is still expand-first.

**Legal documents are not modelled here.** Per [R3](./research.md#r3), they are versioned in-repo content
with a manifest; only the _version identifier_ reaches the database.

---

## 1. `terms_acceptances` — the licence's evidentiary record

The most important table in the feature: it is what makes `FR-010`'s licence real.

| Column        | Type                   | Notes                                                      |
| ------------- | ---------------------- | ---------------------------------------------------------- |
| `id`          | `text` PK              | ULID                                                       |
| `account_id`  | `text` NOT NULL        | FK → accounts                                              |
| `document_id` | `text` NOT NULL        | Closed union: `terms`, `privacy`, `community`, `infringer` |
| `version`     | `text` NOT NULL        | Matches a version in the in-repo manifest                  |
| `locale`      | `text` NOT NULL        | The locale the user was **shown** (`FR-002`)               |
| `accepted_at` | `timestamptz` NOT NULL |                                                            |

**Append-only. Superseded rows are never updated or deleted** (`FR-002`, `FR-052`) — an acceptance record is
evidence, and evidence that can be rewritten is not evidence. Enforced by the DAL exposing no update or delete
path, and asserted by an integration test that attempts both.

Index: `(account_id, document_id, accepted_at DESC)` — the current-acceptance lookup runs on every
content-creating request.

**Derived, never stored**: whether an account is current on terms. `acceptancePolicy.ts` computes it from the
latest row per document versus the manifest's current version. Storing it would create a second source of
truth that drifts the moment a document is published.

---

## 2. `consents` — one row per (account, purpose)

| Column         | Type                   | Notes                                                                          |
| -------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `id`           | `text` PK              | ULID                                                                           |
| `account_id`   | `text` NOT NULL        |                                                                                |
| `purpose`      | `text` NOT NULL        | **Closed union**, shared via `@kitchensink/schema-identity`                    |
| `lawful_basis` | `text` NOT NULL        | Closed union: `consent`, `contract`, `legitimate_interest`, `legal_obligation` |
| `granted_at`   | `timestamptz` NOT NULL |                                                                                |
| `withdrawn_at` | `timestamptz` NULL     | Non-null = withdrawn; the row is never deleted                                 |

Unique: `(account_id, purpose)` where `withdrawn_at IS NULL` — at most one live consent per purpose.

**Purposes at v1**: `special_category_dietary`, `special_category_health`, `special_category_religious`,
`marketing_email`, `product_analytics`. `FR-036` requires special-category processing to carry an explicit
basis and forbids inferring it from ordinary account use — so the three special-category purposes may only
ever hold `lawful_basis = 'consent'`, enforced in `consentPolicy.ts` and asserted by a unit test that would
fail if the constraint were relaxed.

Withdrawal never deletes: `FR-035` and a regulator both need to know _when_ consent ended.

---

## 3. `age_assurances` — the basis, not the birth date

| Column        | Type                   | Notes                                                                     |
| ------------- | ---------------------- | ------------------------------------------------------------------------- |
| `account_id`  | `text` PK              | One per account                                                           |
| `basis`       | `text` NOT NULL        | Closed union: `self_attested`, `payment_verified`, `operator_reviewed`    |
| `floor_met`   | `text` NOT NULL        | The floor applied, e.g. `13`, `16` — recorded because it varies by market |
| `asserted_at` | `timestamptz` NOT NULL |                                                                           |

Per [R4](./research.md#r4) **no date of birth is stored.** `FR-008` asks for a recorded basis; a birth date
would be personal data with no other use in this product.

---

## 4. `notices` — a report about specific content

| Column                      | Type                   | Notes                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `text` PK              | ULID                                                                                                                                                                                                                                                          |
| `reference`                 | `text` UNIQUE NOT NULL | The human-quotable acknowledgement reference (`FR-016`)                                                                                                                                                                                                       |
| `reporter_name`             | `text` NOT NULL        |                                                                                                                                                                                                                                                               |
| `reporter_email`            | `text` NOT NULL        | The only contact channel; no account required                                                                                                                                                                                                                 |
| `content_type`              | `text` NOT NULL        | Closed union: `recipe`, `creator_profile`, `lesson` — opaque by design ([R2](./research.md#r2))                                                                                                                                                               |
| `content_id`                | `text` NOT NULL        | Opaque; **no FK** — the target lives in another service                                                                                                                                                                                                       |
| `grounds`                   | `text` NOT NULL        | Closed union: `copyright`, `trademark`, `privacy`, `illegal_content`, `terms_violation`, `other`                                                                                                                                                              |
| `statement`                 | `text` NOT NULL        | The reporter's own words                                                                                                                                                                                                                                      |
| `state`                     | `text` NOT NULL        | See the state machine below                                                                                                                                                                                                                                   |
| `declined_reason`           | `text` NULL            | Non-null only in `declined` — `FR-024` requires a recorded reason, never a silent drop                                                                                                                                                                        |
| `submitted_at`              | `timestamptz` NOT NULL |                                                                                                                                                                                                                                                               |
| `decision_due_at`           | `timestamptz` NOT NULL | Derived at acknowledgement from grounds: 24h for `copyright`/`illegal_content`, 7d otherwise (`FR-017a`). **Stored, not recomputed** — `FR-017b` runs the clock from acknowledgement, so reclassification can shorten it without the original ever being lost |
| `reporter_pseudonymised_at` | `timestamptz` NULL     | Set by the sweep once the counter-notice window closes (`FR-052b`); `reporter_name` and `reporter_email` are blanked at the same moment                                                                                                                       |

Index: `(state, submitted_at)` for the triage queue; `(content_type, content_id)` to find every notice against
an item, which `SC-004`'s single-record compliance history needs.

### Notice state machine (`noticeStateMachine.ts`, pure)

```text
received ──▶ under_review ──┬──▶ actioned ──┬──▶ counter_noticed ──┬──▶ restored
                            │               │                      └──▶ upheld
                            │               └──▶ (terminal)
                            ├──▶ no_action  (assessed, nothing to do — still recorded)
                            └──▶ declined   (not processed; reason REQUIRED)
```

Every transition is total and testable without a database. **`received` is reachable from nothing and
`declined` requires a reason** — the two properties that make silence impossible, which is the failure mode
`FR-017` and `FR-024` exist to prevent.

---

## 5. `notice_decisions` — what we did, and why

| Column                    | Type                         | Notes                                                                                                                                                          |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `text` PK                    |                                                                                                                                                                |
| `notice_id`               | `text` NOT NULL              | FK → notices                                                                                                                                                   |
| `action`                  | `text` NOT NULL              | Closed union: `removed`, `disabled`, `demoted`, `restricted`, `no_action`                                                                                      |
| `ground`                  | `text` NOT NULL              | The legal provision or terms clause relied on (`FR-018`)                                                                                                       |
| `facts`                   | `text` NOT NULL              | The facts relied on                                                                                                                                            |
| `automated_means`         | `boolean` NOT NULL           | `FR-018` requires disclosing this. Expected `false` at launch — adjudication is human                                                                          |
| `decided_by`              | `text` NOT NULL              | Operator identity                                                                                                                                              |
| `decided_at`              | `timestamptz` NOT NULL       |                                                                                                                                                                |
| `statement_in_app_at`     | `timestamptz` NULL           | In-app surfacing (`FR-018a`)                                                                                                                                   |
| `statement_email_at`      | `timestamptz` NULL           | Email **accepted by the provider**. This is the field that discharges the obligation — an in-app-only statement reaches nobody who has stopped opening the app |
| `email_attempts`          | `integer` NOT NULL DEFAULT 0 | Retry count (`FR-018b`)                                                                                                                                        |
| `email_last_error`        | `text` NULL                  | Last failure, so the alert can say what went wrong                                                                                                             |
| `derived_copies_actioned` | `boolean` NOT NULL           | `FR-022`: removing only the original is **not** compliance                                                                                                     |

The statement of reasons is **derived** from this row, not stored separately — one authoritative
representation, and delivery is recorded on the decision it communicates.

---

## 6. `counter_notices`

| Column                      | Type                   | Notes                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `text` PK              |                                                                                                                                                                                                                                                               |
| `notice_id`                 | `text` NOT NULL        | FK → notices                                                                                                                                                                                                                                                  |
| `account_id`                | `text` NOT NULL        | The uploader; authenticated (`FR-019`)                                                                                                                                                                                                                        |
| `statement`                 | `text` NOT NULL        |                                                                                                                                                                                                                                                               |
| `submitted_at`              | `timestamptz` NOT NULL |                                                                                                                                                                                                                                                               |
| `decision_due_at`           | `timestamptz` NOT NULL | Derived at acknowledgement from grounds: 24h for `copyright`/`illegal_content`, 7d otherwise (`FR-017a`). **Stored, not recomputed** — `FR-017b` runs the clock from acknowledgement, so reclassification can shorten it without the original ever being lost |
| `reporter_pseudonymised_at` | `timestamptz` NULL     | Set by the sweep once the counter-notice window closes (`FR-052b`); `reporter_name` and `reporter_email` are blanked at the same moment                                                                                                                       |
| `restoration_decision`      | `text` NULL            | Closed union: `restored`, `upheld`                                                                                                                                                                                                                            |
| `restoration_decided_at`    | `timestamptz` NULL     |                                                                                                                                                                                                                                                               |

---

## 7. `infringement_strikes` — the repeat-infringer tally

| Column        | Type                   | Notes                                          |
| ------------- | ---------------------- | ---------------------------------------------- |
| `id`          | `text` PK              |                                                |
| `account_id`  | `text` NOT NULL        |                                                |
| `notice_id`   | `text` NOT NULL        |                                                |
| `decision_id` | `text` NOT NULL        |                                                |
| `accrued_at`  | `timestamptz` NOT NULL |                                                |
| `reversed_at` | `timestamptz` NULL     | Set when a counter-notice restores the content |

`repeatInfringerPolicy.ts` (pure) takes the live strikes and returns terminate / do-not-terminate. `FR-020`
requires **one** threshold applied to every account without exception, so the threshold is a single constant
consumed by that one function — never a per-caller literal.

**This table is also `015`'s hook**: `FR-023` requires an actioned notice to reverse the reward grant the
publication earned, so a decision that accrues a strike also emits the reversal.

---

## 8. `data_export_requests`

| Column         | Type                   | Notes                                                                               |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `id`           | `text` PK              |                                                                                     |
| `account_id`   | `text` NOT NULL        |                                                                                     |
| `state`        | `text` NOT NULL        | Closed union: `queued`, `building`, `ready`, `delivered`, `failed`                  |
| `requested_at` | `timestamptz` NOT NULL |                                                                                     |
| `deadline_at`  | `timestamptz` NOT NULL | `requested_at` + 1 month, stored so the promise is auditable rather than recomputed |
| `completed_at` | `timestamptz` NULL     |                                                                                     |
| `artifact_key` | `text` NULL            | S3 key; the link handed to the user is time-limited and derived, never stored       |

---

## 9. `legal_holds` — why a record outlived its period

| Column        | Type                   | Notes                                                                                                                    |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `text` PK              |                                                                                                                          |
| `record_type` | `text` NOT NULL        | Closed union: `notice`, `decision`, `counter_notice`, `strike`, `acceptance`, `restriction_statement` (added 2026-11-03) |
| `record_id`   | `text` NOT NULL        |                                                                                                                          |
| `reason`      | `text` NOT NULL        | Substantive; a one-word reason is a defect                                                                               |
| `placed_by`   | `text` NOT NULL        | A named human, not a service                                                                                             |
| `placed_at`   | `timestamptz` NOT NULL |                                                                                                                          |
| `lifted_at`   | `timestamptz` NULL     | Null = still held                                                                                                        |

⛔ **A hold is a row, never a boolean on the held record.** A flag records _that_ something was kept; this
records _why_, _by whom_, and _whether it still applies_ — the only version that answers the question a
regulator actually asks. `FR-052c`.

---

## 10. The public-domain record (recipe-service, `FR-015k`) _(added 2026-11-03, ADR-0082)_

The record lives on ADR-0023's curator grant, as amended by ADR-0082. There is **no new `sourceType` value**. Label 7
is derived from the grant plus a passing record, by the rights-label Policy (`spec FR-015d`), and is never stored.

`public_domain_records`, one row per book or edition used:

| Column                  | Type                   | Notes                                                                        |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `id`                    | `uuid` PK              |                                                                              |
| `title`                 | `text` NOT NULL        | The work's title                                                             |
| `first_published_year`  | `integer` NOT NULL     | The FIRST publication, never a manuscript date                               |
| `first_published_place` | `text` NOT NULL        | Country or city                                                              |
| `no_named_author`       | `boolean` NOT NULL     | True for an anonymous, corporate or test-kitchen book. Then test 1 is enough |
| `edition_used`          | `text` NOT NULL        | The old edition the text was taken from                                      |
| `markets_checked`       | `text[]` NOT NULL      | Closed union of market codes                                                 |
| `checked_by`            | `text` NOT NULL        | A named curator account                                                      |
| `checked_at`            | `timestamptz` NOT NULL |                                                                              |
| `rule_version`          | `text` NOT NULL        | The version of the `FR-015k` rule table it was judged under                  |

`public_domain_creators`, one row per named creator of a record:

| Column                | Type               | Notes                                               |
| --------------------- | ------------------ | --------------------------------------------------- |
| `record_id`           | `uuid` NOT NULL FK |                                                     |
| `name`                | `text` NOT NULL    |                                                     |
| `role`                | `text` NOT NULL    | Closed union: `author`, `translator`, `illustrator` |
| `death_year`          | `integer` NULL     | NULL means not known, and a NULL fails test 2       |
| `mort_pour_la_france` | `boolean` NOT NULL | The French CPI L123-10 check. True fails test 3     |

- A record with `no_named_author` has no creator row, and a record without it has at least one. A deferred
  constraint trigger enforces both halves, because a CHECK cannot see another table's rows.
- "Passes" is **derived at read time** by one pure function, `publicDomainGate(record, creators, today)`. The rule
  rolls forward each 1 January, so a stored pass goes stale. A record that fails today can pass in a later year.
- A recipe under the curator grant references its record by `public_domain_record_id`. A recipe with the reference
  and a failing record is label 3 or 4 by its source, never label 7.

## 11. The recipe licence choice (recipe-service, `FR-010`, `FR-033`) _(added 2026-11-03, ADR-0082)_

New columns on `recipes`:

| Column                  | Type            | Notes                                                                                  |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `licence`               | `text` NOT NULL | Closed union: `commise` (the cook licence of `FR-010`), `cc-by-4.0`. Default `commise` |
| `licence_version`       | `text` NOT NULL | The version of that licence, for example `4.0`, or the terms version                   |
| `photo_licence`         | `text` NOT NULL | Same union, default `commise`. A separate choice (`FR-010`)                            |
| `photo_licence_version` | `text` NOT NULL |                                                                                        |

- `cc-by-4.0` is accepted only on a label 1 recipe whose 020 check passed, from an adult account. One pure Policy
  decides it at write time, in the write's transaction. A CHECK cannot read the derived label.
- `recipe_licence_grants` is an append-only history: `recipe_id`, `scope` (`text` or `photos`), `licence`,
  `licence_version`, `granted_by`, `granted_at`. A CC BY grant cannot be recalled for copies already made, so the
  history is evidence, and a later switch back to `commise` affects new copies only.
- The recipe read contract sends `licence`, `licence_version`, `photo_licence` and `photo_licence_version` to clients.
  Public pages carry the licence in schema.org `license`. That contract change belongs to recipe-service's schema
  package (ADR-0014), not to [contracts/legal-api.md](./contracts/legal-api.md).

## 12. The per-source cap count (recipe-service, `FR-030a`) _(added 2026-11-03, ADR-0082)_

`source_card_events`, append-only, one row each time a public form of a source's recipe is made public:

| Column           | Type                   | Notes                                                                                                                                  |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid` PK              |                                                                                                                                        |
| `source_key`     | `text` NOT NULL        | A site's registrable domain (from the Public Suffix List, by a library), a book's ISBN-13 or normalized title, or a paid site's domain |
| `source_class`   | `text` NOT NULL        | Closed union: `site`, `aggregator`, `book`, `paid_site`                                                                                |
| `recipe_id`      | `uuid` NOT NULL        |                                                                                                                                        |
| `form`           | `text` NOT NULL        | Closed union: `facts_card`, `commise_version`                                                                                          |
| `made_public_at` | `timestamptz` NOT NULL |                                                                                                                                        |
| `withdrawn_at`   | `timestamptz` NULL     |                                                                                                                                        |

- The count is **over time**: a withdrawn row still counts, because the cap guards repeated and systematic taking
  (Art. 7(5)), not what is live today. Counsel confirms this reading (`spec FR-050`).
- The count is taken live with `COUNT(*)` under a per-source advisory lock, in the same transaction as the write,
  the shape ADR-0073 uses for private slots. There is no counter column.
- The cap numbers are configuration per `source_class`, set by counsel. `aggregator` can be zero.
- Past the cap, the card is the title, the source's name and the link, and a restriction statement is written
  (section 14).

## 13. The fetch-signal log (the fetching service, `FR-024a`) _(added 2026-11-03, ADR-0082)_

`fetch_signal_records`, one row per server fetch of a page:

| Column                    | Type                   | Notes                                                           |
| ------------------------- | ---------------------- | --------------------------------------------------------------- |
| `id`                      | `uuid` PK              |                                                                 |
| `url`                     | `text` NOT NULL        | The page fetched                                                |
| `fetched_at`              | `timestamptz` NOT NULL |                                                                 |
| `user_agent`              | `text` NOT NULL        | Our honest user-agent string                                    |
| `robots_group`            | `text` NOT NULL        | Closed union: `named`, `star`, `none_found`, `error`            |
| `robots_allows`           | `boolean` NULL         | NULL when no robots.txt was found                               |
| `tdmrep`                  | `text` NOT NULL        | Closed union: `reserved`, `not_reserved`, `none_found`, `error` |
| `tdm_header`              | `text` NOT NULL        | Same union, for the `tdm-reservation` header                    |
| `noai_tag`                | `text` NOT NULL        | Closed union: `noai`, `noimageai`, `both`, `none_found`         |
| `ai_crawler_blocks`       | `text[]` NOT NULL      | The AI crawler groups found blocked. Empty means none found     |
| `content_signal_ai_input` | `text` NOT NULL        | Closed union: `no`, `yes`, `none_found`                         |
| `pirate_host`             | `boolean` NOT NULL     |                                                                 |
| `outcome`                 | `text` NOT NULL        | Closed union: `fetched`, `refused`                              |

- "None found" is a value, never NULL, because the log is our evidence that we looked.
- It holds no cook identifier, so it carries no personal data. It is kept for the `FR-052a` period. The identity
  sweep cannot reach another service's database, so the fetching service runs its own purge on the same period
  (plan task L082-21).

## 14. `restriction_statements` (identity, `FR-018`, `FR-019`) _(added 2026-11-03, ADR-0082)_

A statement of reasons for a restriction that did not start from a notice. It cannot live in `notice_decisions`,
which needs a notice. It reuses the same two-channel delivery (`FR-018a`, `FR-018b`). Recipe-service calls identity
through the existing internal path when it places the restriction.

| Column                 | Type                   | Notes                                                                                                                                              |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `text` PK              |                                                                                                                                                    |
| `account_id`           | `text` NOT NULL        | The cook                                                                                                                                           |
| `content_ref`          | `text` NOT NULL        | An opaque recipe reference                                                                                                                         |
| `idempotency_key`      | `text` NOT NULL UNIQUE | Set by recipe-service, so a retried call writes one row                                                                                            |
| `kind`                 | `text` NOT NULL        | Closed union: `refused_to_publish`, `held_for_review`, `not_approved`, `demoted`, `visibility_limited`, `card_reduced_opt_out`, `card_reduced_cap` |
| `ground`               | `text` NOT NULL        | The legal provision or terms clause                                                                                                                |
| `facts`                | `text` NOT NULL        | Substantive                                                                                                                                        |
| `automated`            | `boolean` NOT NULL     | 020's automated hold is `true`. A person's decision is `false`                                                                                     |
| `redress`              | `text` NOT NULL        | The route to challenge it (`FR-019`)                                                                                                               |
| `created_at`           | `timestamptz` NOT NULL |                                                                                                                                                    |
| `statement_inapp_at`   | `timestamptz` NULL     |                                                                                                                                                    |
| `statement_email_at`   | `timestamptz` NULL     | Email accepted by the provider                                                                                                                     |
| `challenge_outcome`    | `text` NULL            | Closed union: `upheld`, `reversed`. NULL while open or never challenged                                                                            |
| `challenge_decided_at` | `timestamptz` NULL     |                                                                                                                                                    |

It is evidence, so it follows the retention rules below like `notice_decisions`.

## 15. Statement kinds (recipe-service, `004-FR-014a`) _(added 2026-11-03, ADR-0082)_

The statement kind becomes a closed union of five values. Shipped migration `0059_recipe_imports.sql` holds only
`authored` and `source` on `recipe_import_items`, and the recipe's own statement must match it.

| Kind           | Meaning                                             | Required with it                                                                                                              |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `authored`     | I wrote this                                        | No citation                                                                                                                   |
| `adapted`      | My own words, with a credit                         | A credit to the source                                                                                                        |
| `source`       | A copy from a web page, book, magazine or paid site | A citation and a source kind: `public_web`, `book`, `magazine`, `paid_site`                                                   |
| `family`       | From a family member or friend, with permission     | `permission_scope = 'commise_and_web'`. The giver's credit is optional, and present only with `giver_credit_permitted = true` |
| `publicDomain` | Old text under the curator grant                    | The curator grant and a section 10 record. Never declarable by a cook                                                         |

- **Expand-first.** The migration adds the values and the columns and widens the CHECKs. It renames nothing and
  removes nothing. `source_kind` gains `magazine`.
- `family` requires the permission to cover the open web. A family statement that does not is not accepted.
- Renaming a value later is a wire change, so the names are fixed here (ADR-0077's register of one-way doors).

---

## Cross-cutting rules

**Retention** (`FR-052`). Every table here outlives the content or account it describes where the row _is_ the
evidence of a decision. Concretely: `terms_acceptances`, `notices`, `notice_decisions`, `counter_notices` and
`infringement_strikes` (and, from 2026-11-03, `restriction_statements`) survive the erasure of the account they reference, retaining the account id as an
opaque key with no personal data attached. `consents`, `age_assurances` and `data_export_requests` are erased
with the account. This split is the one place where erasure and evidence pull against each other, and it is
resolved deliberately rather than by default — `FR-037` requires telling the user what was retained and why.

**Retention period** (`FR-052a`–`FR-052c`). Surviving records are purged **3 years after the decision they
evidence** — the US copyright limitation period, and the outer bound of the GDPR Art. 17(3)(e) basis that let
them survive erasure in the first place. `notices.reporter_name` and `notices.reporter_email` are pseudonymised
much earlier, once the counter-notice window on that notice closes, since a third-party reporter's contact
details serve no purpose past the dispute. A purge is suspended only by an explicit, recorded legal hold. This
implies one scheduled sweep and a `legal_hold` marker on the records it can skip — the sweep is a task, and
its absence would be silent.

**The compliance history query** (`SC-004`, `FR-053`). "Who published this, under which terms version, with
what attestation, through which channel, with what provenance, and has any notice been actioned against it"
spans identity (acceptance, notices) and recipe-service (attestation, channel, provenance). It is served as
**one record assembled by identity**, calling recipe-service through the existing internal path — not as a
join across databases, which ADR-0006's per-PR logical databases make impossible anyway.

**Migrations** (ADR-0022). The new tables ship as numbered SQL in
`packages/services/identity/src/database/migrations/`, applied by `IdentityServiceStack`'s in-stack Trigger
whose `executeBefore` is derived from the construct tree. **Expand-first**: every migration in this feature is
additive, so none of it constrains a later contracting release.
