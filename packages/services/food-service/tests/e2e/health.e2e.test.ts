import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { resetSchema } from '../support/db.js';

/**
 * Foundation E2E for the food service (T-064). Proves the LocalStack + Docker-Postgres harness
 * end to end at the level food-service exercises TODAY:
 *
 *   1. Applies the Phase-1 ordered migration (`src/db/migrations/0000_food_schema.sql`) to a REAL
 *      Postgres (the `infra/localstack/docker-compose.yml` `postgres` service, or any `DATABASE_URL`).
 *   2. Boots the REAL Nest app (`NestFactory.create(AppModule)`) on an ephemeral port and asserts
 *      `GET /health` returns the live `{ status: 'ok', service: 'food' }` body over HTTP.
 *   3. Asserts the harness DB is reachable end to end: the migrated `foods` table exists and accepts
 *      a row, via a direct `pg` query against the same `DATABASE_URL` the app is configured with.
 *
 * food-service has no `@aws-sdk/*` runtime deps yet, so this suite does NOT touch LocalStack — the
 * AWS-service E2E flows land with Phases 2/3 (see the TODOs below). The LocalStack container is wired
 * in the compose + CI now so those plug straight in.
 *
 * Requires a reachable Postgres. Set `DATABASE_URL` (or `TEST_DATABASE_URL`) to the harness DB, e.g.
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_e2e
 * Skips cleanly when neither is configured. The Nest app also needs `USDA_API_KEY` (any non-empty
 * value) for env validation; the suite sets a dummy one if absent — no real USDA call is made.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/**
 * Reset to a blank schema and apply the ordered migration SQL. The SQL is not idempotent (bare
 * CREATE TABLE), so it must run against a clean schema — matches `tests/schema.integration.test.ts`.
 *
 * @sideEffect Drops and recreates `public`, then runs the migration against `pool`.
 */
async function applyMigration(pool: pg.Pool): Promise<void> {
    await resetSchema(pool);
}

describe.skipIf(!DATABASE_URL)('food-service E2E (booted app + Docker Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    beforeAll(async () => {
        // 1. Migrate the real harness DB.
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await applyMigration(pool);

        // 2. Boot the real Nest app against the same Postgres. The config module validates env at
        //    module-evaluation time (NestJS `ConfigModule.forRoot` runs synchronously when the module
        //    is imported), so the env MUST be set BEFORE `AppModule` is imported — hence the dynamic
        //    import here rather than a static top-of-file import. Env validation requires USDA_API_KEY;
        //    no USDA call is made by the /health + DB path, so a dummy value is sufficient.
        process.env['DATABASE_URL'] = DATABASE_URL;
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

    it('serves GET /health with 200 and the live health body', async () => {
        const response = await fetch(`${baseUrl}/health`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'food' });
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
