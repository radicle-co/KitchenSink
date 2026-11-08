/**
 * Unit tests for {@link PrivateSlotsDal} over the shared fake Drizzle client (ADR-0073 section 2 and 5).
 *
 * What a fake CAN pin: the ORDER of the statements (the per-user lock before the count), the lock's class and key, and
 * the predicate the count renders. What it cannot: that the lock excludes a second connection, or that the count agrees
 * with real rows. Those are `tests/e2e/recipes/privateSlots.e2e.test.ts`, against a real database.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, methodsOf, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { PrivateSlotsDal } from '../privateSlots.dal.js';

const USER = '01JPRIVATESLOTSUSER00001';
const dialect = new PgDialect();

function rendered(argument: unknown): { text: string; params: unknown[] } {
    const { sql: text, params } = dialect.sqlToQuery(argument as SQL);

    return { text: text.replace(/\s+/g, ' ').trim(), params };
}

let control: FakeDrizzle<RecipeDrizzle>;
let dal: PrivateSlotsDal;

beforeEach(() => {
    control = makeFakeDrizzle<RecipeDrizzle>();
    dal = new PrivateSlotsDal();
});

describe('PrivateSlotsDal.lockAndCount', () => {
    it('takes the per-user advisory lock as the FIRST statement, then counts', async () => {
        control.enqueue([{ used: 49 }]);

        const used = await dal.lockAndCount(control.db, USER);

        expect(used).toBe(49);
        expect(methodsOf(control)[0]).toBe('execute');
        expect(methodsOf(control).indexOf('select')).toBeGreaterThan(0);
    });

    it('locks in the registered private-slots class, keyed by the OWNER (not the recipe)', async () => {
        control.enqueue([{ used: 0 }]);

        await dal.lockAndCount(control.db, USER);

        const lock = control.calls.find((call) => call.method === 'execute');
        const { text, params } = rendered(lock?.args[0]);

        expect(text).toContain('pg_advisory_xact_lock');
        expect(text).toContain('hashtext');
        expect(params).toEqual([ADVISORY_LOCK_CLASSES.recipePrivateSlots, USER]);
    });

    it('answers 0 for a cook with no rows, never undefined', async () => {
        control.enqueue([]);

        await expect(dal.lockAndCount(control.db, USER)).resolves.toBe(0);
    });
});

describe('PrivateSlotsDal.count', () => {
    it('counts WITHOUT taking the lock (a display read must not serialise the cook)', async () => {
        control.enqueue([{ used: 12 }]);

        await expect(dal.count(control.db, USER)).resolves.toBe(12);
        expect(methodsOf(control)).not.toContain('execute');
    });

    /**
     * Rewritten for the owner ruling of 2026-10-26 (ADR-0073 section 12): a draft holds no slot, so the count adds
     * `status = 'published'`. The old test pinned `[USER, 'private']` and would pass a count that included drafts.
     */
    it('counts exactly the cook, private, PUBLISHED, undeleted rows: owner AND private AND published AND not tombstoned', async () => {
        control.enqueue([{ used: 1 }]);

        await dal.count(control.db, USER);

        const where = control.calls.find((call) => call.method === 'where');
        const { text, params } = rendered(where?.args[0]);

        expect(text).toContain('"owner_id" = $1');
        expect(text).toContain('"visibility" = $2');
        expect(text).toContain('"status" = $3');
        expect(text).toContain('"deleted_at" is null');
        expect(params).toEqual([USER, 'private', 'published']);
    });
});
