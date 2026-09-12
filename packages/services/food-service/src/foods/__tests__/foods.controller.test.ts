/**
 * Unit tests for {@link FoodsController} over a mocked {@link FoodsService}: what the controller itself decides —
 * boundary rejections, the `202` pending READ body, the `/refetch` scope gate, and the requester key.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT HERE ANY MORE. The controller no longer maps a domain error to a status: that
 * knowledge lives in ONE table (`common/apiError.ts` → `FOOD_ERROR_STATUS`), executed by `ApiExceptionFilter`,
 * and asserting it here as well would be a second copy of the assertion for a second copy of the code that no
 * longer exists. So these cases assert that a domain error PROPAGATES UNCHANGED — which is the controller's actual
 * contribution — and the status/body it becomes is pinned in
 * `common/filters/__tests__/apiException.filter.test.ts` (unit) and `tests/foodsApi.integration.test.ts`
 * (end-to-end, over a real HTTP request).
 *
 * That split matters for a specific reason: a `rejects.toBeInstanceOf(ConflictException)` here would still pass if
 * the filter's 409 mapping were deleted, because nothing downstream of the controller was in the test's scope.
 *
 * Requirement → test mapping:
 * - FR-002/003     → getFood 200 / 202 pending body
 * - FR-004/RES-2   → the read/resolve domain errors reach the filter untouched
 * - FR-006         → malformed ULID → 400 `INVALID_ID`
 * - FR-045         → oversized batch → 400 `BATCH_TOO_LARGE`, with the configured cap in the body
 * - FR-039/FR-051  → /refetch requires the admin scope (403), checked before id validation
 * - CR-002/U1      → the requester key is the app-user ULID, and defers with 401 `IDENTITY_SYNC_PENDING`
 */
import { HttpException, HttpStatus, NotFoundException, RequestMethod } from '@nestjs/common';
import { HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../auth/authenticatedPrincipal.js';
import { FOOD_ERROR_STATUS } from '../../common/apiError.js';
import type { ApiErrorBody } from '../../common/apiError.schema.js';
import type { Environment } from '../../config/env.schema.js';
import type { SearchTermQueryDto } from '../dto/foods.dto.js';
import { FoodsController } from '../foods.controller.js';
import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../foods.errors.js';
import { FoodsService } from '../foods.service.js';
import type { TestPrincipalPurgeService } from '../testPrincipalPurge.service.js';

const VALID_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

/**
 * Assert a thrown value is the coded envelope for `code`, at the status the ONE table assigns it.
 *
 * Reads the status from `FOOD_ERROR_STATUS` rather than restating it, so this helper cannot disagree with the
 * table the service actually serves — and asserts on `getStatus()` rather than on which `HttpException` SUBCLASS
 * was constructed, because picking a subclass is picking the status a second time (see `common/apiError.ts`).
 */
function expectApiError(thrown: unknown, code: keyof typeof FOOD_ERROR_STATUS): ApiErrorBody {
    expect(thrown).toBeInstanceOf(HttpException);
    const exception = thrown as HttpException;
    expect(exception.getStatus()).toBe(FOOD_ERROR_STATUS[code]);
    const body = exception.getResponse() as ApiErrorBody;
    expect(body.code).toBe(code);
    expect(body.message.length).toBeGreaterThan(0);

    return body;
}

/**
 * A verified USER token whose `external_id` has not synced yet — no `userId`. Built literally, because passing
 * `undefined` to {@link makeReq} would take its default and hand back a synced principal.
 */
function makePreSyncReq(): AuthenticatedRequest {
    return { user: { sub: 'user_9', scopes: [], permissions: [] } } as unknown as AuthenticatedRequest;
}

/** A service principal: its `svc_*` sub IS the requester key, and it carries no `external_id`. */
function makeServiceReq(): AuthenticatedRequest {
    return { user: { sub: 'svc_recipe', scopes: [], permissions: [] } } as unknown as AuthenticatedRequest;
}

/** Run `call`, returning whatever it threw (and failing if it threw nothing). */
async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }

    return expect.unreachable('expected the call to reject');
}

