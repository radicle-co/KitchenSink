# Data Model — Legal Compliance Framework

**Feature**: [016](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

All nine tables live in the existing `kitchensink_identity` database and are declared **once**, in
`packages/services/identity/src/database/schema/legal.ts` (`GR-021`: one declarer per table name). No name
below collides with a shipped table. Timestamps are `timestamptz`; identifiers are ULIDs as `text`
(`GR-019`: no sentinels — an id is required except on create, where it is generated).

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

| Column        | Type                   | Notes                                                                        |
| ------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `id`          | `text` PK              |                                                                              |
| `record_type` | `text` NOT NULL        | Closed union: `notice`, `decision`, `counter_notice`, `strike`, `acceptance` |
| `record_id`   | `text` NOT NULL        |                                                                              |
| `reason`      | `text` NOT NULL        | Substantive; a one-word reason is a defect                                   |
| `placed_by`   | `text` NOT NULL        | A named human, not a service                                                 |
| `placed_at`   | `timestamptz` NOT NULL |                                                                              |
| `lifted_at`   | `timestamptz` NULL     | Null = still held                                                            |

⛔ **A hold is a row, never a boolean on the held record.** A flag records _that_ something was kept; this
records _why_, _by whom_, and _whether it still applies_ — the only version that answers the question a
regulator actually asks. `FR-052c`.

---

## Cross-cutting rules

**Retention** (`FR-052`). Every table here outlives the content or account it describes where the row _is_ the
evidence of a decision. Concretely: `terms_acceptances`, `notices`, `notice_decisions`, `counter_notices` and
`infringement_strikes` survive the erasure of the account they reference, retaining the account id as an
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
