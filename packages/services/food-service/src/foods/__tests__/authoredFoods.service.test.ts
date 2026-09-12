/**
 * Unit tests for the authored-food surface of `FoodsService` (plan U10, D8/D9a) — the policy ORDER and
 * the error mapping, over fake DAOs. The SQL truth (partial uniques, the CHECK, macro rows) is the
 * integration tier's (`tests/authoredFoods.integration.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import { FoodsService } from '../foods.service.js';
import {
    isDuplicateAuthoredNameError,
    isFoodNotFoundError,
    isNotEditableError,
    isNotFoodAuthorError,
} from '../foods.errors.js';
import type { AuthoredFoodsDao } from '../dao/authoredFoods.dao.js';
import { IllegalStatusTransitionError } from '../dao/dao.errors.js';
import type { FoodDao, GoldenFoodRecord } from '../dao/food.dao.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';

const AUTHOR = '01JFOODAUTHORAAAAAAAAAAAAA';
const STRANGER = '01JFOODSTRANGERBBBBBBBBBBB';
const FOOD_ID = '01JFOODIDCCCCCCCCCCCCCCCCC';

const CREATE_BODY = {
    name: 'My Protein Blend',
    macros: { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 },
};

function makeRecord(overrides: Partial<GoldenFoodRecord> = {}): GoldenFoodRecord {
    return {
        id: FOOD_ID,
        name: 'My Protein Blend',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        status: 'RESOLVED',
        tombstonedAt: null,
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z',
        sources: [],
        nutrients: [],
        portions: [],
        fieldProvenance: [],
        priorFraction: null,
        userId: AUTHOR,
        visibility: 'private',
        ...overrides,
    } as GoldenFoodRecord;
}

function makeService(overrides: {
    record?: GoldenFoodRecord | null;
    authored?: Partial<AuthoredFoodsDao>;
    foodDao?: Record<string, ReturnType<typeof vi.fn>>;
}): {
    service: FoodsService;
    authored: Record<string, ReturnType<typeof vi.fn>>;
    foodDao: Record<string, ReturnType<typeof vi.fn>>;
} {
    const unused = undefined as unknown as never;
    const foodDao = {
        readGoldenRecord: vi.fn().mockResolvedValue(overrides.record === undefined ? makeRecord() : overrides.record),
        setStatus: vi.fn().mockResolvedValue(undefined),
        ...overrides.foodDao,
    };
    const authored = {
        createAuthored: vi.fn().mockResolvedValue({ kind: 'created', id: FOOD_ID }),
        replaceAuthored: vi.fn().mockResolvedValue({ kind: 'replaced' }),
        readAuthorshipFacts: vi.fn().mockResolvedValue({ userId: AUTHOR, visibility: 'private' }),
        ...overrides.authored,
    };
    const service = new FoodsService(
        foodDao as unknown as FoodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(vi.fn()),
        authored as unknown as AuthoredFoodsDao,
    );

    return {
        service,
        authored: authored as Record<string, ReturnType<typeof vi.fn>>,
        foodDao: foodDao as unknown as Record<string, ReturnType<typeof vi.fn>>,
    };
}

describe('createAuthored', () => {
    it('creates and answers the COMPLETE entity (born RESOLVED, visibility private)', async () => {
        const { service } = makeService({});

        const response = await service.createAuthored(AUTHOR, CREATE_BODY);

        expect(response).toMatchObject({ id: FOOD_ID, status: 'RESOLVED', visibility: 'private' });
    });

    it('maps the per-author dedup to DUPLICATE_AUTHORED_NAME with the colliding id', async () => {
        const { service } = makeService({
            authored: {
                createAuthored: vi.fn().mockResolvedValue({ kind: 'duplicate', existingId: 'f-existing' }),
            } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.createAuthored(AUTHOR, CREATE_BODY).catch((error: unknown) => error);

        expect(isDuplicateAuthoredNameError(thrown) && thrown.existingId).toBe('f-existing');
    });
});

describe('updateAuthored — the policy runs FIRST, and its verdicts map exactly', () => {
    it('a stranger editing a PRIVATE food gets the not-found a missing id gets, and the write never runs', async () => {
        const { service, authored } = makeService({});

        const thrown = await service.updateAuthored(STRANGER, FOOD_ID, CREATE_BODY).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(true);
        expect(authored['replaceAuthored']).not.toHaveBeenCalled();
    });

    it('a stranger editing a PROMOTED food gets 403 — existence is public, authorship is not', async () => {
        const { service } = makeService({
            authored: {
                readAuthorshipFacts: vi.fn().mockResolvedValue({ userId: AUTHOR, visibility: 'promoted' }),
            } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.updateAuthored(STRANGER, FOOD_ID, CREATE_BODY).catch((error: unknown) => error);

        expect(isNotFoodAuthorError(thrown)).toBe(true);
    });

    it('ANY caller editing a PIPELINE food gets NOT_EDITABLE — the single-writer ruling', async () => {
        const { service } = makeService({
            authored: {
                readAuthorshipFacts: vi.fn().mockResolvedValue({ userId: null, visibility: 'public' }),
            } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.updateAuthored(AUTHOR, FOOD_ID, CREATE_BODY).catch((error: unknown) => error);

        expect(isNotEditableError(thrown)).toBe(true);
    });

    it('a rename that collides with the author`s OTHER food maps to DUPLICATE_AUTHORED_NAME', async () => {
        const { service } = makeService({
            authored: {
                replaceAuthored: vi.fn().mockResolvedValue({ kind: 'duplicate', existingId: 'f-other' }),
            } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.updateAuthored(AUTHOR, FOOD_ID, CREATE_BODY).catch((error: unknown) => error);

        expect(isDuplicateAuthoredNameError(thrown) && thrown.existingId).toBe('f-other');
    });
});

describe('getFood — the read gate (plan U10)', () => {
    it('⛔ a stranger reading a PRIVATE authored food gets the SAME not-found a missing id gets', async () => {
        const { service } = makeService({});

        const thrown = await service.getFood(FOOD_ID, STRANGER).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(true);
    });

    it('the author reads their own private food, visibility included', async () => {
        const { service } = makeService({});

        const response = await service.getFood(FOOD_ID, AUTHOR);

        expect(response).toMatchObject({ id: FOOD_ID, visibility: 'private' });
    });

    it('a catalog food publishes NO visibility field at all', async () => {
        const { service } = makeService({ record: makeRecord({ userId: null, visibility: 'public' }) });

        const response = await service.getFood(FOOD_ID, STRANGER);

        expect('visibility' in response).toBe(false);
    });
});

/**
 * `deleteAuthored` — the WITHDRAWAL (owner rulings 1, 2, 5, 2026-09-07).
 *
 * ⛔ **The single most important assertion in this file is a negative one: no collaborator but the DAO.**
 * The service is constructed here with ELEVEN arguments and no reference-check port, because that port no
 * longer exists — and if a future change reintroduces a cross-service call on this path, this fixture cannot
 * supply it and the suite fails rather than passing with a stub. That is the point. The owner's ruling is
 * that "the food service should not be updating recipes"; a test that mocks a recipe client proves nothing
 * about whether one is being called.
 *
 * ⚠️ This behaviour had NO unit coverage at all before this change — neither the reference-check flow it
 * replaces nor the authorization ordering it keeps. So these are not rewritten tests; they are the tests the
 * route was always owed.
 */
