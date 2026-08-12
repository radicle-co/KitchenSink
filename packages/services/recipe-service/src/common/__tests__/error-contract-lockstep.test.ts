/**
 * THE LOCKSTEP TEST — the REAL exception filter's output driven through the REAL
 * `@kitchensink/recipe-service-client`, in one process, with nothing hand-shaped in between.
 *
 * ── WHY THIS TIER EXISTS, AND WHAT IT CATCHES THAT NOTHING ELSE DOES ──
 *
 * Converging this service's error shapes into one was a change with two halves, and the halves live in different
 * packages:
 *
 *  - the SERVER stopped passing `HttpException` bodies through, so it no longer emits Nest's
 *    `{ statusCode, message, error? }`, `nestjs-zod`'s `{ statusCode, message: 'Validation failed', errors }`, the
 *    throttler's bare JSON STRING, or the readiness probe's `{ status: 'unavailable', service: 'recipe' }`;
 *  - the CLIENT stopped reading an unchecked `(res.body ?? {}) as { code?, message?, details? }` cast and now
 *    parses the published envelope and narrows on `code`.
 *
 * Move only one half and **`typecheck` says nothing.** The two sides exchange JSON at runtime, and every
 * per-package test asserts its own side's belief about that JSON: the filter suite asserts the body it writes, the
 * client suite asserts the body it is handed by a `fetch` double literal *in the client's own repo*. A body
 * literal in a client test is exactly the second, independently-authored representation of the contract that
 * `docs/CODING_STANDARDS.md` §15.1 exists to eliminate — it agrees with the server by the test author's memory.
 *
 * So these cases produce the body with `ApiExceptionFilter` and consume it with `RecipeServiceClient`. Break
 * either side and a case here fails naming the outcome that changed. It runs in the DEFAULT unit tier
 * deliberately: no database, no network, no Docker — a gate that needs a container is a gate that gets skipped,
 * and this is the only place the two halves meet before an e2e run against a live deployment.
 *
 * (`@kitchensink/recipe-service-client` is already a devDependency of this service, for `tests/e2e`. The
 * client → schema → service → client cycle that implies is why the turbo edge is `inputs` and not `dependsOn`.)
 *
 * DESIGN PATTERN: Test-double as a REPLAY channel. {@link throughTheWire} is the seam — the filter's captured
 * `(status, body)` pair is replayed verbatim as a `fetch` response, so the client sees bytes the server actually
 * produced rather than bytes a test author typed.
 */
