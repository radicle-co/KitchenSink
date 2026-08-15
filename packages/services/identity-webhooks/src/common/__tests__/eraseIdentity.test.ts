/**
 * Unit tests for the shared identity-erasure primitive (CR-002 / U4b). This is the ONE authoritative
 * representation of "reduce an identity row to the erased field-scrub + append the R8 audit row, in one
 * transaction" — consumed by BOTH the 12-month tombstone-sweep (`triggerSource: 'sweep'`) and the
 * `user.deleted`-webhook full erasure (`triggerSource: 'admin'`). The tests pin the erased column set, the
 * companion-row purge, the audit row's trigger source/actor, and the single-transaction guarantee.
 */
import { describe, it, expect } from 'vitest';

import { eraseIdentityRow } from '../eraseIdentity.js';

/** A drizzle-shaped mock tx recording the update set, deleted tables, and audit rows. */
function buildMockDb() {
    const userSets: Array<Record<string, unknown>> = [];
    const deletedTables: string[] = [];
    const auditRows: Array<Record<string, unknown>> = [];
    let transactions = 0;

    const tx = {
        update: () => ({
            set: (value: Record<string, unknown>) => {
                userSets.push(value);

                return { where: () => Promise.resolve() };
            },
        }),
        delete: () => {
            deletedTables.push('table');

            return { where: () => Promise.resolve() };
        },
        insert: () => ({
            values: (value: Record<string, unknown>) => {
                auditRows.push(value);

                return Promise.resolve();
            },
        }),
    };

    const db = {
        transaction: (cb: (t: typeof tx) => unknown) => {
            transactions += 1;

            return cb(tx);
        },
    };

    return { db, userSets, deletedTables, auditRows, transactionCount: () => transactions };
}

describe('eraseIdentityRow', () => {
    it('applies the erased field-scrub, purges companion rows, and appends the audit row in ONE transaction', async () => {
        const { db, userSets, deletedTables, auditRows, transactionCount } = buildMockDb();
        const now = new Date('2026-07-26T00:00:00.000Z');

        await eraseIdentityRow(db as never, { userId: 'usr_01', triggerSource: 'admin', actor: 'clerk-webhook' }, now);

        expect(transactionCount()).toBe(1);
        // Erased scrub: name + picture destroyed, email → ULID placeholder, status erased.
        expect(userSets[0]).toMatchObject({ status: 'erased', name: null, picture: null });
        expect(userSets[0]!.email).toContain('@erased.invalid');
        expect(userSets[0]!.updatedAt).toBe(now);
        // Companion rows (accounts + profiles) purged on erasure.
        expect(deletedTables).toHaveLength(2);
        // R8 audit row carries the caller's trigger source + actor.
        expect(auditRows[0]).toMatchObject({
            userId: 'usr_01',
            event: 'erasure',
            triggerSource: 'admin',
            actor: 'clerk-webhook',
            occurredAt: now,
        });
    });

    it('records the sweep trigger source with a null actor for the automated path', async () => {
        const { db, auditRows } = buildMockDb();

        await eraseIdentityRow(db as never, { userId: 'usr_02', triggerSource: 'sweep', actor: null }, new Date());

        expect(auditRows[0]).toMatchObject({ userId: 'usr_02', triggerSource: 'sweep', actor: null });
    });
});
