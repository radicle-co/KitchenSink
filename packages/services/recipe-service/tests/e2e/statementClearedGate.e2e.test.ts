/**
 * A past "from another person" is locked for the cook (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a; migration 0090, ADR-0095
 * section 4 and ADR-0097), over HTTP against a REAL database.
 *
 * Once a recipe stores "from another person", no cook write replaces or clears it (owner ruling 2026-11-19). A recipe cleared before the lock existed
 * (no stored statement, a past `fromPerson` attestation row) is locked on the server too (cleared before the lock existed). Those states can no longer be
 * reached through the API, so the tests put the row in them directly as the owner. The refusals read the attestation table
 * (`RecipeStatementAttestationsDal.hasFromPerson`) under the row lock, which a mocked data layer cannot prove.
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

const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

/** Creates a private recipe stated "from another person"; the record holds one `fromPerson` row. */
async function fromPersonRecipe(title: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${title}`,
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
}

/** The R2 state, as a recipe cleared before the lock existed: no stored statement, the `fromPerson` row still on record. */
async function clearStatementAsOwner(id: string): Promise<void> {
    await roleDb.asOwner((client) => client.query('UPDATE recipes SET statement_kind = NULL WHERE id = $1', [id]));
}

async function readState(id: string): Promise<{ statementKind: string | null; attestations: number }> {
    const { rows } = await pool.query<{ statement_kind: string | null; attestations: string }>(
        `SELECT r.statement_kind, (SELECT count(*) FROM recipe_statement_attestations WHERE recipe_ref = r.id) AS attestations
           FROM recipes r WHERE r.id = $1`,
        [id],
    );

    return { statementKind: rows[0]?.statement_kind ?? null, attestations: Number(rows[0]?.attestations ?? 0) };
}

async function expectLockedWrites(id: string, version: number): Promise<void> {
    const before = await readState(id);
    const patch = await call('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: AUTHORED });
    const sheet = await call('PATCH', `/api/v1/recipes/${id}/visibility`, {
        visibility: 'public',
        statement: AUTHORED,
        publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
    });

    for (const response of [patch, sheet]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ details: { reason: 'SOURCE_LOCKED' } });
    }

    expect(await readState(id)).toEqual(before);
}

describe('"from another person" is locked for the cook (e2e)', () => {
    it('refuses "I wrote this" over a stored "from another person" on every write, and Public stays refused', async () => {
        const created = await fromPersonRecipe('stored pesto');

        await expectLockedWrites(created.id, created.currentVersion);

        const state = await readState(created.id);

        expect(state).toEqual({ statementKind: 'fromPerson', attestations: 1 });
    });

    it('refuses Public with FROM_PERSON_PRIVATE_ONLY on the R2 state, and refuses "I wrote this" over it', async () => {
        const created = await fromPersonRecipe('cleared pesto');

        await clearStatementAsOwner(created.id);
        await expectLockedWrites(created.id, created.currentVersion);

        const refused = await call('PATCH', `/api/v1/recipes/${created.id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({
            code: 'INVALID_VISIBILITY',
            details: { reason: 'FROM_PERSON_PRIVATE_ONLY' },
        });
        expect(await readState(created.id)).toEqual({ statementKind: null, attestations: 1 });

        const { rows } = await pool.query<{ held: boolean }>('SELECT recipe_is_from_person($1) AS held', [created.id]);

        expect(rows[0]?.held).toBe(true);
    });

    it('refuses Public on a CLONE of a recipe cleared before the lock, and the clone stays locked on its own id', async () => {
        const created = await fromPersonRecipe('cloned cleared pesto');

        await clearStatementAsOwner(created.id);

        const clone = await json<RecipeBody>('POST', `/api/v1/recipes/${created.id}/clone`, 201, {});

        expect(clone.visibility).toBe('private');

        const refused = await call('PATCH', `/api/v1/recipes/${clone.id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({
            code: 'INVALID_VISIBILITY',
            details: { reason: 'FROM_PERSON_PRIVATE_ONLY' },
        });

        const { rows } = await pool.query<{ held: boolean }>('SELECT recipe_is_from_person($1) AS held', [clone.id]);

        expect(rows[0]?.held).toBe(true);

        // The attestation is read for the clone's OWN id: both writes are refused and nothing is written.
        await expectLockedWrites(clone.id, clone.currentVersion);
    });

    it('lets the R2 recipe state "from another person" again (a first statement), and an unstated recipe state either answer', async () => {
        const created = await fromPersonRecipe('restated pesto');

        await clearStatementAsOwner(created.id);

        const restated = await call('PATCH', `/api/v1/recipes/${created.id}`, {
            expectedVersion: created.currentVersion,
            statement: { kind: 'fromPerson', wording: FROM_PERSON_AS_SHOWN },
        });

        expect(restated.status).toBe(200);
        expect((await readState(created.id)).statementKind).toBe('fromPerson');

        // R4: a recipe with no statement and no attestation at all still takes "I wrote this".
        const unstated = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            title: `${SCOPE} unstated`,
            cuisine: 'Thai',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 0,
            totalTimeMinutes: 5,
            ingredients: [{ ingredientId: basilLookup, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
            steps: [{ instruction: 'Blend.' }],
            visibility: 'private',
        });
        const authored = await call('PATCH', `/api/v1/recipes/${unstated.id}`, {
            expectedVersion: unstated.currentVersion,
            statement: AUTHORED,
        });

        expect(authored.status).toBe(200);
    });

    // AE9 / AE1: this used to assert the gap the lock closes (a cook replaced "from another person" with "I wrote this", and the
    // clone then went Public). The replace is refused now, so the clone of a "from another person" recipe stays held.
    it('a clone of a "from another person" recipe holds it, stays private, and cannot be changed to "I wrote this"', async () => {
        const created = await fromPersonRecipe('cloned pesto');

        const clone = await json<RecipeBody>('POST', `/api/v1/recipes/${created.id}/clone`, 201, {});

        expect(clone.visibility).toBe('private');

        const { rows } = await pool.query<{ held: boolean }>('SELECT recipe_is_from_person($1) AS held', [clone.id]);

        expect(rows[0]?.held).toBe(true);

        await expectLockedWrites(clone.id, clone.currentVersion);
        expect((await readState(clone.id)).statementKind).toBe('fromPerson');
    });
});
