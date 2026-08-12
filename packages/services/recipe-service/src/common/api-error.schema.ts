/**
 * THE ERROR WIRE CONTRACT — authored here and copied into `@kitchensink/schema-recipe`
 * (`docs/CODING_STANDARDS.md` §15.2 / ADR-0014).
 *
 * SOURCE OF TRUTH for these shapes. It may import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling
 * `*.schema.js` modules — enforced by `@kitchensink/contract-gen`'s import restriction.
 *
 * ⚠️ WHY THIS FILE HAD TO EXIST, AND WHAT WAS WRONG BEFORE IT. Recipe was the one service of the three with no
 * authored error envelope, and the gap was not merely an omission — the published `ErrorResponse` component was
 * `@kitchensink/recipe-core`'s `recipeErrorSchema`, whose `code` is an ENUM of the fifteen recipe-DOMAIN codes.
 * That schema is CORRECT for what it is (the type guard `ApiExceptionFilter` uses to recognise a thrown domain
 * error, which is precisely why it is an enum) and WRONG as a description of the wire: the generic `500`'s
 * `INTERNAL_ERROR`, the auth middleware's `IDENTITY_SYNC_PENDING` `401`, the erasure service's
 * `ACCOUNT_ALREADY_ERASED` `410`, every Nest `{ statusCode, message, error }`, the validation `400` and the
 * `429` all FAIL it. So the document promised one narrow shape while the service emitted four, and the typed
 * client — having nothing publishable to parse against — read error bodies through an unchecked cast marked
 * `@unparsedBoundary`. `recipeErrorSchema` keeps its job as the domain-error guard; the WIRE is described here.
 *
 * ⚠️ FINDING, RECORDED RATHER THAN PAPERED OVER: this service does not emit ONE error shape. It emits FOUR, and
 * which one a caller receives depends on which layer failed:
 *
 *  1. `{ code, message, details? }` — {@link apiErrorSchema}, the ARCH-PS-2 envelope shared verbatim with the
 *     food and identity services. Produced by `ApiExceptionFilter` for a thrown recipe domain error, for the
 *     generic `500`, and for the two exceptions raised with an object payload of this shape
 *     (`IDENTITY_SYNC_PENDING` `401`, `ACCOUNT_ALREADY_ERASED` `410`).
 *  2. `{ statusCode, message, error? }` — {@link nestHttpErrorSchema}, Nest's own default body, produced by any
 *     `new HttpException('a string')`. `error` is OPTIONAL because an ARGUMENT-LESS exception omits it, and this
 *     service raises `new UnauthorizedException()` five times (`ClerkAuthService` once,
 *     `ServiceErasureAuthService` four).
 *  3. `{ statusCode, message: 'Validation failed', errors? }` — {@link validationErrorSchema}, `nestjs-zod`'s
 *     `ZodValidationException`. This is the body EVERY request-validation `400` carries, which since the
 *     `z.strictObject()` sweep (GR-017 §17-c) includes every rejected unknown key — so it is also the body that
 *     tells a caller which field they misspelled. It shares `statusCode`/`message` with shape 2, carries no
 *     `error`, and carries `errors` that shape 2 never has.
 *  4. A bare JSON **string** — {@link throttleErrorSchema}. `UserThrottlerGuard` extends `@nestjs/throttler`'s
 *     `ThrottlerGuard`, whose `ThrottlerException` response is the string `"ThrottlerException: Too Many
 *     Requests"`, so the `429` body is not an object at all.
 *
 * All four reach the wire because `ApiExceptionFilter` passes an `HttpException`'s response body through
 * UNCHANGED. They are published as a UNION rather than smoothed over, because a document claiming a single
 * envelope would be a document that LIES — the failure §15.2 exists to prevent — and every member here is
 * parsed out of a body the real failing layer produced (`__tests__/api-error.schema.test.ts`).
 *
 * ⛔ CONVERGING THEM IS A SEPARATE, BREAKING CHANGE and deliberately NOT attempted here. Identity DOES normalize
 * (its filter rewrites every failure into shape 1) and that is the better end state, but reaching it from here
 * changes the failure body of all 41 operations for an already-shipped mobile binary, and it must land with the
 * client updated in step — the same call the food contract recorded making. What this file changes is only what
 * the document CLAIMS, which was false; the bytes on the wire are unchanged.
 *
 * `.loose()` throughout: these schemas DESCRIBE responses rather than validate requests, so a body carrying a
 * field a client has not been taught must stay valid instead of turning a forward-compatible deploy into a
 * client-side parse crash. That is the mirror image of the `z.strictObject()` rule for REQUEST bodies, and the
 * asymmetry is deliberate — a request's unknown key is a caller's mistake to be told about, a response's is a
 * newer server's addition to be tolerated.
 */