/** App-user ULID (from `external_id`) — THE requester key an enqueue records (CR-002/U1). */
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } {
    const status = vi.fn();
    const setHeader = vi.fn();
    const res = { status, setHeader } as unknown as Response;

    return { res, status, setHeader };
}

/**
 * Build a request with a verified principal. Defaults to a user principal carrying its app-user ULID
 * (`userId`) — the requester key an enqueue records. Pass `userId: undefined` to simulate the
 * first-token sync race (no `external_id` yet), or a `svc_*` `sub` for a service principal.
 */
function makeReq(sub = 'user_1', scopes: string[] = [], userId: string | undefined = USER_ULID): AuthenticatedRequest {
    return { user: { sub, userId, scopes, permissions: [] } } as unknown as AuthenticatedRequest;
}

function makeController(): { controller: FoodsController; service: Record<string, ReturnType<typeof vi.fn>> } {
    const service = {
        getFood: vi.fn(),
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        search: vi.fn(),
        searchCatalog: vi.fn(),
        searchAuthored: vi.fn(),
        addByName: vi.fn(),
        batchAdd: vi.fn(),
        patchResolve: vi.fn(),
        refetch: vi.fn(),
        resolveRefs: vi.fn(),
    };

    // Mirror the boot-validated ConfigModule: the batch cap comes from the coerced Environment.
    const config = new ConfigService<Environment, true>({ FOOD_MAX_BATCH_NAMES: 100 } as Environment);

    // ADR-0040's authored-food test purge. Every case outside its own describe leaves it untouched.
    const testPurge = { purge: vi.fn() };

    // The Data sources read (plan R55). Every case outside its own describe leaves it untouched.
    const citedSources = { list: vi.fn() };

    // The remote pick (ADR-0055 point 10). Every case outside its own describe leaves it untouched.
    const adoptRemote = { execute: vi.fn(async () => ({ id: 'R-adopted' })) };

    // The progressive search (ADR-0055 point 5): its route streams, so the mocked integration tier covers it.
    const progressive = { run: vi.fn() };

    return {
        controller: new FoodsController(
            service as unknown as FoodsService,
            config,
            testPurge as unknown as TestPrincipalPurgeService,
            citedSources,
            adoptRemote,
            progressive,
        ),
        service: { ...service, purge: testPurge.purge, listSources: citedSources.list, adopt: adoptRemote.execute },
    };
}

