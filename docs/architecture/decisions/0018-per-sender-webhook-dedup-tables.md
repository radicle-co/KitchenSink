# 0018 — Webhook delivery dedup is ONE TABLE PER SENDER: Stripe gets `stripe_webhook_events`, Clerk keeps `webhook_events`

- **Status**: Accepted
- **Date**: 2026-08-12
- **Drivers**: Feature 010's `plan.md` §2 declared a `webhook_events` table for Stripe idempotency. A table of
  that name **already ships**, in the very database
  [ADR-0017](0017-service-ownership-for-features-006-007-009-010.md) puts 010's webhook in:
  `packages/shared/identity-db/src/schema/webhookEvents.ts`, keyed `svix_id text PRIMARY KEY` with
  `identity_id text NOT NULL`, used for Clerk's svix delivery dedup. Two features writing one table name with
  different columns and different owners is a migration that fails at deploy time — or, worse, one that
  succeeds and corrupts dedup for **both** senders.
- **Relates to**: [ADR-0017](0017-service-ownership-for-features-006-007-009-010.md) — 010's webhook lands in
  `@kitchensink/identity-webhooks`, the **same** deployable that owns the existing table, so "they are in
  different services" was never available as an escape;
  [GR-018](../../../specs/governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) and
  [GR-019](../../../specs/governance-rules.md#gr-019-identifier-integrity--no-sentinels) — the shipped table's
  `identity_id text NOT NULL` is exactly why a rejected Clerk payload cannot be recorded as a row, and why a
  Stripe row must not be forced to invent an identity;
  [ADR-0016](0016-notification-retention-payload-dedup-and-valkey.md) — the portfolio's other dedup/retention
  decision, whose retention model this one deliberately does **not** share.

## Context

The two tables look alike. They are not the same table, and the difference is not cosmetic.

| Column                                                   | Clerk / svix (**shipped**)         | Stripe (010, as planned)                          |
| -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| Primary key                                              | `svix_id text PRIMARY KEY`         | `id uuid` + `stripe_event_id varchar(255)` UNIQUE |
| Identity attribution                                     | `identity_id text **NOT NULL**`    | — (none available at receipt)                     |
| Received timestamp                                       | `received_at timestamptz NOT NULL` | `created_at timestamptz NOT NULL`                 |
| Event type                                               | `event_type text`                  | `event_type varchar(100)`                         |
| Retention                                                | `expires_at timestamptz` (TTL)     | — (tied to Stripe's 72h retry window)             |
| Processing lifecycle (`status`, `error`, `processed_at`) | —                                  | all three                                         |

They also **change for different reasons**, which is the DRY test that actually matters (DRY governs knowledge,
not shape):

- A svix row exists to prove "we have already applied this Clerk identity event". Its subject is **always** a
  user, which is why `identity_id` is `NOT NULL` — the constraint IS the invariant.
- A Stripe row exists to make a **billing state transition** idempotent across a 72-hour retry window, and to
  record whether that transition succeeded. Its subject is a Stripe customer, which may not resolve to an app
  identity at all.

## Decision

**One dedup table per sender.**

1. Feature 010 creates a **distinctly named** `stripe_webhook_events` table. The shipped `webhook_events` table
   is **not touched** — no rename, no added columns, no relaxed constraints.
2. Both live in `@kitchensink/identity-db` (`packages/shared/identity-db/src/schema/`), because both are read
   and written by `@kitchensink/identity-webhooks` as well as the API, and that is where `webhookEvents` and
   `accounts` already live. Note the file-naming regime there is camelCase (`stripeWebhookEvents.ts`), not the
   services' kebab `name.type.ts`.
3. `stripe_webhook_events` has **no `identity_id` column**. Attribution is a lookup against
   `accounts.stripe_customer_id`, where a miss is allowed to be a miss.
4. A future sender gets its own table by the same rule, until the flip condition below is met.

## Alternatives considered, and why they lose

### Rejected 1 — Add a `source` discriminator to the shipped table (one shared delivery log)

The tempting one, and the most expensive. It requires migrating a **live production table on the identity
database** that sits on the critical path of user provisioning: drop the `svix_id` PRIMARY KEY, introduce a
composite `(source, external_id)` key, add four Stripe-only columns, backfill `source = 'clerk'`, and — the
disqualifying part — **relax `identity_id` to nullable**, because a Stripe event has no identity to put there.

That last step deletes the constraint that makes GR-019 enforceable by the schema instead of by convention. It
is precisely the constraint 010's own analysis leans on to conclude that a rejected webhook must not be recorded
as a row. Trading a schema-enforced invariant for a `WHERE source = …` on every read is the "flag-riddled shared
helper" anti-pattern expressed as a table.

It also fuses two failure domains. A dedup table is a **safety** mechanism; if Stripe's retention pruning is too
aggressive or its writer has a bug, a shared table lets a billing defect evict Clerk's dedup rows and silently
re-apply identity events. This portfolio has already lost a `user.created` to a dedup race once. Coupling the two
senders' safety mechanisms buys nothing and risks that again.

Finally, the migration itself is the risk asymmetry that decides it: option 1 is a multi-step rewrite of a live
table with a dropped PK and a relaxed NOT NULL; this decision is a plain additive `CREATE TABLE` that cannot
lock, break or half-apply against the existing one.

### Rejected 2 — Put Stripe's table in a separate Postgres schema (`billing.webhook_events`)

Namespacing by schema keeps both names but makes every reference ambiguous to a human reader and to every tool
that reports a bare table name (`\dt`, slow-query logs, this repository's own collision guard). It also adds a
`search_path` concern to a Lambda that currently has none, for the sole benefit of reusing a word. Two clear
names cost nothing.

### Rejected 3 — Reuse the shipped table as-is, writing Stripe events into it

Impossible without a sentinel: `identity_id` is `NOT NULL`, so every Stripe row would need an invented value.
`'unknown'` fuses every unattributable billing event into one fictitious account, cannot be told apart from a
real id afterwards, and puts an **authorization**-relevant decision in the hands of a string literal. GR-019
forbids it outright.

## Consequences

**Accepted:**

- Two dedup tables, two writers, two retention policies. A future "how many webhooks did we receive" question
  needs a `UNION`, not a `GROUP BY`.
- Two pruning paths. Clerk's is TTL-driven via `expires_at`; Stripe's is tied to the retry window. They are
  sized differently on purpose, and sharing one table would have forced a compromise on both.
- 010 owes a migration and a Drizzle schema file that did not exist before, rather than "just using" a table
  that appeared to be there. Its `plan.md` §2, `spec.md` and `tasks.md` (T-003, T-014, T-015) all name
  `stripe_webhook_events`.

**Gained:**

- The shipped table's `identity_id text NOT NULL` survives, so GR-019 stays schema-enforced for the Clerk path.
- The 010 migration is purely additive: it cannot fail against, lock, or partially alter the live table.
- A billing-side dedup or retention defect cannot corrupt identity provisioning.

**Flip condition.** Revisit when **both** hold: (a) a third and fourth webhook sender arrive that share the
identity-attribution and retention model, so a generic `delivery_log` would not need per-source nullable
columns; and (b) some requirement needs a single cross-sender ordering or audit view that a `UNION` cannot serve.
Two senders with disjoint column sets is not that, and a shared table adopted before (a) holds would have to
relax exactly the constraint this ADR preserves.

## Enforcement

`packages/infra/global/__tests__/specTableCollisions.test.ts` discovers every `specs/*/` feature and every
shipped `pgTable(...)` / `CREATE TABLE`, and fails when one table name is declared by more than one owner
without a ruled exemption carrying a written `why`. It parses rather than greps — fenced-block-aware for
markdown, comment-stripped for SQL, and TypeScript-AST-based for `pgTable`, because a text search cannot tell
010's DDL from the paragraphs in the same file that discuss it. See
[GR-021](../../../specs/governance-rules.md#gr-021-one-declarer-per-table-name-and-one-definition-per-task-id).
