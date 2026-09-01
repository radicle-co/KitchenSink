/**
 * Analytics plan U3 — `AnalyticsService.capture`: the fire-and-forget server-door writer.
 *
 * The property under test is ISOLATION (origin R7/SC4): a failed, slow, or saturated analytics write
 * must never throw into, block, or slow a user-facing action. `capture` is synchronous-void by
 * construction; these tests force every failure shape the DB path has — rejection, saturation, even a
 * synchronous throw — and assert nothing escapes. The shed policy (KTD4) is per-instance and two-tier:
 * client-door families (`query_outcome`) shed FIRST at the lower threshold; server-door families
 * (`recipe_saved`/`recipe_viewed`, the ones feeding 015's credit) shed only at the hard cap. Drops are
 * COUNTED and flushed as one aggregated line — never one log per drop, which storms during the exact
 * saturation the cap exists for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import {
    AnalyticsService,
    ANALYTICS_HARD_CAP,
    ANALYTICS_CLIENT_SHED_AT,
    ANALYTICS_DROP_FLUSH_INTERVAL_MS,
} from '../analytics.service.js';
import type { RecipeDrizzle } from '../../database/client.js';

const OWNER = '01JU3ANALYTICSCAPTUREUSER0';
const RECIPE = '77777777-7777-4777-8777-000000000c01';

/** Render a captured drizzle SQL to text + params, the erasure-worker harness technique. */
const dialect = new PgDialect();

const render = (statement: SQL): { text: string; params: unknown[] } => {
    const query = dialect.sqlToQuery(statement);

    return { text: query.sql.replace(/\s+/g, ' ').trim(), params: query.params };
};

interface FakeDb {
    readonly db: RecipeDrizzle;
    readonly statements: () => { text: string; params: unknown[] }[];
    /** Make the next `execute` calls return promises that stay PENDING until `release()`. */
    readonly holdOpen: () => void;
    readonly release: () => void;
    readonly rejectWith: (error: unknown) => void;
    /** Let every in-flight microtask settle. */
    readonly settle: () => Promise<void>;
}

function createFakeDb(): FakeDb {
    const captured: SQL[] = [];
    let mode: 'resolve' | 'hold' | 'reject' = 'resolve';
    let rejection: unknown;
    let pendingResolvers: (() => void)[] = [];

    const execute = (statement: SQL): Promise<{ rows: unknown[] }> => {
        captured.push(statement);

        if (mode === 'reject') {
            return Promise.reject(rejection);
        }

        if (mode === 'hold') {
            return new Promise((resolve) => {
                pendingResolvers.push(() => {
                    resolve({ rows: [] });
                });
            });
        }

        return Promise.resolve({ rows: [] });
    };

    return {
        db: { execute } as unknown as RecipeDrizzle,
        statements: () => captured.map(render),
        holdOpen: () => {
            mode = 'hold';
        },
        release: () => {
            for (const resolve of pendingResolvers) {
                resolve();
            }

            pendingResolvers = [];
            mode = 'resolve';
        },
        rejectWith: (error: unknown) => {
            mode = 'reject';
            rejection = error;
        },
        settle: async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        },
    };
}

