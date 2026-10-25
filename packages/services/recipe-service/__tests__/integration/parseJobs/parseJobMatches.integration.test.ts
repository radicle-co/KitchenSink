/**
 * `POST /api/v1/recipe-parse-jobs/:id/matches` (ADR-0071) over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` — routing, the auth middleware, the rate limit, the matcher
 * and the real proposal chain — with the parse-job, match and mapping repositories doubled, the verification queue
 * captured, and food faked at the network so the real food client searches and resolves refs as the cook.
 *
 * It proves what the unit tier cannot: that the route is routed and owner-scoped (404 for a stranger, 409 past the TTL),
 * answers 202 with the job view, that the chain's searches really carry the cook's bearer to food, that the first call
 * sends one verification per proposal and a second call sends none, and that a food outage stores nothing.
 *
 * The real SQL of the match table is the LOCAL e2e tier's (`tests/e2e/parseJobs/parseJobMatches.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseJobResponseSchema } from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import {
    inMemoryParseJobMatches,
    makeParseJobLine,
    makeParseJobRecord,
    makeStoredProposal,
} from '../../../src/recipes/__fixtures__/parseJobMatches.fixture.js';
import { PARSE_JOB_MATCHES_DAL } from '../../../src/recipes/matchProposal.service.js';
import { PARSE_JOBS_DAL } from '../../../src/recipes/parseJobs.service.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from '../../../src/recipes/recipes.tokens.js';
import { VERIFICATION_QUEUE } from '../../../src/recipes/verification.queue.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JPARSEMATCHESCOOK0000001';
const STRANGER = '01JPARSEMATCHESSTRANGER001';
const JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3311';
const EXPIRED_JOB_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3312';

const JOB = makeParseJobRecord({
    id: JOB_ID,
    lines: [
        makeParseJobLine({
            sourceLine: '2 cups milk',
            proposal: makeStoredProposal({ raw: '2 cups milk', foods: [{ name: 'milk', prep: null }] }),
        }),
    ],
});
const EXPIRED = makeParseJobRecord({ id: EXPIRED_JOB_ID, expiresAt: new Date(Date.now() - 60_000) });

let food: FoodFake;
let booted: BootedServiceApp;
let matches = inMemoryParseJobMatches(new Map([[JOB_ID, COOK]]));
const sent: VerifyIngredientLineMessage[][] = [];

/** POST the command as `principal`. @sideEffect One HTTP request. */
async function proposeMatches(principal: string, jobId: string): Promise<Response> {
    return asPrincipal(principal, () =>
        fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${jobId}/matches`, {
            method: 'POST',
            headers: { authorization: bearerFor(principal) },
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('F-whole', { name: 'Milk, whole', status: 'RESOLVED' });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: PARSE_JOBS_DAL,
                useValue: {
                    getJob: async (ownerId: string, jobId: string) =>
                        ownerId !== COOK
                            ? undefined
                            : jobId === JOB_ID
                              ? JOB
                              : jobId === EXPIRED_JOB_ID
                                ? EXPIRED
                                : undefined,
                },
            },
            // A proxy, so each test's fresh store is the one the app holds.
            {
                provide: PARSE_JOB_MATCHES_DAL,
                useValue: {
                    findForJob: (...args: Parameters<typeof matches.findForJob>) => matches.findForJob(...args),
                    saveMatches: (...args: Parameters<typeof matches.saveMatches>) => matches.saveMatches(...args),
                    claimEnqueue: (...args: Parameters<typeof matches.claimEnqueue>) => matches.claimEnqueue(...args),
                    releaseEnqueue: (...args: Parameters<typeof matches.releaseEnqueue>) =>
                        matches.releaseEnqueue(...args),
                },
            },
            {
                provide: VERIFICATION_QUEUE,
                useValue: {
                    enqueue: vi.fn(async (messages: readonly VerifyIngredientLineMessage[]) => {
                        sent.push([...messages]);
                    }),
                },
            },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            {
                provide: ResolutionMappingsDal,
                useValue: { findInForce: async () => undefined, findMemo: async () => undefined },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    matches = inMemoryParseJobMatches(new Map([[JOB_ID, COOK]]));
    sent.length = 0;
    food.down = false;
    food.requests.length = 0;
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/recipe-parse-jobs/:id/matches (integration: real pipeline, mocked dependencies)', () => {
    it('answers 202 with the job view, proposes as the COOK, and sends one parse-job verification', async () => {
        const response = await proposeMatches(COOK, JOB_ID);

        expect(response.status).toBe(202);
        expect(parseJobResponseSchema.parse(await response.json()).id).toBe(JOB_ID);
        // The chain's catalog search reached food with the cook's own bearer.
        expect(
            food.requests.filter((request) => request.path === '/api/v1/foods/search').map((r) => r.callerId),
        ).toEqual([COOK]);
        expect([...matches.rows.values()]).toMatchObject([
            { proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' } } },
        ]);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.[0]).toMatchObject({
            origin: { kind: 'parseJob', jobId: JOB_ID, lineIndex: 0, foodIndex: 0 },
            foodId: 'F-whole',
            candidateFoodName: 'Milk, whole',
            evidenceKind: 'unattributed',
        });
    });

    it('⛔ is idempotent: a second call sends nothing more', async () => {
        await proposeMatches(COOK, JOB_ID);
        const again = await proposeMatches(COOK, JOB_ID);

        expect(again.status).toBe(202);
        expect(sent).toHaveLength(1);
    });

    it("⛔ answers a stranger's request with 404, exactly as for an absent job", async () => {
        const response = await proposeMatches(STRANGER, JOB_ID);

        expect(response.status).toBe(404);
        expect(matches.rows.size).toBe(0);
    });

    it('answers an expired job with 409', async () => {
        expect((await proposeMatches(COOK, EXPIRED_JOB_ID)).status).toBe(409);
    });

    it('⛔ stores NOTHING while food is down — an outage is never a stored no-match', async () => {
        food.down = true;

        const response = await proposeMatches(COOK, JOB_ID);

        expect(response.status).toBe(202);
        expect(matches.rows.size).toBe(0);
        expect(sent).toEqual([]);
    });

    it('answers 401 with no credential', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs/${JOB_ID}/matches`, {
            method: 'POST',
        });

        expect(response.status).toBe(401);
    });
});