describe('FoodsController.getFood', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('sets 200 and returns the golden record on RESOLVED (FR-002)', async () => {
        const food = { id: VALID_ID, status: 'RESOLVED' };
        ctx.service.getFood.mockResolvedValue(food);
        const { res, status } = makeRes();

        const result = await ctx.controller.getFood(VALID_ID, makeReq(), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(result).toBe(food);
    });

    it('sets 202 and returns the pending body on a FoodPendingError (FR-003)', async () => {
        ctx.service.getFood.mockRejectedValue(new FoodPendingError(VALID_ID, 'PENDING', 30));
        const { res, status } = makeRes();

        const result = await ctx.controller.getFood(VALID_ID, makeReq(), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        expect(result).toEqual({ id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 30 });
    });

    it('lets a FoodNotFoundError propagate to the filter, unwrapped (FR-004)', async () => {
        const domainError = new FoodNotFoundError(VALID_ID, 'NOT_FOUND');
        ctx.service.getFood.mockRejectedValue(domainError);
        const { res } = makeRes();

        // Identity, not just type: re-wrapping it here would put the code→status decision in two places.
        await expect(ctx.controller.getFood(VALID_ID, makeReq(), res)).rejects.toBe(domainError);
    });

    it('rejects a malformed ULID with 400 INVALID_ID, without calling the service (FR-006)', async () => {
        const { res } = makeRes();

        expectApiError(await thrownBy(() => ctx.controller.getFood('not-a-ulid', makeReq(), res)), 'INVALID_ID');
        expect(ctx.service.getFood).not.toHaveBeenCalled();
    });
});

/**
 * `/status` and `/candidates` now pass the REQUESTER to the service, exactly as `getFood` does — the service's
 * read gate (`requireReadable`) decides over it. These cases replaced ones that called both handlers with no
 * request at all, which is precisely the shape that let the two routes skip the authorship check.
 */
describe('FoodsController.getStatus / getCandidates / search', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it.each(['getStatus', 'getCandidates'] as const)(
        '%s hands the service the app-user ULID the authorship gate decides over',
        async (method) => {
            ctx.service[method].mockResolvedValue({ id: VALID_ID });

            await ctx.controller[method](VALID_ID, makeReq());

            expect(ctx.service[method]).toHaveBeenCalledWith(VALID_ID, USER_ULID);
        },
    );

    it.each(['getStatus', 'getCandidates'] as const)(
        '%s hands a service principal its svc_* id — a stranger to every authored food',
        async (method) => {
            ctx.service[method].mockResolvedValue({ id: VALID_ID });

            await ctx.controller[method](VALID_ID, makeServiceReq());

            expect(ctx.service[method]).toHaveBeenCalledWith(VALID_ID, 'svc_recipe');
        },
    );

    it.each(['getStatus', 'getCandidates'] as const)(
        '%s DEFERS an unsynced user token with 401 IDENTITY_SYNC_PENDING, as GET /{id} does',
        async (method) => {
            expectApiError(
                await thrownBy(() => ctx.controller[method](VALID_ID, makePreSyncReq())),
                'IDENTITY_SYNC_PENDING',
            );
            expect(ctx.service[method]).not.toHaveBeenCalled();
        },
    );

    it('lets a FoodNotFoundError propagate on status', async () => {
        const domainError = new FoodNotFoundError(VALID_ID);
        ctx.service.getStatus.mockRejectedValue(domainError);

        await expect(ctx.controller.getStatus(VALID_ID, makeReq())).rejects.toBe(domainError);
    });

    it('delegates the validated search term', async () => {
        // The controller no longer receives a bare `string | undefined`: the globally bound `ZodValidationPipe`
        // hands it a `SearchFoodQueryDto` that is already trimmed, non-empty and length-bounded. That the pipe
        // really enforces those is proven against the REAL pipe in `../dto/__tests__/foods.dto.test.ts` — here
        // we only assert the delegation.
        ctx.service.search.mockResolvedValue({ results: [] });

        await ctx.controller.search({ query: 'chicken' }, makeReq());

        // U11/R20: the requester key rides along so the caller's own authored rows can rank.
        expect(ctx.service.search).toHaveBeenCalledWith('chicken', USER_ULID, false);
    });
});

/**
 * The split search (plan 002 R40, S3). The catalog handler takes the validated term and NOTHING about the caller
 * (property 1): no `@Req`, so no principal can reach its answer, which the edge shares. The authored handler reads
 * the caller and gives a service principal, which owns no foods, an empty list with no read (property 6).
 */
