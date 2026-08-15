/**
 * THE ERROR WIRE CONTRACT — authored here and copied into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * ── ONE SHAPE. THERE USED TO BE THREE. ──
 *
 * Until 2026-08-12 this service emitted a different error body depending on which layer failed:
 *
 *  1. `{ code, message, details? }` — this envelope, from `ApiExceptionFilter`, for a food domain error.
 *  2. `{ statusCode, message, error }` — Nest's own default body, from any `new HttpException('a string')`,
 *     which is how `FoodAuthGuard` raised every `401`.
 *  3. `{ error, …extras }` — the object payloads `FoodsController` passed to `BadRequestException` /
 *     `NotFoundException` / `ConflictException` / `ServiceUnavailableException`.
 *
 * All three reached the wire because the filter passed an `HttpException`'s body through UNCHANGED, and the
 * published contract described the union honestly rather than claiming a uniformity that did not exist. The cost
 * landed on consumers: `@kitchensink/food-service-client` read `body.status` on a `404` and told a
 * candidate-not-in-set `409` from a lifecycle-conflict `409` with `/candidate/i.test(body.error)` — a regex over
 * human-readable prose deciding which typed error a caller received.
 *
 * The convergence removed the shapes rather than reformatting them:
 *
 *  - `ApiExceptionFilter` now NORMALIZES every failure into {@link apiErrorSchema}. There is no passthrough
 *    branch, so a string-bodied `HttpException` thrown anywhere — including by Nest itself, on a route no
 *    controller in this service owns — still leaves as this envelope. That guarantee is STRUCTURAL: it does not
 *    depend on anyone remembering to shape a body at a throw site.
 *  - Discrimination moved onto the stable `code`. `packages/services/food-service/src/foods/foods.schema.ts`
 *    publishes `foodErrorCodeSchema` and `foodErrorSchema` — a discriminated union over `code` whose `details`
 *    are typed per code, including a real `FoodStatus`. That is where a consumer narrows.
 *
 * Why the typed union is not in THIS file: generation flattens every authored schema into one directory, so a
 * `*.schema.ts` may import only a flat `./x.schema.js` sibling. This module is cross-vertical (health, admin and
 * the service-erasure route all answer through it) and cannot reach `foods.schema.ts`'s lifecycle enum. The
 * envelope therefore stays generic and the foods vertical publishes the typed refinement, with
 * `src/foods/__tests__/foods.schema.test.ts` asserting every arm of the refinement is a valid envelope.
 */
import { z } from 'zod';

/**
 * The structured error envelope shared with the identity and recipe services (ARCH-PS-2), and the ONLY shape a
 * non-2xx body from this service has.
 *
 * `code` is a plain `string`, not an enum of the codes emitted today, and that is deliberate: a client MUST
 * tolerate a code it has not been taught, because a deployed service adds codes ahead of a released mobile
 * binary. Narrowing it here would make every new code a breaking change for a client that only branches on the
 * few it knows — and the typed narrowing a client DOES want is available separately, as `foodErrorSchema`.
 *
 * `.loose()`: this schema DESCRIBES a response rather than validating a request, so a body carrying a field a
 * client has not been taught must stay valid instead of turning a forward-compatible deploy into a client-side
 * parse crash.
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

/** The one error shape this service emits: `{ code, message, details? }`. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
