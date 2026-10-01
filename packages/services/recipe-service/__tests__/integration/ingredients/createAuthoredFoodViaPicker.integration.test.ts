/**
 * U16 — the picker's create-and-attach BFF vertical against a REAL Postgres and a REAL food-service
 * socket (a `node:http` stub — the `foodTokenForwarding` harness pattern).
 *
 * What only this tier can prove: the composed round-trip creates through food under the CALLER's forwarded
 * bearer and binds locally, the binding lands with the U11 privacy capture (`food_lookups.food_owner_id` = the
 * author — the fact every recipe-side read keys a private food's visibility on), and the per-author dedup
 * collision comes back as the duplicate outcome with NOTHING bound.
 *
 * ⚠️ REWRITTEN (plan 002):
 *  - The round trip is ONE food call now, not two. The bind admits the created food under the name food's CREATE
 *    response carries (`admitAuthoredFood`); the old follow-up `GET /status` fetched a name for the catalog row,
 *    and the recipe database stores no food names any more. The call-sequence assertion states the new sequence.
 *  - The privacy capture is read off the BINDING (`food_lookups`), which carries no name; the name is asserted on
 *    the returned ingredient instead.
 *  - The suite no longer wipes the shared tables (which, since 0051, would delete every recipe LINE in the
 *    database); it scopes its rows by food id, and "nothing bound" is a before/after count of `food_lookups`.
 */
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/FoodServiceClients.factory.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { hasTestDatabase, recipeDb } from '../../../tests/support/roleDb.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';

const roleDb = recipeDb();
const hasDatabaseUrl = hasTestDatabase;

const AUTHOR_ULID = '01JU16AUTHOR00000000000AAA';
const BEARER = 'eyJhbGciOiJSUzI1NiJ9.U16-AUTHOR-SESSION.sig';
const FOOD_ID = '01JU16FOOD0000000000000NEW';
/** The id the stub's per-author 409 names as the colliding food. */
const PRIOR_FOOD_ID = 'F_prior';

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
    // Food's read always carries the root's live variants (curated U8); an authored food has none.
    variants: [],
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
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
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
                            details: { existingId: PRIOR_FOOD_ID },
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
        await pool.query('DELETE FROM food_lookups WHERE food_id = ANY($1)', [[FOOD_ID, PRIOR_FOOD_ID]]);
        await pool.end();
    });

    beforeEach(async () => {
        createBehaviour = 'created';
        observed = [];
        await pool.query('DELETE FROM food_lookups WHERE food_id = ANY($1)', [[FOOD_ID, PRIOR_FOOD_ID]]);
    });

    /** How many bindings exist at all — "nothing bound" is this number not moving. */
    async function bindingCount(): Promise<number> {
        const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM food_lookups');

        return rows[0]?.n ?? 0;
    }

    function service(): IngredientsService {
        const clients = new FoodServiceClients({
            baseUrl: origin,
            typeaheadTimeoutMs: 150,
            postCommitNutritionTimeoutMs: 1_500,
            readNutritionDeadlineMs: 3_000,
        });

        return new IngredientsService(
            new FoodLookupsDal(db),
            clients,
            new FoodCatalogGateway(clients, { enabled: true }),
            new FoodRefsGateway(clients),
            [],
            makeFakeIngredientResolutionsDal(),
            makeFakeResolutionBandsDal(),
        );
    }

    it('creates through food, binds locally, and captures the U11 privacy fact — under the caller bearer', async () => {
        const before = await bindingCount();
        const outcome = await service().createAuthoredFood(callerToken(BEARER), AUTHOR_ULID, {
            name: 'Grandma Blend',
            macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        });

        expect(outcome.kind).toBe('created');

        if (outcome.kind === 'created') {
            expect(outcome.ingredient).toMatchObject({ foodId: FOOD_ID, name: 'Grandma Blend' });
        }

        // The binding carries the AUTHOR — the input to every recipe-side privacy predicate (R20).
        const row = await pool.query(`SELECT id, food_owner_id FROM food_lookups WHERE food_id = $1`, [FOOD_ID]);

        expect(row.rows).toHaveLength(1);
        expect(row.rows[0]?.food_owner_id).toBe(AUTHOR_ULID);
        expect(await bindingCount()).toBe(before + 1);

        // The one food call carried the CALLER's own credential (issue #120) — never a service token.
        const apiCalls = observed.filter((call) => call.path !== '/health');

        expect(apiCalls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/v1/foods/authored']);

        for (const call of apiCalls) {
            expect(call.authorization).toBe(`Bearer ${BEARER}`);
        }
    });

    it('the per-author collision admits NOTHING and answers the duplicate outcome', async () => {
        createBehaviour = 'duplicate';
        const before = await bindingCount();

        const outcome = await service().createAuthoredFood(callerToken(BEARER), AUTHOR_ULID, {
            name: 'Grandma Blend',
            macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        });

        expect(outcome).toEqual({ kind: 'duplicate', existingFoodId: PRIOR_FOOD_ID });
        expect(await bindingCount()).toBe(before);
    });
});
