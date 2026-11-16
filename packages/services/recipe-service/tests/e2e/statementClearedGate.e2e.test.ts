/**
 * A past "from another person" survives a later statement and a clear (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a; migration
 * 0090 and ADR-0095 section 4), over HTTP against a REAL database.
 *
 * A cook says a recipe is from another person, replaces that with "I wrote this", then clears the statement. The stored statement
 * is now empty, but the cook once attested "from another person", so Public is still refused. That refusal reads the attestation
 * table (`RecipeStatementAttestationsDal.hasFromPerson`), which a mocked data layer cannot prove: only the database says whether the
 * rows were written in the same transaction as each statement, and whether the read finds them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../src/__fixtures__/index.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-cleared-gate';
const COOK = '01JCLEAREDGATEE2E000000COOK';
const BASIL = `${SCOPE}-basil`;

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly visibility: string;
}

const FROM_PERSON_AS_SHOWN = { version: 'statementFromPerson.v1', locale: 'en' } as const;

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let basilLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set(BASIL, { name: 'Basil', status: 'RESOLVED' });
    process.env['FOOD_SERVICE_URL'] = food.origin;

    booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
    pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    basilLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BASIL })).id;
});

afterAll(async () => {
    if (pool !== undefined) {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [COOK]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    }

    await booted?.close();
    await food?.close();
});

describe('Public after "from another person", "I wrote this" and a clear (e2e)', () => {
    it('refuses Public with FROM_PERSON_PRIVATE_ONLY, and the record holds all three acts', async () => {
        const created = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            title: `${SCOPE} pesto`,
            cuisine: 'Thai',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 0,
            totalTimeMinutes: 5,
            ingredients: [{ ingredientId: basilLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
            steps: [{ instruction: 'Blend.' }],
            visibility: 'private',
            statement: { kind: 'fromPerson', wording: FROM_PERSON_AS_SHOWN },
        });

        expect(created.visibility).toBe('private');

        const authored = await json<RecipeBody>('PATCH', `/api/v1/recipes/${created.id}`, 200, {
            expectedVersion: created.currentVersion,
            statement: { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } },
        });
        const cleared = await json<RecipeBody>('PATCH', `/api/v1/recipes/${created.id}`, 200, {
            expectedVersion: authored.currentVersion,
            statement: null,
        });

        const refused = await call('PATCH', `/api/v1/recipes/${created.id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({
            code: 'INVALID_VISIBILITY',
            details: { reason: 'FROM_PERSON_PRIVATE_ONLY' },
        });

        const { rows } = await pool.query<{ choice: string }>(
            'SELECT choice FROM recipe_statement_attestations WHERE recipe_ref = $1 ORDER BY recorded_at, id',
            [created.id],
        );

        expect(rows.map((row) => row.choice)).toEqual(['fromPerson', 'authored', 'cleared']);
        expect(cleared.visibility).toBe('private');
    });
});
