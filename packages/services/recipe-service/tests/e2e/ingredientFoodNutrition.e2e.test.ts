/**
 * `POST /api/v1/ingredients/food-nutrition` (plan 002 U9) through the ASSEMBLED app on REAL Postgres — a LOCAL-target
 * e2e suite (`docs/CODING_STANDARDS.md` §7.1a). It never skips: without a database, booting throws.
 *
 * Food is not running here, so every root is `unavailable`: a public bound food, a stranger's private food and an
 * unknown id alike, which is also the concealment rule's answer for a stranger's food when food cannot be asked. What
 * this tier adds over the mocked integration tier is the real SQL: `findPrivateRootOwners` against the real schema,
 * asserted directly because the route cannot show it with food down, and the transport failure to a real, closed
 * port degrading the answer instead of failing the request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../src/database/client.js';
import { FoodLookupsDal } from '../../src/ingredients/dal/foodLookups.dal.js';
import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeE2eDb } from '../support/roleDb.js';

const roleDb = recipeE2eDb();

const CALLER = '01JFOODNUTRITIONE2ECALLER01';
const STRANGER = '01JFOODNUTRITIONE2ESTRANGER';

/** Food ids unique to this suite, so its bindings never meet another suite's. */
const SCOPE = 'e2e-food-nutrition';
const PUBLIC_FOOD = `${SCOPE}-public`;
const THEIR_FOOD = `${SCOPE}-theirs`;
const UNKNOWN_FOOD = `${SCOPE}-unknown`;

describe('POST /api/v1/ingredients/food-nutrition (e2e, LOCAL: assembled app, real Postgres, food down)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: CALLER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 2 });
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.query(`INSERT INTO food_lookups (food_id, food_owner_id) VALUES ($1, NULL), ($2, $3)`, [
            PUBLIC_FOOD,
            THEIR_FOOD,
            STRANGER,
        ]);
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
    });

    it('answers every root unavailable when food cannot be asked, and a variant absent', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/food-nutrition`, {
            method: 'POST',
            // A bearer, so the gateway really calls the closed food origin rather than skipping the call.
            headers: { 'content-type': 'application/json', authorization: 'Bearer local-e2e' },
            body: JSON.stringify({
                refs: [
                    { kind: 'root', id: PUBLIC_FOOD },
                    { kind: 'root', id: THEIR_FOOD },
                    { kind: 'root', id: UNKNOWN_FOOD },
                    { kind: 'variant', id: `${SCOPE}-variant` },
                ],
            }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(await res.json()).toStrictEqual({
            entries: [
                { outcome: 'unavailable', ref: { kind: 'root', id: PUBLIC_FOOD } },
                { outcome: 'unavailable', ref: { kind: 'root', id: THEIR_FOOD } },
                { outcome: 'unavailable', ref: { kind: 'root', id: UNKNOWN_FOOD } },
                { outcome: 'absent', ref: { kind: 'variant', id: `${SCOPE}-variant` } },
            ],
        });
    });

    it('reads the owner of each PRIVATE binding asked about, and nothing for a shared or unknown food', async () => {
        const owners = await new FoodLookupsDal(createRecipeDrizzle(pool)).findPrivateRootOwners([
            PUBLIC_FOOD,
            THEIR_FOOD,
            UNKNOWN_FOOD,
        ]);

        expect(new Map(owners)).toStrictEqual(new Map([[THEIR_FOOD, STRANGER]]));
        expect((await new FoodLookupsDal(createRecipeDrizzle(pool)).findPrivateRootOwners([])).size).toBe(0);
    });

    it('refuses an over-long id with a 400 before any read', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/food-nutrition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refs: [{ kind: 'root', id: 'x'.repeat(65) }] }),
        });

        expect(res.status).toBe(400);
    });
});
