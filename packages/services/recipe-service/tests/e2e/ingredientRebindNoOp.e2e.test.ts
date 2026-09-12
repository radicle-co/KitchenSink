/**
 * A rebind whose target is the binding the line already holds, through the fully assembled app, a real Postgres and a
 * food-service fake (plan 002 U5; ADR-0045; LOCAL e2e under the 2026-09-20 ruling).
 *
 * An editor adopts the version the command answers. What a mock cannot prove and these cases do: a stale
 * `expectedVersion` meets the enriched 409 with both conflict sides and writes nothing; a current one writes no
 * version, no line and no correction; and when another writer commits while food is asked, the answer still names the
 * version the caller sent, so the caller's next save meets that writer's change instead of overwriting it.
 *
 * The other writer is made deterministic by a hop in front of the food fake ({@link startFoodGate}) that holds the
 * command's first food request until a PATCH through the same app has committed.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { versionConflictDetailsSchema } from '@kitchensink/recipe-core';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-rebind-noop';
const AUTHOR = '01JREBINDNOOPE2E00AUTHOR00';
const BRISKET = `${SCOPE}-brisket`;

interface RecipeBody {
    readonly id: string;
    readonly title: string;
    readonly currentVersion: number;
    readonly ingredients: readonly { readonly ingredientId: string }[];
}

/** What a test sets on a {@link FoodGate}, and what it reads back. */
interface FoodGateState {
    /** Awaited before the next food API request is forwarded, then cleared. */
    beforeNext: (() => Promise<void>) | undefined;
    /** How many times a `beforeNext` ran. */
    fired: number;
}

/** A hop in front of the food fake that can hold one food API request until other work has finished. */
interface FoodGate extends FoodGateState {
    readonly origin: string;
    close(): Promise<void>;
}

/**
 * Start a gate that forwards every request to `upstream`, running {@link FoodGate.beforeNext} first when it is set.
 *
 * @param upstream - The food fake's origin.
 * @returns The running gate.
 * @sideEffect Opens an HTTP listener.
 */
async function startFoodGate(upstream: string): Promise<FoodGate> {
    const state: FoodGateState = { beforeNext: undefined, fired: 0 };

    const forward = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
            chunks.push(chunk as Buffer);
        }

        const hold = state.beforeNext;

        if (hold !== undefined && req.url?.startsWith('/api/') === true) {
            state.beforeNext = undefined;
            state.fired += 1;
            await hold();
        }

        const headers: Record<string, string> = {};

        for (const name of ['authorization', 'content-type']) {
            const value = req.headers[name];

            if (typeof value === 'string') {
                headers[name] = value;
            }
        }

        // Only a path is forwarded, and only to the fake's own origin.
        const target = new URL(req.url ?? '/', upstream);

        if (target.origin !== new URL(upstream).origin) {
            res.writeHead(400).end();

            return;
        }

        const answer = await fetch(target, {
            method: req.method ?? 'GET',
            headers,
            ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
        });

        res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' });
        res.end(Buffer.from(await answer.arrayBuffer()));
    };

    const server = createServer((req, res) => {
        forward(req, res).catch((error: unknown) => {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end(`food gate: ${String(error)}`);
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const { port } = server.address() as AddressInfo;

    return Object.assign(state, {
        origin: `http://127.0.0.1:${String(port)}`,
        close: async () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error === undefined ? resolve() : reject(error)));
            }),
    });
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let gate: FoodGate;
let brisketLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${booted.baseUrl}${path}`, {
        method,
        headers: { authorization: bearerFor(AUTHOR), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

/** A recipe whose one line holds the brisket and carries `phrase`, an imported phrase a correction could teach. */
async function brisketRecipe(phrase: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} braise`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [
            {
                ingredientId: brisketLookup,
                quantity: { kind: 'exact', value: 500 },
                unit: 'g',
                sourceLine: `500 g ${phrase}`,
                sourcePhrase: phrase,
            },
        ],
        steps: [{ instruction: 'Braise.' }],
    });
}

/** Rebind line 0 to the brisket it already holds. */
async function rebindToSameFood(recipeId: string, expectedVersion: number): Promise<Response> {
    return call('POST', `/api/v1/recipes/${recipeId}/ingredients/0/rebind`, {
        expectedVersion,
        target: { kind: 'catalogFood', foodId: BRISKET },
    });
}