describe('FoodsController.searchCatalog / searchAuthored (plan 002 S3)', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    /** The `:id` routes, which must all be declared after the split search routes. */
    function idRoutes(): string[] {
        return Object.getOwnPropertyNames(FoodsController.prototype).filter((name) => {
            const path: unknown = Reflect.getMetadata(PATH_METADATA, (FoodsController.prototype as never)[name]);

            return typeof path === 'string' && path.startsWith(':id');
        });
    }

    it('⛔ the catalog handler takes the validated term and nothing else', () => {
        expectTypeOf<Parameters<FoodsController['searchCatalog']>>().toEqualTypeOf<[SearchTermQueryDto]>();
    });

    it('delegates exactly the term to the catalog search', async () => {
        const answer = { results: [] };
        ctx.service.searchCatalog.mockResolvedValue(answer);

        await expect(ctx.controller.searchCatalog({ query: 'chicken breast' })).resolves.toBe(answer);
        expect(ctx.service.searchCatalog).toHaveBeenCalledWith('chicken breast');
    });

    it("hands the authored search the caller's app-user ULID", async () => {
        ctx.service.searchAuthored.mockResolvedValue({ results: [] });

        await ctx.controller.searchAuthored({ query: 'chicken breast' }, makeReq());

        expect(ctx.service.searchAuthored).toHaveBeenCalledWith('chicken breast', USER_ULID);
    });

    it('answers a service principal an empty list without reading anything', async () => {
        await expect(
            ctx.controller.searchAuthored({ query: 'chicken breast' }, makeServiceReq()),
        ).resolves.toStrictEqual({ results: [] });
        expect(ctx.service.searchAuthored).not.toHaveBeenCalled();
    });

    it('DEFERS an unsynced user token with 401 IDENTITY_SYNC_PENDING', async () => {
        expectApiError(
            await thrownBy(() => ctx.controller.searchAuthored({ query: 'egg' }, makePreSyncReq())),
            'IDENTITY_SYNC_PENDING',
        );
        expect(ctx.service.searchAuthored).not.toHaveBeenCalled();
    });

    it.each([
        ['searchCatalog', 'catalog/search', undefined],
        ['searchAuthored', 'authored/search', [{ name: 'Cache-Control', value: 'private, no-store' }]],
    ] as const)('%s is GET %s, with the Cache-Control the edge needs', (handler, path, headers) => {
        const method: unknown = Reflect.get(FoodsController.prototype, handler);

        expect(Reflect.getMetadata(PATH_METADATA, method as object)).toBe(path);
        expect(Reflect.getMetadata(METHOD_METADATA, method as object)).toBe(RequestMethod.GET);
        // The catalog `200` sends none, so the edge decides (ADR-0020); its errors say `no-store` through the filter.
        expect(Reflect.getMetadata(HEADERS_METADATA, method as object)).toStrictEqual(headers);
    });

    it.each(['searchCatalog', 'searchAuthored'])('⛔ declares %s BEFORE every `:id` route', (handler) => {
        const methods = Object.getOwnPropertyNames(FoodsController.prototype);

        expect(idRoutes().length).toBeGreaterThan(5);
        expect(methods).toContain(handler);

        for (const route of idRoutes()) {
            expect(methods.indexOf(handler), `${handler} must precede ${route}`).toBeLessThan(methods.indexOf(route));
        }
    });
});

/**
 * `POST /api/v1/foods/refs/resolve` (curated U8). The controller's whole contribution is the requester key and
 * the route's declaration; the answer is the service's, pinned in `domain/__tests__/foodRefResolution.test.ts`,
 * and the headers and status over a real HTTP request in `tests/foodRefsApi.integration.test.ts`.
 */
describe('FoodsController.resolveRefs', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    const REFS = [{ kind: 'root' as const, id: VALID_ID }];

    it('delegates the validated refs with the app-user ULID as the caller', async () => {
        const answer = { entries: [{ outcome: 'absent', ref: REFS[0] }] };
        ctx.service.resolveRefs.mockResolvedValue(answer);

        await expect(ctx.controller.resolveRefs({ refs: REFS }, makeReq())).resolves.toBe(answer);
        expect(ctx.service.resolveRefs).toHaveBeenCalledWith(REFS, USER_ULID);
    });

    it('resolves a service principal as its svc_* id, which authored nothing', async () => {
        ctx.service.resolveRefs.mockResolvedValue({ entries: [] });

        await ctx.controller.resolveRefs({ refs: REFS }, makeServiceReq());

        expect(ctx.service.resolveRefs).toHaveBeenCalledWith(REFS, 'svc_recipe');
    });

    it('DEFERS an unsynced user token with 401 IDENTITY_SYNC_PENDING, never falling back to the Clerk sub', async () => {
        expectApiError(
            await thrownBy(() => ctx.controller.resolveRefs({ refs: REFS }, makePreSyncReq())),
            'IDENTITY_SYNC_PENDING',
        );
        expect(ctx.service.resolveRefs).not.toHaveBeenCalled();
    });

    it('is declared as POST refs/resolve, 200, private + no-store', () => {
        const handler = FoodsController.prototype.resolveRefs;

        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('refs/resolve');
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toStrictEqual([
            { name: 'Cache-Control', value: 'private, no-store' },
        ]);
    });

    /**
     * Every GET answers per caller unless it is one of the caller-independent reads the edge may share (ADR-0020), so
     * every other GET says `private, no-store` and no shared cache can serve one cook's private foods to another
     * (security review C7). A new GET route lands in one column or the other.
     */
    it('⛔ marks every per-caller GET private + no-store, and only the shared reads leave it to the edge', () => {
        const SHARED_READS = new Set(['listDataSources', 'getNutritionBatch', 'searchCatalog']);
        const gets = Object.getOwnPropertyNames(FoodsController.prototype).filter(
            (name) =>
                Reflect.getMetadata(METHOD_METADATA, (FoodsController.prototype as never)[name]) === RequestMethod.GET,
        );
        const headersOf = (name: string): unknown =>
            Reflect.getMetadata(HEADERS_METADATA, (FoodsController.prototype as never)[name]);

        expect(gets.length).toBeGreaterThan(6);
        expect(gets.filter((name) => SHARED_READS.has(name)).sort()).toStrictEqual([...SHARED_READS].sort());

        for (const name of gets) {
            expect(headersOf(name), name).toStrictEqual(
                SHARED_READS.has(name) ? undefined : [{ name: 'Cache-Control', value: 'private, no-store' }],
            );
        }
    });

    it('⛔ is declared BEFORE every `:id` route — Nest registers handlers in prototype order', () => {
        const methods = Object.getOwnPropertyNames(FoodsController.prototype);
        const idRoutes = methods.filter((name) => {
            const path: unknown = Reflect.getMetadata(PATH_METADATA, (FoodsController.prototype as never)[name]);

            return typeof path === 'string' && path.startsWith(':id');
        });

        // Non-vacuity: the by-id routes exist, so the ordering claim is about something.
        expect(idRoutes.length).toBeGreaterThan(5);

        for (const route of idRoutes) {
            expect(methods.indexOf('resolveRefs'), `resolveRefs must precede ${route}`).toBeLessThan(
                methods.indexOf(route),
            );
        }
    });
});

