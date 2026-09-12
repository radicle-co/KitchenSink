/**
 * ⛔ SUPERSEDED — HAND-WRITTEN, VERIFIED BY NOTHING. NOT THE CONTRACT AUTHORITY.
 *
 * Per GR-015 / `docs/CODING_STANDARDS.md` §15 / ADR-0014 the identity service AUTHORS its wire contract as
 * zod in the `*.schema.ts` files under `packages/services/identity/src/`, copied to `packages/schemas/identity`
 * (`@kitchensink/schema-identity`), from which the normative `openapi.yaml` is DERIVED. Where this file and
 * the service's zod disagree, THE SERVICE'S ZOD WINS.
 *
 * ⛔ Do not extend this file, and do not import it into `packages/`. Author the zod in the service.
 *
 * Retained as the historical record while documents under `specs/` still cite it.
 */
/**
 * @module contracts/deletion
 * @description Types for the async IdP user deletion queue (SQS).
 * When account deletion succeeds in the Commise database but the IdP
 * Management API call fails, the IdP deletion is queued for async retry.
 *
 * Source spec: specs/002-user-auth/spec.md FR-024
 * Research: specs/002-user-auth/research.md §2
 */

/**
 * Message body enqueued to the SQS IdP deletion queue when an IdP user
 * deletion fails after the database records have been deleted.
 *
 * Serialized to JSON when publishing to SQS.
 */
export interface IdpDeletionMessage {
    /** IdP `sub` claim of the user to delete (e.g., `user_abc123`). */
    readonly identityUserId: string;
    /**
     * Canonical Commise user ID. Included for audit logging only —
     * the database record has already been deleted when this message is processed.
     */
    readonly userId: string;
    /** ISO 8601 timestamp when the deletion was first attempted. */
    readonly enqueuedAt: string;
    /**
     * Human-readable reason why the first deletion attempt failed.
     * Used for DLQ investigation.
     */
    readonly failureReason: string;
}

/**
 * Result of processing a single IdpDeletionMessage from the SQS queue.
 * Returned by the deletion worker handler for logging and metrics.
 */
export interface DeletionWorkerResult {
    /** The IdP user ID that was processed. */
    identityUserId: string;
    /** Whether the IdP deletion succeeded in this attempt. */
    success: boolean;
    /** The SQS ApproximateReceiveCount at the time of this attempt (1-indexed). */
    attemptNumber: number;
    /**
     * If `success` is false, the next visibility timeout delay in seconds
     * (exponential backoff: 30, 60, 120, 240, 480).
     */
    nextRetryDelaySeconds?: number;
}
