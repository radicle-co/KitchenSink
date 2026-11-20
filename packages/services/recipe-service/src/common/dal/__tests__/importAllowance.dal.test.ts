/**
 * Unit tests for {@link ImportAllowanceDal} over the shared fake Drizzle client.
 *
 * What a fake CAN pin, and what it cannot. It pins the ORDER of the statements (the per-user lock first, the clock read
 * after it, the insert last and only on admission) and the VALUES handed to each. It cannot pin that the lock excludes
 * a second connection, that the grants let the service role insert, or that the window predicate selects the right
 * rows: those are `tests/e2e/parseJobs/parseJobQuota.e2e.test.ts`, against a real database.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, methodsOf, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { IMPORT_ALLOWANCE_RULE } from '../../importAllowancePolicy.js';
import type { ImportAllowanceChannel } from '../../../database/schema/importAllowanceEvents.js';
import { ImportAllowanceDal } from '../importAllowance.dal.js';

const USER = '01JIMPORTALLOWANCEUSER0001';
const NOW = new Date('2026-10-26T12:00:00.000Z');

const dialect = new PgDialect();

const PASTE = { channel: 'paste', isPremium: false, principalKind: 'real', units: 1 } as const;

/** The SQL text and bound parameters a recorded builder argument renders to. */
function rendered(argument: unknown): { text: string; params: unknown[] } {
    const { sql: text, params } = dialect.sqlToQuery(argument as SQL);

    return { text: text.replace(/\s+/g, ' ').trim(), params };
}

/** The first recorded argument of the first call to `method`. */
function firstArgumentOf(method: string): unknown {
    return control.calls.find((call) => call.method === method)?.args[0];
}

let control: FakeDrizzle<RecipeDrizzle>;
let dal: ImportAllowanceDal;

/** Queue the reads in the order `admit` issues them: the clock, the prune, the window. */
function queueReads(windowRows: readonly { channel: ImportAllowanceChannel; units: number; createdAt: Date }[]): void {
    control.enqueue([{ epochMs: NOW.getTime() }], undefined, windowRows, undefined);
}

function valuesPayloads(): Record<string, unknown>[] {
    return control.calls
        .filter((call) => call.method === 'values')
        .map((call) => call.args[0] as Record<string, unknown>);
}

beforeEach(() => {
    control = makeFakeDrizzle<RecipeDrizzle>();
    dal = new ImportAllowanceDal();
});

