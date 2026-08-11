/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/common/api-error.schema.ts

/**
 * THE ERROR WIRE CONTRACT — authored here and copied into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * ⚠️ FINDING, RECORDED RATHER THAN PAPERED OVER. This service does **not** emit one error shape. It emits
 * THREE, and which one a caller receives depends on which layer failed:
 *
 *  1. `{ code, message, details? }` — {@link apiErrorSchema}, the ARCH-PS-2 envelope shared verbatim with the
 *     identity and recipe services. Produced by `ApiExceptionFilter` for an uncaught food domain error and for
 *     the generic `500`.
 *  2. `{ statusCode, message, error }` — {@link nestHttpErrorSchema}, Nest's own default body. Produced by any
 *     `new HttpException('a string')`, which is how `FoodAuthGuard` raises every `401`.
 *  3. `{ error, …extras }` — {@link controllerErrorSchema}, the object payloads `FoodsController` passes to
 *     `BadRequestException`/`NotFoundException`/`ConflictException`/`ServiceUnavailableException`.
 *
 * All three reach the wire because the filter passes an `HttpException`'s response body through UNCHANGED
 * (`resolve()` → `exception.getResponse()`), and shapes 2 and 3 never enter the envelope. That is a genuine
 * pre-existing inconsistency, and it is published as a union rather than smoothed over because a document
 * claiming a single envelope would be a document that LIES — the failure mode §15.2 exists to prevent.
 *
 * CONVERGING THEM IS A SEPARATE, BREAKING CHANGE and deliberately NOT attempted here: today's shapes are
 * asserted by `tests/api-exception-filter.integration.test.ts`, `tests/foods-api.integration.test.ts` and the
 * client's own error mapping, and already-shipped mobile builds branch on them. It needs its own PR with the
 * client updated in step, not a drive-by normalization inside a contract-extraction change.
 */
import { z } from 'zod';

/**
 * The structured error envelope shared with the identity and recipe services (ARCH-PS-2).
 *
 * `code` is a plain `string`, not an enum of the codes emitted today, and that is deliberate: a client MUST
 * tolerate a code it has not been taught, because a deployed service adds codes ahead of a released mobile
 * binary. Narrowing it would make every new code a breaking change for a client that only branches on the few
 * it knows.
 *
 * `.loose()` throughout this module: these schemas DESCRIBE responses rather than validate requests, so a body
 * carrying a field a client has not been taught must stay valid instead of turning a forward-compatible deploy
 * into a client-side parse crash.
 */
export const apiErrorSchema = z
    .object({
        /** Stable, machine-readable failure code, e.g. `FOOD_NOT_FOUND`. Branch on this, never on `message`. */
        code: z.string(),
        /** Human-readable summary. Never localized, never security-sensitive, never a stack trace. */
        message: z.string(),
        /** Per-code diagnostic detail, when the code carries any. */
        details: z.record(z.string(), z.unknown()).optional(),
    })
    .loose();

/** The structured error envelope: `{ code, message, details? }`. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** Nest's own default `HttpException` body, still on the wire wherever an exception was raised with a string. */
export const nestHttpErrorSchema = z
    .object({
        /** The HTTP status, repeated in the body by Nest. */
        statusCode: z.number(),
        /** The exception's message. */
        message: z.string(),
        /** Nest's status text, e.g. `Unauthorized`. */
        error: z.string(),
    })
    .loose();

/** Nest's default `HttpException` body: `{ statusCode, message, error }`. */
export type NestHttpError = z.infer<typeof nestHttpErrorSchema>;

/**
 * The controller-raised payload: a short `error` label plus whatever that specific failure carries.
 *
 * Every extra is optional because the label determines which are present — `Batch too large` carries
 * `maxNames`, `Food not found` carries `id`/`status`/`message`, `Fetch temporarily unavailable` carries
 * `retryAfterSeconds`. A per-label discriminated union would model that precisely and is NOT built, because
 * the labels are prose that shifts with copy edits and no client branches on them; the union would be a
 * contract nobody consumes that then has to be kept honest.
 *
 * `status` is `z.string()` rather than the lifecycle enum on purpose: the enum lives in `foods.schema.ts`, and
 * an authored `*.schema.ts` may only import a FLAT sibling (generation flattens the package), so this
 * cross-vertical module cannot reach it. The lifecycle's authority is `foodStatusSchema`; this is a diagnostic
 * echo of it.
 */
export const controllerErrorSchema = z
    .object({
        /** Short failure label, e.g. `Invalid id`, `Empty name`, `Food not found`. */
        error: z.string(),
        /** Longer explanation, when the label needs one. */
        message: z.string().optional(),
        /** The food id the failure concerns (`Food not found`). */
        id: z.string().optional(),
        /** The food's lifecycle status (`Food not found`, `NOT_RESOLVABLE`). See `foodStatusSchema`. */
        status: z.string().optional(),
        /** The configured batch maximum (`Batch too large`) — runtime configuration, reported at failure. */
        maxNames: z.number().optional(),
        /** Seconds to wait (`Fetch temporarily unavailable`); also sent as the `Retry-After` header. */
        retryAfterSeconds: z.number().optional(),
    })
    .loose();

/** The controller-raised error payload: `{ error, …extras }`. */
export type ControllerError = z.infer<typeof controllerErrorSchema>;

/**
 * What a non-2xx body from this service actually is: one of the three live shapes.
 *
 * A plain union rather than a discriminated one, because the three have no common discriminant — that IS the
 * inconsistency. A consumer should test for `code`, then `error`, in that order.
 */
export const errorResponseSchema = z.union([apiErrorSchema, controllerErrorSchema, nestHttpErrorSchema]);

/** Any non-2xx body this service emits. */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