describe('FoodsController.listDataSources (plan R55)', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('answers what the cited-sources read answers, for any principal', async () => {
        const answer = { sources: [] };
        ctx.service.listSources.mockResolvedValue(answer);

        await expect(ctx.controller.listDataSources()).resolves.toBe(answer);
        expect(ctx.service.listSources).toHaveBeenCalledTimes(1);
    });

    it('is declared as GET sources, with no Cache-Control of its own, as the sibling catalog reads', () => {
        const handler = FoodsController.prototype.listDataSources;

        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('sources');
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toBeUndefined();
    });

    it('⛔ is declared BEFORE every `:id` route, or `GET /:id` would answer `sources` as a malformed id', () => {
        const methods = Object.getOwnPropertyNames(FoodsController.prototype);
        const idRoutes = methods.filter((name) => {
            const path: unknown = Reflect.getMetadata(PATH_METADATA, (FoodsController.prototype as never)[name]);

            return typeof path === 'string' && path.startsWith(':id');
        });

        expect(idRoutes.length).toBeGreaterThan(5);
        // Non-vacuity: an absent handler's index is -1, which precedes everything.
        expect(methods).toContain('listDataSources');

        for (const route of idRoutes) {
            expect(methods.indexOf('listDataSources'), `listDataSources must precede ${route}`).toBeLessThan(
                methods.indexOf(route),
            );
        }
    });
});

