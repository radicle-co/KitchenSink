/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): the per-requester source budget through two booted food apps on one real
 * Postgres, over the REAL client and the REAL rate-limited transport, with USDA a loopback stub
 * (`support/usdaStubServer.ts`). Two apps stand in for two Fargate tasks: the per-minute caps live in each app's
 * memory, so only a budget held in the database can refuse on one task what the other spent.
 *
 * Rewritten onto the remote pick when plan 002 S7.9 deleted the live search, which charged the same budget. Each app is
 * given remote search settings, as a deployed task is, so it opens the references this suite seals; no case searches,
 * so the search origin is never dialled.
 *
 * A request is charged up front and given back the calls it did not make. So the suite reads the row after each
 * request: a call the transport admitted stays spent whatever the source answered, and a request that asked no source
 * (a missing food, a reference no key opens, a source the window has blocked) costs nothing once it has answered.
 *
 * Both apps connect as `food_app`, and the tokens are really signed and verified.
 *
 * | What the budget must do                                                   | Pinned here                                   |
 * | ------------------------------------------------------------------------- | --------------------------------------------- |
 * | refuse past the budget on every task and both routes, as the cook's limit | `429 REQUESTER_LIMIT_REACHED`, the window      |
 * | keep a call the source answered                                           | `200`, one call spent                          |
 * | keep a call the source failed or throttled                                | `503`, one call spent                          |
 * | refund a request that asked no source                                     | a `404`, a `409` and a blocked source: nothing |
 * | count per requester, and reopen when the hour ends                        | another cook admitted; a new window admits     |
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
    REQUESTER_SOURCE_BUDGET_PER_HOUR,
    REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
} from '../../src/common/throttle/throttle.config.js';
import { foodErrorSchema, MAX_RESOLVE_CANDIDATE_IDS } from '../../src/foods/foods.schema.js';
import { RemoteReferenceSealer } from '../../src/foods/remote/RemoteReferenceSealer.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';
import { bootFoodApp, callFoodApi, type FoodApiResponse } from './harness.js';

const APP_AZP = 'https://app.example.com';
const keypair = generateClerkKeypair();
const COOK = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const OTHER_COOK = '01J9ZK8N7QF3B2X4M6T0V5C1AC';
const cookToken = mintToken(keypair.privateKeyPem, { sub: 'user_budget_cook', externalId: COOK, azp: APP_AZP });
const otherToken = mintToken(keypair.privateKeyPem, { sub: 'user_budget_other', externalId: OTHER_COOK, azp: APP_AZP });

/** A food id no row carries, so a resolve answers `404` without calling a source. */
const MISSING_FOOD = '/api/v1/foods/01JCATA10GF00D000000000000';
const ADOPT = '/api/v1/foods/remote/adopt';

/** The reference key both apps open with, as unpadded base64url (`FOOD_REMOTE_REFERENCE_KEY`). */
const REFERENCE_KEY = randomBytes(32).toString('base64url');
const SEALER = new RemoteReferenceSealer(new Uint8Array(Buffer.from(REFERENCE_KEY, 'base64url')));
const { privateKey: SIGNING_KEY } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
/** The remote search settings both apps are given, set together as a deployed stage sets them, and unset after. */
const REMOTE_SEARCH_ENV: Readonly<Record<string, string>> = {
    REMOTE_SEARCH_ORIGIN: 'http://127.0.0.1:9',
    REMOTE_SEARCH_KEY_PAIR_ID: 'K2JCJMDEHXQW5F',
    REMOTE_SEARCH_SIGNING_KEY: SIGNING_KEY,
    FOOD_REMOTE_REFERENCE_KEY: REFERENCE_KEY,
};

/** `count` distinct candidate ids. */
function picks(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `01JCAND1DATE0000000000${String(index).padStart(4, '0')}`);
}

/**
 * The body that picks USDA item `externalKey`, sealed as the progressive search seals a hit.
 *
 * @param externalKey - The item, a USDA FDC id the stub answers.
 * @param sealer - The sealer; another key's makes a reference no app opens.
 * @returns The body.
 * @sideEffect Draws a random IV.
 */
async function pickOf(externalKey: string, sealer = SEALER): Promise<{ reference: string }> {
    return {
        reference: await sealer.seal({ source: 'usda', externalKey, lineageKey: null, name: `Kale ${externalKey}` }),
    };
}