describe('deleteAuthored — authorization first, then one guarded transition', () => {
    it('withdraws the author`s own food: RESOLVED → WITHDRAWN, and nothing else', async () => {
        const { service, foodDao } = makeService({});

        await expect(service.deleteAuthored(AUTHOR, FOOD_ID)).resolves.toBeUndefined();

        expect(foodDao['setStatus']).toHaveBeenCalledExactlyOnceWith({ id: FOOD_ID, status: 'WITHDRAWN' });
    });

    it('⛔ NEVER hard-deletes — the row is retained so a cook can be told what was removed', async () => {
        // Ruling 5: "we should soft delete for now so that we can provide information about what was
        // deleted". `deleteAuthoredRow` is gone, so the strongest available assertion is that the DAO is
        // asked for no destructive operation at all.
        const { service, authored } = makeService({});

        await service.deleteAuthored(AUTHOR, FOOD_ID);

        expect(authored['deleteAuthoredRow']).toBeUndefined();
        expect(Object.keys(authored)).not.toContain('deleteAuthoredRow');
    });

    it('a stranger deleting a PRIVATE food gets the not-found a missing id gets, and nothing is written', async () => {
        const { service, foodDao } = makeService({});

        const thrown = await service.deleteAuthored(STRANGER, FOOD_ID).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(true);
        expect(foodDao['setStatus']).not.toHaveBeenCalled();
    });

    it('ANY caller deleting a PIPELINE food gets 409 NOT_EDITABLE — catalog rows have a single writer', async () => {
        const { service, foodDao } = makeService({
            authored: {
                readAuthorshipFacts: vi.fn().mockResolvedValue({ userId: null, visibility: 'public' }),
            } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.deleteAuthored(AUTHOR, FOOD_ID).catch((error: unknown) => error);

        expect(isNotEditableError(thrown)).toBe(true);
        expect(foodDao['setStatus']).not.toHaveBeenCalled();
    });

    it('an id that names no row is 404 before any transition is attempted', async () => {
        const { service, foodDao } = makeService({
            authored: { readAuthorshipFacts: vi.fn().mockResolvedValue(undefined) } as Partial<AuthoredFoodsDao>,
        });

        const thrown = await service.deleteAuthored(AUTHOR, FOOD_ID).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(true);
        expect(foodDao['setStatus']).not.toHaveBeenCalled();
    });

    it('a SECOND delete is 404 — the guarded transition matches no row, which is the honest answer', async () => {
        // `LEGAL_PRIORS.WITHDRAWN` is `['RESOLVED']`, so re-withdrawing matches no row and the DAO throws
        // `IllegalStatusTransitionError`. The food IS already gone from the author's point of view, and 404
        // says so. A race with an ERASURE lands here too — and lands as the SAME error, because `setStatus`
        // filters `WHERE id = … AND status IN (priors)` and raises this whenever `rowCount !== 1`, so a row
        // that vanished is indistinguishable from one in the wrong state. That is why narrowing the catch
        // costs nothing: both cases this route must answer 404 for are this one type.
        //
        // ⚠️ REWRITTEN: this fed a plain `new Error('illegal transition')` and asserted 404, which pinned a
        // shape the DAO never throws while leaving the real one unproven — and it is what made the
        // swallow-everything catch below look justified.
        const { service } = makeService({
            foodDao: { setStatus: vi.fn().mockRejectedValue(new IllegalStatusTransitionError(FOOD_ID, 'WITHDRAWN')) },
        });

        const thrown = await service.deleteAuthored(AUTHOR, FOOD_ID).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(true);
    });

    it('⛔ a DATABASE FAILURE is NOT a 404 — the author is never told their food is already gone', async () => {
        // The catch was unconditional, so a connection reset, a timeout, or a permission error answered
        // `404 food not found`: the author reads "already deleted" and stops, the food is still live, and
        // the 5xx that would have paged somebody was converted into a benign-looking client error. The two
        // cases above are both `IllegalStatusTransitionError`; everything else belongs to the exception
        // filter, which maps an unrecognised throwable to a 500 logged at `error` with its stack.
        const { service } = makeService({
            foodDao: { setStatus: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.3.14:5432')) },
        });

        const thrown = await service.deleteAuthored(AUTHOR, FOOD_ID).catch((error: unknown) => error);

        expect(isFoodNotFoundError(thrown)).toBe(false);
        expect((thrown as Error).message).toContain('ECONNREFUSED');
    });
});