describe('FoodsController.addByName / batch', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('sets 202 + returns the add result and passes the app-user ULID as the requester (CR-002/U1)', async () => {
        ctx.service.addByName.mockResolvedValue({ id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 30 });
        const { res, status } = makeRes();

        await ctx.controller.addByName({ name: 'Broccoli' }, makeReq('user_9', [], USER_ULID), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        // The requester is the app-user ULID (external_id), NEVER the Clerk sub 'user_9'.
        expect(ctx.service.addByName).toHaveBeenCalledWith('Broccoli', USER_ULID);
    });

    it('passes a service principal`s svc_* id straight through as the requester (FR-047)', async () => {
        ctx.service.addByName.mockResolvedValue({ id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 30 });
        const { res } = makeRes();
        // A service principal carries no external_id; its svc_* sub IS the requester key.
        const svcReq = { user: { sub: 'svc_import', scopes: [], permissions: [] } } as unknown as AuthenticatedRequest;

        await ctx.controller.addByName({ name: 'Broccoli' }, svcReq, res);

        expect(ctx.service.addByName).toHaveBeenCalledWith('Broccoli', 'svc_import');
    });

    it('DEFERS with 401 when a user token has no external_id yet, without calling the service (CR-002/U1)', async () => {
        const { res } = makeRes();
        // A verified user token whose external_id has not synced yet (no userId) — never falls back to sub.
        const preSyncReq = { user: { sub: 'user_9', scopes: [], permissions: [] } } as unknown as AuthenticatedRequest;

        expectApiError(
            await thrownBy(() => ctx.controller.addByName({ name: 'Broccoli' }, preSyncReq, res)),
            'IDENTITY_SYNC_PENDING',
        );
        expect(ctx.service.addByName).not.toHaveBeenCalled();
    });

    // NOTE: "rejects an empty name with 400" (FR-006) moved to `../dto/__tests__/foods.dto.test.ts`, where it
    // runs against the REAL `ZodValidationPipe`. The controller's parameter is typed as the DTO now, so the only
    // whitespace-only name a test could pass here is one the pipe would already have rejected.

    // The catalog is ownerless and globally unique-named, so the name a caller sends becomes shared state.
    // These four pin the boundary rule: what reaches the service is the CANONICAL form, and a name that is
    // invisible-only never reaches it at all. See `../foodName.ts` (findings 16.A-6 / 23.S-11).
    it('hands the service the canonical name, not the caller`s bytes', async () => {
        ctx.service.addByName.mockResolvedValue({ id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 30 });
        const { res } = makeRes();

        await ctx.controller.addByName({ name: 'Bro\u200Bccoli,\u00A0 raw' }, makeReq(), res);

        expect(ctx.service.addByName).toHaveBeenCalledWith('Broccoli, raw', USER_ULID);
    });

    it('rejects an invisible-only name with 400 VALIDATION_FAILED, without calling the service', async () => {
        const { res } = makeRes();

        expectApiError(
            await thrownBy(() => ctx.controller.addByName({ name: '\u200B\u200B\uFEFF' }, makeReq(), res)),
            'VALIDATION_FAILED',
        );
        expect(ctx.service.addByName).not.toHaveBeenCalled();
    });

    it('canonicalizes every batch name and drops the invisible-only entries', async () => {
        ctx.service.batchAdd.mockResolvedValue({ items: [] });

        await ctx.controller.batch({ names: ['Bro\u200Bccoli', '\u200B', '\uFF2Bale'] }, makeReq());

        expect(ctx.service.batchAdd).toHaveBeenCalledWith(['Broccoli', 'Kale'], USER_ULID);
    });

    it('counts a batch against the cap AFTER dropping the invisible-only entries', async () => {
        ctx.service.batchAdd.mockResolvedValue({ items: [] });
        const names = [...Array.from({ length: 100 }, (_, i) => `food ${i}`), '\u200B'];

        await ctx.controller.batch({ names }, makeReq());

        expect(ctx.service.batchAdd).toHaveBeenCalledWith(expect.arrayContaining(['food 0']), USER_ULID);
    });

    it('lets a FetchUnavailableError propagate, and sets NO Retry-After itself (FR-046)', async () => {
        const domainError = new FetchUnavailableError(30);
        ctx.service.addByName.mockRejectedValue(domainError);
        const { res, setHeader } = makeRes();

        await expect(ctx.controller.addByName({ name: 'Broccoli' }, makeReq(), res)).rejects.toBe(domainError);
        // The header is the FILTER's, derived from the body it publishes, so the two cannot disagree. The
        // controller used to set it here as well — two writers for one header.
        expect(setHeader).not.toHaveBeenCalled();
    });

    it('rejects a batch over the configured cap with 400 BATCH_TOO_LARGE, reporting the cap (FR-045)', async () => {
        const names = Array.from({ length: 101 }, (_, i) => `food ${i}`);

        const body = expectApiError(
            await thrownBy(() => ctx.controller.batch({ names }, makeReq())),
            'BATCH_TOO_LARGE',
        );

        // The cap is runtime config, so a caller can only re-chunk correctly if the body carries it.
        expect(body.details).toEqual({ maxNames: 100 });
        expect(ctx.service.batchAdd).not.toHaveBeenCalled();
    });

    // NOTE: "rejects a non-array `names`" moved to `../dto/__tests__/foods.dto.test.ts`, where it runs against
    // the REAL `ZodValidationPipe`. Asserting it here would now be theatre: the controller's parameter is typed
    // as the DTO, so a test can only pass it a well-formed object or lie about the type.
});

