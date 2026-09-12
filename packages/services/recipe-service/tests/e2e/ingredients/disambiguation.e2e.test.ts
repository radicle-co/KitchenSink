/**
 * T028/T029/T067 — ingredient async-resolution DISAMBIGUATION integration (data-model R5).
 *
 * Exercises {@link IngredientsService} over the REAL {@link FoodLookupsDal} against Docker Postgres
 * (migrated + seeded by `tests/globalSetup.ts`) with the external food service (003) stubbed at the
 * `FoodServiceClient` boundary — the ONLY external dependency, and the one 001 does not own. This proves
 * the behaviours a mocked `db.execute` cannot: the poll settles a pending or several-candidates phrase onto a real
 * binding and moves the lines that were waiting on it, and a terminal answer is recorded (never thrown).
 *
 * ⚠️ REWRITTEN (plan 002). Migration 0051 replaced the food-backed catalog row a pending phrase used to be with a
 * FAILURE RECORD (`unresolved_foods`) carrying food's handle, and a successful poll now SETTLES it: it binds the
 * food on its own `food_lookups` row and repoints every line that was waiting on the failure (R13 — a repoint,
 * never a delete). So:
 *
 *  - The two-interleaved-refreshes case was a compare-and-set on the catalog row's status. There is no status to
 *    regress now: the fresh refresh settles, and a settle is final, so the stale PENDING answer writes nothing. The
 *    case asserts exactly that: the settled line stays on the bound food, and the stale caller is answered with it.
 *  - "terminal → PENDING reactivation" now happens by RE-ASKING food by name: a terminal failure keeps no handle
 *    (the table's own CHECK), so the poll asks food to add the phrase again.
 *  - The poll answers with the BOUND binding's id, which the client adopts, rather than the id it asked about.
 *  - A terminal NOT_FOUND is food's `absent` answer about the handle, where it used to be a thrown `NotFoundError`.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import type { FoodRef, FoodServiceClient, FoodStatus } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import type { UnresolvedArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { failureOf } from '../../../src/ingredients/domain/failureOutcome.js';
import type { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { CALLER_TOKEN as CALLER, foodClientsOf } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { insertIngredientLine, readFailureRecord } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';

const roleDb = recipeDb();
/** A food id unique to this suite so its rows never collide with other integration specs. */
const FOOD_ID = '01JINGDISAMBIG0000000000FD';
/** Food's name for {@link FOOD_ID} once it resolves. */
const FOOD_NAME = 'Quinoa, cooked';
/** The phrase this suite's failure records stand for, and its key. */
const PHRASE = 'Ambiguous quinoa disambiguation suite';
const KEY = normalizedIngredientKey(PHRASE) ?? '';
/** The cook whose recipe holds a line waiting on the phrase. */
const OWNER = '01JINGDISAMBIG0000000OWNER';

/** A minimally-stubbed food client: only the async-resolution methods this vertical calls. */
function makeFoodClientStub(): FoodServiceClient {
    return {
        addByName: vi.fn(),
        resolveRefs: vi.fn(),
    } as unknown as FoodServiceClient;
}

/** A no-op catalog gateway — the disambiguation path never blends (see `blendedSuggest.integration.test.ts`). */
function makeCatalogStub(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
}

/** Food's `refs/resolve` answer about {@link FOOD_ID}: `found` with `status`, or `absent`. */
function refsAnswer(status: FoodStatus | 'absent') {
    return async (refs: readonly FoodRef[]) => ({
        entries: refs.map((ref) =>
            status === 'absent' || ref.id !== FOOD_ID
                ? { outcome: 'absent' as const, ref }
                : { outcome: 'found' as const, ref, name: status === 'RESOLVED' ? FOOD_NAME : null, status },
        ),
    });
}

