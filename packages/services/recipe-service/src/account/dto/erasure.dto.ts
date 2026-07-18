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
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import type { ActiveErasureJobStatus } from '../../database/schema/account.js';

/**
 * The exact phrase a client MUST send to confirm an irreversible erasure (U7 — the contract's value).
 *
 * Exported so the eventual "Erase my data" UI (Phase 5) can render and submit the same literal rather
 * than hard-coding a second copy that could drift out of agreement with the server and 400 every user.
 */
export const ACCOUNT_ERASURE_CONFIRMATION_PHRASE = 'ERASE MY DATA';

/** Upper bound on the accepted phrase length — a confirmation, not a payload. */
const MAX_CONFIRMATION_PHRASE_LENGTH = 100;

/**
 * Body of `POST /v1/account/erasure`. `confirmationPhrase` is REQUIRED (U7 — erasure is irreversible, so
 * it must never proceed without a deliberate intent gate); a missing or empty phrase is a `400`. The
 * controller's `whitelist` `ValidationPipe` strips stray keys — notably an `ownerId`, which could never
 * redirect the erasure anyway because the owner comes from the verified token. Enforcement is belt AND
 * braces: this DTO rejects an empty/absent phrase when a body is present, and {@link ErasureService}
 * re-checks it so a request sent with NO body at all (which bypasses the pipe) is still rejected.
 */
export class ErasureRequestDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAX_CONFIRMATION_PHRASE_LENGTH)
    confirmationPhrase!: string;
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