/** Everything a recipe write changes: the version, the row's timestamp, the version rows and the line rows. */
async function storedState(recipeId: string): Promise<unknown> {
    const { rows } = await pool.query(
        `SELECT r.current_version,
                r.updated_at::text AS updated_at,
                (SELECT count(*)::int FROM recipe_versions v WHERE v.recipe_id = r.id) AS versions,
                (SELECT array_agg(i.id::text || ':' || i.food_lookup_id::text ORDER BY i.sort_order)
                   FROM ingredients i WHERE i.recipe_id = r.id) AS lines
           FROM recipes r WHERE r.id = $1`,
        [recipeId],
    );

    return rows[0];
}

/** The live corrections this cook holds for `phrase`. */
async function corrections(phrase: string): Promise<unknown[]> {
    const { rows } = await pool.query(
        `SELECT food_id FROM ingredient_resolution_mappings
          WHERE normalized_key = lower($1) AND user_id = $2 AND superseded_at IS NULL`,
        [phrase, AUTHOR],
    );

    return rows;
}

describe('a rebind that changes nothing (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(BRISKET, { name: 'Beef brisket', status: 'RESOLVED' });
        gate = await startFoodGate(food.origin);
        process.env['FOOD_SERVICE_URL'] = gate.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        brisketLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BRISKET }))
            .id;
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [AUTHOR]);
            await pool.query(`DELETE FROM ingredient_resolution_mappings WHERE user_id = $1`, [AUTHOR]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await gate?.close();
        await food?.close();
    });

    it('writes no version, line or correction for a current no-op, and answers the version sent', async () => {
        const phrase = `${SCOPE} current brisket`;
        const recipe = await brisketRecipe(phrase);
        const before = await storedState(recipe.id);

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as RecipeBody;

        expect(response.status).toBe(200);
        expect(body.currentVersion).toBe(recipe.currentVersion);
        expect(body.ingredients.map((line) => line.ingredientId)).toStrictEqual([brisketLookup]);
        expect(await storedState(recipe.id)).toStrictEqual(before);
        expect(await corrections(phrase)).toStrictEqual([]);
    });

    it('⛔ refuses a stale no-op with the enriched 409 — both conflict sides — and writes nothing', async () => {
        const phrase = `${SCOPE} stale brisket`;
        const recipe = await brisketRecipe(phrase);
        const edited = await json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            title: `${SCOPE} edited elsewhere`,
        });
        const before = await storedState(recipe.id);

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as { code: string; details: unknown };
        const details = versionConflictDetailsSchema.parse(body.details);

        expect(response.status).toBe(409);
        expect(body.code).toBe('VERSION_CONFLICT');
        expect({
            currentVersion: details.currentVersion,
            conflictingVersion: details.conflictingVersion,
            server: [details.server.versionNumber, details.server.snapshot.title],
            base: [details.base?.versionNumber, details.base?.snapshot.title],
        }).toStrictEqual({
            currentVersion: edited.currentVersion,
            conflictingVersion: recipe.currentVersion,
            server: [edited.currentVersion, edited.title],
            base: [recipe.currentVersion, recipe.title],
        });
        expect(await storedState(recipe.id)).toStrictEqual(before);
        expect(await corrections(phrase)).toStrictEqual([]);
    });

    it('⛔ answers the version sent when another writer commits mid-command; the next save meets the 409', async () => {
        const recipe = await brisketRecipe(`${SCOPE} raced brisket`);
        const otherTitle = `${SCOPE} the other writer`;
        let otherWrite: number | undefined;

        gate.beforeNext = async () => {
            otherWrite = (
                await call('PATCH', `/api/v1/recipes/${recipe.id}`, {
                    expectedVersion: recipe.currentVersion,
                    title: otherTitle,
                })
            ).status;
        };

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as RecipeBody;

        expect(gate.fired).toBe(1);
        expect(otherWrite).toBe(200);
        expect(response.status).toBe(200);
        expect(body.currentVersion).toBe(recipe.currentVersion);

        // The caller's next save, built on the version the command answered.
        const save = await call('PATCH', `/api/v1/recipes/${recipe.id}`, {
            expectedVersion: body.currentVersion,
            title: `${SCOPE} the cook's draft`,
        });

        expect(save.status).toBe(409);
        expect((await json<RecipeBody>('GET', `/api/v1/recipes/${recipe.id}`, 200)).title).toBe(otherTitle);
    });
});