describe('AnalyticsService.capture (U3 — fire-and-forget, two-tier shed)', () => {
    let fake: FakeDb;
    let service: AnalyticsService;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fake = createFakeDb();
        service = new AnalyticsService(fake.db);
        warn = vi.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            'warn',
        ) as unknown as ReturnType<typeof vi.spyOn>;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('returns void synchronously — the caller never awaits analytics', async () => {
        const result = service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });

        expect(result).toBeUndefined();
        await fake.settle();
    });

    it('inserts the server-door row shape: type, actor, subject, server-stamped occurred_at, NO event_id', async () => {
        service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        await fake.settle();

        const statements = fake.statements();

        expect(statements).toHaveLength(1);
        const insert = statements[0];

        if (insert === undefined) {
            throw new Error('unreachable: length asserted above');
        }

        expect(insert.text).toMatch(/^insert into analytics_events/i);
        expect(insert.params).toContain('recipe_saved');
        expect(insert.params).toContain(OWNER);
        expect(insert.params).toContain(RECIPE);
        // Server-door rows carry NO client idempotency key and need no ON CONFLICT arbiter.
        expect(insert.text).not.toMatch(/on conflict/i);
    });

    it('a rejected insert is swallowed and warned — never thrown to the caller', async () => {
        fake.rejectWith(new Error('connection refused'));

        expect(() => {
            service.capture({ type: 'recipe_viewed', userId: OWNER, recipeId: RECIPE });
        }).not.toThrow();
        await fake.settle();

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a SYNCHRONOUS throw from the db layer is swallowed too', async () => {
        // `insert` is `async`, so a sync throw becomes a rejection the chain contains structurally —
        // the observable contract is "capture never throws, and the failure is warned", not when.
        const broken = {
            execute: () => {
                throw new Error('sync explosion');
            },
        } as unknown as RecipeDrizzle;
        const brokenService = new AnalyticsService(broken);
        const brokenWarn = vi.spyOn(
            (brokenService as unknown as { logger: { warn: (message: string) => void } }).logger,
            'warn',
        );

        expect(() => {
            brokenService.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        }).not.toThrow();
        await fake.settle();

        expect(brokenWarn).toHaveBeenCalledTimes(1);
    });

    it('sheds CLIENT-DOOR events at the lower threshold while server-door events still land (KTD4)', async () => {
        fake.holdOpen();

        // Saturate up to (but not past) the client shed threshold with server-door captures.
        for (let index = 0; index < ANALYTICS_CLIENT_SHED_AT; index += 1) {
            service.capture({ type: 'recipe_viewed', userId: OWNER, recipeId: RECIPE });
        }

        const beforeClientDrop = fake.statements().length;
        service.capture({ type: 'query_outcome', userId: OWNER, queryText: 'salt', eventId: crypto.randomUUID() });
        // The client-door event was SHED — no new statement.
        expect(fake.statements()).toHaveLength(beforeClientDrop);

        // A server-door event still lands: the families feeding credit shed LAST.
        service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        expect(fake.statements()).toHaveLength(beforeClientDrop + 1);

        fake.release();
        await fake.settle();
    });

    it('sheds EVERYTHING at the hard cap', async () => {
        fake.holdOpen();

        for (let index = 0; index < ANALYTICS_HARD_CAP; index += 1) {
            service.capture({ type: 'recipe_viewed', userId: OWNER, recipeId: RECIPE });
        }

        const saturated = fake.statements().length;
        service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        expect(fake.statements()).toHaveLength(saturated);

        fake.release();
        await fake.settle();
    });

    it('counts drops and flushes ONE aggregated line per interval — never a line per drop', async () => {
        vi.useFakeTimers();
        fake.holdOpen();

        for (let index = 0; index < ANALYTICS_HARD_CAP; index += 1) {
            service.capture({ type: 'recipe_viewed', userId: OWNER, recipeId: RECIPE });
        }

        // First over-cap drop flushes immediately (the signal must not be delayed a whole interval)…
        service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        expect(warn).toHaveBeenCalledTimes(1);

        // …then a storm of drops inside the interval accumulates SILENTLY.
        for (let index = 0; index < 50; index += 1) {
            service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        }

        expect(warn).toHaveBeenCalledTimes(1);

        // After the interval elapses, the next drop flushes one line carrying the accumulated count.
        vi.advanceTimersByTime(ANALYTICS_DROP_FLUSH_INTERVAL_MS + 1);
        service.capture({ type: 'recipe_saved', userId: OWNER, recipeId: RECIPE });
        expect(warn).toHaveBeenCalledTimes(2);
        expect(String(warn.mock.calls[1]?.[0])).toMatch(/51/);

        fake.release();
        vi.useRealTimers();
        await fake.settle();
    });

    // ── U4: the AWAITED ingest-door batch landing ────────────────────────────────────────────────

    it('ingestBatch lands a multi-row INSERT spelling the PARTIAL ON CONFLICT predicate, and counts RETURNING', async () => {
        const batch = [
            {
                type: 'query_outcome' as const,
                eventId: '99999999-9999-4999-8999-000000000d01',
                occurredAt: '2026-09-01T12:00:00.000Z',
                query: 'salt',
                served: [{ group: 'catalog' as const, label: 'Salt, table' }],
                outcome: { kind: 'no_pick' as const },
            },
            {
                type: 'query_outcome' as const,
                eventId: '99999999-9999-4999-8999-000000000d02',
                occurredAt: '2026-09-01T12:00:01.000Z',
                query: 'buckwheat honey',
                served: [],
                outcome: { kind: 'no_pick' as const },
            },
        ];

        const result = await service.ingestBatch(OWNER, batch);

        const statements = fake.statements();
        expect(statements).toHaveLength(1);
        const insert = statements[0];

        if (insert === undefined) {
            throw new Error('unreachable: length asserted above');
        }

        expect(insert.text).toMatch(/^insert into analytics_events/i);
        // ⛔ The idempotency index is PARTIAL, so the landing must repeat its predicate — a bare
        // ON CONFLICT (event_id) has no arbiter to infer and errors at runtime (0043's header).
        expect(insert.text).toMatch(/on conflict \(event_id\) where event_id is not null do nothing/i);
        expect(insert.text).toMatch(/returning/i);
        expect(insert.params).toContain('99999999-9999-4999-8999-000000000d01');
        expect(insert.params).toContain('99999999-9999-4999-8999-000000000d02');
        expect(insert.params).toContain(OWNER);
        // The fake resolves zero rows, so landed reflects RETURNING — 0 here, not the batch size.
        expect(result).toEqual({ landed: 0, shed: false });
    });

    it('ingestBatch SHEDS the whole batch at the client-door threshold — the ingest door is client-door load', async () => {
        fake.holdOpen();

        for (let index = 0; index < ANALYTICS_CLIENT_SHED_AT; index += 1) {
            service.capture({ type: 'recipe_viewed', userId: OWNER, recipeId: RECIPE });
        }

        const saturated = fake.statements().length;
        const result = await service.ingestBatch(OWNER, [
            {
                type: 'query_outcome' as const,
                eventId: '99999999-9999-4999-8999-000000000d03',
                occurredAt: '2026-09-01T12:00:00.000Z',
                query: 'salt',
                served: [],
                outcome: { kind: 'no_pick' as const },
            },
        ]);

        expect(result).toEqual({ landed: 0, shed: true });
        expect(fake.statements()).toHaveLength(saturated);

        fake.release();
        await fake.settle();
    });

    it('ingestBatch answers 0 for an empty batch without touching the database', async () => {
        const result = await service.ingestBatch(OWNER, []);

        expect(result).toEqual({ landed: 0, shed: false });
        expect(fake.statements()).toHaveLength(0);
    });
});