describe('FoodsController.patchResolve', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('sets 200 and returns the resolve result on success', async () => {
        ctx.service.patchResolve.mockResolvedValue({ id: VALID_ID, status: 'RESOLVED' });
        const { res, status } = makeRes();

        const result = await ctx.controller.patchResolve(VALID_ID, { candidateIds: ['c1'] }, res);

        expect(status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(result).toEqual({ id: VALID_ID, status: 'RESOLVED' });
    });

    it.each([
        ['CandidateMismatchError', new CandidateMismatchError(VALID_ID)],
        ['NotResolvableError', new NotResolvableError(VALID_ID, 'PENDING')],
    ])('lets a %s propagate to the filter, unwrapped (FR-RES-2/DSN-14)', async (_label, domainError) => {
        ctx.service.patchResolve.mockRejectedValue(domainError);
        const { res } = makeRes();

        await expect(ctx.controller.patchResolve(VALID_ID, { candidateIds: ['c1'] }, res)).rejects.toBe(domainError);
    });

    // NOTE: "rejects a body with no `candidateIds`" (DSN-14) moved to `../dto/__tests__/foods.dto.test.ts`,
    // against the REAL pipe — see the batch note above for why it cannot stay here.
});

/**
 * The FIVE raw `@Param('id')` inputs, all in one place.
 *
 * `__tests__/routeValidation.test.ts` enumerates them from Nest's own route metadata and asserts the list is
 * exhaustive, on the claim that each is validated by `requireId`. This is the behavioural half of that claim: the
 * list is only trustworthy if every entry on it actually rejects. A new by-id route fails the inventory (its
 * parameter is not on the list) and then fails here (nobody added the case), which is one gate more than either
 * gives alone.
 */
describe('every by-id route rejects a malformed ULID before touching the service (FR-006)', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    const BAD = 'not-a-ulid';

    it.each([
        ['getFood', (c: FoodsController) => c.getFood(BAD, makeReq(), makeRes().res), 'getFood'],
        ['getStatus', (c: FoodsController) => c.getStatus(BAD, makeReq()), 'getStatus'],
        ['getCandidates', (c: FoodsController) => c.getCandidates(BAD, makeReq()), 'getCandidates'],
        [
            'patchResolve',
            (c: FoodsController) => c.patchResolve(BAD, { candidateIds: ['c1'] }, makeRes().res),
            'patchResolve',
        ],
        // `refetch` is passed an ADMIN-scoped principal on purpose: without the scope its 403 would win (FR-051),
        // so this case would pass for the wrong reason and prove nothing about id validation.
        [
            'refetch',
            (c: FoodsController) => c.refetch(BAD, makeReq('admin_1', ['food:admin'], USER_ULID), makeRes().res),
            'refetch',
        ],
    ])('%s → 400 INVALID_ID', async (_label, call, serviceMethod) => {
        expectApiError(await thrownBy(() => call(ctx.controller)), 'INVALID_ID');
        expect(ctx.service[serviceMethod]).not.toHaveBeenCalled();
    });
});

describe('FoodsController.refetch', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('rejects a principal without the admin scope with 403, before id validation (FR-039/FR-051)', async () => {
        const { res } = makeRes();

        // The id is deliberately malformed: the 403 must win, so the scope check has to run FIRST.
        expectApiError(await thrownBy(() => ctx.controller.refetch('bad-id', makeReq('user_1', []), res)), 'FORBIDDEN');
        expect(ctx.service.refetch).not.toHaveBeenCalled();
    });

    it('re-enqueues (202) for an admin-scoped principal', async () => {
        ctx.service.refetch.mockResolvedValue({ id: VALID_ID, status: 'RESOLVED', estimatedWaitSeconds: 30 });
        const { res, status } = makeRes();

        await ctx.controller.refetch(VALID_ID, makeReq('admin_1', ['food:admin'], USER_ULID), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        // The recorded requester is the admin's app-user ULID, not the Clerk sub.
        expect(ctx.service.refetch).toHaveBeenCalledWith(VALID_ID, USER_ULID);
    });
});

