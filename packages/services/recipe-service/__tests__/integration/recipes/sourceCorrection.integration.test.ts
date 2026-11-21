/**
 * The staff correction route (ADR-0099, plan everyAnswerSourceLock U3) over the REAL HTTP pipeline: a signed token, the real
 * `AuthMiddleware`, the validation pipe, the controller, the service and the policy, with the DALs as doubles
 * (`docs/CODING_STANDARDS.md` section 7.1a). That the rows change, the clone walk and the database refusals are the LOCAL e2e tier's
 * (`sourceCorrection.e2e.test.ts`).
 *
 * The grant is the SIGNED claim in the token, so a cook holding no grant and a staff account holding it are both real principals.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import { SourceCorrectionsDal } from '../../../src/recipes/dal/sourceCorrections.dal.js';
import type { CorrectableRecipe } from '../../../src/recipes/domain/sourceCorrectionScopePolicy.js';
import { SOURCE_CORRECT_SCOPE } from '../../../src/recipes/recipes.schema.js';
import { RECIPES_DAL } from '../../../src/recipes/recipes.tokens.js';
import { FAKE_TX } from '../../../src/recipes/__fixtures__/recipesDal.fixture.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const AZP = 'https://recipes.example.com';
const OWNER = '01JSRCCORRECTOWNER000001';
const STAFF = '01JSRCCORRECTSTAFF0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000c9';
const keypair = generateClerkKeypair();
const savedEnv: Record<string, string | undefined> = {};

const BOOK: CorrectableRecipe = {
    ownerId: OWNER,
    sourceType: 'imported_physical',
    sourceKind: 'book',
    statementKind: 'source',
    sourceUrl: null,
    sourceAttribution: 'Joy of Cooking, p. 12',
};

let stored: CorrectableRecipe | undefined;
const calls: string[] = [];
const readPreview = vi.fn(async (_id: string) =>
    stored === undefined
        ? undefined
        : { ...stored, title: 'Tomato Soup', visibility: 'private' as const, sourceCorrectionHold: false },
);
const rewriteSource = vi.fn(async (..._args: unknown[]) => {
    calls.push('rewrite');
});
const recordCorrection = vi.fn(async (..._args: unknown[]) => {
    calls.push('record');
});
const holdOwnersClones = vi.fn(async (..._args: unknown[]) => {
    calls.push('clones');
});
const insertEvidence = vi.fn(async (..._args: unknown[]) => {
    calls.push('evidence');
});

let booted: BootedServiceApp;

const CORRECTION = {
    ownerAccountId: OWNER,
    answer: { kind: 'public_web', citation: 'https://www.allrecipes.com/recipe/1/soup/' },
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email; mailbox challenge passed.',
};

/** One request as `caller`, holding `scopes` in a signed token. */
async function post(caller: string, scopes: readonly string[], body: unknown, id = RECIPE_ID): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${caller}`, azp: AZP, externalId: caller, scopes });

    return fetch(`${booted.baseUrl}/api/v1/recipes/${id}/source-correction`, {
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
            {
                provide: RECIPES_DAL,
                useValue: {
                    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
                        calls.push('begin');

                        return fn(FAKE_TX);
                    },
                    lockAndCountPrivateSlots: async () => {
                        calls.push('lockOwner');

                        return 0;
                    },
                },
            },
            {
                provide: SourceCorrectionsDal,
                useValue: {
                    lockRecipe: async () => {
                        calls.push('lockRecipe');

                        return stored;
                    },
                    readPreview,
                    rewriteSource,
                    recordCorrection,
                    holdOwnersClones,
                },
            },
            // The erasure lock reads the CALLER's job on every write; no job here.
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: RecipeSourceEvidenceDal, useValue: { insert: insertEvidence, list: async () => [] } },
        ],
    });
});

afterAll(async () => {
    await booted?.close();

    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

beforeEach(() => {
    stored = BOOK;
    calls.length = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('POST /api/v1/recipes/:id/source-correction', () => {
    it('a staff caller with the grant corrects the answer: 200 applied, and the work runs in the lock order', async () => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], CORRECTION);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: 'applied' });
        expect(calls).toEqual(['begin', 'lockOwner', 'lockRecipe', 'rewrite', 'evidence', 'record', 'clones']);
    });

    it('the OWNER, who holds no grant, cannot correct their own recipe: 403 FORBIDDEN naming the scope, nothing written', async () => {
        const response = await post(OWNER, [], CORRECTION);

        await expect(errorOf(response)).resolves.toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { requiredScope: SOURCE_CORRECT_SCOPE },
        });
        expect(calls).toEqual([]);
    });

    it('the curator grant is not the staff grant', async () => {
        const response = await post(STAFF, ['recipes:import:public'], CORRECTION);

        expect(response.status).toBe(403);
        expect(calls).toEqual([]);
    });

    it('a recipe of another owner answers exactly as a missing recipe does: one 404, nothing written', async () => {
        stored = { ...BOOK, ownerId: '01JSOMEONEELSE000000001' };
        const wrongOwner = await errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], CORRECTION));
        stored = undefined;
        const missing = await errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], CORRECTION));

        expect(wrongOwner).toMatchObject({ status: 404, code: 'RECIPE_NOT_FOUND' });
        expect(wrongOwner).toEqual(missing);
        expect(rewriteSource).not.toHaveBeenCalled();
    });

    it('stating the answer the recipe already holds is 200 unchanged, and writes nothing', async () => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], {
            ...CORRECTION,
            answer: { kind: 'book', citation: 'Joy of Cooking, p. 12' },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: 'unchanged' });
        expect(rewriteSource).not.toHaveBeenCalled();
        expect(recordCorrection).not.toHaveBeenCalled();
    });

    it('a recipe with no answer to correct is 400 VALIDATION_FAILED, and writes nothing', async () => {
        stored = { ...BOOK, sourceType: 'user_created', sourceKind: null, statementKind: null };

        await expect(errorOf(await post(STAFF, [SOURCE_CORRECT_SCOPE], CORRECTION))).resolves.toMatchObject({
            status: 400,
            code: 'VALIDATION_FAILED',
            details: { fields: [expect.stringContaining('no source answer')] },
        });
        expect(rewriteSource).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a wording on the answer',
            { ...CORRECTION, answer: { kind: 'authored', wording: { version: 'v', locale: 'en' } } },
        ],
        ['an unknown field', { ...CORRECTION, visibility: 'public' }],
        ['a blank reason', { ...CORRECTION, reason: '  ' }],
        ['no ground', { ...CORRECTION, ground: undefined }],
    ])('rejects %s with 400 before any work', async (_name, body) => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], body);

        expect(response.status).toBe(400);
        expect(calls).toEqual([]);
    });

    it('a recipe id that is not a uuid is 400', async () => {
        const response = await post(STAFF, [SOURCE_CORRECT_SCOPE], CORRECTION, 'not-a-uuid');

        expect(response.status).toBe(400);
    });

    it('a caller with no token is 401', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}/source-correction`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CORRECTION),
        });

        expect(response.status).toBe(401);
    });
});

