/**
 * THE ERROR ENVELOPE IS PROVEN, NOT DESCRIBED — every published error shape is parsed out of a body the REAL
 * failing layer produced.
 *
 * `contract/openapi.ts` records two evidence standards for a documented response body: *observed in production*
 * (a shape the shipped client already parses, so it would be throwing were the schema wrong) and *proven
 * deliberately* (a suite drives the real code and parses its ACTUAL output). The error bodies have neither
 * property to inherit — the client did not parse them at all (`@unparsedBoundary`) — so this suite supplies the
 * second one.
 *
 * WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE. The previous `ErrorResponse` component was `recipe-core`'s
 * `recipeErrorSchema`, whose `code` is an ENUM of the fifteen recipe-DOMAIN codes. Three of the four bodies this
 * service actually emits do not satisfy it — the generic `500`'s `INTERNAL_ERROR`, every Nest `{ statusCode,
 * message, error }`, and the validation `400` — so the document described a shape the service mostly does not
 * send, and it did so while nothing compared the two. A schema written from the filter's source code would
 * reproduce that class of error; a schema whose every member is parsed from a real emitted body cannot.
 *
 * The suite is written to FAIL if a schema is loosened into vacuity as well as if it is wrong: each body is
 * required to parse against its OWN member and to be REJECTED by the members it is not, so folding two
 * populations together (or widening one until it swallows another) reds the build instead of passing.
 */
import {
    BadRequestException,
    GoneException,
    HttpStatus,
    UnauthorizedException,
    type ArgumentsHost,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import type { RecipeError } from '@kitchensink/recipe-core';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter } from '../filters/api-exception.filter.js';
import {
    apiErrorSchema,
    errorResponseSchema,
    nestHttpErrorSchema,
    throttleErrorSchema,
    validationErrorSchema,
} from '../api-error.schema.js';
import { CreateRecipeDto } from '../../recipes/dto/create-recipe.dto.js';
import { buildRecipeOpenApiDocument } from '../../../contract/openapi.js';

