/**
 * Typed error hierarchy for `@kitchensink/recipe-service-client` (T-004 / T-095). Each maps a recipe
 * service HTTP status to a discriminable error so a downstream caller (web/mobile UI, other services)
 * handles outcomes by type, not by inspecting status codes. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships an `is*` guard
 * (CODING_STANDARDS). Mirrors the shape of `@kitchensink/food-service-client`'s error module.
 *
 * Status → error map (per `packages/schemas/recipe/openapi.yaml`, derived from the service's zod):
 *   `400` → {@link BadRequestError}, `401` → {@link UnauthorizedError}, `403` → {@link ForbiddenError},
 *   `404` → {@link NotFoundError}, `409` → {@link VersionConflictError} (optimistic-concurrency) OR
 *   {@link PullDriftError} (pull-from-source drift — the two `409`s are disambiguated by the response
 *   body's `code`), `410` → {@link GoneError} (account already erased), anything else →
 *   {@link UnexpectedResponseError}.
 *
 * The optional `code` is the PUBLISHED `ApiError.code` — `recipeErrorCodeSchema` in
 * `@kitchensink/schema-recipe`, authored by the service. It is typed as a plain `string` on purpose, not as
 * that enum: a deployed service may emit a code ahead of a released mobile binary, and narrowing here would turn
 * a forward-compatible deploy into a client-side type error. The typed narrowing happens once, in
 * `client.ts`'s `errorForCode`, whose `switch` IS exhaustive over the published set.
 */
import type {
    ImportLockedStage,
    PrivateFoodLine,
    PublishRequirement,
    VersionConflictSide,
} from '@kitchensink/recipe-core';

import type { PullDiff } from './types.js';

/** Base class for all recipe-service client errors. Carries the originating HTTP status + domain code. */
export class RecipeServiceClientError extends Error {
    /** The HTTP status that produced this error (`undefined` for transport/parse failures). */
    public readonly status: number | undefined;
    /** The recipe-domain error code from the response body (`ErrorResponse.code`), when present. */
    public readonly code: string | undefined;
    /** The seconds the response's `Retry-After` asked for, when it carried one this client could read. */
    public readonly retryAfterSeconds: number | undefined;

    public constructor(message: string, status?: number, code?: string, retryAfterSeconds?: number) {
        super(message);
        this.name = 'RecipeServiceClientError';
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, RecipeServiceClientError.prototype);
    }
}

/** Type guard for {@link RecipeServiceClientError}. */
export function isRecipeServiceClientError(error: unknown): error is RecipeServiceClientError {
    return error instanceof RecipeServiceClientError;
}

/** `400` — malformed request (validation failure, or a non-cloned collection has no source to pull). */
export class BadRequestError extends RecipeServiceClientError {
    public constructor(message = 'Bad request', code?: string) {
        super(message, 400, code);
        this.name = 'BadRequestError';
        Object.setPrototypeOf(this, BadRequestError.prototype);
    }
}

/** Type guard for {@link BadRequestError}. */
export function isBadRequestError(error: unknown): error is BadRequestError {
    return error instanceof BadRequestError;
}

/**
 * `400 PUBLISH_REQUIREMENTS_UNMET` — the write would leave the recipe published without something Publish needs
 * (owner rulings 2026-10-13). `missing` names each gap in page order, so a surface marks the fields in its own
 * localized copy. A {@link BadRequestError}, so every caller that knows only that class (the outbox's terminal 400, the
 * retry policy) treats it as before: re-sending the same body meets the same refusal.
 */
export class PublishRequirementsUnmetError extends BadRequestError {
    /** Every unmet requirement, in page order. */
    public readonly missing: readonly PublishRequirement[];

    public constructor(missing: readonly PublishRequirement[], message = 'A published recipe is missing something') {
        super(message, 'PUBLISH_REQUIREMENTS_UNMET');
        this.name = 'PublishRequirementsUnmetError';
        this.missing = missing;
        Object.setPrototypeOf(this, PublishRequirementsUnmetError.prototype);
    }
}

/** Type guard for {@link PublishRequirementsUnmetError}. */
export function isPublishRequirementsUnmetError(error: unknown): error is PublishRequirementsUnmetError {
    return error instanceof PublishRequirementsUnmetError;
}

