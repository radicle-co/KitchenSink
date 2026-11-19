/**
 * The API-writer Public confirmation marker (`{ apiWriter: true }`), over the wire against a real PostgreSQL, with REAL signed
 * tokens (the provenance review, finding 2).
 *
 * ⛔ WHY THIS TIER: the rule is "a test principal's seed satisfies the confirmation duty and leaves NO `publicConfirm` row; a
 * real cook who sends the marker is refused". Which principal kind a request has is decided by the signed claim
 * `public_metadata.testPrincipal`, read by the auth middleware, and whether a row exists is decided by the database. A mocked
 * principal and a mocked table prove neither.
 *
 * The stage runs containment `off`, as the sandbox and every preview do: on an enforcing stage a test principal may not publish
 * at all, so the marker has no use there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { PUBLIC_CONFIRMATION_FOR_API_WRITERS } from '@kitchensink/recipe-core';

import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';
import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { generateClerkKeypair, mintToken } from '../../support/jwt.js';
import { recipeDb } from '../../support/roleDb.js';

const AZP = 'https://recipes.example.com';
const TEST_OWNER = '01JAPIWRITERCONFIRMTEST001';
const REAL_OWNER = '01JAPIWRITERCONFIRMREAL001';

const PUBLISHED_PUBLIC = {
    title: 'API writer confirmation probe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    cuisine: 'Italian',
    tags: [],
    dietaryFlags: [],
    visibility: 'public',
    status: 'published',
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-0000000000aa', quantity: { kind: 'exact', value: 1 }, unit: 'cup' },
    ],
    steps: [{ instruction: 'Mix.' }],
};

const roleDb = recipeDb();

describe('the API-writer confirmation marker', () => {
    const keypair = generateClerkKeypair();
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
        process.env['TEST_PRINCIPAL_CONTAINMENT'] = 'off';
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl });
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterAll(async () => {
        delete process.env['TEST_PRINCIPAL_CONTAINMENT'];
        await pool?.end();
        await booted?.close();
    });

    async function createAs(
        owner: string,
        testPrincipal: boolean,
        publicConfirmation: unknown,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
        const token = mintToken(keypair.privateKeyPem, {
            sub: `user_${owner}`,
            azp: AZP,
            externalId: owner,
            roles: ['premium'],
            ...(testPrincipal ? { testPrincipal: true } : {}),
        });
        const response = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ ...PUBLISHED_PUBLIC, publicConfirmation }),
        });

        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    async function rowsOf(recipeId: string): Promise<Array<{ choice: string }>> {
        const { rows } = await pool.query<{ choice: string }>(
            `SELECT choice FROM recipe_statement_attestations WHERE recipe_ref = $1`,
            [recipeId],
        );

        return rows;
    }

    it('lets a test principal publish with the marker, and writes NO publicConfirm row', async () => {
        const { status, body } = await createAs(TEST_OWNER, true, PUBLIC_CONFIRMATION_FOR_API_WRITERS);

        expect(status).toBe(201);
        expect(body).toMatchObject({ visibility: 'public', status: 'published' });
        expect(await rowsOf(body['id'] as string)).toEqual([]);
    });

    it('refuses a real cook who sends the marker: 400 INVALID_VISIBILITY, API_WRITER_CONFIRMATION_FORBIDDEN, nothing stored', async () => {
        const { status, body } = await createAs(REAL_OWNER, false, PUBLIC_CONFIRMATION_FOR_API_WRITERS);

        expect(status).toBe(400);
        expect(body).toMatchObject({
            code: 'INVALID_VISIBILITY',
            details: { reason: 'API_WRITER_CONFIRMATION_FORBIDDEN' },
        });

        const { rows } = await pool.query(`SELECT 1 FROM recipes WHERE owner_id = $1`, [REAL_OWNER]);

        expect(rows).toEqual([]);
    });

    it('still records the row for a wording a screen showed, from a real cook', async () => {
        const { status, body } = await createAs(REAL_OWNER, false, PUBLIC_CONFIRMATION_AS_SHOWN);

        expect(status).toBe(201);
        expect(await rowsOf(body['id'] as string)).toEqual([{ choice: 'publicConfirm' }]);
    });

    it('still demands a confirmation of a test principal: the marker or a wording, not nothing', async () => {
        const { status, body } = await createAs(TEST_OWNER, true, undefined);

        expect(status).toBe(400);
        expect(body).toMatchObject({ details: { reason: 'PUBLIC_CONFIRMATION_REQUIRED' } });
    });
});
