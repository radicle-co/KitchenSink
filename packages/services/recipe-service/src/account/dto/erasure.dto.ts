/**
 * T134 — the request/response DTOs for `POST /v1/account/erasure`, mirroring the `ErasureRequest` /
 * `ErasureRequestAcceptedResponse` schemas in `api.openapi.yaml` EXACTLY.
 *
 * The response carries `{ jobId, status }` and nothing else: the contract marks both `required` and
 * declares no other property, so any extra field here would be silent contract drift.
 *
 * Note the split of responsibility on `confirmationPhrase`: this DTO validates its SHAPE (a string of
 * sane length, optional), while its VALUE is a domain rule enforced by {@link ErasureService} — which is
 * where the "validate before queuing the job" requirement lives and where it is unit-tested.
 */
import { IsOptional, IsString, MaxLength } from 'class-validator';

import type { ActiveErasureJobStatus } from '../../database/schema/account.js';

/**
 * The phrase a client must send **if** it chooses to send one at all (the contract's example value).
 *
 * Exported so the eventual "Erase my data" UI (Phase 5) can render and submit the same literal rather
 * than hard-coding a second copy that could drift out of agreement with the server and 400 every user.
 */
export const ACCOUNT_ERASURE_CONFIRMATION_PHRASE = 'ERASE MY DATA';

/** Upper bound on the accepted phrase length — a confirmation, not a payload. */
const MAX_CONFIRMATION_PHRASE_LENGTH = 100;

/**
 * Body of `POST /v1/account/erasure`. The whole body is OPTIONAL (`requestBody.required: false`), and so
 * is its only field; with the controller's `whitelist` `ValidationPipe`, stray keys a client sends are
 * stripped rather than trusted — notably an `ownerId`, which could never redirect the erasure anyway
 * because the owner comes from the verified token.
 */
export class ErasureRequestDto {
    @IsOptional()
    @IsString()
    @MaxLength(MAX_CONFIRMATION_PHRASE_LENGTH)
    confirmationPhrase?: string;
}

/**
 * `202` response: the id of the erasure job now in flight for the caller.
 *
 * `status` is narrowed to the in-flight statuses because that is the contract's enum — a `202` is only
 * ever returned for a job that is `queued` (newly enqueued, or a fresh retry after a failure) or
 * `running` (returned idempotently for a duplicate request).
 */
export interface ErasureRequestAcceptedResponse {
    /** The erasure job's id (`account_erasure_jobs.id`, a UUID). */
    readonly jobId: string;
    /** `queued` for a newly enqueued job; `running` when an in-progress job is returned idempotently. */
    readonly status: ActiveErasureJobStatus;
}