/**
 * `400 PRIVATE_FOODS_ON_PUBLIC_RECIPE` (ADR-0029 section 4): the write would leave a PUBLIC recipe holding a food only its
 * author can see. `lines` names every refused line, matched to the cook's lines by `foodId` and, for two lines of one
 * food, by `sortOrder`. A {@link BadRequestError}, so the outbox treats it as terminal as it treats every 400: sending
 * the same body meets the same refusal.
 */
export class PrivateFoodsOnPublicRecipeError extends BadRequestError {
    /** Every refused line, at least one. */
    public readonly lines: readonly PrivateFoodLine[];

    public constructor(lines: readonly PrivateFoodLine[], message = 'A public recipe cannot use a private food') {
        super(message, 'PRIVATE_FOODS_ON_PUBLIC_RECIPE');
        this.name = 'PrivateFoodsOnPublicRecipeError';
        this.lines = lines;
        Object.setPrototypeOf(this, PrivateFoodsOnPublicRecipeError.prototype);
    }
}

/** Type guard for {@link PrivateFoodsOnPublicRecipeError}. */
export function isPrivateFoodsOnPublicRecipeError(error: unknown): error is PrivateFoodsOnPublicRecipeError {
    return error instanceof PrivateFoodsOnPublicRecipeError;
}

/** `401` — no/invalid/expired token, or wrong authorized party (the caller is unauthenticated). */
export class UnauthorizedError extends RecipeServiceClientError {
    public constructor(message = 'Unauthorized', code?: string) {
        super(message, 401, code);
        this.name = 'UnauthorizedError';
        Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
}

/** Type guard for {@link UnauthorizedError}. */
export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
    return error instanceof UnauthorizedError;
}

