/**
 * The GDPR account-erasure contract shared across the erasure path (C-007 / D7).
 *
 * Two pieces of knowledge live here because they cross a package boundary and **no single package may
 * own them**:
 *
 *  - {@link AccountErasureMessage} — the `account-erasure` SQS message body. It has a producer in
 *    `@kitchensink/recipe-service` (the `ErasureService`, which enqueues on `POST /v1/account/erasure`)
 *    and a consumer in `@kitchensink/recipe-workers` (the erasure worker, plus the cron sweeper that
 *    re-drains stuck jobs). A message contract with a producer and a consumer in different packages that
 *    each declare their own copy is a contract that WILL drift — exactly the failure
 *    {@link ownerMediaPrefix} exists to prevent (`verticals-8`, where a service and a worker drifted onto
 *    different key schemes). One definition, imported by both.
 *  - {@link ACCOUNT_ALREADY_ERASED_CODE} — the `410` wire code, produced by the service and consumed by
 *    `@kitchensink/recipe-service-client`. Like {@link IDENTITY_SYNC_PENDING_CODE}, it is deliberately
 *    **not** a `RecipeErrorCode`: it is an account-lifecycle signal, not a recipe-domain error, so it
 *    never enters that enum (and never needs a row in the exception filter's status map — the service
 *    raises it as a framework `GoneException`, which the filter passes through untouched).
 */

/**
 * Machine-readable `code` the recipe API returns on the `410` from `POST /v1/account/erasure` when a
 * prior erasure job already `completed` — the account's data is gone and a fresh job would be
 * meaningless. Per `api.openapi.yaml` (`requestAccountErasure` → `410`). Distinct from the `202` that a
 * duplicate request gets while a job is still `queued`/`running`: that is idempotency, this is terminal.
 */
export const ACCOUNT_ALREADY_ERASED_CODE = 'ALREADY_ERASED';

/**
 * The body of one `account-erasure` SQS message: the unit of work handed to the erasure worker.
 *
 * Deliberately owner-scoped rather than job-scoped. The work ("erase everything this owner owns") is
 * idempotent and identical no matter which job row prompted it, so a duplicate/replayed delivery is a
 * harmless no-op — which is what makes at-least-once delivery the right trade here (at-most-once could
 * drop a right-to-erasure request on the floor).
 *
 * The message is a DERIVED artifact, never the source of truth: the durable record is the
 * `account_erasure_jobs` row, and the cron sweeper re-drains any row left `queued`/`running`. A message
 * lost to an SQS outage therefore costs latency, not compliance.
 */
export interface AccountErasureMessage {
    /** App-user ULID whose recipe data must be erased (the `account_erasure_jobs.owner_id`). */
    readonly ownerId: string;
    /** ISO 8601 timestamp of when erasure was requested. */
    readonly requestedAt: string;
}
