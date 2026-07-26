/**
 * Unit tests for {@link FoodsController} — the HTTP status-code + validation + scope mapping over a
 * mocked {@link FoodsService}. The end-to-end behaviour (real DAOs, guard, enqueue, backpressure) is
 * covered by `tests/foods-api.integration.test.ts`; this suite pins the pure controller mapping.
 *
 * Requirement → test mapping:
 * - FR-002/003/004 → getFood 200 / 202 / 404 mapping
 * - FR-006         → malformed ULID / empty name / oversized batch → 400
 * - FR-RES-2/DSN-14 → CandidateMismatch / NotResolvable → 409; malformed body → 400
 * - FR-039/FR-051   → /refetch requires the admin scope (403), checked before id validation
 * - FR-046          → FetchUnavailableError → 503 + Retry-After
 */
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpStatus,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../auth/authenticated-principal.js';
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

const VALID_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

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

    return { controller: new FoodsController(service as unknown as FoodsService, config), service };
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

        const result = await ctx.controller.getFood(VALID_ID, res);

        expect(status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(result).toBe(food);
    });

    it('sets 202 and returns the pending body on a FoodPendingError (FR-003)', async () => {
        ctx.service.getFood.mockRejectedValue(new FoodPendingError(VALID_ID, 'PENDING', 30));
        const { res, status } = makeRes();

        const result = await ctx.controller.getFood(VALID_ID, res);

        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        expect(result).toEqual({ id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 30 });
    });

    it('throws NotFoundException (404) on a FoodNotFoundError (FR-004)', async () => {
        ctx.service.getFood.mockRejectedValue(new FoodNotFoundError(VALID_ID, 'NOT_FOUND'));
        const { res } = makeRes();

        await expect(ctx.controller.getFood(VALID_ID, res)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException (400) for a malformed ULID, without calling the service (FR-006)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.getFood('not-a-ulid', res)).rejects.toBeInstanceOf(BadRequestException);
        expect(ctx.service.getFood).not.toHaveBeenCalled();
    });
});

describe('FoodsController.getStatus / getCandidates / search', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('maps a FoodNotFoundError to 404 on status', async () => {
        ctx.service.getStatus.mockRejectedValue(new FoodNotFoundError(VALID_ID));

        await expect(ctx.controller.getStatus(VALID_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a malformed id on candidates with 400', async () => {
        await expect(ctx.controller.getCandidates('bad')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delegates the search query (and empty when omitted)', async () => {
        ctx.service.search.mockResolvedValue({ results: [] });

        await ctx.controller.search('chicken');
        await ctx.controller.search(undefined);

        expect(ctx.service.search).toHaveBeenNthCalledWith(1, 'chicken');
        expect(ctx.service.search).toHaveBeenNthCalledWith(2, '');
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

        await expect(ctx.controller.addByName({ name: 'Broccoli' }, preSyncReq, res)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(ctx.service.addByName).not.toHaveBeenCalled();
    });

    it('rejects an empty name with 400 before calling the service (FR-006)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.addByName({ name: '  ' }, makeReq(), res)).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(ctx.service.addByName).not.toHaveBeenCalled();
    });

    it('maps a FetchUnavailableError to 503 + Retry-After (FR-046)', async () => {
        ctx.service.addByName.mockRejectedValue(new FetchUnavailableError(30));
        const { res, setHeader } = makeRes();

        await expect(ctx.controller.addByName({ name: 'Broccoli' }, makeReq(), res)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
    });

    it('rejects a batch over 100 names with 400, without calling the service (FR-045)', async () => {
        const { res } = makeRes();
        const names = Array.from({ length: 101 }, (_, i) => `food ${i}`);

        await expect(ctx.controller.batch({ names }, makeReq(), res)).rejects.toBeInstanceOf(BadRequestException);
        expect(ctx.service.batchAdd).not.toHaveBeenCalled();
    });

    it('rejects a non-array names body with 400', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.batch({ names: 'nope' }, makeReq(), res)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });
});

describe('FoodsController.patchResolve', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('sets 200 and returns the resolve result on success', async () => {
        ctx.service.patchResolve.mockResolvedValue({ id: VALID_ID, status: 'RESOLVED' });
        const { res, status } = makeRes();

        const result = await ctx.controller.patchResolve(VALID_ID, { candidateIds: ['c1'] }, makeReq(), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(result).toEqual({ id: VALID_ID, status: 'RESOLVED' });
    });

    it('maps a CandidateMismatchError to 409', async () => {
        ctx.service.patchResolve.mockRejectedValue(new CandidateMismatchError(VALID_ID));
        const { res } = makeRes();

        await expect(
            ctx.controller.patchResolve(VALID_ID, { candidateIds: ['c1'] }, makeReq(), res),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a NotResolvableError to 409', async () => {
        ctx.service.patchResolve.mockRejectedValue(new NotResolvableError(VALID_ID, 'PENDING'));
        const { res } = makeRes();

        await expect(
            ctx.controller.patchResolve(VALID_ID, { candidateIds: ['c1'] }, makeReq(), res),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a malformed body (no candidateIds) with 400 (DSN-14)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.patchResolve(VALID_ID, {}, makeReq(), res)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });
});

describe('FoodsController.refetch', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('rejects a principal without the admin scope with 403, before id validation (FR-039/FR-051)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.refetch('bad-id', makeReq('user_1', []), res)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
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