describe('FoodsController.purgeTestPrincipalFoods (ADR-0040)', () => {
    const PURGE_URL = '/api/v1/foods/authored/test-purge';
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    /** A request as Express hands it over: the verified principal plus the method and URL Nest's 404 names. */
    function purgeReq(user: { sub: string; userId?: string; testPrincipal: boolean }): AuthenticatedRequest {
        return {
            method: 'POST',
            originalUrl: PURGE_URL,
            user: { scopes: [], permissions: [], ...user },
        } as unknown as AuthenticatedRequest;
    }

    /**
     * Assert the refusal is the exception Nest's own not-found handler throws for an unrouted path
     * (`@nestjs/core/router/routes-resolver.js`: `new NotFoundException(`Cannot ${method} ${url}`)`), so the
     * filter renders it through the identical path. The integration tier compares it against a real unrouted
     * request; this tier pins that nothing ran first.
     */
    async function expectUnroutedNotFound(req: AuthenticatedRequest): Promise<void> {
        const thrown = await thrownBy(() => ctx.controller.purgeTestPrincipalFoods(req));

        expect(thrown).toBeInstanceOf(NotFoundException);
        expect((thrown as NotFoundException).getResponse()).toStrictEqual({
            statusCode: HttpStatus.NOT_FOUND,
            message: `Cannot POST ${PURGE_URL}`,
            error: 'Not Found',
        });
        expect(ctx.service['purge']).not.toHaveBeenCalled();
    }

    it('purges a signed test principal by its app-user ULID and returns the counts', async () => {
        const counts = { deletedAuthoredFoods: 3, retainedPromotedFoods: 1 };
        ctx.service['purge']?.mockResolvedValue(counts);

        const result = await ctx.controller.purgeTestPrincipalFoods(
            purgeReq({ sub: 'user_pool_1', userId: USER_ULID, testPrincipal: true }),
        );

        expect(result).toBe(counts);
        expect(ctx.service['purge']).toHaveBeenCalledExactlyOnceWith(USER_ULID);
    });

    it('answers a real user with the unrouted 404, touching nothing', async () => {
        await expectUnroutedNotFound(purgeReq({ sub: 'user_real', userId: USER_ULID, testPrincipal: false }));
    });

    it("answers a service principal with the unrouted 404 — NOT requireUserUlid's 403", async () => {
        await expectUnroutedNotFound(purgeReq({ sub: 'svc_import', testPrincipal: false }));
        await expectUnroutedNotFound(purgeReq({ sub: 'svc_import', userId: USER_ULID, testPrincipal: true }));
    });

    it('answers an unsynced test principal with the unrouted 404 — NOT 401 IDENTITY_SYNC_PENDING', async () => {
        await expectUnroutedNotFound(purgeReq({ sub: 'user_pool_1', userId: undefined, testPrincipal: true }));
    });

    it('fails closed with 401 when the guard attached no principal (defensive, as every route)', async () => {
        const req = { method: 'POST', originalUrl: PURGE_URL } as unknown as AuthenticatedRequest;

        await expect(ctx.controller.purgeTestPrincipalFoods(req)).rejects.toHaveProperty('status', 401);
        expect(ctx.service['purge']).not.toHaveBeenCalled();
    });
});

describe('FoodsController.adoptRemoteFood (ADR-0055 point 10)', () => {
    it('hands the reference to the remote pick command and answers the root it names', async () => {
        const { controller, service } = makeController();

        await expect(controller.adoptRemoteFood({ reference: 'a.b.c.d.e' })).resolves.toStrictEqual({
            id: 'R-adopted',
        });
        expect(service.adopt).toHaveBeenCalledExactlyOnceWith('a.b.c.d.e');
    });
});
