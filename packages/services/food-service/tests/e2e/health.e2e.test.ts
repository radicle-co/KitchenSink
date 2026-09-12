import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { CONTRACT_HASH } from '../../src/contract/contractHash.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';

/**
 * Foundation E2E for the food service (T-064). Proves the LocalStack + Docker-Postgres harness
 * end to end at the level food-service exercises TODAY:
 *
 *   1. Runs against a REAL Postgres, migrated once per run by the tier's `globalSetup` with the service's
 *      own production runner, and reached as `food_app` — the role a deployed task holds (ADR-0039).
 *   2. Boots the REAL Nest app (`NestFactory.create(AppModule)`) on an ephemeral port and asserts
 *      `GET /health` returns the live `{ status: 'ok', service: 'food', contractHash }` body over HTTP —
 *      including the drift-layer-3 skew signal every consumer compares against (§15.2.5).
 *   3. Asserts the harness DB is reachable end to end: the migrated `foods` table exists and accepts
 *      a row, via a direct `pg` query on the same connection the app is configured with.
 *
 * food-service has no `@aws-sdk/*` runtime deps yet, so this suite does NOT touch LocalStack — the
 * AWS-service E2E flows land with Phases 2/3 (see the TODOs below). The LocalStack container is wired
 * in the compose + CI now so those plug straight in.
 *
 * Requires a reachable Postgres. Point `DATABASE_ADMIN_URL` at a throwaway local server, e.g.
 *   DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
 * Skips cleanly when it is not configured. The Nest app also needs `USDA_API_KEY` (any non-empty
 * value) for env validation; the suite sets a dummy one if absent — no real USDA call is made.
 */

describe.skipIf(!hasTestDatabase)('food-service E2E (booted app + Docker Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    beforeAll(async () => {
        // 1. Empty the harness DB. The SCHEMA is built once per run by `tests/e2e/globalSetup.ts`, with
        //    the runner a stage uses; emptying data is all a suite needs, and it runs as the OWNER because
        //    the service role has no TRUNCATE.
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        await foodE2eDb().truncate();

        // 2. Boot the real Nest app against the same Postgres. The config module validates env at
        //    module-evaluation time (NestJS `ConfigModule.forRoot` runs synchronously when the module
        //    is imported), so the env MUST be set BEFORE `AppModule` is imported — hence the dynamic
        //    import here rather than a static top-of-file import. Env validation requires USDA_API_KEY;
        //    no USDA call is made by the /health + DB path, so a dummy value is sufficient.
        foodE2eDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = process.env['USDA_API_KEY'] ?? 'e2e-dummy-key';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        // Ephemeral port — no fixed-port collisions across parallel CI jobs.
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    it('serves GET /health with 200 and the live health body, carrying the contract fingerprint', async () => {
        const response = await fetch(`${baseUrl}/health`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            status: 'ok',
            service: 'food',
            contractHash: CONTRACT_HASH,
        });
    });

    // Drift layer 3 (§15.2.5) end to end: the fingerprint a CLIENT compares against is only usable if it
    // survives the real HTTP round-trip on the UNAUTHENTICATED route. A consumer checking for skew has to be
    // able to ask before it holds a credential, so this probe deliberately sends no `Authorization`.
    it('publishes the contract fingerprint on the unauthenticated readiness probe too', async () => {
        const response = await fetch(`${baseUrl}/health/ready`);
        expect(response.status).toBe(200);
        expect(((await response.json()) as { contractHash?: unknown }).contractHash).toBe(CONTRACT_HASH);
    });

    it('proves the harness DB is reachable end to end: the migrated food table accepts a row', async () => {
        // The source-agnostic migration created `food` (internal id PK); a direct insert/read confirms
        // the booted-app DB works.
        await pool.query(`DELETE FROM food WHERE id = 'e2e-health-probe'`);
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ('e2e-health-probe', 'probe', 'probe', 'PENDING')`,
        );

        const { rows } = await pool.query<{ status: string }>(`SELECT status FROM food WHERE id = 'e2e-health-probe'`);
        expect(rows[0]?.status).toBe('PENDING');

        await pool.query(`DELETE FROM food WHERE id = 'e2e-health-probe'`);
    });

    // TODO(Phase 2, T-061/T-063): E2E `GET /api/v1/foods/:id` — cache-hit 200 (no USDA call),
    //   cache-miss → 202 + a `fetch_queue` row, then the worker drains and a re-request returns 200,
    //   plus concurrent same-fdcId dedup and batch partial-success, all through the booted HTTP API.
    // TODO(Phase 3, T-023): assert the fetch-completion fan-out lands on EventBridge via LocalStack
    //   (`events` is provisioned in infra/localstack/docker-compose.yml; Community tier, no token).
});