/** `403` — authenticated but not the owner of the recipe/collection being acted on (`NOT_OWNER`). */
export class ForbiddenError extends RecipeServiceClientError {
    public constructor(message = 'Forbidden', code?: string) {
        super(message, 403, code);
        this.name = 'ForbiddenError';
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/** Type guard for {@link ForbiddenError}. */
export function isForbiddenError(error: unknown): error is ForbiddenError {
    return error instanceof ForbiddenError;
}

/** `404` — no such recipe/collection/version/photo, or a tombstoned recipe on a production read path. */
export class NotFoundError extends RecipeServiceClientError {
    public constructor(message = 'Resource not found', code?: string) {
        super(message, 404, code);
        this.name = 'NotFoundError';
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}

/** Type guard for {@link NotFoundError}. */
export function isNotFoundError(error: unknown): error is NotFoundError {
    return error instanceof NotFoundError;
}

/**
 * Whether the recipe service ITSELF answered that no active recipe has the id: a {@link NotFoundError} carrying
 * `RECIPE_NOT_FOUND` (a soft-deleted recipe answers the same).
 *
 * ⛔ A 404 ALONE IS NOT THAT. The shared ALB answers a host with no listener rule with a code-less `text/plain` 404
 * (ADR-0003), and the service answers a path it does not route with `NOT_FOUND`; neither says anything about the
 * recipe. A caller that reads "the recipe is gone" from a 404 reads it here.
 *
 * @param error - The rejection.
 * @returns Whether it is the service's own "no such recipe". Pure.
 */
export function isRecipeNotFoundError(error: unknown): error is NotFoundError {
    return isNotFoundError(error) && error.code === 'RECIPE_NOT_FOUND';
}

/**
 * `409` — optimistic-concurrency conflict on a recipe update or version restore (`VERSION_CONFLICT`).
 * Carries the server's `currentVersion` and the client's `conflictingVersion` (from the response
 * `details`) so a caller can reconcile without re-reading the recipe.
 */
export class VersionConflictError extends RecipeServiceClientError {
    /** The recipe's actual current version on the server. */
    public readonly currentVersion: number | undefined;
    /** The stale `expectedVersion` the caller sent. */
    public readonly conflictingVersion: number | undefined;
    /**
     * The current winning version's snapshot + metadata (W8-a.5) — present when the server sent the
     * enriched body (the owner-gated update path), so the conflict UI can 3-way merge without re-fetching.
     */
    public readonly server: VersionConflictSide | undefined;
    /**
     * The version the caller edited from (W8-a.5) — present when still retained in the DB window; absent
     * when evicted (the caller can fall back to its own local base, or fetch via the versions endpoint).
     */
    public readonly base: VersionConflictSide | undefined;

    public constructor(
        currentVersion?: number,
        conflictingVersion?: number,
        message = 'Recipe version conflict',
        sides?: { server?: VersionConflictSide; base?: VersionConflictSide },
    ) {
        super(message, 409, 'VERSION_CONFLICT');
        this.name = 'VersionConflictError';
        this.currentVersion = currentVersion;
        this.conflictingVersion = conflictingVersion;
        this.server = sides?.server;
        this.base = sides?.base;
        Object.setPrototypeOf(this, VersionConflictError.prototype);
    }
}

/** Type guard for {@link VersionConflictError}. */
export function isVersionConflictError(error: unknown): error is VersionConflictError {
    return error instanceof VersionConflictError;
}

/**
 * `409` — a pull-from-source commit drifted since the client's preview (`PULL_DRIFT`, W5 Task 5): the
 * source OR the caller's own clone membership changed since `previewPullFromSource`, so the previewed diff
 * no longer matches. Carries the FRESH `diff` (from the response `details`) so the caller can re-present
 * the updated changes rather than silently applying a set the user never confirmed.
 */
export class PullDriftError extends RecipeServiceClientError {
    /** The freshly recomputed diff (added/removed/unchanged) as of the rejected commit attempt. */
    public readonly diff: PullDiff;

    public constructor(diff: PullDiff, message = 'The source changed since you previewed this pull.') {
        super(message, 409, 'PULL_DRIFT');
        this.name = 'PullDriftError';
        this.diff = diff;
        Object.setPrototypeOf(this, PullDriftError.prototype);
    }
}

/** Type guard for {@link PullDriftError}. */
export function isPullDriftError(error: unknown): error is PullDriftError {
    return error instanceof PullDriftError;
}

/** `410` — the account has already been erased (a prior GDPR erasure job completed; `ALREADY_ERASED`). */
export class GoneError extends RecipeServiceClientError {
    public constructor(message = 'Account has already been erased', code?: string) {
        super(message, 410, code);
        this.name = 'GoneError';
        Object.setPrototypeOf(this, GoneError.prototype);
    }
}

/** Type guard for {@link GoneError}. */
export function isGoneError(error: unknown): error is GoneError {
    return error instanceof GoneError;
}

/**
 * The service did not respond within the client's request timeout, so the call was aborted. Carries NO HTTP
 * status — nothing answered — which is exactly why it needs its own type: a hung connection is otherwise
 * indistinguishable from "still loading", and an unbounded wait leaves every consuming query pending for the
 * life of the page (the surface's loading branch never flips, and its empty/error branches are unreachable).
 * Mirrors `@kitchensink/food-service-client`'s `FetchUnavailableError`, so the two clients read alike.
 */
export class FetchUnavailableError extends RecipeServiceClientError {
    /**
     * The underlying abort/timeout error, when the transport supplied one. Narrows `Error.cause` (which the
     * ES2022 lib declares as optional `unknown`) to a value this constructor always sets, so a caller reading
     * `error.cause` for diagnostics does not have to widen it back.
     */
    public override readonly cause: unknown;

    public constructor(message = 'Recipe service did not respond in time', cause?: unknown) {
        super(message);
        this.name = 'FetchUnavailableError';
        this.cause = cause;
        Object.setPrototypeOf(this, FetchUnavailableError.prototype);
    }
}

/** Type guard for {@link FetchUnavailableError}. */
export function isFetchUnavailableError(error: unknown): error is FetchUnavailableError {
    return error instanceof FetchUnavailableError;
}

/**
 * A `502 SOURCE_UNAVAILABLE`: a route needed the food service and could not ask it. Nothing was done. Carries no
 * retry window, because nothing on our side knows when food recovers.
 */
export class SourceUnavailableError extends RecipeServiceClientError {
    public constructor(message = 'The ingredient source did not answer') {
        super(message, 502, 'SOURCE_UNAVAILABLE');
        this.name = 'SourceUnavailableError';
        Object.setPrototypeOf(this, SourceUnavailableError.prototype);
    }
}

/** Type guard for {@link SourceUnavailableError}. */
export function isSourceUnavailableError(error: unknown): error is SourceUnavailableError {
    return error instanceof SourceUnavailableError;
}

/**
 * The parse job's 24-hour TTL has passed — a `409 PARSE_JOB_EXPIRED` from `POST /{id}/retry` or
 * `PATCH /{id}/lines/{lineIndex}` (plan U9).
 *
 * ⛔ ITS OWN TYPE, because the surfaces render it as a different sentence with a different control. Every
 * other failure on this resource is worth trying again; an expired job is not — the row is terminal (the
 * aggregate rule's `WHERE status IN ('running','partial')` guard means a late landing cannot even reopen it),
 * so the only remedy is pasting the block afresh. Left as a bare {@link UnexpectedResponseError}, a surface
 * could only tell by string-comparing `.code`, which is precisely the unvalidated read `errorForCode` exists
 * to replace.
 *
 * ⚠️ A `GET` NEVER raises this. The service answers an expired job's read `200` with `status: 'expired'`, so
 * the poll observes expiry as DATA and only a mutation observes it as a refusal. A surface that handled the
 * error alone would show a cook a live-looking job until they touched it.
 */
export class ParseJobExpiredError extends RecipeServiceClientError {
    public constructor(message = 'This parse job has expired') {
        super(message, 409, 'PARSE_JOB_EXPIRED');
        this.name = 'ParseJobExpiredError';
        Object.setPrototypeOf(this, ParseJobExpiredError.prototype);
    }
}

/** Type guard for {@link ParseJobExpiredError}. */
export function isParseJobExpiredError(error: unknown): error is ParseJobExpiredError {
    return error instanceof ParseJobExpiredError;
}

/**
 * `429 IMPORT_QUOTA_EXCEEDED` — the caller's daily import allowance is spent (004 FR-022). NOTHING was created.
 *
 * ⛔ ITS OWN TYPE, and deliberately NOT retryable. It shares a status with the service's burst throttle, and the two could
 * not be more different: a throttle clears in seconds and is worth coming back for, a spent allowance stays spent until
 * `resetsAt`, hours away. A retry loop (the transport's, TanStack's, the outbox's) that treated it as a throttle would
 * hammer the server for hours and the cook would never see why their paste did nothing. `retryPolicy.ts` classifies it
 * terminal, and a test pins that.
 *
 * `resetsAt` is the instant the allowance reopens, kept as the ISO string the wire carries: a surface localises the date
 * itself, and a `Date` here would be a conversion this client has no reason to own.
 */
export class ImportQuotaExceededError extends RecipeServiceClientError {
    /** When the allowance reopens for this caller, an ISO 8601 instant. */
    public readonly resetsAt: string;

    public constructor(resetsAt: string, message = 'The daily import allowance is spent') {
        super(message, 429, 'IMPORT_QUOTA_EXCEEDED');
        this.name = 'ImportQuotaExceededError';
        this.resetsAt = resetsAt;
        Object.setPrototypeOf(this, ImportQuotaExceededError.prototype);
    }
}

/**
 * `409 IMPORT_CURSOR_MOVED` — the bulk-import wizard's cursor is not where this request said it was (ADR-0072): another
 * device moved it. NOTHING was changed.
 *
 * ITS OWN TYPE, because the remedy is not a retry: the surface adopts `cursorOrdinal` (where the cursor is now, `null`
 * when it is past the last item) and shows that item, and repeating the same request would be refused the same way.
 */
export class ImportCursorMovedError extends RecipeServiceClientError {
    /** The item ordinal the cursor is on now, or `null` when it is done. */
    public readonly cursorOrdinal: number | null;

    public constructor(cursorOrdinal: number | null, message = 'The import has moved on') {
        super(message, 409, 'IMPORT_CURSOR_MOVED');
        this.name = 'ImportCursorMovedError';
        this.cursorOrdinal = cursorOrdinal;
        Object.setPrototypeOf(this, ImportCursorMovedError.prototype);
    }
}

/** Type guard for {@link ImportCursorMovedError}. */
export function isImportCursorMovedError(error: unknown): error is ImportCursorMovedError {
    return error instanceof ImportCursorMovedError;
}

/**
 * `409 IMPORT_ITEM_ALREADY_SAVED` — the item's recipe was already saved (ADR-0072). An item is saved once.
 *
 * ITS OWN TYPE: for a client that retried a save it means the first request landed (treat the item as done), and for
 * one that tried to change a saved item it means the edit belongs in the recipe editor now. Neither is a retry.
 */
export class ImportItemAlreadySavedError extends RecipeServiceClientError {
    /** The item that is already saved. */
    public readonly ordinal: number;

    public constructor(ordinal: number, message = 'This import item has already been saved') {
        super(message, 409, 'IMPORT_ITEM_ALREADY_SAVED');
        this.name = 'ImportItemAlreadySavedError';
        this.ordinal = ordinal;
        Object.setPrototypeOf(this, ImportItemAlreadySavedError.prototype);
    }
}

/** Type guard for {@link ImportItemAlreadySavedError}. */
export function isImportItemAlreadySavedError(error: unknown): error is ImportItemAlreadySavedError {
    return error instanceof ImportItemAlreadySavedError;
}

/**
 * `403 PRIVATE_SLOTS_FULL` - a free cook has no private slot left (ADR-0073). NOTHING was written.
 *
 * ⛔ ITS OWN TYPE, and not a {@link ForbiddenError}: a `ForbiddenError` is a scope or ownership gate, and this one has a
 * remedy the surface offers (make a private recipe public, delete one, take Premium). It is a 403 on the wire so that an
 * installed client that predates the code reads a plain refusal and not the version-conflict view a 409 would open.
 *
 * ⛔ TERMINAL for the retry policy: repeating the write meets the same full slots. The editor's outbox parks it for the cook
 * to resolve and never re-sends it.
 *
 * `used` can exceed `limit`: a cook who lost Premium keeps every private recipe, and the refusal says how far over they are.
 */
export class PrivateSlotsFullError extends RecipeServiceClientError {
    /** The private recipes the cook holds, as the server counted them. */
    public readonly used: number;

    /** The cook's private-slot limit. */
    public readonly limit: number;

    public constructor(used: number, limit: number, message = 'All of your private slots are in use') {
        super(message, 403, 'PRIVATE_SLOTS_FULL');
        this.name = 'PrivateSlotsFullError';
        this.used = used;
        this.limit = limit;
        Object.setPrototypeOf(this, PrivateSlotsFullError.prototype);
    }
}

/** Type guard for {@link PrivateSlotsFullError}. */
export function isPrivateSlotsFullError(error: unknown): error is PrivateSlotsFullError {
    return error instanceof PrivateSlotsFullError;
}

/**
 * `409 IMPORT_ITEM_LOCKED` — a different recipe was sent for an item already being processed (ADR-0072 §3). The recipe
 * the item holds is what its paid parse and its match snapshot were made from, so it is not replaced.
 *
 * ITS OWN TYPE: resending the same body meets the same refusal, and the remedy is to keep what the server holds (the
 * client's copy of the file is no longer the item's source of truth). Distinct from {@link ImportItemAlreadySavedError},
 * where the item is finished and an edit belongs in the editor.
 */
export class ImportItemLockedError extends RecipeServiceClientError {
    /** The item that is locked. */
    public readonly ordinal: number;
    /** Where it stands: `parsing` or `matched`. */
    public readonly stage: ImportLockedStage;

    public constructor(
        ordinal: number,
        stage: ImportLockedStage,
        message = 'This import item is already being processed',
    ) {
        super(message, 409, 'IMPORT_ITEM_LOCKED');
        this.name = 'ImportItemLockedError';
        this.ordinal = ordinal;
        this.stage = stage;
        Object.setPrototypeOf(this, ImportItemLockedError.prototype);
    }
}

/** Type guard for {@link ImportItemLockedError}. */
export function isImportItemLockedError(error: unknown): error is ImportItemLockedError {
    return error instanceof ImportItemLockedError;
}

/** Type guard for {@link ImportQuotaExceededError}. */
export function isImportQuotaExceededError(error: unknown): error is ImportQuotaExceededError {
    return error instanceof ImportQuotaExceededError;
}

/**
 * `409 VERSION_LINE_UNRESTORABLE` — a version restore would drop lines whose foods no longer exist and whose version
 * froze no name to find them by (plan 002 R52). NOTHING was restored.
 *
 * ⛔ ITS OWN TYPE, not a {@link VersionConflictError}: a conflict is cured by re-reading and retrying, and this is
 * not — retrying the same restore fails the same way. The surface names the lines (`positions`, 0-based in the
 * version's snapshot) and offers the cook a different version or an edit instead.
 */
export class VersionLineUnrestorableError extends RecipeServiceClientError {
    /** The 0-based positions, in the version's snapshot, of the lines that cannot be restored. */
    public readonly positions: readonly number[];

    public constructor(positions: readonly number[], message = 'This version cannot be restored') {
        super(message, 409, 'VERSION_LINE_UNRESTORABLE');
        this.name = 'VersionLineUnrestorableError';
        this.positions = positions;
        Object.setPrototypeOf(this, VersionLineUnrestorableError.prototype);
    }
}

/** Type guard for {@link VersionLineUnrestorableError}. */
export function isVersionLineUnrestorableError(error: unknown): error is VersionLineUnrestorableError {
    return error instanceof VersionLineUnrestorableError;
}

/**
 * The body the CALLER built does not satisfy the request schema the service publishes, so the request was
 * never sent (ADR-0014, outbound half).
 *
 * ⚠️ It exists to keep three failures that all "look like a 400" distinguishable, because the right response
 * to each is different and a caller cannot act on a conflated one:
 *
 *  1. **This error** — the caller's own bug. The body is illegal per `@kitchensink/schema-recipe`; no request
 *     went out, nothing was charged, nothing partially applied, and a retry with the same body cannot work.
 *  2. {@link BadRequestError} — the SERVER answered `400`. The body was legal per the contract this client
 *     compiles against and the service rejected it anyway, which is either a rule the contract does not
 *     express (a policy check) or genuine skew worth alerting on.
 *  3. A bare `ZodError` out of `RecipeServiceClient`'s response parse — the SERVER's body drifted.
 *
 * Collapsing 1 into 2 would have a caller retry-and-alert on its own malformed input; collapsing 1 into 3
 * would blame the service for the client's mistake. Carries the `ZodError` as `cause` so the offending
 * field path is available without re-parsing.
 */
export class InvalidRequestError extends RecipeServiceClientError {
    /** The `ZodError` from parsing the outbound body against the published request schema. */
    public override readonly cause: unknown;

    public constructor(operation: string, cause: unknown) {
        super(`Request body for ${operation} does not satisfy the published recipe-service contract`);
        this.name = 'InvalidRequestError';
        this.cause = cause;
        Object.setPrototypeOf(this, InvalidRequestError.prototype);
    }
}

/** Type guard for {@link InvalidRequestError}. */
export function isInvalidRequestError(error: unknown): error is InvalidRequestError {
    return error instanceof InvalidRequestError;
}

/** Any unmapped/unexpected response status (a contract drift the caller should surface, not swallow). */
export class UnexpectedResponseError extends RecipeServiceClientError {
    /**
     * @param status - The HTTP status that produced this error.
     * @param message - Defaults to a status-only summary when the body carried none.
     * @param code - The published `code` when the body carried one. It NOW usually does: since the recipe
     *   service converged onto one error envelope, a status this client has no dedicated error class for still
     *   arrives with a machine-readable code (`MAX_PHOTOS_EXCEEDED`, `TOO_MANY_REQUESTS`, `NOT_READY`, …), and
     *   dropping it here would discard the only actionable part of the body.
     * @param retryAfterSeconds - The wait the response's `Retry-After` header asked for, when it carried one.
     */
    public constructor(
        status: number,
        message = `Unexpected recipe-service response (${status})`,
        code?: string,
        retryAfterSeconds?: number,
    ) {
        super(message, status, code, retryAfterSeconds);
        this.name = 'UnexpectedResponseError';
        Object.setPrototypeOf(this, UnexpectedResponseError.prototype);
    }
}

/** Type guard for {@link UnexpectedResponseError}. */
export function isUnexpectedResponseError(error: unknown): error is UnexpectedResponseError {
    return error instanceof UnexpectedResponseError;
}