describe('the source budget across two booted tasks (real Postgres, USDA stubbed)', () => {
    let first: BootedServiceApp;
    let second: BootedServiceApp;
    let pool: pg.Pool;
    let usda: UsdaStubServer;

    /**
     * What a requester has spent in their current window, or `undefined` when they have no row.
     *
     * @param requesterId - The requester.
     * @returns The spend.
     * @sideEffect Reads `requester_source_budget`.
     */
    async function spentBy(requesterId: string): Promise<number | undefined> {
        const result = await pool.query<{ spent: number }>(
            'SELECT spent FROM requester_source_budget WHERE requester_id = $1',
            [requesterId],
        );

        return result.rows[0]?.spent;
    }

    /**
     * The detail fetches of one item that reached the stub.
     *
     * @param externalKey - The item.
     * @returns How many.
     */
    function fetchesOf(externalKey: string): number {
        return usda.requests.filter((path) => path.endsWith(`/food/${externalKey}`)).length;
    }

    /**
     * Call a route on a task as the cook.
     *
     * @param task - The task.
     * @param method - The method.
     * @param path - The path.
     * @param body - The JSON body, when there is one.
     * @returns The answer.
     * @sideEffect One HTTP request.
     */
    async function asCook(
        task: BootedServiceApp,
        method: string,
        path: string,
        body?: unknown,
    ): Promise<FoodApiResponse> {
        return callFoodApi(
            task.baseUrl,
            method,
            path,
            body === undefined ? { token: cookToken } : { token: cookToken, body },
        );
    }

    beforeAll(async () => {
        usda = await startUsdaStubServer();
        // Not forced by the harness, so both apps' registries send their USDA calls to the stub.
        process.env['USDA_API_BASE_URL'] = usda.baseUrl;

        for (const [name, value] of Object.entries(REMOTE_SEARCH_ENV)) {
            process.env[name] = value;
        }

        const options = { clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] };

        first = await bootFoodApp(options);
        second = await bootFoodApp(options);
        pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 2 });
    });

    afterAll(async () => {
        await first?.close();
        await second?.close();
        await pool?.end();
        await usda?.close();
        delete process.env['USDA_API_BASE_URL'];

        for (const name of Object.keys(REMOTE_SEARCH_ENV)) {
            Reflect.deleteProperty(process.env, name);
        }
    });

    beforeEach(async () => {
        await foodDb().truncate();
        usda.mode = 'hits';
        usda.reset();
    });

    it('refuses a spent budget on both tasks and both routes as the cook’s own limit, per cook, until the hour ends', async () => {
        await pool.query(
            `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at)
             VALUES ($1, $2, now() + make_interval(secs => $3::int))`,
            [COOK, REQUESTER_SOURCE_BUDGET_PER_HOUR, REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS],
        );

        for (const refused of [
            await asCook(first, 'POST', ADOPT, await pickOf('900101')),
            await asCook(second, 'POST', ADOPT, await pickOf('900101')),
            await asCook(second, 'PATCH', MISSING_FOOD, { candidateIds: picks(1) }),
        ]) {
            const retryAfter = Number(refused.headers.get('retry-after'));

            expect(refused.status).toBe(429);
            expect(foodErrorSchema.parse(refused.body)).toMatchObject({
                code: 'REQUESTER_LIMIT_REACHED',
                details: { retryAfterSeconds: retryAfter },
            });
            expect(retryAfter).toBeGreaterThan(REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS - 120);
            expect(retryAfter).toBeLessThanOrEqual(REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS);
        }

        expect(usda.requests).toStrictEqual([]);
        expect(await spentBy(COOK)).toBe(REQUESTER_SOURCE_BUDGET_PER_HOUR);

        // Another cook's budget is untouched.
        expect(
            (await callFoodApi(second.baseUrl, 'POST', ADOPT, { token: otherToken, body: await pickOf('900101') }))
                .status,
        ).toBe(200);

        // The hour ends: the next call opens a new window on either task. A fresh item, because the other cook's pick
        // made 900101 held, and a pick of a held item asks no source.
        await pool.query(
            `UPDATE requester_source_budget SET window_ends_at = now() - interval '1 second' WHERE requester_id = $1`,
            [COOK],
        );

        expect((await asCook(first, 'POST', ADOPT, await pickOf('900102'))).status).toBe(200);
        expect(await spentBy(COOK)).toBe(1);
    });

    it('keeps the call a pick made when the source answered', async () => {
        const res = await asCook(first, 'POST', ADOPT, await pickOf('900103'));

        expect(res.status).toBe(200);
        expect(fetchesOf('900103')).toBe(1);
        expect(await spentBy(COOK)).toBe(1);
    });

    it('keeps the call a pick made when the source failed', async () => {
        usda.mode = 'server-error';

        const res = await asCook(first, 'POST', ADOPT, await pickOf('900104'));

        expect(res.status).toBe(503);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(fetchesOf('900104')).toBe(1);
        expect(await spentBy(COOK)).toBe(1);
    });

    // Both answers are a 503. Only the first asked the source; the block its 429 wrote refuses the second unasked.
    it('keeps a call the source throttled, and gives back the next pick, which the block refused unasked', async () => {
        usda.mode = 'throttled';

        const throttled = await asCook(first, 'POST', ADOPT, await pickOf('900105'));

        expect(throttled.status).toBe(503);
        expect(await spentBy(COOK)).toBe(1);

        const blocked = await asCook(second, 'POST', ADOPT, await pickOf('900105'));

        expect(blocked.status).toBe(503);
        expect(foodErrorSchema.parse(blocked.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(fetchesOf('900105')).toBe(1);
        expect(await spentBy(COOK)).toBe(1);
    });

    it('gives back every call of a request that asked no source: a missing food and a reference no key opens', async () => {
        const resolve = await asCook(first, 'PATCH', MISSING_FOOD, { candidateIds: picks(MAX_RESOLVE_CANDIDATE_IDS) });

        expect(resolve.status).toBe(404);
        expect(await spentBy(COOK)).toBe(0);

        const foreign = new RemoteReferenceSealer(new Uint8Array(randomBytes(32)));
        const gone = await asCook(second, 'POST', ADOPT, await pickOf('900106', foreign));

        expect(gone.status).toBe(409);
        expect(foodErrorSchema.parse(gone.body)).toMatchObject({ code: 'REMOTE_FOOD_GONE' });
        expect(await spentBy(COOK)).toBe(0);
        expect(usda.requests).toStrictEqual([]);
    });
});