describe('ImportAllowanceDal.admit', () => {
    it('takes the per-user lock BEFORE it reads the clock, the window or writes', async () => {
        queueReads([]);

        await dal.admit(control.db, USER, PASTE);

        expect(methodsOf(control)[0]).toBe('execute');
        expect(methodsOf(control).indexOf('select')).toBeGreaterThan(0);
        expect(methodsOf(control).indexOf('insert')).toBeGreaterThan(methodsOf(control).indexOf('select'));
    });

    it('records the admitted unit with the SAME instant it decided on', async () => {
        queueReads([]);

        const outcome = await dal.admit(control.db, USER, PASTE);

        expect(outcome).toEqual({ kind: 'admitted', units: 1 });
        expect(valuesPayloads()).toEqual([{ userId: USER, channel: 'paste', units: 1, createdAt: NOW }]);
    });

    it('refuses at the limit, names when the oldest unit leaves, and writes nothing', async () => {
        const oldest = new Date(NOW.getTime() - 20 * 3_600_000);
        const rest = Array.from({ length: IMPORT_ALLOWANCE_RULE.limit.free - 1 }, () => ({
            channel: 'paste' as const,
            units: 1,
            createdAt: new Date(NOW.getTime() - 3_600_000),
        }));
        queueReads([{ channel: 'paste', units: 1, createdAt: oldest }, ...rest]);

        const outcome = await dal.admit(control.db, USER, PASTE);

        expect(outcome).toEqual({
            kind: 'refused',
            resetsAt: new Date(oldest.getTime() + IMPORT_ALLOWANCE_RULE.windowMs),
        });
        expect(methodsOf(control)).not.toContain('insert');
    });

    it("prunes the caller's expired units under the lock, before it reads the window", async () => {
        queueReads([]);

        await dal.admit(control.db, USER, PASTE);

        const methods = methodsOf(control);

        expect(methods).toContain('delete');
        expect(methods.indexOf('delete')).toBeGreaterThan(methods.indexOf('execute'));
        expect(methods.lastIndexOf('select')).toBeGreaterThan(methods.indexOf('delete'));
    });
    it('⛔ takes the lock on the REGISTERED class and the caller’s own id, in the transaction-scoped form', async () => {
        queueReads([]);

        await dal.admit(control.db, USER, PASTE);

        const lock = rendered(firstArgumentOf('execute'));

        // `SELECT 1` in its place would still be "an execute first": the text and the key are what make it a lock.
        expect(lock.text).toBe('SELECT pg_advisory_xact_lock($1, hashtext($2))');
        expect(lock.params).toEqual([ADVISORY_LOCK_CLASSES.recipeImportAllowance, USER]);
    });

    it("⛔ prunes ONLY this user's rows at or before the ONE window edge, and reads ONLY this user's rows after it, on every channel", async () => {
        queueReads([]);

        await dal.admit(control.db, USER, PASTE);

        const edge = new Date(NOW.getTime() - IMPORT_ALLOWANCE_RULE.windowMs).toISOString();
        const wheres = control.calls.filter((call) => call.method === 'where').map((call) => rendered(call.args[0]));

        // Dropping the user filter would spend one user's window against everyone's; flipping an operator would move the
        // edge the policy defines; a channel term would cut one channel's rows by a window of its own.
        expect(wheres).toHaveLength(2);
        expect(wheres[0]?.text).toBe(
            '("import_allowance_events"."user_id" = $1 and "import_allowance_events"."created_at" <= $2)',
        );
        expect(wheres[0]?.params).toEqual([USER, edge]);
        expect(wheres[1]?.text).toBe(
            '("import_allowance_events"."user_id" = $1 and "import_allowance_events"."created_at" > $2)',
        );
        expect(wheres[1]?.params).toEqual([USER, edge]);
    });

    it('⛔ counts EVERY channel: a full bulk allowance refuses a paste (one allowance, 2026-11-15)', async () => {
        queueReads([
            {
                channel: 'bulk',
                units: IMPORT_ALLOWANCE_RULE.limit.free,
                createdAt: new Date(NOW.getTime() - 3_600_000),
            },
        ]);

        const outcome = await dal.admit(control.db, USER, PASTE);

        expect(outcome.kind).toBe('refused');
        expect(methodsOf(control)).not.toContain('insert');
    });

    it('⛔ a paid cook is admitted past 200, and a test principal is never refused', async () => {
        const spent = { channel: 'paste' as const, units: 5_000, createdAt: new Date(NOW.getTime() - 3_600_000) };

        queueReads([{ ...spent, units: 200 }]);
        const paid = await dal.admit(control.db, USER, { ...PASTE, isPremium: true });

        queueReads([spent]);
        const test = await dal.admit(control.db, USER, { ...PASTE, principalKind: 'test' });

        expect(paid).toEqual({ kind: 'admitted', units: 1 });
        expect(test).toEqual({ kind: 'admitted', units: 1 });
    });

    it('⛔ a test principal’s paste still writes its ledger row (ADR-0072 §8): the one pipeline runs end to end', async () => {
        queueReads([]);

        await dal.admit(control.db, USER, { ...PASTE, principalKind: 'test' });

        expect(valuesPayloads()).toEqual([{ userId: USER, channel: 'paste', units: 1, createdAt: NOW }]);
    });

    it('⛔ writes ONLY the units that fit, and answers partial with when more opens', async () => {
        queueReads([{ channel: 'bulk', units: 990, createdAt: new Date(NOW.getTime() - 3_600_000) }]);

        const outcome = await dal.admit(control.db, USER, {
            channel: 'bulk',
            isPremium: true,
            principalKind: 'real',
            units: 50,
        });

        expect(outcome).toEqual({
            kind: 'partial',
            units: 10,
            resetsAt: new Date(NOW.getTime() - 3_600_000 + IMPORT_ALLOWANCE_RULE.windowMs),
        });
        expect(valuesPayloads()).toEqual([{ userId: USER, channel: 'bulk', units: 10, createdAt: NOW }]);
    });
});