/** Capture what the filter wrote, exactly as `api-exception.filter.test.ts` does. */
function emit(thrown: unknown): { readonly status: number | undefined; readonly body: unknown } {
    const captured: { status: number | undefined; body: unknown } = { status: undefined, body: undefined };
    const response = {
        status: vi.fn((code: number) => {
            captured.status = code;

            return response;
        }),
        json: vi.fn((body: unknown) => {
            captured.body = body;

            return response;
        }),
    };
    const host = {
        switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(thrown, host);

    // Round-trip through JSON: what a client receives is the SERIALIZED body, and `ThrottlerException`'s is a
    // bare string — a distinction that only survives if the assertion looks at the wire form.
    return { status: captured.status, body: JSON.parse(JSON.stringify(captured.body)) as unknown };
}

/** Drive the REAL `nestjs-zod` pipe over the REAL create DTO and return the body its rejection produces. */
function emitValidationFailure(body: unknown): { readonly status: number | undefined; readonly body: unknown } {
    try {
        new ZodValidationPipe().transform(body, { type: 'body', metatype: CreateRecipeDto });
    } catch (thrown) {
        return emit(thrown);
    }

    throw new Error('the pipe accepted a body this test needs it to reject');
}

/** A minimal-but-valid create body, so a rejection is caused only by the field under test. */
const A_VALID_CREATE_BODY = {
    title: 'Herb Risotto',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    totalTimeMinutes: 35,
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
    steps: [{ instruction: 'Toast the rice.' }],
} as const;

describe('shape 1 — the { code, message, details? } envelope', () => {
    it('describes a DOMAIN error body, as the filter emits it', () => {
        const error: RecipeError = { code: RecipeErrorCode.RECIPE_NOT_FOUND, message: 'No such recipe' };
        const { body } = emit(error);

        expect(apiErrorSchema.parse(body)).toStrictEqual({ code: 'RECIPE_NOT_FOUND', message: 'No such recipe' });
    });

    it('describes the domain error that carries `details`, without flattening it', () => {
        const error: RecipeError = {
            code: RecipeErrorCode.VERSION_CONFLICT,
            message: 'Recipe version conflict',
            details: { currentVersion: 3, conflictingVersion: 2 },
        };

        expect(apiErrorSchema.parse(emit(error).body).details).toStrictEqual({
            currentVersion: 3,
            conflictingVersion: 2,
        });
    });

    // THE BODY THE OLD COMPONENT COULD NOT DESCRIBE. `recipeErrorSchema.code` is an enum of the fifteen domain
    // codes, and `INTERNAL_ERROR` is not one of them — so the document's own `500` description was false.
    it('describes the generic 500, whose `INTERNAL_ERROR` is NOT a recipe-domain code', () => {
        const { status, body } = emit(new Error('a leaked internal detail'));

        expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(apiErrorSchema.parse(body)).toStrictEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(JSON.stringify(body)).not.toContain('leaked internal detail');
    });

    it('describes the object-payload 401 the auth middleware raises for the first-token sync race', () => {
        const thrown = new UnauthorizedException({
            code: 'IDENTITY_SYNC_PENDING',
            message: 'App-user identity (external_id) not yet available; retry with a refreshed token.',
        });

        expect(apiErrorSchema.parse(emit(thrown).body).code).toBe('IDENTITY_SYNC_PENDING');
    });

    it('describes the object-payload 410 the erasure service raises for an already-erased account', () => {
        const thrown = new GoneException({
            code: 'ACCOUNT_ALREADY_ERASED',
            message: 'Account has already been erased',
        });

        expect(apiErrorSchema.parse(emit(thrown).body).code).toBe('ACCOUNT_ALREADY_ERASED');
    });

    // `code` must stay a plain `string`. Narrowing it to the codes emitted today makes every NEW code a
    // breaking change for a client that only branches on the few it knows — and a deployed service adds codes
    // ahead of a released mobile binary.
    it('admits a code it has not been taught, so a forward-compatible deploy is not a client crash', () => {
        expect(apiErrorSchema.safeParse({ code: 'A_CODE_FROM_A_LATER_DEPLOY', message: 'x' }).success).toBe(true);
    });

    it('passes an unknown FIELD through rather than stripping it, for the same reason', () => {
        expect(apiErrorSchema.parse({ code: 'X', message: 'y', addedLater: 1 })['addedLater']).toBe(1);
    });
});

describe('shape 2 — Nest’s own { statusCode, message, error? } body', () => {
    it('describes a string-constructed exception, which carries `error`', () => {
        const { body } = emit(new BadRequestException('The confirmation phrase does not match.'));

        expect(nestHttpErrorSchema.parse(body)).toStrictEqual({
            statusCode: 400,
            message: 'The confirmation phrase does not match.',
            error: 'Bad Request',
        });
    });

    // `error` MUST be optional: `new UnauthorizedException()` with no argument omits it entirely, and this
    // service raises exactly that in `ClerkAuthService` and four times in `ServiceErasureAuthService`. A
    // required `error` would make the union reject every one of those five 401s.
    it('describes the ARGUMENT-LESS exception, whose body has NO `error` key at all', () => {
        const { body } = emit(new UnauthorizedException());

        expect(body).not.toHaveProperty('error');
        expect(nestHttpErrorSchema.parse(body)).toStrictEqual({ statusCode: 401, message: 'Unauthorized' });
    });

    it('is NOT satisfied by the { code, message } envelope, so the two populations stay distinct', () => {
        expect(nestHttpErrorSchema.safeParse({ code: 'RECIPE_NOT_FOUND', message: 'x' }).success).toBe(false);
        expect(apiErrorSchema.safeParse({ statusCode: 404, message: 'x', error: 'Not Found' }).success).toBe(false);
    });
});

describe('shape 3 — the validation 400, which is what a REJECTED UNKNOWN KEY now produces', () => {
    it('is the body `nestjs-zod` emits, `errors` and all', () => {
        const { status, body } = emitValidationFailure({ ...A_VALID_CREATE_BODY, title: '' });
        const parsed = validationErrorSchema.parse(body);

        expect(status).toBe(HttpStatus.BAD_REQUEST);
        expect(parsed.message).toBe('Validation failed');
        expect(parsed.errors?.length).toBeGreaterThan(0);
    });

    /**
     * THE POINT OF THE WHOLE STRICT-OBJECT RULING, MADE MACHINE-READABLE.
     *
     * GR-017 §17-c picks rejection over stripping because "rejecting unknown keys turns a client's misspelled
     * field into a `400` the client can fix". That promise is only kept if the `400` says WHICH key — otherwise
     * the caller is told "Validation failed" and is no better off than with a silent strip. The `keys` array on
     * an `unrecognized_keys` issue is where that information lives, so it is published and asserted here.
     */
    it('names the misspelled key, which is what makes the 400 actionable rather than merely correct', () => {
        const { body } = emitValidationFailure({ ...A_VALID_CREATE_BODY, tilte: 'typo' });
        const issues = validationErrorSchema.parse(body).errors ?? [];

        expect(issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
        expect(issues.flatMap((issue) => issue.keys ?? [])).toContain('tilte');
    });

    it('reports the PATH of a nested failure, so a client can mark the offending input', () => {
        const { body } = emitValidationFailure({
            ...A_VALID_CREATE_BODY,
            ingredients: [{ ingredientId: 'not-a-uuid', name: 'Flour', quantity: 1 }],
        });
        const issues = validationErrorSchema.parse(body).errors ?? [];

        expect(issues.some((issue) => issue.path?.join('.') === 'ingredients.0.ingredientId')).toBe(true);
    });

    // It shares `statusCode` + `message` with shape 2 but has NO `error` and DOES have `errors`. Folding the
    // two together would publish a `400` that promises `error` (absent) and hides `errors` (present).
    it('is distinguishable from Nest’s default body, so the two are not one component', () => {
        const { body } = emitValidationFailure({ ...A_VALID_CREATE_BODY, title: '' });

        expect(body).not.toHaveProperty('error');
        expect(body).toHaveProperty('errors');
    });
});

describe('shape 4 — the 429, which is a bare JSON STRING and not an object at all', () => {
    /**
     * ⚠️ FINDING. `UserThrottlerGuard` extends `@nestjs/throttler`'s `ThrottlerGuard`, which throws
     * `ThrottlerException`; that exception's response is the bare string `"ThrottlerException: Too Many
     * Requests"`, and `ApiExceptionFilter` passes an `HttpException`'s response through UNCHANGED. So the
     * `429` body on the wire is a JSON string, while the document described it as `{ code, message }`.
     *
     * Published rather than normalized: converging it is a wire change on a status the shipped client already
     * handles (it falls to `UnexpectedResponseError`), and it belongs in the same PR as the client, not in a
     * contract-extraction change.
     */
    it('is the string the throttler guard produces, not an envelope', () => {
        const { status, body } = emit(new ThrottlerException());

        expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(typeof body).toBe('string');
        expect(throttleErrorSchema.parse(body)).toContain('Too Many Requests');
    });

    it('is rejected by all three OBJECT members, which is why it needs a member of its own', () => {
        const body = 'ThrottlerException: Too Many Requests';

        expect(apiErrorSchema.safeParse(body).success).toBe(false);
        expect(nestHttpErrorSchema.safeParse(body).success).toBe(false);
        expect(validationErrorSchema.safeParse(body).success).toBe(false);
    });
});

describe('the union — every body this service can emit parses, and it is not vacuous', () => {
    it('parses all four REAL bodies', () => {
        const bodies: readonly unknown[] = [
            emit({ code: RecipeErrorCode.NOT_OWNER, message: 'Not yours' } satisfies RecipeError).body,
            emit(new Error('boom')).body,
            emit(new BadRequestException('nope')).body,
            emit(new UnauthorizedException()).body,
            emitValidationFailure({ ...A_VALID_CREATE_BODY, title: '' }).body,
            emit(new ThrottlerException()).body,
        ];

        for (const body of bodies) {
            expect(errorResponseSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
        }
    });

    // Non-vacuity. A union that had degenerated to `z.unknown()` would satisfy every assertion above; these
    // are bodies this service cannot produce, and the union must still say no to them.
    it('REJECTS a body this service cannot emit, so the union is a check and not a rubber stamp', () => {
        expect(errorResponseSchema.safeParse({}).success).toBe(false);
        expect(errorResponseSchema.safeParse({ code: 404 }).success).toBe(false);
        expect(errorResponseSchema.safeParse({ message: 'no code and no statusCode' }).success).toBe(false);
        expect(errorResponseSchema.safeParse(null).success).toBe(false);
        expect(errorResponseSchema.safeParse(42).success).toBe(false);
    });
});

// ── The document's per-status CLAIM must accept every real body of that status ─────────────────────

describe('the published document does not claim a NARROWER shape than a status can carry', () => {
    /**
     * ⚠️ THIS SUITE EXISTS BECAUSE THE MISTAKE IT CATCHES WAS MADE IN THE CHANGE THAT ADDED IT.
     *
     * `contract/openapi.ts` publishes a component per error status. Narrowing one from the `ErrorResponse` union
     * to a specific member is legitimate ONLY when that status has exactly one producer — and the `400` was
     * briefly narrowed to `ValidationError` on the strength of the validation case being the common one. It is
     * not the only one: six hand-thrown `BadRequestException('a string')` sites emit `NestHttpError`, and three
     * domain codes mapped to `400` emit `ApiError`. The document would have promised `errors` on a body carrying
     * `error` — the same lie as the `recipeErrorSchema` component being removed, reintroduced one layer over.
     *
     * The check drives the REAL producers for the statuses that matter and requires the document's claimed
     * component to accept each. It cannot see a throw site added tomorrow; what it does is make a WRONG narrowing
     * fail immediately instead of shipping as a documented promise.
     */
    /** The component the emitted document claims for a status on `POST /api/v1/recipes`, resolved by `$ref`. */
    function claimedComponentFor(status: string): string {
        const paths = buildRecipeOpenApiDocument().document['paths'] as Record<
            string,
            Record<
                string,
                { readonly responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }> }
            >
        >;
        const ref = paths['/api/v1/recipes']?.['post']?.responses[status]?.content?.['application/json']?.schema.$ref;

        expect(ref, `POST /api/v1/recipes has no documented ${status} body`).toBeDefined();

        return String(ref).replace('#/components/schemas/', '');
    }

    /** The published zod for a component name. */
    const componentSchema: Readonly<Record<string, { safeParse: (value: unknown) => { success: boolean } }>> = {
        ErrorResponse: errorResponseSchema,
        ApiError: apiErrorSchema,
        NestHttpError: nestHttpErrorSchema,
        ValidationError: validationErrorSchema,
        ThrottleError: throttleErrorSchema,
    };

    it('the documented 400 accepts ALL THREE bodies a 400 can carry, not just the validation one', () => {
        const claimed = componentSchema[claimedComponentFor('400')];
        const realBodies: readonly unknown[] = [
            // 1. the nestjs-zod pipe
            emitValidationFailure({ ...A_VALID_CREATE_BODY, title: '' }).body,
            // 2. a hand-thrown BadRequestException (ErasureService, IngredientsController, PhotosService)
            emit(new BadRequestException('The confirmation phrase does not match.')).body,
            // 3. a DOMAIN code mapped to 400 by ApiExceptionFilter
            emit({ code: RecipeErrorCode.UNKNOWN_INGREDIENT, message: 'No such ingredient' } satisfies RecipeError)
                .body,
        ];

        expect(claimed).toBeDefined();

        for (const body of realBodies) {
            expect(claimed?.safeParse(body).success, `the documented 400 rejects ${JSON.stringify(body)}`).toBe(true);
        }
    });

    it('the documented 429 accepts the throttler’s bare string', () => {
        const claimed = componentSchema[claimedComponentFor('429')];

        expect(claimed?.safeParse(emit(new ThrottlerException()).body).success).toBe(true);
    });

    it('the documented 500 accepts the filter’s collapsed envelope', () => {
        const claimed = componentSchema[claimedComponentFor('500')];

        expect(claimed?.safeParse(emit(new Error('boom')).body).success).toBe(true);
    });

    it('the documented 401 accepts BOTH the sync-race envelope and Nest’s argument-less body', () => {
        const claimed = componentSchema[claimedComponentFor('401')];
        const syncRace = emit(new UnauthorizedException({ code: 'IDENTITY_SYNC_PENDING', message: 'retry' })).body;

        expect(claimed?.safeParse(syncRace).success).toBe(true);
        expect(claimed?.safeParse(emit(new UnauthorizedException()).body).success).toBe(true);
    });

    // Non-vacuity: the resolution must really be reading the document, and the narrow members must really be
    // narrower — otherwise every assertion above would hold against a component map of `z.unknown()`.
    it('is not vacuous — the narrow members REJECT bodies the union accepts', () => {
        expect(claimedComponentFor('429')).toBe('ThrottleError');
        expect(claimedComponentFor('400')).toBe('ErrorResponse');
        expect(validationErrorSchema.safeParse(emit(new BadRequestException('nope')).body).success).toBe(false);
        expect(throttleErrorSchema.safeParse(emit(new Error('boom')).body).success).toBe(false);
    });
});
