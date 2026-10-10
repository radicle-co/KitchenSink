/**
 * Erasure coverage guard: every table that holds a user's data is reached by `eraseIdentityRow`, or is retained
 * on purpose and says why (ADR-0059).
 *
 * @pattern Specification — one predicate over the schema, "a table with a user column is erased or retained by
 * ruling", evaluated against what the erasure transaction actually issues rather than against a list.
 *
 * ⛔ WHY IT EXISTS. A new table with a `user_id` column is personal data the day it ships, and nothing else forces
 * its author to decide what an erasure does to it. The retention map is that decision, written down. The guard
 * discovers the tables from the exports of the package, and learns what the erasure touches by running it against a
 * recording database, so a table added to neither the erasure nor the map fails here.
 *
 * ⚠️ A table is "erased" when the transaction deletes from it or updates it. `users` is updated in place (the row is
 * never hard-deleted, R1), so it is in the touched set, not in the retention map.
 */
import { getTableName, is, type Table } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { eraseIdentityRow } from '../eraseIdentityRow.js';
import * as identityDb from '../index.js';

/**
 * Tables with a user column that an erasure deliberately leaves, and why. A reason is a sentence, not a flag.
 */
const RETAINED: Readonly<Record<string, string>> = {
    lifecycle_events:
        'The append-only R8 audit trail. It records that the erasure happened, and the erasure itself appends to it.',
};

/** The tables the schema exports. Discovered, so a new export cannot be missed. */
const exportedValues: readonly unknown[] = Object.values(identityDb);
const exportedTables: readonly PgTable[] = exportedValues.filter((value): value is PgTable => is(value, PgTable));

/** The user column a table carries, if it carries one: `users.id` is the user, every other table points at it. */
function holdsUserData(table: PgTable): boolean {
    const config = getTableConfig(table);

    return config.name === 'users' || config.columns.some((column) => column.name === 'user_id');
}

/** Run the erasure against a recording database and return the tables it deleted from or updated. */
async function tablesTouchedByErasure(): Promise<ReadonlySet<string>> {
    const touched = new Set<string>();
    const tx = {
        update: (table: Table) => {
            touched.add(getTableName(table));

            return { set: () => ({ where: () => Promise.resolve() }) };
        },
        delete: (table: Table) => {
            touched.add(getTableName(table));

            return { where: () => Promise.resolve() };
        },
        // An insert is the audit append, not an erasure of that table.
        insert: () => ({ values: () => Promise.resolve() }),
    };
    const db = { transaction: (callback: (t: typeof tx) => unknown) => callback(tx) };

    await eraseIdentityRow(db as never, { userId: 'usr_cov', triggerSource: 'admin', actor: 'guard' }, new Date());

    return touched;
}

describe('eraseIdentityRow covers every table that holds a user', () => {
    it('discovers the schema (a guard over an empty list proves nothing)', () => {
        const names = exportedTables.map((table) => getTableName(table));

        expect(names).toEqual(expect.arrayContaining(['users', 'accounts', 'profiles', 'settings']));
    });

    it('erases, or retains with a reason, every table with a user column', async () => {
        const touched = await tablesTouchedByErasure();
        const unaccounted = exportedTables
            .filter(holdsUserData)
            .map((table) => getTableName(table))
            .filter((name) => !touched.has(name) && !(name in RETAINED));

        expect(unaccounted, 'add an erasure step in eraseIdentityRow, or a RETAINED entry with its reason').toEqual([]);
    });

    it('keeps the retention map honest: every entry names a real table and gives a reason', () => {
        const names = new Set(exportedTables.map((table) => getTableName(table)));

        for (const [name, reason] of Object.entries(RETAINED)) {
            expect(names.has(name), `${name} is not an exported table`).toBe(true);
            expect(reason.length, `${name} needs a reason`).toBeGreaterThan(20);
        }
    });

    it('does not list as retained a table the erasure already touches', async () => {
        const touched = await tablesTouchedByErasure();

        expect(Object.keys(RETAINED).filter((name) => touched.has(name))).toEqual([]);
    });
});
