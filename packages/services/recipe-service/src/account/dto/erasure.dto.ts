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
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import type { ActiveErasureJobStatus } from '../../database/schema/account.js';

/**
 * The exact phrase a client MUST send to confirm an irreversible erasure (U7 — the contract's value).
 *
 * Exported so the eventual "Erase my data" UI (Phase 5) can render and submit the same literal rather
 * than hard-coding a second copy that could drift out of agreement with the server and 400 every user.
 */
export const ACCOUNT_ERASURE_CONFIRMATION_PHRASE = 'ERASE MY DATA';

/**
 * The permanence warning the donate-election UI (U4b) MUST show beside every "publish instead of delete"
 * choice (CR-002 / U3b). A donated recipe is flipped to public + published as part of an IRREVERSIBLE
 * erasure and is thereafter attributed to a pseudonymous handle the erased owner no longer controls — so
 * they can never edit or take it down. Exported (like {@link ACCOUNT_ERASURE_CONFIRMATION_PHRASE}) so the
 * eventual UI renders ONE authoritative copy rather than drifting a second string.
 *
 * NOTE: this is the backend/DTO source of the copy (U3b scope). The real per-platform UI is U4b, where it
 * is rendered through the localization path — this constant is the canonical English text it localizes.
 */
export const ACCOUNT_ERASURE_PUBLISH_WARNING =
    'Recipes you choose to publish become public and are permanently unremovable by you once your account is erased.';

/** Upper bound on the accepted phrase length — a confirmation, not a payload. */
const MAX_CONFIRMATION_PHRASE_LENGTH = 100;

/**
 * Upper bound on how many recipes one request may elect to publish. A generous cap that a real corpus
 * will not approach, present only so a single request cannot smuggle an unbounded array into the durable
 * job row (a payload-size / DoS guard, not a product limit).
 */
const MAX_PUBLISH_ELECTION_SIZE = 1000;

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

    /**
     * The per-recipe DONATE election (CR-002 / U3b): the recipe ids the caller elected to PUBLISH
     * (donate) instead of remove. OPTIONAL — an absent/empty list means "donate nothing", so every
     * owner-only recipe is removed (the default). Each entry is validated as a UUID (the `recipes.id`
     * shape); the worker additionally scopes the publish-flip to `owner_id = caller`, so an id the caller
     * does not own — or one already public — is a harmless no-op rather than a way to publish another
     * user's recipe. Capped so a single request cannot persist an unbounded array on the job row.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_PUBLISH_ELECTION_SIZE)
    @IsUUID('all', { each: true })
    publishRecipeIds?: string[];
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
