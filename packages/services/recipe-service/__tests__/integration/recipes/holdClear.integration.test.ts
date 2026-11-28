/**
 * The staff hold-clear route (ADR-0106, plan pr5HoldClear U4) over the REAL HTTP pipeline: a signed token, the real
 * `AuthMiddleware`, the validation pipe, the controller, the service and the policy, with the DALs as doubles
 * (`docs/CODING_STANDARDS.md` section 7.1a). That the rows change, the clone walk and the database refusals are the LOCAL e2e tier's
 * (`holdClear.e2e.test.ts`).
 *
 * The grant is the SIGNED claim in the token, so a cook holding no grant and a staff account holding it are both real principals.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { SourceCorrectionsDal } from '../../../src/recipes/dal/sourceCorrections.dal.js';
import { SourceHoldClearsDal, type CorrectionChainRow } from '../../../src/recipes/dal/sourceHoldClears.dal.js';
import { SOURCE_CORRECT_SCOPE } from '../../../src/recipes/recipes.schema.js';
import { FAKE_TX } from '../../../src/recipes/__fixtures__/recipesDal.fixture.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';
import { recipesDalDouble } from '../../../tests/support/recipesDalDouble.js';

const AZP = 'https://recipes.example.com';
const OWNER = '01JHOLDCLEAROWNER0000001';
const STAFF = '01JHOLDCLEARSTAFF0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000d9';
const ROW_ID = '00000000-0000-4000-8000-0000000000e9';
const keypair = generateClerkKeypair();
const savedEnv: Record<string, string | undefined> = {};

const BOOK_ROW: CorrectionChainRow = {
    id: ROW_ID,
    recipeId: RECIPE_ID,
    newSourceType: 'imported_physical',
    newSourceKind: 'book',
    newStatementKind: 'source',
};

let facts: { ownerId: string; held: boolean } | undefined;
let chain: readonly CorrectionChainRow[] = [];
const calls: string[] = [];
const recordClears = vi.fn<(...args: unknown[]) => void>(() => {
    calls.push('record');
});
const releaseHolds = vi.fn<(...args: unknown[]) => void>(() => {
    calls.push('release');
});

let booted: BootedServiceApp;

const REQUEST = { ownerAccountId: OWNER, correctionId: ROW_ID, reason: 'The correction was a mistake.' };

async function post(caller: string, scopes: readonly string[], body: unknown): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${caller}`, azp: AZP, externalId: caller, scopes });

    return fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}/source-correction/hold-clear`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function errorOf(response: Response): Promise<{ status: number; code: string; details: unknown }> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

beforeAll(async () => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'RECIPE_DEV_AUTH_USER_ID']) {
        savedEnv[key] = process.env[key];
    }

    delete process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;

    booted = await bootMockedRecipeApp({
        doubles: [
            recipesDalDouble({
                transaction: async (fn) => {
                    calls.push('begin');

                    return fn(FAKE_TX);
                },
                lockAndCountPrivateSlots: () => {
                    calls.push('lockOwner');

                    return Promise.resolve(0);
                },
            }),
            { provide: SourceCorrectionsDal, useValue: {} },
            {
                provide: SourceHoldClearsDal,
                useValue: {
                    lockHoldFacts: () => {
                        calls.push('lockRecipe');

                        return Promise.resolve(facts);
                    },
                    readCorrectionChain: () => Promise.resolve(chain),
                    readLatestCorrectionId: () => Promise.resolve(chain[0]?.id ?? null),
                    lockOwnersDescendants: () => Promise.resolve(),
                    releasableDescendants: () => Promise.resolve([]),
                    recordClears,
                    releaseHolds,
                },
            },
        ],
    });
});

afterAll(async () => {
    await booted.close();

    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key);
        } else {
            process.env[key] = value;
        }
    }
});

beforeEach(() => {
    facts = { ownerId: OWNER, held: true };
    chain = [BOOK_ROW];
    calls.length = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('POST /api/v1/recipes/:id/source-correction/hold-clear', () => {
    it('a staff caller with the grant clears the hold: 200 with the number cleared, the record BEFORE the release', async () => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], REQUEST);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: 'cleared', released: 1 });
        expect(calls).toEqual(['begin', 'lockOwner', 'lockRecipe', 'record', 'release']);
    });

    it('the OWNER, who holds no grant, cannot clear their own recipe: 403 naming the scope, nothing written', async () => {
        await expect(errorOf(await post(OWNER, [], REQUEST))).resolves.toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { requiredScope: SOURCE_CORRECT_SCOPE },
        });
        expect(calls).toEqual([]);
    });

    it('a recipe of another owner answers exactly as a missing recipe does: one 404, nothing written', async () => {
        facts = { ownerId: 'someone-else', held: true };
        const wrongOwner = await errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], REQUEST));
        facts = undefined;
        const missing = await errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], REQUEST));

        expect(wrongOwner).toMatchObject({ status: 404, code: 'RECIPE_NOT_FOUND' });
        expect(wrongOwner).toEqual(missing);
        expect(recordClears).not.toHaveBeenCalled();
    });

    it.each([
        ['', 'an empty reason'],
        ['   ', 'a whitespace-only reason'],
    ])('refuses %j (%s) with 400 and writes nothing', async (reason) => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], { ...REQUEST, reason });

        expect(response.status).toBe(400);
        expect(recordClears).not.toHaveBeenCalled();
    });

    it('refuses a body with an unknown field (strict)', async () => {
        expect((await post(STAFF, [SOURCE_CORRECT_SCOPE], { ...REQUEST, cause: 'earnedRewrite' })).status).toBe(400);
        expect(recordClears).not.toHaveBeenCalled();
    });

    it.each([
        ['a recipe that is not held', () => (facts = { ownerId: OWNER, held: false }), 'HOLD_NOT_SET'],
        [
            'a correction that is no longer the newest',
            () => (chain = [{ ...BOOK_ROW, id: '00000000-0000-4000-8000-0000000000ff' }]),
            'CORRECTION_NOT_LATEST',
        ],
    ] as const)(
        'answers 409 HOLD_CLEAR_CONFLICT for %s, with the reason in details',
        async (_name, arrange, reason) => {
            arrange();

            await expect(errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], REQUEST))).resolves.toEqual({
                status: 409,
                code: 'HOLD_CLEAR_CONFLICT',
                details: { reason },
            });
            expect(recordClears).not.toHaveBeenCalled();
            expect(releaseHolds).not.toHaveBeenCalled();
        },
    );
});
