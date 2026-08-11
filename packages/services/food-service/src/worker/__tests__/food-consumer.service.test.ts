/**
 * Unit tests for {@link FoodConsumerService}'s lease-window pass-through (FR-018).
 *
 * The service used to resolve `deps.leaseSeconds ?? 30` and pass that literal on EVERY `leaseNext` /
 * `reapExpiredLeases` call, which overrode the queue DAO's own default. So even once
 * `FOOD_LEASE_TIMEOUT_SECONDS` had a consumer in the DAO, the only caller that matters in production — the
 * drainer — would still have ignored it. The knowledge belongs in ONE place (the DAO, next to the SQL that
 * expresses it); this service must impose nothing.
 *
 * The real {@link FetchQueueDao} is composed over a SQL-recording fake client, because the observable
 * consequence is which interval reaches Postgres — asserting "called with `undefined`" would pin the
 * mechanism rather than the outcome, and would still pass if the DAO's default were wrong.
 *
 * @implements FR-018
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FoodDrizzle } from '../../database/database.module.js';
import { FetchQueueDao } from '../../foods/dao/fetch-queue.dao.js';
import { FoodConsumerService, type FoodConsumerDeps } from '../food-consumer.service.js';
import { SilentWorkerLogger } from '../worker-logger.js';

const dialect = new PgDialect();

/** A fake Drizzle client recording the rendered SQL + params of every statement handed to it. */
function makeDb(): { db: FoodDrizzle; queries: { sql: string; params: unknown[] }[] } {
    const queries: { sql: string; params: unknown[] }[] = [];

    const execute = (query: SQL): Promise<{ rows: unknown[]; rowCount: number }> => {
        const { sql, params } = dialect.sqlToQuery(query);
        queries.push({ sql, params });

        return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return { db: { execute } as unknown as FoodDrizzle, queries };
}

/**
 * A consumer wired with the real queue DAO; every other collaborator is absent because `reapStaleLeases`
 * touches none of them.
 */
function makeConsumer(queue: FetchQueueDao, leaseSeconds?: number): FoodConsumerService {
    const deps = {
        foodDao: undefined,
        sources: undefined,
        queue,
        registry: undefined,
        limiter: undefined,
        merge: undefined,
        events: undefined,
        logger: new SilentWorkerLogger(),
        ...(leaseSeconds === undefined ? {} : { leaseSeconds }),
    } as unknown as FoodConsumerDeps;

    return new FoodConsumerService(deps);
}

describe('FoodConsumerService — the lease window it does NOT own (FR-018)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("reaps on the queue DAO's CONFIGURED window, imposing no literal of its own", async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '90');
        const { db, queries } = makeDb();

        await makeConsumer(new FetchQueueDao(db)).reapStaleLeases();

        expect(queries[0]?.params).toContain(90);
        expect(queries[0]?.params).not.toContain(30);
    });

    it('still honours an explicit deps.leaseSeconds (the seam a caller can use)', async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '90');
        const { db, queries } = makeDb();

        await makeConsumer(new FetchQueueDao(db), 15).reapStaleLeases();

        expect(queries[0]?.params).toContain(15);
        expect(queries[0]?.params).not.toContain(90);
    });
});
