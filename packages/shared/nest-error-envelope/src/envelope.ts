/**
 * THE ONE NEST→ENVELOPE NORMALIZATION, shared by every HTTP service's `ApiExceptionFilter`.
 *
 * ── WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT ──
 *
 * It is the MECHANISM: "given an `HttpException` of any shape Nest can build, produce `{ code, message, details? }`".
 * It is NOT the CONTRACT. Each service still AUTHORS its own `apiErrorSchema`, its own published code enum and its
 * own code→status table in its own `*.schema.ts` (ADR-0014 / CODING_STANDARDS §15.2), because those are wire
 * contracts and each service owns its wire. Nothing here is published to any client, imported by any client, or
 * reachable from any `@kitchensink/schema-*` package.
 *
 * That split is the whole design. The three services agreed on the mechanism and disagreed on the contract, so
 * copying the mechanism to keep the contracts separate was paying the wrong price.
 *
 * ── WHY IT EXISTS: THREE COPIES MEANT THREE BEHAVIOURS, AND ONE OF THEM WAS WRONG ──
 *
 * Measured 2026-08-12: 102 of the 137 code lines in recipe's `ApiExceptionFilter` also appeared in food's, and
 * `codeForStatus` + its status table existed three times. That alone is duplication. The reason it was a DEFECT
 * rather than untidiness is what the third copy was missing:
 *
 * `identity`'s filter had NO `asExplicitEnvelope` branch. `HealthController.getReadiness` raises
 * `new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database not reachable' })` and identity's own
 * published `openapi.yaml` describes that `503` as "Database not reachable (`NOT_READY`)" — but the filter derived
 * the code from the STATUS and put `SERVICE_UNAVAILABLE` on the wire. The document described a code the service
 * never sent, on the auth service every request touches, and no test could see it because the branch that would
 * have preserved the code did not exist in that copy to be tested.
 *
 * A status-keyed derivation cannot distinguish two failures that share a status and need opposite handling, which
 * is the entire reason the envelope carries a code at all: `IDENTITY_SYNC_PENDING` ("retry with a refreshed token")
 * versus `UNAUTHORIZED` ("sign in") are both `401`s, and `ACCOUNT_ALREADY_ERASED` versus a bare `GONE` are both
 * `410`s. Food and recipe protected that distinction; identity flattened it.
 *
 * ── SERVER-ONLY, WHICH IS WHY THIS EXTRACTION IS ALLOWED AND `contractSkew.ts`'s IS NOT ──
 *
 * `packages/clients/food-service/src/contractSkew.ts` records a deliberate refusal to extract ITS duplicate into a
 * shared leaf: that module is bundled into `@commise/web` (via `transpilePackages`, an explicit allowlist) and into
 * the released mobile binary, so a new workspace package on that path is a bundler-resolution change that cannot be
 * verified without a real device build. ⛔ That reasoning does NOT transfer here and must not be cited to undo this
 * extraction: this module imports `@nestjs/common`, is consumed only by `packages/services/*`, and is never part of
 * any client bundle. The two cases differ in the one property that mattered.
 */
import { HttpStatus } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';

/**
 * The envelope every service publishes for a failure — the MECHANISM's structural view of it.
 *
 * ⚠️ This is NOT a fourth declaration of the wire contract, and the distinction is load-bearing. Each service's
 * `apiErrorSchema` remains the authored, published shape; this is the type this module's pure functions return, and
 * it is structurally what all three `z.infer`s already are. Nothing publishes it, and no client can reach it.
 *
 * The property that keeps it honest is asserted mechanically rather than assumed: `errorEnvelopeParity.test.ts`
 * (`packages/infra/global/__tests__`) parses a value of this type with EVERY service's published `apiErrorSchema`,
 * which is what makes the long-standing claim — "shared VERBATIM with the food and identity services (ARCH-PS-2),
 * so one client-side handler covers all three" — a checked fact instead of prose.
 */
export interface ApiErrorEnvelope {
    /** Stable, machine-readable failure code. The value a client branches on. */
    readonly code: string;
    /** Human-readable summary. Never localized, never security-sensitive, never a stack trace. */
    readonly message: string;
    /** Per-code diagnostic detail, when that code's contract promises any. */
    readonly details?: Record<string, unknown>;
}