/** One preview request as `caller`, holding `scopes` in a signed token. */
async function get(caller: string, scopes: readonly string[], query: string, id = RECIPE_ID): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${caller}`, azp: AZP, externalId: caller, scopes });

    return fetch(`${booted.baseUrl}/api/v1/recipes/${id}/source-correction${query}`, {
        headers: { authorization: `Bearer ${token}` },
    });
}

describe('GET /api/v1/recipes/:id/source-correction (the runbook preview)', () => {
    const OWNER_QUERY = `?ownerAccountId=${OWNER}`;

    it.each([
        ['a cook with no grant', []],
        ['a curator holding only the import grant', ['recipes:import:public']],
    ])('%s is 403 FORBIDDEN naming the scope, and the recipe is never read', async (_name, scopes) => {
        const response = await get(OWNER, scopes, OWNER_QUERY);

        await expect(errorOf(response)).resolves.toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { requiredScope: SOURCE_CORRECT_SCOPE },
        });
        expect(readPreview).not.toHaveBeenCalled();
    });

    it('a missing recipe and a wrong owner answer with the SAME 404 body, byte for byte', async () => {
        stored = undefined;
        const missing = await get(STAFF, [SOURCE_CORRECT_SCOPE], OWNER_QUERY);
        const missingBody = await missing.text();

        stored = BOOK;
        const wrong = await get(STAFF, [SOURCE_CORRECT_SCOPE], '?ownerAccountId=01JSOMEONEELSE000000001');
        const wrongBody = await wrong.text();

        expect(missing.status).toBe(404);
        expect(wrong.status).toBe(404);
        expect(wrongBody).toBe(missingBody);
    });

    it('a request with no ownerAccountId is 400, and the recipe is never read', async () => {
        const response = await get(STAFF, [SOURCE_CORRECT_SCOPE], '');

        expect(response.status).toBe(400);
        expect(readPreview).not.toHaveBeenCalled();
    });

    it('answers EXACTLY the title, owner, visibility, answer and corrected flag, uncached', async () => {
        const response = await get(STAFF, [SOURCE_CORRECT_SCOPE], OWNER_QUERY);

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toStrictEqual({
            title: 'Tomato Soup',
            ownerAccountId: OWNER,
            visibility: 'private',
            answer: { kind: 'book', citation: 'Joy of Cooking, p. 12' },
            sourceCorrected: false,
        });
        expect(calls).toEqual([]);
    });
});
