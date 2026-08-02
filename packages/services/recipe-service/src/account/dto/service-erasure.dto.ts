/**
 * Response DTO for the service-principal erasure route `POST /api/v1/internal/account/erasure` (CR-002 / U4a).
 *
 * Kept SEPARATE from the user-facing {@link ErasureRequestAcceptedResponse}: the service path has no
 * request body (the target owner is bound in the verified token, never supplied), reports the audit
 * `triggerSource`, and — unlike the user path, which raises `410` for an already-erased account — treats a
 * prior completed erasure as an idempotent no-op success (the deletion-worker caller only needs "handled").
 */
import type { ErasureTriggerSource } from '@kitchensink/recipe-core';

import type { ErasureJobStatus } from '../../database/schema/account.js';

/**
 * The result of a service-principal erasure request. Returned as `202` when a job is queued or already in
 * flight, and as `200` when the account was already erased (idempotent no-op).
 */
export interface ServiceErasureAcceptedResponse {
    /**
     * The erasure job's id. Present when a job was created or is already in flight; ABSENT for an
     * already-erased account (the completed job exists but its id is not surfaced to the caller — the
     * worker only needs to know the erasure is handled).
     */
    readonly jobId?: string;
    /** The job's status (`queued`/`running` when accepted, `completed` when the account was already erased). */
    readonly status: ErasureJobStatus;
    /** Always `'service'` — the R8 trigger source attributed to this erasure. */
    readonly triggerSource: Extract<ErasureTriggerSource, 'service'>;
}