/** What a normalization decided to put on the wire: the status and the envelope. */
export interface NormalizedFailure {
    /** The HTTP status to answer with. */
    readonly status: number;
    /** The body to answer with. */
    readonly body: ApiErrorEnvelope;
}

/** Last-resort `message` when neither the body nor the exception offers a non-empty one. */
export const UNSPECIFIED_MESSAGE = 'Request failed';

/**
 * Body keys the framework owns; never lifted into `details`, because they duplicate the envelope.
 *
 * Exported so a service that grows a fourth framework key can assert against this set rather than restating it.
 */
export const FRAMEWORK_KEYS: ReadonlySet<string> = new Set([
    'statusCode',
    'message',
    'error',
    'code',
    'details',
    'errors',
]);

/**
 * The GENERIC half of the status→code vocabulary: the statuses that are not about any service's domain.
 *
 * The three services spell these IDENTICALLY on purpose, so a client reads one vocabulary for the cases that are
 * not domain-specific. A service SPREADS this and overrides the entries its own published enum names — e.g. recipe
 * maps `404` to its published `NOT_FOUND` member and `500` to `INTERNAL_ERROR`.
 *
 * ⚠️ NOT every value here is a PUBLISHED code in any given service, and that is deliberate rather than an
 * oversight. `BAD_REQUEST`, `METHOD_NOT_ALLOWED`, `CONFLICT`, `GONE`, `UNPROCESSABLE_ENTITY`, `LOCKED` and
 * `SERVICE_UNAVAILABLE` are absent from recipe's and food's code enums, so a typed client's union REJECTS them and
 * the consumer degrades to mapping by status — which is the correct handling, because these are exactly the
 * failures where the status IS the whole signal. Publishing them would invite a consumer to branch on a code
 * carrying no more information than the number beside it.
 *
 * ⚠️ `NOT_FOUND` here is NOT any service's `<ENTITY>_NOT_FOUND`: it is a request for a path the service does not
 * route, which is a different failure with a different fix. Keeping them distinct is the point of having a code.
 */
export const GENERIC_STATUS_CODES: Readonly<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.GONE]: 'GONE',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    // HTTP 423 Locked (WebDAV, RFC 4918). Nest's `HttpStatus` enum does not define it.
    423: 'LOCKED',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * The `code` to publish for a status that arrived with no code of its own.
 *
 * @param status - The HTTP status being returned.
 * @param table - The service's own status→code table (typically `GENERIC_STATUS_CODES` spread and extended).
 * @returns A stable code — `HTTP_<status>` for anything unlisted, which is deterministic and leaks nothing. Pure.
 */
export function codeForStatus(status: number, table: Readonly<Record<number, string>>): string {
    return table[status] ?? `HTTP_${status}`;
}

/**
 * Render ONE zod issue as a human-readable constraint, prefixed with the field it failed on. Pure.
 *
 * A zod issue's `message` is the CONSTRAINT alone (`Too small: expected string to have >=1 characters`), so without
 * the path a caller is told something is wrong but not what. An issue whose `path` is empty describes the object
 * itself — `z.strictObject`'s `unrecognized_keys` is exactly that, and since the strict sweep it is a common case —
 * and is rendered bare rather than with an empty `': '` prefix. A path segment may be a symbol in zod v4, hence the
 * string/number filter.
 *
 * @param issue - One entry of the validation exception's `errors` array.
 * @returns `"<field path>: <message>"`, the bare message for a path-less issue, or `undefined` when the entry is
 *   not renderable (so an unrecognised shape degrades to the envelope's own message).
 */
