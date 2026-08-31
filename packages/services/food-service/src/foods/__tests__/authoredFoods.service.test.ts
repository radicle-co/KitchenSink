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
import type { FoodDao, GoldenFoodRecord } from '../dao/index.js';
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

function makeService(overrides: { record?: GoldenFoodRecord | null; authored?: Partial<AuthoredFoodsDao> }): {
    service: FoodsService;
    authored: Record<string, ReturnType<typeof vi.fn>>;
} {
    const unused = undefined as unknown as never;
    const foodDao = {
        readGoldenRecord: vi.fn().mockResolvedValue(overrides.record === undefined ? makeRecord() : overrides.record),
    } as unknown as FoodDao;
    const authored = {
        createAuthored: vi.fn().mockResolvedValue({ kind: 'created', id: FOOD_ID }),
        replaceAuthored: vi.fn().mockResolvedValue({ kind: 'replaced' }),
        readAuthorshipFacts: vi.fn().mockResolvedValue({ userId: AUTHOR, visibility: 'private' }),
        ...overrides.authored,
    };
    const service = new FoodsService(
        foodDao,
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

    return { service, authored: authored as Record<string, ReturnType<typeof vi.fn>> };
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
