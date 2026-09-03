/**
 * Real USDA→canonical HTTP-contract e2e (T-121 / MOD-008, FR-023/FR-024/FR-ADP-2). Unlike
 * `foodServiceClient.e2e.test.ts` (which `vi.mock`s the whole `UsdaSourceAdapter` with a
 * programmable stub), this suite exercises the REAL `UsdaApiClient` + REAL
 * `UsdaSourceAdapter` against CAPTURED real USDA wire payloads, intercepted at the HTTP
 * transport with undici's {@link MockAgent}. The genuine client's request hits the mock — the actual
 * status→typed-error mapping, nested-nutrient flattening, per-serving label reconciliation,
 * `fdcId → externalKey` mapping, batch path, and merge→persist all run for real. Loopback (`127.0.0.1`)
 * is re-enabled so the booted Nest app is still reachable by the client while every USDA origin call is
 * intercepted.
 *
 * ⛔ **`setGlobalDispatcher` ALONE DOES NOT INTERCEPT NODE'S BUILT-IN `fetch` — the suite installs undici's
 * own `fetch` as the global, and that line is load-bearing** (repaired 2026-09-03). This file's premise used
 * to be "Node's global `fetch` routes through the global dispatcher", which held under undici 6 and stopped
 * holding at the `^6.27.0 → ^8.10.0` bump (`a3254d42`). Under undici 8 the dispatcher is stored wrapped in a
 * `Dispatcher1Wrapper` for legacy readers, and Node's built-in `fetch` reaches the `MockAgent` through it with
 * `allowH2: false` — which makes undici 8's inner `Agent` key its client map `"<origin>#http1-only"`
 * (`lib/dispatcher/agent.js`) while `MockAgent.get(origin)` registered the `MockPool` under the bare origin.
 * The lookup misses, a REAL `Pool` is created beside the `MockPool`, and the request leaves the process.
 * `disableNetConnect()` cannot save it: that check lives inside the `MockPool` that was never consulted.
 * Measured symptom — every case answered by the LIVE `api.nal.usda.gov` with `403 API_KEY_INVALID`, i.e. this
 * "hermetic" suite had been making unauthenticated calls to a third-party API from CI.
 *
 * ⛔ Do NOT "fix" this by registering the interceptor under `"<origin>#http1-only"`. Beyond being an
 * undici-internal key format, `MockAgent` SHARES the inner `Agent`'s client map (`lib/mock/mock-agent.js`:
 * `this[kClients] = agent[kClients]`), so that repair would rest on two internals continuing to agree with
 * each other rather than one. Do NOT reach for `undici.install()` either — it swaps ten globals (`Response`,
 * `Headers`, `Request`, …) and ships no `uninstall` (verified: `undici.uninstall === undefined`). Swapping the
 * ONE global the transport actually goes through is reversible and is what {@link afterAll} undoes.
 *
 * ⛔ Do NOT thread `fetchFn` through `createUsdaSourceRegistry` instead. The seam already exists on
 * `UsdaApiClientOptions` and the unit suite uses it — but injecting it here would fix ONE client and leave
 * every other component in the process on the built-in `fetch`, which is precisely what stops
 * `disableNetConnect()` being a process-wide guarantee and makes the hermeticity probe below impossible to
 * write. The global swap is what makes `disableNetConnect()` mean what this file has always claimed.
 *
 * ⚠️ CONSIDERED, NOT CHOSEN — pointing `USDA_API_BASE_URL` at a loopback fixture server. It is a real option
 * (the setting is production, boot-validated, and its own docstring anticipates a stub base URL), it needs no
 * global mutation, and it would keep the built-in `fetch`. Rejected because it loses the body/query predicates
 * below, which would have to be re-implemented, and costs a real HTTP server per run. Recorded so the next
 * person hitting an undici bump inherits the adjudication instead of rediscovering it.
 *
 * ⚠️ NOT `msw`, though the repo uses it in `identity-webhooks`. `MockAgent` IS the library here — the defect
 * was a wiring bug between two undici copies, not a reinvention — and msw's own `FetchInterceptor` reaches
 * Node `fetch` by assigning `globalThis.fetch`, the SAME technique, so a port packages the mechanism rather
 * than replacing it. It would also answer the request before undici is involved at all, losing the real
 * dispatcher stack (header normalization and body SERIALIZATION — which is exactly what the two POST-body
 * predicates below prove the client got right). FLIP CONDITIONS, either one: food-service acquires a SECOND
 * HTTP-interception site, or an undici bump breaks `MockAgent` again (turning one pinned internal from a
 * fixed cost into a recurring one).
 *
 * ⚠️ LIMIT OF THIS SUITE: swapping in the standalone `undici` build means these cases exercise a PINNED
 * sibling transport, while production runs Node's own bundled undici (`usdaRegistry.ts` passes no `fetchFn`).
 * Same library, same era, but not byte-identical — so a defect that lives only in Node's copy would not be
 * caught here.
 *
 * ⛔ {@link installTransportInterception} must run BEFORE the Nest boot: `UsdaApiClient` captures
 * `options.fetchFn ?? fetch` at CONSTRUCTION, so a client composed first would hold the built-in `fetch`
 * forever and no later swap would reach it.
 *
 * Cases:
 *   1. add-by-name "cheddar cheese" (real search → real batch detail) → drain → RESOLVED → assert the
 *      PERSISTED golden record reflects the real branded mapping (kind/barcode/brand + per-100g Protein).
 *   2. Foundation detail through the real adapter → all per-100g, ≥1 portion, generic, no brand/barcode.
 *   3. Real batch `POST /foods` (`fetchByKeys`) → two canonical candidates with the right keys/kinds.
 *   4. Error classification: a 404 detail → SourceApiError(404) (worker → NOT_FOUND).
 *   4b. Error classification: a 429 detail → SourceApiError(429) (the back-off/window-full path).
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import pg from 'pg';
import { MockAgent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { InMemoryPublisher } from '@kitchensink/messaging';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao, FoodDao, FoodSourcesDao } from '../../src/foods/dao/index.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { isSourceApiError } from '../../src/sources/foodSource.errors.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import type { WorkerLogger } from '../../src/worker/workerLogger.js';
import { resetSchema } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/usda');

const USDA_ORIGIN = 'https://api.nal.usda.gov';
/** undici's stable identifier for "the mock refused this request" (`lib/mock/mock-errors.js`). */
const MOCK_NOT_MATCHED_CODE = 'UND_MOCK_ERR_MOCK_NOT_MATCHED';
const APP_AZP = 'https://app.example.com';

