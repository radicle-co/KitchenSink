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
 * @module contracts/reconciliation
 * @description Types for the nightly IdP reconciliation job.
 * The reconciliation job detects IdP users without a corresponding Commise
 * database record and creates the missing User + Account records.
 *
 * Source spec: specs/002-user-auth/spec.md FR-017
 * Research: specs/002-user-auth/research.md §3
 */

/**
 * A minimal IdP user record as returned by the IdP Backend API's
 * user listing endpoint.
 * Only the fields needed for reconciliation are included.
 */
export interface IdpUserRecord {
    /** IdP user ID (e.g., `user_abc123`). */
    readonly id: string;
    /** User's email address (primary email). */
    readonly email: string;
    /** ISO 8601 timestamp when the IdP user was created. */
    readonly created_at: string;
}

/**
 * Describes a single IdP user that has no matching record in the Commise database.
 * These are "orphaned" users that the reconciliation job will create records for.
 */
export interface OrphanedIdpUser {
    /** IdP user ID. */
    readonly identityUserId: string;
    /** User's email address. */
    readonly email: string;
    /**
     * Existing canonical user ID (ULID) if the record was partially created.
     * If null, the reconciliation job generates a new ULID for the missing user record.
     */
    readonly existingUserId: string | null;
    /** ISO 8601 timestamp when the IdP user was created. */
    readonly identityCreatedAt: string;
}

/**
 * Result of a single reconciliation job run.
 * Emitted as a structured log and CloudWatch custom metric.
 */
export interface ReconciliationResult {
    /** ISO 8601 timestamp when the reconciliation run started. */
    readonly startedAt: string;
    /** ISO 8601 timestamp when the reconciliation run completed. */
    readonly completedAt: string;
    /** Number of IdP users scanned in the reconciliation window. */
    readonly idpUsersScanned: number;
    /** Number of database users scanned in the reconciliation window. */
    readonly dbUsersScanned: number;
    /** Number of orphaned IdP users detected (in IdP but not in DB). */
    readonly orphanedUsersDetected: number;
    /** Number of orphaned users for which User + Account records were successfully created. */
    readonly usersRepaired: number;
    /** Number of orphaned users for which repair failed. These require manual investigation. */
    readonly repairFailures: number;
    /**
     * The IdP user IDs that failed to be repaired.
     * Included only if `repairFailures > 0`.
     */
    readonly failedIdentityIds?: string[];
}