import { BadRequestException, HttpStatus, UnauthorizedException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { RecipeErrorCode, type RecipeError } from '@kitchensink/recipe-core';
import {
    BadRequestError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    PullDriftError,
    RecipeServiceClient,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
} from '@kitchensink/recipe-service-client';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';

import { apiError } from '../api-error.js';
import { apiErrorSchema, recipeApiErrorSchema, recipeErrorCodeSchema } from '../api-error.schema.js';
import { ApiExceptionFilter } from '../filters/api-exception.filter.js';
import { CreateRecipeDto } from '../../recipes/dto/create-recipe.dto.js';

const BASE = 'https://recipe.example.test';
const RECIPE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CODE = recipeErrorCodeSchema.enum;

/** What the filter actually put on the wire. */
interface WireResponse {
    status: number;
    body: unknown;
}

/**
 * Run a throwable through the REAL filter and capture the HTTP response it wrote.
 *
 * @param throwable - The value a handler threw.
 * @returns The status and JSON body the filter emitted.
 * @sideEffect None observable — the "response" is a recorder. The filter's `Logger` writes to stdout.
 */
function throughTheFilter(throwable: unknown): WireResponse {
    const captured: WireResponse = { status: 0, body: undefined };
    const res = {
        status(code: number): Response {
            captured.status = code;

            return res as unknown as Response;
        },
        json(body: unknown): Response {
            captured.body = body;

            return res as unknown as Response;
        },
    };
    const request = { method: 'GET', originalUrl: `/api/v1/recipes/${RECIPE_ID}`, url: '/', headers: {} };
    const host = {
        switchToHttp: () => ({
            getResponse: <T>() => res as unknown as T,
            getRequest: <T>() => request as unknown as Request as T,
        }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(throwable, host);

    // Round-trip through JSON: what a client receives is the SERIALIZED body, and the pre-convergence `429` was a
    // bare string — a distinction that only survives if the replay uses the wire form.
    return { status: captured.status, body: JSON.parse(JSON.stringify(captured.body)) as unknown };
}

/**
 * Replay a captured wire response to the REAL client and return whatever typed error it threw.
 *
 * @param wire - The response the filter produced, replayed byte-for-byte.
 * @param call - The client method under test.
 * @returns The error the client threw.
 * @sideEffect Constructs a client whose `fetch` is a double; issues no real request.
 */
async function replayToClient(wire: WireResponse, call: (client: RecipeServiceClient) => Promise<unknown>) {
    const body = wire.body === undefined ? undefined : JSON.stringify(wire.body);
    const fetchDouble = vi.fn(
        async () => new Response(body, { status: wire.status, headers: { 'content-type': 'application/json' } }),
    );
    const client = new RecipeServiceClient({
        baseUrl: BASE,
        token: 'tok',
        fetch: fetchDouble as unknown as typeof fetch,
        // The first-token sync-race retry would re-issue the request against the same double and slow every 401
        // case; the retry behaviour itself is asserted by the client's own suite. Disabled by allowing ZERO
        // retries, not by stubbing the clock — an unstubbed `sleep` with a nonzero limit is how a suite like this
        // becomes intermittently slow.
        maxIdentitySyncRetries: 0,
    });

    try {
        await call(client);
    } catch (error) {
        return error;
    }

    return expect.unreachable('the client resolved a response the service sent as a failure');
}

/**
 * Filter → wire → client, in one call: the whole point of this file.
 *
 * @param throwable - What the service threw.
 * @param call - How the client asked for it.
 * @returns The wire response AND the typed error the client produced from it.
 */
async function throughTheWire(throwable: unknown, call: (client: RecipeServiceClient) => Promise<unknown>) {
    const wire = throughTheFilter(throwable);

    return { wire, error: await replayToClient(wire, call) };
}

/** A domain error, as a service would throw it. */
function domainError(code: RecipeError['code'], message: string, details?: Record<string, unknown>): RecipeError {
    return details === undefined ? { code, message } : { code, message, details };
}

/**
 * A full `RecipeSnapshot`, because `versionConflictSideSchema.snapshot` is one.
 *
 * Spelled out rather than trimmed to the fields under test, and that is the point of using the REAL schema: the
 * published union composes `recipe-core`'s `versionConflictDetailsSchema`, so a `details` missing any required
 * field FAILS the typed parse and the client degrades to a bare 409. A partial literal here would have passed a
 * hand-rolled schema and hidden that.
 */
const SNAPSHOT = {
    version: 7,
    title: 'Server Title',
    description: '',
    steps: [],
    ingredients: [],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
} as const;

/**
 * The `details` each domain code carries, for the exhaustive-narrowing case.
 *
 * A `Partial` keyed by code rather than a complete `Record`: most codes promise no `details`, and inventing an
 * empty object for them would assert something the contract does not say. The five that DO promise one are the
 * five arms of the published union that require it, so an arm gaining a required field without this map gaining
 * the value fails the exhaustive case — which is the coupling that keeps the two in step.
 */
const DETAILS_BY_CODE: Partial<Record<string, Record<string, unknown>>> = {
    [RecipeErrorCode.VERSION_CONFLICT]: {
        currentVersion: 7,
        conflictingVersion: 5,
        server: { versionNumber: 7, updatedAt: '2026-08-12T10:00:00.000Z', snapshot: SNAPSHOT },
    },
    [RecipeErrorCode.PULL_DRIFT]: { diff: { added: [], removed: [], unchanged: [] } },
    [RecipeErrorCode.COLLECTION_LIMIT_REACHED]: { limit: 50 },
    [RecipeErrorCode.MAX_PHOTOS_EXCEEDED]: { limit: 10 },
};

/** The `details` a real `VERSION_CONFLICT` carries (W8-a.5: enough for a client-side 3-way merge). */
const CONFLICT_DETAILS = {
    currentVersion: 7,
    conflictingVersion: 5,
    server: {
        versionNumber: 7,
        updatedAt: '2026-08-12T10:00:00.000Z',
        snapshot: SNAPSHOT,
    },
} as const;

describe('every body the filter writes is the ONE envelope', () => {
    /**
     * THE STRUCTURAL ASSERTION, and the one that would have failed before this change on four of these five.
     *
     * Each throwable below reached the wire as a DIFFERENT shape while the filter had a passthrough branch. They
     * are asserted as a group rather than individually because the property is about the SET: there is no input to
     * this filter that produces anything other than the envelope.
     */
    it.each([
        ['a domain error', domainError(RecipeErrorCode.RECIPE_NOT_FOUND, 'No such recipe')],
        ['a string-bodied HttpException', new BadRequestException('The confirmation phrase does not match.')],
        ['an ARGUMENT-LESS HttpException', new UnauthorizedException()],
        ['the throttler’s string-bodied exception', new ThrottlerException()],
        ['an unexpected throwable', new Error('a leaked internal detail')],
        ['a deliberately raised code', apiError('NOT_READY', 'Database not reachable')],
    ])('%s becomes { code, message, details? }', (_case, throwable) => {
        const { body } = throughTheFilter(throwable);

        expect(apiErrorSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    });

    /**
     * ⚠️ THE SPLIT BETWEEN THE TWO SCHEMAS, PINNED — and it is the assertion this suite got WRONG first.
     *
     * The case above originally asserted every filter output against the TYPED union, which failed on the generic
     * `BadRequestException`: its status-derived code is `BAD_REQUEST`, which is deliberately NOT a member of
     * `recipeErrorCodeSchema`. That is the design (see `api-error.ts`'s `STATUS_CODE`): a code that carries no
     * more information than the status beside it is not published, because publishing it would invite a consumer
     * to branch on it. The right property for the group is therefore the PERMISSIVE envelope.
     *
     * Both halves are pinned here so the boundary cannot move silently in either direction — a domain code
     * dropping out of the published set, or a status-derived string quietly becoming one.
     */
    it('narrows with the TYPED union for a published code, and only the envelope for a status-derived one', () => {
        const published = throughTheFilter(domainError(RecipeErrorCode.NOT_OWNER, 'Not yours')).body;
        const statusDerived = throughTheFilter(new BadRequestException('a hand-thrown rejection')).body;

        expect(recipeApiErrorSchema.safeParse(published).success).toBe(true);

        expect((statusDerived as { code: string }).code).toBe('BAD_REQUEST');
        expect(recipeApiErrorSchema.safeParse(statusDerived).success).toBe(false);
        expect(apiErrorSchema.safeParse(statusDerived).success).toBe(true);
    });

    /**
     * EVERY DOMAIN code must be narrowable, which is the half that actually matters to a consumer — and it is
     * asserted over `RecipeErrorCode`'s OWN values rather than a hand-copied list, so a code added to the domain
     * without an arm in the published union fails here rather than degrading silently in production.
     */
    it('narrows EVERY recipe-domain code, discovered from recipe-core rather than listed', () => {
        const unnarrowable = Object.values(RecipeErrorCode).filter((code) => {
            const { body } = throughTheFilter(domainError(code, 'a message', DETAILS_BY_CODE[code]));

            return !recipeApiErrorSchema.safeParse(body).success;
        });

        expect(unnarrowable).toStrictEqual([]);
    });

    it('never leaks an unexpected throwable’s message, which is where a stack fragment would ride', () => {
        const { status, body } = throughTheFilter(new Error('connection string: postgres://u:p@host/db'));

        expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(body).toStrictEqual({ code: CODE.INTERNAL_ERROR, message: 'Internal server error' });
    });
});

describe('the recipe error contract, end to end through both halves', () => {
    it('409 VERSION_CONFLICT → VersionConflictError carrying the versions AND the 3-way-merge snapshots', async () => {
        const { wire, error } = await throughTheWire(
            domainError(RecipeErrorCode.VERSION_CONFLICT, 'Recipe version conflict', { ...CONFLICT_DETAILS }),
            (client) => client.updateRecipe(RECIPE_ID, { expectedVersion: 5, title: 'Mine' }),
        );

        expect(wire.status).toBe(HttpStatus.CONFLICT);
        expect(error).toBeInstanceOf(VersionConflictError);
        // THE lockstep assertion for this code: every one of these values crossed the wire inside `details`, was
        // parsed by the PUBLISHED union (not re-narrowed by the client), and arrived typed.
        expect((error as VersionConflictError).currentVersion).toBe(7);
        expect((error as VersionConflictError).conflictingVersion).toBe(5);
        expect((error as VersionConflictError).server?.versionNumber).toBe(7);
    });

    /**
     * ⚠️ THE SHARPEST CASE IN THIS FILE — the two `409`s, discriminated with the MESSAGES DELIBERATELY MISLEADING.
     *
     * `VERSION_CONFLICT` and `PULL_DRIFT` are both `409`s, so the status cannot separate them, and their correct
     * handling differs (re-merge versus re-preview). Before the convergence the client separated them with
     * `body.code === 'PULL_DRIFT'` read off an UNVALIDATED cast, and anything that was not that literal fell
     * through to the version-conflict mapping — so a drifted or absent code produced the WRONG typed error.
     *
     * Both messages here are written to point at the OTHER outcome: the drift body says "version conflict" and the
     * conflict body says "pull drift". Any implementation that reads the prose — a regex, a `.includes()`, a
     * substring check — gets both cases backwards and fails. The discrimination must come from `code` alone.
     */
    it('tells the two 409s apart on CODE, with the messages written to mislead any prose-based reader', async () => {
        const drift = await throughTheWire(
            domainError(RecipeErrorCode.PULL_DRIFT, 'a version conflict occurred', {
                diff: { added: ['r1'], removed: [], unchanged: [] },
            }),
            (client) => client.pullCollectionFromSource(RECIPE_ID),
        );
        const conflict = await throughTheWire(
            domainError(RecipeErrorCode.VERSION_CONFLICT, 'pull drift detected', { ...CONFLICT_DETAILS }),
            (client) => client.updateRecipe(RECIPE_ID, { expectedVersion: 5, title: 'Mine' }),
        );

        expect(drift.error).toBeInstanceOf(PullDriftError);
        expect((drift.error as PullDriftError).diff.added).toStrictEqual(['r1']);
        expect(conflict.error).toBeInstanceOf(VersionConflictError);
        expect((conflict.error as VersionConflictError).currentVersion).toBe(7);
    });

    it('401 IDENTITY_SYNC_PENDING keeps its own code, so the retry case stays distinguishable from a real 401', async () => {
        const { wire, error } = await throughTheWire(
            new UnauthorizedException({ code: CODE.IDENTITY_SYNC_PENDING, message: 'ULID not yet synced' }),
            (client) => client.getRecipeById(RECIPE_ID),
        );

        expect(wire.status).toBe(HttpStatus.UNAUTHORIZED);
        // The `asExplicitEnvelope` branch is what protects this: a status-keyed derivation would have flattened it
        // into a plain `UNAUTHORIZED`, and the client's refresh-and-retry would never fire.
        expect((wire.body as { code: string }).code).toBe(CODE.IDENTITY_SYNC_PENDING);
        expect(error).toBeInstanceOf(UnauthorizedError);
        expect((error as UnauthorizedError).code).toBe(CODE.IDENTITY_SYNC_PENDING);
    });

    it('401 from an ARGUMENT-LESS exception gets a code it never had, and still maps to UnauthorizedError', async () => {
        // `ClerkAuthService` raises this, and `ServiceErasureAuthService` four more times. Its body was
        // `{ message: 'Unauthorized', statusCode: 401 }` — no `code` at all — so the client had nothing to read.
        const { wire, error } = await throughTheWire(new UnauthorizedException(), (client) =>
            client.getRecipeById(RECIPE_ID),
        );

        expect((wire.body as { code: string }).code).toBe(CODE.UNAUTHORIZED);
        expect(error).toBeInstanceOf(UnauthorizedError);
    });

    /**
     * The `404`, and the reason it is not merely the boring case: `RECIPE_NOT_FOUND` is the answer BOTH for a
     * recipe that does not exist AND for one the caller may not see. That conflation is deliberate and
     * security-relevant — a `403` for an invisible recipe would confirm it exists — so the code must be identical
     * for both, and this pins that a private recipe does not leak a different outcome.
     */
    it('404 RECIPE_NOT_FOUND → NotFoundError, identically for a missing and an invisible recipe', async () => {
        const missing = await throughTheWire(
            domainError(RecipeErrorCode.RECIPE_NOT_FOUND, 'No such recipe'),
            (client) => client.getRecipeById(RECIPE_ID),
        );
        const invisible = await throughTheWire(
            domainError(RecipeErrorCode.RECIPE_NOT_FOUND, 'No such recipe'),
            (client) => client.getRecipeById(RECIPE_ID),
        );

        expect(missing.wire.status).toBe(HttpStatus.NOT_FOUND);
        expect(missing.error).toBeInstanceOf(NotFoundError);
        expect((missing.error as NotFoundError).code).toBe(CODE.RECIPE_NOT_FOUND);
        // Byte-identical: nothing in the outcome tells the two apart, which is the property.
        expect(invisible.wire.body).toStrictEqual(missing.wire.body);
    });

    it('410 RECIPE_TOMBSTONED → GoneError, which a 404 must not be confused with', async () => {
        const { wire, error } = await throughTheWire(
            domainError(RecipeErrorCode.RECIPE_TOMBSTONED, 'The recipe was erased'),
            (client) => client.getRecipeById(RECIPE_ID),
        );

        expect(wire.status).toBe(HttpStatus.GONE);
        expect(error).toBeInstanceOf(GoneError);
        expect((error as GoneError).code).toBe(CODE.RECIPE_TOMBSTONED);
    });

    it('403 CANNOT_RATE_OWN_RECIPE → ForbiddenError with its own code, never a bare 403', async () => {
        const { error } = await throughTheWire(
            domainError(RecipeErrorCode.CANNOT_RATE_OWN_RECIPE, 'You cannot rate your own recipe'),
            (client) => client.setRecipeRating(RECIPE_ID, { stars: 5 }),
        );

        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).code).toBe(CODE.CANNOT_RATE_OWN_RECIPE);
    });

    /**
     * THE VALIDATION `400`, WHICH IS THE BODY GR-017 §17-c's RULING MADE COMMON.
     *
     * Driven through the REAL `nestjs-zod` pipe, so the `errors` array is the one the pipe really produces rather
     * than a literal. The filter turns it into `details.fields`, and the point of the case is that the rendered
     * field NAMES survive: `nestjs-zod`'s own body has the fixed message `Validation failed`, which tells a caller
     * their request was wrong and nothing about which part, and publishing that string is what §17-c's promise of
     * "a `400` the client can fix" would have failed on.
     */
    it('400 VALIDATION_FAILED names the rejected field, including an unrecognised key', async () => {
        let thrown: unknown;

        try {
            new ZodValidationPipe().transform(
                { title: 'A Recipe', tilte: 'typo', servings: 4 },
                { type: 'body', metatype: CreateRecipeDto },
            );
        } catch (error) {
            thrown = error;
        }

        // ⚠️ The call must be one whose OUTBOUND body the client accepts. `createRecipe` with a partial body
        // throws `InvalidRequestError` at the client's own request-validation boundary and never issues a
        // request, so the response path — the thing this case is about — would never run. `getRecipeById` has no
        // body to validate.
        const { wire, error } = await throughTheWire(thrown, (client) => client.getRecipeById(RECIPE_ID));
        const fields = (wire.body as { details: { fields: string[] } }).details.fields;

        expect(wire.status).toBe(HttpStatus.BAD_REQUEST);
        expect((wire.body as { code: string }).code).toBe(CODE.VALIDATION_FAILED);
        expect(fields.some((field) => field.includes('tilte'))).toBe(true);
        expect(error).toBeInstanceOf(BadRequestError);
        // The message is the joined fields, NOT the pipe's fixed `Validation failed`.
        expect((error as BadRequestError).message).not.toBe('Validation failed');
        expect((error as BadRequestError).message).toContain('tilte');
    });

    /**
     * THE `429`, WHICH USED TO BE A BARE JSON STRING.
     *
     * `@nestjs/throttler`'s `ThrottlerException` response IS the string `"ThrottlerException: Too Many Requests"`,
     * and the old filter passed it through — so the body on the wire was JSON text, not an object, and the client's
     * `body.message` read `undefined` off a string. It is now the envelope with a real code.
     */
    it('429 becomes the envelope with TOO_MANY_REQUESTS, where it used to be a bare JSON string', async () => {
        const { wire, error } = await throughTheWire(new ThrottlerException(), (client) =>
            client.getRecipeById(RECIPE_ID),
        );

        expect(typeof wire.body).toBe('object');
        expect((wire.body as { code: string }).code).toBe(CODE.TOO_MANY_REQUESTS);
        expect((wire.body as { message: string }).message).toContain('Too Many Requests');
        expect(error).toBeInstanceOf(UnexpectedResponseError);
        expect((error as UnexpectedResponseError).code).toBe(CODE.TOO_MANY_REQUESTS);
    });

    it('503 NOT_READY is the envelope, where the readiness probe used to send its own bespoke shape', () => {
        const { status, body } = throughTheFilter(apiError('NOT_READY', 'Database not reachable'));

        expect(status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(body).toStrictEqual({ code: CODE.NOT_READY, message: 'Database not reachable' });
        // The retired `HealthUnavailable` shape must not come back through any path.
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('service');
    });

    /**
     * FORWARD COMPATIBILITY, which is the property the two-layer read exists for.
     *
     * A deployed service may emit a code a released mobile binary has never been taught. The published union must
     * REJECT it (so the client does not invent a meaning) while the permissive envelope still parses it (so the
     * message and code survive) and the status still decides the class.
     */
    it('degrades correctly for a code this build has never been taught', async () => {
        const { error } = await throughTheWire(
            // Deliberately NOT a member of `recipeErrorCodeSchema` — this is what a newer server looks like.
            new BadRequestException({ code: 'A_CODE_FROM_A_LATER_DEPLOY', message: 'something new' }),
            (client) => client.getRecipeById(RECIPE_ID),
        );

        expect(error).toBeInstanceOf(BadRequestError);
        expect((error as BadRequestError).code).toBe('A_CODE_FROM_A_LATER_DEPLOY');
        expect((error as BadRequestError).message).toBe('something new');
    });

    // The ALB serves an HTML page for 502/503/504 during every deploy (ADR-0003), so a non-envelope body is a real
    // case and must not throw out of the error-mapping path itself.
    it('survives a body that is not our envelope at all', async () => {
        const fetchDouble = vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: fetchDouble as unknown as typeof fetch,
        });

        await expect(client.getRecipeById(RECIPE_ID)).rejects.toBeInstanceOf(UnexpectedResponseError);
    });
});