/** The captured branded (2057648), foundation (1750340), and ghost fdcIds this suite routes on. */
const BRANDED_FDC_ID = 2057648;
const FOUNDATION_FDC_ID = 1750340;
const GHOST_FDC_ID = 404404;

const keypair = generateClerkKeypair();
// CR-002/U1: the user token carries its app-user ULID as `external_id` (THE requester key).
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_usda_e2e',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});

const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

/**
 * Read and parse a captured USDA wire fixture.
 *
 * @param name - The fixture filename under `__fixtures__/usda/`.
 * @returns The parsed JSON payload (object or array), ready for a MockAgent JSON reply.
 * @sideEffect Reads from the filesystem.
 */
function loadFixture(name: string): object {
    return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8')) as object;
}

/**
 * Parse the `fdcIds` array from a `POST /v1/foods` request body.
 *
 * @param body - The raw request body string.
 * @returns The requested fdcIds.
 */
function fdcIdsOf(body: string): number[] {
    return (JSON.parse(body) as { fdcIds: number[] }).fdcIds;
}

describe.skipIf(!DATABASE_URL)('real UsdaApiClient + UsdaSourceAdapter over undici MockAgent (e2e)', () => {
    /** The shared capturing adapter (plan U4) — replaces this suite's hand-rolled bus double. */
    const captureBus = new InMemoryPublisher();
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;
    let registry: SourceAdapterRegistry;
    let client: FoodServiceClient;
    let previousDispatcher: Dispatcher;
    let previousFetch: typeof globalThis.fetch;
    let agent: MockAgent;

    /**
     * Route every `fetch` in this process through `agent`, and PROVE it took effect.
     *
     * The proof is the point. Interception failing OPEN — the mock silently bypassed, real traffic leaving the
     * process — is the exact failure this suite shipped for weeks, and it was invisible because a bypassed
     * `MockAgent` reports itself as the global dispatcher and `disableNetConnect()` returns without complaint.
     * So this probes the intercepted origin at a path it deliberately does NOT register.
     *
     * ⚠️ What this proves is narrower than it looks, and the narrow claim is the true one: it proves the
     * global `fetch` reaches a net-connect-disabled `MockAgent`. It does NOT prove the USDA interceptors below
     * were registered — measured, a wholly UNKNOWN origin answers with the same error — and it is not trying to;
     * a missing interceptor already fails its own case loudly. The silent failure is the transport, so that is
     * what is asserted.
     *
     * ⚠️ The predicate is the rejection's `cause`, NOT merely "it rejected", and that is deliberate: an OFFLINE
     * runner rejects a real request too, so "rejected" alone would report green in exactly the environment that
     * can least afford it. With interception in force, undici answers `MockNotMatchedError` for ANY unmatched
     * request — measured, including for a host that does not resolve — so only that cause proves the mock, not
     * the network, refused it. It is matched on `code` (`UND_MOCK_ERR_MOCK_NOT_MATCHED`, undici's stable
     * identifier, `lib/mock/mock-errors.js`) rather than on the class NAME, which is not part of its contract.
     *
     * @throws {Error} naming the bypass when the probe resolves, or rejects for any reason but a mock miss.
     * @sideEffect Replaces `globalThis.fetch` and the undici global dispatcher; issues one probe request.
     */
    async function installTransportInterception(): Promise<void> {
        setGlobalDispatcher(agent);
        // The cast is REQUIRED, not laziness: undici's `fetch` is typed over undici's own `Request`, which lacks
        // `duplex`/`textStream` from Node's lib.dom `Request`, so the two signatures are not assignable
        // (`TS2322`). Nothing here passes a `Request` — every caller passes a URL string and reads
        // `status`/`json()`/`text()`, which the two implementations agree on.
        globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch;

        const outcome = await fetch(`${USDA_ORIGIN}/__interception_guard__`).then(
            (response) => `resolved with ${response.status}`,
            (error: { cause?: { code?: string; name?: string } }) =>
                error.cause?.code === MOCK_NOT_MATCHED_CODE ? null : `rejected via ${error.cause?.name ?? 'unknown'}`,
        );

        if (outcome !== null) {
            throw new Error(
                `undici MockAgent interception is NOT in force: a non-intercepted USDA path ${outcome} instead ` +
                    `of ${MOCK_NOT_MATCHED_CODE}. This suite would be calling the LIVE USDA API. See this file's ` +
                    `header — the transport swap is what makes setGlobalDispatcher reach fetch.`,
            );
        }
    }

    /** Drain the queue until the food reaches a terminal status (deterministic stand-in for backoff). */
    async function drainUntilTerminal(id: string): Promise<string> {
        const terminal = new Set(['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED']);

        for (let pass = 0; pass < 12; pass += 1) {
            await consumer.drain();
            const rows = await pool.query<{ status: string }>('SELECT status FROM food WHERE id = $1', [id]);
            const status = rows.rows[0]?.status;

            if (status === undefined || terminal.has(status)) {
                return status ?? 'MISSING';
            }

            await pool.query(
                `UPDATE fetch_queue SET status='pending', leased_at=NULL, last_requested=now() WHERE food_id=$1`,
                [id],
            );
        }

        return 'TIMEOUT';
    }

    beforeAll(async () => {
        // ── undici transport interception ─────────────────────────────────────────────────────────
        // Intercept every USDA origin call; re-allow loopback so the booted Nest app stays reachable
        // (the food-service client's fetch also rides the global dispatcher).
        previousDispatcher = getGlobalDispatcher();
        previousFetch = globalThis.fetch;
        agent = new MockAgent();
        agent.disableNetConnect();
        // Exact host match (port stripped) so `disableNetConnect()` stays a hard guarantee — a substring
        // test would also let through hosts that merely *contain* the loopback names (e.g. `127.0.0.1.evil.com`).
        agent.enableNetConnect((host) => {
            const hostname = host.replace(/:\d+$/, '');

            return hostname === '127.0.0.1' || hostname === 'localhost';
        });

        const usda = agent.get(USDA_ORIGIN);

        // GET /food/{fdcId} — real captured details, plus deterministic 404/429 keys for classification.
        usda.intercept({ path: (p) => p.startsWith(`/fdc/v1/food/${FOUNDATION_FDC_ID}`), method: 'GET' })
            .reply(200, loadFixture('food-1750340-foundation.json'))
            .persist();
        usda.intercept({ path: (p) => p.startsWith(`/fdc/v1/food/${BRANDED_FDC_ID}`), method: 'GET' })
            .reply(200, loadFixture('food-2057648-branded.json'))
            .persist();
        usda.intercept({ path: (p) => p.startsWith('/fdc/v1/food/404404'), method: 'GET' })
            .reply(404, { error: 'not found' })
            .persist();
        usda.intercept({ path: (p) => p.startsWith('/fdc/v1/food/429429'), method: 'GET' })
            .reply(429, { error: 'rate limited' })
            .persist();

        // GET /foods/search — one branded hit by default; a "ghost" query yields a hit that 404s on fetch.
        usda.intercept({ path: (p) => p.startsWith('/fdc/v1/foods/search'), method: 'GET' })
            .reply(200, (opts) => {
                const query = (new URL(`${USDA_ORIGIN}${opts.path}`).searchParams.get('query') ?? '').toLowerCase();

                if (query.includes('ghost')) {
                    return {
                        totalHits: 1,
                        foods: [{ fdcId: GHOST_FDC_ID, description: 'GHOST FOOD', dataType: 'Branded' }],
                    };
                }

                return loadFixture('search-single-branded.json');
            })
            .persist();

        // POST /foods (batch) — routed by the requested fdcIds so one route serves each case unambiguously.
        usda.intercept({
            path: (p) => p.startsWith('/fdc/v1/foods?'),
            method: 'POST',
            body: (b) => fdcIdsOf(b).includes(GHOST_FDC_ID),
        })
            .reply(404, { error: 'not found' })
            .persist();
        usda.intercept({
            path: (p) => p.startsWith('/fdc/v1/foods?'),
            method: 'POST',
            body: (b) => fdcIdsOf(b).includes(FOUNDATION_FDC_ID) && fdcIdsOf(b).includes(BRANDED_FDC_ID),
        })
            .reply(200, loadFixture('foods-batch.json'))
            .persist();
        usda.intercept({
            path: (p) => p.startsWith('/fdc/v1/foods?'),
            method: 'POST',
            body: (b) => fdcIdsOf(b).includes(BRANDED_FDC_ID) && !fdcIdsOf(b).includes(FOUNDATION_FDC_ID),
        })
            .reply(200, [loadFixture('food-2057648-branded.json')])
            .persist();

        // Arm the transport ONLY once every interceptor is registered — the guard inside probes a
        // non-intercepted path on an origin the agent must already know, and it must precede the Nest boot
        // (`UsdaApiClient` captures the global `fetch` at construction).
        await installTransportInterception();

        // ── real DB migration + Nest boot (same hermetic stack as the other food-service e2es) ──────
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await resetSchema(pool);

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'e2e-usda-key';
        process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = '100000';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = APP_AZP;
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '25';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        registry = app.get(SourceAdapterRegistry, { strict: false });
        consumer = new FoodConsumerService({
            foodDao: app.get(FoodDao, { strict: false }),
            sources: app.get(FoodSourcesDao, { strict: false }),
            queue: new FetchQueueDao(app.get<FoodDrizzle>(DrizzleProvider, { strict: false })),
            registry,
            limiter: app.get(RollingWindowLimiter, { strict: false }),
            merge: app.get(MergeAndPersistService, { strict: false }),
            events: new FoodEventEmitter(captureBus),
            logger: silentLogger,
        });

        client = new FoodServiceClient({ baseUrl, token: userToken });
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
        // Both globals this suite swapped go back, in reverse order of installation.
        globalThis.fetch = previousFetch;
        setGlobalDispatcher(previousDispatcher);
        await agent?.close();
    });

    beforeEach(async () => {
        await pool.query(`
            TRUNCATE food, food_sources, nutrient, food_nutrients, food_portions, food_field_provenance,
                     food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
                     source_call_log, source_sync_metadata RESTART IDENTITY CASCADE
        `);
    });

    it('case 1: real search+batch → RESOLVED → persists the real branded golden record', async () => {
        const add = await client.addByName('cheddar cheese');
        expect(add.status).toBe('PENDING');

        expect(await drainUntilTerminal(add.id)).toBe('RESOLVED');

        // Golden scalars reflect the REAL branded payload (kind/barcode/brand owner).
        const foodRow = await pool.query<{ kind: string; barcode: string | null; brand_owner: string | null }>(
            'SELECT kind, barcode, brand_owner FROM food WHERE id = $1',
            [add.id],
        );
        expect(foodRow.rows[0]?.kind).toBe('branded');
        expect(foodRow.rows[0]?.barcode).toBe('094395000172');
        expect(foodRow.rows[0]?.brand_owner).toBe('Grafton Village Cheese Co, LLC');

        // Protein — the exact string the REAL adapter produced end-to-end (per-100g `foodNutrients`
        // value 21.43 is PREFERRED over the per-serving label panel, which is skipped to avoid a
        // double count — so the persisted golden value is the source per-100g figure, not a conversion).
        const protein = await pool.query<{ amount: string; basis: string }>(
            `SELECT fn.amount, fn.basis
               FROM food_nutrients fn
               JOIN nutrient n ON n.id = fn.nutrient_id
              WHERE fn.food_id = $1 AND n.name = 'Protein'`,
            [add.id],
        );
        expect(protein.rows[0]?.basis).toBe('per_100g');
        expect(protein.rows[0]?.amount).toBe('21.43');

        const count = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM food_nutrients WHERE food_id = $1',
            [add.id],
        );
        expect(count.rows[0]?.n).toBe(15);

        // The canonical API never leaks the source-native key (FR-IDN-2).
        const got = await client.getById(add.id);
        expect(got.status).toBe('RESOLVED');
        expect(JSON.stringify(got)).not.toContain('fdcId');
    });

    it('case 2: Foundation detail maps to generic, all per-100g, ≥1 portion, no brand/barcode', async () => {
        const candidate = await registry.adapterFor('usda').fetchByKey(String(FOUNDATION_FDC_ID));

        expect(candidate.externalKey).toBe('1750340');
        expect(candidate.kind).toBe('generic');
        expect(candidate.brandOwner).toBeNull();
        expect(candidate.barcode).toBeNull();
        expect(candidate.nutrients.length).toBeGreaterThan(0);
        expect(candidate.nutrients.every((nutrient) => nutrient.basis === 'per_100g')).toBe(true);
        expect(candidate.portions.length).toBeGreaterThanOrEqual(1);
        expect(candidate.portions[0]).toEqual({ label: 'RACC', gramWeight: '140' });
    });

    it('case 3: batch POST /foods (fetchByKeys) → two canonical candidates with the right keys/kinds', async () => {
        const batch = registry.adapterFor('usda').fetchByKeys?.bind(registry.adapterFor('usda'));

        if (!batch) {
            throw new Error('the USDA adapter must expose the batch fetchByKeys path (FR-023)');
        }

        const candidates = await batch(['1750340', '2057648']);
        const byKey = new Map(candidates.map((candidate) => [candidate.externalKey, candidate]));

        expect(candidates).toHaveLength(2);
        expect(byKey.get('1750340')?.kind).toBe('generic');
        expect(byKey.get('2057648')?.kind).toBe('branded');
        expect(byKey.get('2057648')?.barcode).toBe('094395000172');
    });

    it('case 4: a 404 detail classifies as SourceApiError(404) and drives the worker to NOT_FOUND', async () => {
        const notFound = await registry
            .adapterFor('usda')
            .fetchByKey('404404')
            .catch((error: unknown) => error);
        expect(isSourceApiError(notFound)).toBe(true);
        expect((notFound as { statusCode: number }).statusCode).toBe(404);

        // End-to-end: a hit whose batch fetch 404s contributes nothing → NOT_FOUND tombstone (no failure).
        const add = await client.addByName('ghost cheese');
        expect(await drainUntilTerminal(add.id)).toBe('NOT_FOUND');
    });

    it('case 4b: a 429 detail classifies as SourceApiError(429) (the back-off/window-full path)', async () => {
        const rateLimited = await registry
            .adapterFor('usda')
            .fetchByKey('429429')
            .catch((error: unknown) => error);

        expect(isSourceApiError(rateLimited)).toBe(true);
        expect((rateLimited as { statusCode: number }).statusCode).toBe(429);
    });
});