import { z } from 'zod';

import { versionConflictDetailsSchema, IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';

/**
 * The structured error envelope shared with the food and identity services (ARCH-PS-2).
 *
 * `code` is a plain `string`, not an enum of the codes emitted today, and that is deliberate: a client MUST
 * tolerate a code it has not been taught, because a deployed service adds codes ahead of a released mobile
 * binary. Narrowing it would make every new code a breaking change for a client that only branches on the few it
 * knows — and it is exactly how the previous `ErrorResponse` came to describe a shape the service mostly does
 * not send. ⛔ Do not "tighten" it to `recipe-core`'s `recipeErrorCodeSchema`: that enum is the DOMAIN's, and
 * three of this service's four error populations carry a code outside it (or no code at all).
 */
export const apiErrorSchema = z
    .object({
        /** Stable, machine-readable failure code, e.g. `RECIPE_NOT_FOUND`, `INTERNAL_ERROR`. Branch on this. */
        code: z.string(),
        /** Human-readable summary. Never localized, never security-sensitive, never a stack trace. */
        message: z.string(),
        /**
         * Per-code diagnostic detail, when the code carries any. Two are load-bearing and already parsed by the
         * typed client: `VERSION_CONFLICT` carries `{ currentVersion, conflictingVersion, server, base? }`
         * (`recipe-core`'s `versionConflictDetailsSchema`) and `PULL_DRIFT` carries `{ diff }`
         * (`collections.schema.ts`'s `pullDiffSchema`).
         */
        details: z.record(z.string(), z.unknown()).optional(),
    })
    .loose();

/** The structured error envelope: `{ code, message, details? }`. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * Nest's own default `HttpException` body, still on the wire wherever an exception was raised with a string.
 *
 * ⚠️ `error` IS OPTIONAL, and that is a fact rather than caution: `HttpException.createBody` omits it entirely
 * when the exception was constructed with no argument, so `new UnauthorizedException()` emits
 * `{ message: 'Unauthorized', statusCode: 401 }`. A required `error` would make this member reject five of this
 * service's real `401`s.
 *
 * `message` is `z.string()` rather than `z.union([z.string(), z.array(z.string())])`: Nest supports an array
 * message, but nothing in this service passes one, and publishing the wider type would tell an integrator to
 * handle a case that cannot occur. If an array is ever passed, this member must widen with it.
 */
export const nestHttpErrorSchema = z
    .object({
        /** The HTTP status, repeated in the body by Nest. */
        statusCode: z.number(),
        /** The exception's message. */
        message: z.string(),
        /** Nest's status text, e.g. `Unauthorized`. ABSENT for an argument-less exception. */
        error: z.string().optional(),
    })
    .loose();

/** Nest's default `HttpException` body: `{ statusCode, message, error? }`. */
export type NestHttpError = z.infer<typeof nestHttpErrorSchema>;

/**
 * One `zod` issue as `nestjs-zod` serializes it into a validation `400`.
 *
 * Deliberately shallow and loose: zod's issue union has a per-code shape (`expected`, `values`, `origin`,
 * `minimum`, …) and re-declaring all of it here would be a second, drifting copy of zod's own types for no
 * consumer's benefit. What IS declared is the three fields a client can act on, and `keys` is the reason this
 * schema exists at all — see {@link validationErrorSchema}.
 */
const validationIssueSchema = z
    .object({
        /** zod's issue code, e.g. `too_small`, `invalid_type`, `unrecognized_keys`. */
        code: z.string().optional(),
        /**
         * Path to the offending value, e.g. `['ingredients', 0, 'ingredientId']`. EMPTY for an issue about the
         * object itself, which is the case for a rejected unknown key.
         */
        path: z.array(z.union([z.string(), z.number()])).optional(),
        /** zod's message for the issue. */
        message: z.string().optional(),
        /** The unknown keys that were REJECTED. Present only on an `unrecognized_keys` issue. */
        keys: z.array(z.string()).optional(),
    })
    .loose();

/** One zod issue in a validation `400`. */
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/**
 * `nestjs-zod`'s `ZodValidationException` body — the response to EVERY request-validation failure.
 *
 * WHY IT IS ITS OWN COMPONENT AND NOT FOLDED INTO {@link nestHttpErrorSchema}. It shares `statusCode` and
 * `message`, but it has no `error` and it HAS `errors`. Folding them would publish a `400` that promises a field
 * this body never has and hides the only field a caller can act on.
 *
 * WHY `errors` MATTERS MORE SINCE THE STRICT-OBJECT SWEEP. GR-017 §17-c chose rejection over stripping because
 * "a client's misspelled field becomes a `400` the client can fix". That is only true if the `400` says WHICH
 * key, and `keys` on the `unrecognized_keys` issue is where that lives — a caller who reads only `message` sees
 * `Validation failed` and learns nothing. Publishing `errors` is what turns the ruling into a usable contract.
 *
 * `errors` is OPTIONAL because `nestjs-zod` omits it for a thrown value that is not a zod error.
 */
export const validationErrorSchema = z
    .object({
        /** Always `400`. */
        statusCode: z.number(),
        /** Always the literal `Validation failed` — the per-field detail is in `errors`, never here. */
        message: z.literal('Validation failed'),
        /** The zod issues, one per failed constraint. */
        errors: z.array(validationIssueSchema).optional(),
    })
    .loose();

/** The request-validation `400` body: `{ statusCode, message: 'Validation failed', errors? }`. */
export type ValidationError = z.infer<typeof validationErrorSchema>;

/**
 * The `429` body: a bare JSON **string**, not an envelope.
 *
 * `@nestjs/throttler`'s `ThrottlerException` is constructed with a string, so its response IS that string, and
 * `ApiExceptionFilter` passes an `HttpException`'s response through unchanged. Published as `z.string()` because
 * that is what a caller receives; the `Retry-After` header (documented on the operation) is where the actionable
 * information is.
 *
 * ⛔ Do not "fix" this by asserting an object here — that would make the document claim a body the guard does not
 * send. Normalizing the guard's response is the real fix and is a wire change owed its own PR.
 */
export const throttleErrorSchema = z.string();

/** The rate-limit `429` body: a bare string. */
export type ThrottleError = z.infer<typeof throttleErrorSchema>;

/**
 * What a non-2xx body from this service actually is: one of the four live shapes.
 *
 * A plain union rather than a discriminated one, because the four have no common discriminant — that IS the
 * inconsistency. A consumer should test in this order: a `string` is the rate limit; then `code` (the envelope);
 * then `errors` (a validation failure); then `statusCode` (Nest's default).
 *
 * Member ORDER is not load-bearing for correctness — no body satisfies two members, asserted in
 * `__tests__/api-error.schema.test.ts` — but it is kept in "most specific first" order so a zod error names the
 * closest member rather than the first one tried.
 */
export const errorResponseSchema = z.union([
    apiErrorSchema,
    validationErrorSchema,
    nestHttpErrorSchema,
    throttleErrorSchema,
]);

/** Any non-2xx body this service emits. */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ── Re-exported wire shapes: the two error payloads a client must branch on ───────────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION. `recipe-core` remains the sole AUTHOR; this makes the shape reachable from
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. The full reasoning
 * (and the `CONTRACT_HASH` residual it does not close) is stated ONCE, in `recipes.schema.ts`. ⛔ Do not
 * re-declare it here to make this file self-contained.
 */
export {
    /**
     * The `details` payload of a `409` whose `code` is `VERSION_CONFLICT` —
     * `{ currentVersion, conflictingVersion, server, base? }`. Re-exported HERE, with the envelope that
     * carries it, so a consumer can obtain every schema it needs to parse an error body from one package.
     */
    versionConflictDetailsSchema,
    /**
     * The `code` on the `401` a client must RETRY rather than surface (the first-token sync race). A wire
     * constant, not a domain one: a consumer that compares against a literal of its own has re-declared the
     * contract, which is what §15 rule 4 forbids.
     */
    IDENTITY_SYNC_PENDING_CODE,
};
