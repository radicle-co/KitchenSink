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
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../auth/authenticatedPrincipal.js';
import { FOOD_ERROR_STATUS } from '../../common/apiError.js';
import type { ApiErrorBody } from '../../common/apiError.schema.js';
import type { Environment } from '../../config/env.schema.js';
import { FoodsController } from '../foods.controller.js';
import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../foods.errors.js';
import { FoodsService } from '../foods.service.js';
import type { LiveFoodSearchService } from '../liveSearch.service.js';

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
        addByName: vi.fn(),
        batchAdd: vi.fn(),
        patchResolve: vi.fn(),
        refetch: vi.fn(),
    };

    // Mirror the boot-validated ConfigModule: the batch cap comes from the coerced Environment.
    const config = new ConfigService<Environment, true>({ FOOD_MAX_BATCH_NAMES: 100 } as Environment);

    // The live-search collaborator is unused by every case in this file (they exercise the LOCAL routes),
    // so it is a bare double rather than a configured one — a real `LiveFoodSearchService` here would give
    // these cases a source adapter and a rate limiter they have no business owning.
    const liveSearch = {} as unknown as LiveFoodSearchService;

    return { controller: new FoodsController(service as unknown as FoodsService, liveSearch, config), service };
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

describe('FoodsController.getStatus / getCandidates / search', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('lets a FoodNotFoundError propagate on status', async () => {
        const domainError = new FoodNotFoundError(VALID_ID);
        ctx.service.getStatus.mockRejectedValue(domainError);

        await expect(ctx.controller.getStatus(VALID_ID)).rejects.toBe(domainError);
    });

    it('rejects a malformed id on candidates with 400 INVALID_ID', async () => {
        expectApiError(await thrownBy(() => ctx.controller.getCandidates('bad')), 'INVALID_ID');
    });

    it('delegates the validated search term', async () => {
        // The controller no longer receives a bare `string | undefined`: the globally bound `ZodValidationPipe`
        // hands it a `SearchFoodQueryDto` that is already trimmed, non-empty and length-bounded. That the pipe
        // really enforces those is proven against the REAL pipe in `../dto/__tests__/foods.dto.test.ts` — here
        // we only assert the delegation.
        ctx.service.search.mockResolvedValue({ results: [] });

        await ctx.controller.search({ query: 'chicken' });

        expect(ctx.service.search).toHaveBeenCalledWith('chicken', false);
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
        ['getStatus', (c: FoodsController) => c.getStatus(BAD), 'getStatus'],
        ['getCandidates', (c: FoodsController) => c.getCandidates(BAD), 'getCandidates'],
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
