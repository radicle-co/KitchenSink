/**
 * U16 — the picker's create-and-attach BFF vertical against a REAL Postgres and a REAL food-service
 * socket (a `node:http` stub — the `foodTokenForwarding` harness pattern).
 *
 * What only this tier can prove: the composed round-trip really is create THEN admit (two food calls,
 * both under the CALLER's forwarded bearer), the admitted `ingredients` row lands with the U11 privacy
 * capture (`food_owner_id` = the author — the whole reason a private food's name never reaches another
 * user's local search), and the per-author dedup collision comes back as the duplicate outcome with
 * NOTHING admitted.
 */
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/FoodServiceClients.factory.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { seed } from '../../../src/database/seed.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const AUTHOR_ULID = '01JU16AUTHOR00000000000AAA';
const BEARER = 'eyJhbGciOiJSUzI1NiJ9.U16-AUTHOR-SESSION.sig';
const FOOD_ID = '01JU16FOOD0000000000000NEW';

/** The authored golden record the stub returns — visibility PRIVATE, per U10. */
/** Build a `CallerToken` from a raw bearer, as the auth middleware would. */
function callerToken(raw: string): CallerToken {
    const token = CallerToken.fromAuthorizationHeader(`Bearer ${raw}`);

    if (token === undefined) {
        throw new Error('fixture: expected a CallerToken');
    }

    return token;
}

const AUTHORED_FOOD = {
    id: FOOD_ID,
    name: 'Grandma Blend',
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [],
    portions: [],
    provenance: {},
    visibility: 'private',
};

describe.skipIf(!hasDatabaseUrl)('createAuthoredFood BFF vertical (integration, U16)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let server: Server;
    let origin: string;
    /** Whether the stub's authored-create answers 201 or the per-author 409. */
    let createBehaviour: 'created' | 'duplicate';
    /** Every request the stub saw: method, path, bearer. */
    let observed: Array<{ method: string; path: string; authorization: string | undefined }>;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = (req.url ?? '').split('?')[0] ?? '';

            observed.push({ method: req.method ?? '', path, authorization: req.headers['authorization'] });

            if (path === '/api/v1/foods/authored' && req.method === 'POST') {
                if (createBehaviour === 'duplicate') {
                    res.writeHead(409, { 'content-type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            code: 'DUPLICATE_AUTHORED_NAME',
                            message: 'already authored',
                            details: { existingId: 'F_prior' },
                        }),
                    );

                    return;
                }

                res.writeHead(201, { 'content-type': 'application/json' });
                res.end(JSON.stringify(AUTHORED_FOOD));

                return;
            }

            if (path === `/api/v1/foods/${FOOD_ID}/status`) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ id: FOOD_ID, status: 'RESOLVED', food: AUTHORED_FOOD }));

                return;
            }

            // The contract-skew /health probe and anything else: a quiet 200.
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await seed(pool);
        await pool.end();
    });

    beforeEach(async () => {
        createBehaviour = 'created';
        observed = [];
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
    });

    function service(): IngredientsService {
        const clients = new FoodServiceClients({ baseUrl: origin, typeaheadTimeoutMs: 150 });

        return new IngredientsService(
            new IngredientsDal(db),
            clients,
            new FoodCatalogGateway(clients, { enabled: true }),
        );
    }

    it('creates through food, admits locally, and captures the U11 privacy fact — all under the caller bearer', async () => {
        const outcome = await service().createAuthoredFood(callerToken(BEARER), AUTHOR_ULID, {
            name: 'Grandma Blend',
            macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        });

        expect(outcome.kind).toBe('created');

        if (outcome.kind === 'created') {
            expect(outcome.ingredient.foodId).toBe(FOOD_ID);
        }

        // The admitted shared-catalog row carries the AUTHOR — the search predicate's input (R20).
        const row = await pool.query(`SELECT name, food_owner_id FROM ingredients WHERE food_id = $1`, [FOOD_ID]);

        expect(row.rows).toEqual([{ name: 'Grandma Blend', food_owner_id: AUTHOR_ULID }]);

        // Both food calls carried the CALLER's own credential (issue #120) — never a service token.
        const apiCalls = observed.filter((call) => call.path !== '/health');

        expect(apiCalls.map((call) => `${call.method} ${call.path}`)).toEqual(
            ['/api/v1/foods/authored', `/api/v1/foods/${FOOD_ID}/status`].map(
                (path, index) => `${index === 0 ? 'POST' : 'GET'} ${path}`,
            ),
        );

        for (const call of apiCalls) {
            expect(call.authorization).toBe(`Bearer ${BEARER}`);
        }
    });

    it('the per-author collision admits NOTHING and answers the duplicate outcome', async () => {
        createBehaviour = 'duplicate';

        const outcome = await service().createAuthoredFood(callerToken(BEARER), AUTHOR_ULID, {
            name: 'Grandma Blend',
            macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        });

        expect(outcome).toEqual({ kind: 'duplicate', existingFoodId: 'F_prior' });

        const rows = await pool.query(`SELECT count(*)::int AS n FROM ingredients`);

        expect(rows.rows[0]?.n).toBe(0);
    });
});