describe('ingredient disambiguation (integration: service + real DAL + stubbed food client)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let lookups: FoodLookupsDal;
    let food: FoodServiceClient;
    let service: IngredientsService;

    /** Remove this suite's recipes, bindings and failure records, in `RESTRICT` order. */
    async function cleanup(): Promise<void> {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await deleteBindingsMatching(pool, PHRASE);
        await deleteBindingsMatching(pool, FOOD_ID);
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        db = createRecipeDrizzle(pool);
        lookups = new FoodLookupsDal(db);
    });

    afterAll(async () => {
        await cleanup();
        await pool.end();
    });

    beforeEach(async () => {
        await cleanup();
        food = makeFoodClientStub();
        service = new IngredientsService(
            lookups,
            foodClientsOf(food),
            makeCatalogStub(),
            new FoodRefsGateway(foodClientsOf(food)),
            [],
            makeFakeIngredientResolutionsDal(),
            makeFakeResolutionBandsDal(),
        );
    });

    /** Record the phrase's failure as food's answer `status` would, through the real DAL, and return it. */
    async function seedFailure(status: 'PENDING' | 'UNRESOLVED' | 'FAILED'): Promise<UnresolvedArm> {
        return lookups.recordFailure(
            failureOf({
                name: PHRASE,
                normalizedKey: KEY,
                sourcePhrase: null,
                cascade: { kind: 'notRun' },
                food: { kind: 'answered', foodId: FOOD_ID, status },
            }),
        );
    }

    /** A recipe of {@link OWNER}'s with one line waiting on `lookupId`; returns the line id. */
    async function lineWaitingOn(lookupId: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings)
                      VALUES ($1, 'Disambiguation suite recipe', 5, 5, 10, 2) RETURNING id`,
            [OWNER],
        );

        return insertIngredientLine(pool, {
            recipeId: rows[0]?.id ?? '',
            foodLookupId: lookupId,
            quantity: 1,
            unit: 'cup',
        });
    }

    /** The binding a line now holds. */
    async function bindingOf(lineId: string): Promise<string | undefined> {
        const { rows } = await pool.query<{ food_lookup_id: string }>(
            'SELECT food_lookup_id FROM ingredients WHERE id = $1',
            [lineId],
        );

        return rows[0]?.food_lookup_id;
    }

    describe('two interleaved refreshes of one pending phrase', () => {
        /**
         * Rewritten: the stale caller used to be answered with the unsettled failure. A settle is now final
         * (ADR-0045), so the stale poll's attempt is refused and it is answered with the settle's target.
         */
        it('cannot undo the settlement: the stale PENDING answer leaves the line on the bound food', async () => {
            const failure = await seedFailure('PENDING');
            const lineId = await lineWaitingOn(failure.lookupId);
            let answerTheFirst: () => void = () => undefined;
            const firstAnswer = new Promise<void>((resolve) => {
                answerTheFirst = resolve;
            });
            vi.mocked(food.resolveRefs)
                .mockImplementationOnce(async (refs) => {
                    await firstAnswer;

                    return refsAnswer('PENDING')(refs);
                })
                .mockImplementationOnce(refsAnswer('RESOLVED'))
                // The stale poll names the settle's target.
                .mockImplementationOnce(refsAnswer('RESOLVED'));

            const first = service.refreshStatus(CALLER, failure.lookupId);
            await vi.waitFor(() => expect(food.resolveRefs).toHaveBeenCalledTimes(1));
            const second = await service.refreshStatus(CALLER, failure.lookupId);

            // The fresh answer settled: food's binding, answered under food's name, with the line moved onto it.
            expect(second).toMatchObject({ foodId: FOOD_ID, name: FOOD_NAME });
            expect(second.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect(await bindingOf(lineId)).toBe(second.id);

            answerTheFirst();
            const stale = await first;

            // The stale caller is answered with where the settle forwards, never with a PENDING it cannot act on.
            expect(stale).toMatchObject({ id: second.id, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            // ⛔ …and nothing it wrote moved the line back.
            expect(await bindingOf(lineId)).toBe(second.id);
        });

        it('re-asks food by name for a TERMINAL phrase, and records the PENDING it genuinely observes', async () => {
            const failure = await seedFailure('FAILED');
            expect(failure.failure.foodHandleId).toBeNull();
            vi.mocked(food.addByName).mockResolvedValue({ id: FOOD_ID, status: 'PENDING' });

            const refreshed = await service.refreshStatus(CALLER, failure.lookupId);

            expect(food.addByName).toHaveBeenCalledWith(PHRASE);
            expect(refreshed.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
            expect(await readFailureRecord(pool, failure.lookupId)).toMatchObject({
                reasonCode: 'awaiting_source',
                status: 'PENDING',
            });
        });
    });

    it.each(['PENDING', 'UNRESOLVED'] as const)(
        'poll (refreshStatus) settles a %s phrase once its food resolves, binding the food reference',
        async (status) => {
            const failure = await seedFailure(status);
            vi.mocked(food.resolveRefs).mockImplementation(refsAnswer('RESOLVED'));

            const refreshed = await service.refreshStatus(CALLER, failure.lookupId);

            expect(refreshed.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect(refreshed.foodId).toBe(FOOD_ID);
            // Re-read from the DB: the food is bound on the root arm. ⛔ The binding carries the REFERENCE, never a
            // copy of the food's numbers (U10), and never a name.
            const { rows } = await pool.query(
                'SELECT id, food_variant_id, unresolved_food_id, food_owner_id FROM food_lookups WHERE food_id = $1',
                [FOOD_ID],
            );
            expect(rows).toEqual([
                { id: refreshed.id, food_variant_id: null, unresolved_food_id: null, food_owner_id: null },
            ]);
        },
    );

    it('poll records a terminal NOT_FOUND as the failure`s status (never throws)', async () => {
        const failure = await seedFailure('PENDING');
        vi.mocked(food.resolveRefs).mockImplementation(refsAnswer('absent'));

        const refreshed = await service.refreshStatus(CALLER, failure.lookupId);

        expect(refreshed.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
        expect(await readFailureRecord(pool, failure.lookupId)).toMatchObject({
            reasonCode: 'no_source_has_it',
            status: 'NOT_FOUND',
        });
    });
});