export function describeIssue(issue: unknown): string | undefined {
    if (issue === null || typeof issue !== 'object') {
        return undefined;
    }

    const message = (issue as Record<string, unknown>)['message'];

    if (typeof message !== 'string' || message.length === 0) {
        return undefined;
    }

    const rawPath = (issue as Record<string, unknown>)['path'];
    const field = Array.isArray(rawPath)
        ? rawPath
              .filter(
                  (segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number',
              )
              .join('.')
        : '';

    return field.length === 0 ? message : `${field}: ${message}`;
}

/**
 * Translate a `nestjs-zod` validation rejection into the envelope, or `undefined` when the body is not one.
 *
 * WHY THIS EXISTS. `ZodValidationPipe` throws a `ZodValidationException` whose body is
 * `{ statusCode, message: 'Validation failed', errors: [...issues] }` — a FIXED message that discards both the
 * field names and the issues. Without this branch the generic normalization would faithfully publish that useless
 * string, telling a caller their request was invalid and nothing about which part. GR-017 §17-c's promise is that a
 * misspelled field becomes "a `400` the client can fix", and a body reading only `Validation failed` does not keep
 * it.
 *
 * The `errors` key is matched STRUCTURALLY rather than with `instanceof ZodValidationException`: the input here is
 * the serialized response body, and a duck-typed match cannot be defeated by a duplicated `nestjs-zod` install.
 * That the pipe really does put its issues there is pinned by each service's own filter test, which drives the REAL
 * pipe rather than a hand-shaped body.
 *
 * @param body - The `HttpException`'s response body.
 * @param validationFailedCode - The service's own published code for a boundary rejection.
 * @returns The envelope, or `undefined` when this is not a validation rejection. Pure.
 */
export function asValidationEnvelope(body: unknown, validationFailedCode: string): ApiErrorEnvelope | undefined {
    if (body === null || typeof body !== 'object') {
        return undefined;
    }

    const rawErrors = (body as Record<string, unknown>)['errors'];

    if (!Array.isArray(rawErrors)) {
        return undefined;
    }

    const fields = rawErrors.map(describeIssue).filter((field): field is string => field !== undefined);

    // An `errors` array with nothing renderable in it must not manufacture an empty `details.fields` or a blank
    // `message` — fall through to the generic normalization instead.
    if (fields.length === 0) {
        return undefined;
    }

    return { code: validationFailedCode, message: fields.join(', '), details: { fields } };
}

/**
 * A body that is ALREADY the envelope, taken verbatim. `undefined` when it is not one.
 *
 * ⚠️ THIS IS THE BRANCH IDENTITY DID NOT HAVE, and its absence published the wrong code on a documented route (see
 * the module header). It is what keeps a DELIBERATE code from being overwritten by a status-derived one.
 *
 * The envelope is REBUILT from the recognised keys rather than spread: a body of `{ code, message, id }` must not
 * publish a stray top-level `id`, because "extras live in `details`" is the property the one-shape contract rests
 * on. Dropping it here makes the omission visible in a test rather than on the wire.
 *
 * @param body - The `HttpException`'s response body.
 * @param fallbackMessage - `exception.message`, used when the body names a code but no message.
 * @returns The envelope, or `undefined`. Pure.
 */
export function asExplicitEnvelope(body: unknown, fallbackMessage: string): ApiErrorEnvelope | undefined {
    if (body === null || typeof body !== 'object') {
        return undefined;
    }

    const record = body as Record<string, unknown>;
    const code = record['code'];

    if (typeof code !== 'string' || code.length === 0) {
        return undefined;
    }

    // A `code` with NO message is still an explicit code, and losing it would flatten the very distinction this
    // branch exists to protect. The message falls back to the exception's; only the code is load-bearing.
    const raw = record['message'];
    const candidate = typeof raw === 'string' && raw.length > 0 ? raw : fallbackMessage;
    const message = candidate.length > 0 ? candidate : UNSPECIFIED_MESSAGE;
    const details = record['details'];

    return details !== null && typeof details === 'object' && !Array.isArray(details)
        ? { code, message, details: details as Record<string, unknown> }
        : { code, message };
}

/**
 * The best available `message` for a framework body, plus any caller-relevant extras lifted into `details`.
 *
 * Handles every body shape Nest can hand us:
 *
 *  - a bare STRING — `new HttpException('Locked', 423)`, and `@nestjs/throttler`'s `ThrottlerException`, whose
 *    response IS the string `"ThrottlerException: Too Many Requests"`. That is the `429` body that used to reach
 *    the wire as bare JSON text rather than an object;
 *  - `{ statusCode, message, error }` — Nest's own object body, from every `new BadRequestException('a string')`;
 *  - `{ message: 'Unauthorized', statusCode: 401 }` — the ARGUMENT-LESS form, which omits `error` entirely;
 *  - `{ message: [...] }` — the array form Nest builds for a multi-constraint rejection;
 *  - anything else (a number, an array) — falls back to `exception.message`, which Nest always populates.
 *
 * `error` is used as the message ONLY when there is no `message`, because in Nest's own body `error` is the STATUS
 * TEXT (`'Unauthorized'`) and publishing that would be strictly less informative than what sits beside it.
 *
 * @param body - The `HttpException`'s response body.
 * @param fallbackMessage - `exception.message`, used when the body carries none.
 * @returns The message and, when the body carried extras, the `details` to publish them under. Pure.
 */
export function describeBody(
    body: unknown,
    fallbackMessage: string,
): { message: string; details?: Record<string, unknown> } {
    if (typeof body === 'string') {
        // ⚠️ The `UNSPECIFIED_MESSAGE` floor applies HERE too, and its absence was a latent bug in both
        // hand-written copies: `new HttpException('', 400)` gives Nest an empty response string AND an empty
        // `exception.message`, so this branch published `{ code: 'BAD_REQUEST', message: '' }` — a body whose only
        // human-readable field is blank. It parsed fine (`z.string()` accepts `''`), so nothing downstream noticed.
        // Found by testing the mechanism directly, which is a thing that only became possible once it had one home.
        const resolved = body.length > 0 ? body : fallbackMessage;

        return { message: resolved.length > 0 ? resolved : UNSPECIFIED_MESSAGE };
    }

    if (body === null || typeof body !== 'object') {
        return { message: fallbackMessage.length > 0 ? fallbackMessage : UNSPECIFIED_MESSAGE };
    }

    const record = body as Record<string, unknown>;
    const rawMessage = record['message'];
    const rawError = record['error'];
    let message = fallbackMessage;

    if (Array.isArray(rawMessage)) {
        message = rawMessage.join(', ');
    } else if (typeof rawMessage === 'string' && rawMessage.length > 0) {
        message = rawMessage;
    } else if (typeof rawError === 'string' && rawError.length > 0) {
        message = rawError;
    }

    const extras = Object.fromEntries(Object.entries(record).filter(([key]) => !FRAMEWORK_KEYS.has(key)));
    const resolved = message.length > 0 ? message : UNSPECIFIED_MESSAGE;

    // A `message` ARRAY is Nest's per-field rejection shape, so it is published as `details.fields` — the same key
    // the zod path uses, so a client reads one place regardless of which validator rejected it.
    if (Array.isArray(rawMessage)) {
        return { message: resolved, details: { ...extras, fields: rawMessage } };
    }

    return Object.keys(extras).length === 0 ? { message: resolved } : { message: resolved, details: extras };
}

/** What a service must tell this module about its OWN published contract. */
export interface EnvelopeVocabulary {
    /** The service's published code for a boundary rejection (`details.fields` names each offending field). */
    readonly validationFailedCode: string;
    /** The service's status→code table — `GENERIC_STATUS_CODES` spread, with its own published members over it. */
    readonly statusCode: Readonly<Record<number, string>>;
}

/**
 * Normalize ANY `HttpException` — whoever raised it, whatever body it carries — into the envelope.
 *
 * ⛔ THERE IS NO PASSTHROUGH BRANCH, AND THAT IS THE POINT. Returning `exception.getResponse()` unchanged is what
 * put FOUR error shapes on a service's wire: the envelope, Nest's `{ statusCode, message, error? }`,
 * `nestjs-zod`'s `{ statusCode, message: 'Validation failed', errors }`, and — for the `429` — a bare JSON STRING.
 * Because the guarantee lives HERE rather than at each throw site, it also covers failures a service does not
 * raise: `ClerkAuthService`'s argument-less `401`s, Nest's `404` for an unrouted path, the body parser's `413`, the
 * throttler's string `429`. No amount of controller discipline would have reached those.
 *
 * ⛔ Do not reintroduce a "pass it through if it looks fine" shortcut — "looks fine" is what the four shapes were.
 *
 * The branch ORDER is load-bearing: an explicit code wins over a validation body, because a service that raises
 * `{ code: 'X', errors: [...] }` means the `X`.
 *
 * @param exception - The thrown `HttpException`.
 * @param vocabulary - The raising service's published code vocabulary.
 * @returns The status and the envelope to surface. Pure.
 */
export function normalizeHttpException(exception: HttpException, vocabulary: EnvelopeVocabulary): NormalizedFailure {
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const envelope =
        asExplicitEnvelope(raw, exception.message) ?? asValidationEnvelope(raw, vocabulary.validationFailedCode);

    if (envelope !== undefined) {
        return { status, body: envelope };
    }

    const { message, details } = describeBody(raw, exception.message);
    const code = codeForStatus(status, vocabulary.statusCode);

    return { status, body: details === undefined ? { code, message } : { code, message, details } };
}
