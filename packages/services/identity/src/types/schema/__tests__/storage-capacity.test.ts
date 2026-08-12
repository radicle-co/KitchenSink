/**
 * THE STORAGE-CAPACITY GATE for the identity service.
 *
 * > For every wire field that writes to a bounded column, the zod max must be ≤ what the column can
 * > physically store.
 *
 * The invariant, the machinery and the reasoning are shared — they live once in
 * `@kitchensink/contract-gen`'s `storage-capacity.ts`, which was built for the recipe service, where nine
 * fields were answering `500` (`22003 … out of range for type integer`) for what were plainly bad requests.
 *
 * ── WHY IT RUNS HERE, WHERE THERE IS ONE BOUNDED COLUMN AND NOTHING WRITES IT ──
 *
 * `users.email` is `varchar(320)` and is populated from the VERIFIED Clerk token claim (or the signed
 * webhook), never from a request body — so it is exempted with that reason. The gate still earns its place
 * because it is exhaustive over COLUMNS, not over today's known defects: the day someone adds a `varchar(n)`,
 * `smallint` or `numeric(p, s)` column, this test fails until the new column is either bound to the wire field
 * that writes it or exempted with a stated reason. Identity is also the service where the
 * `createZodDto`-under-the-wrong-pipe trap has already bitten once, on a route that writes user data, so the
 * cost of an unexamined new column here is higher than the line count suggests.
 *
 * ⚠️ ASSERTION, NOT DERIVATION. Nothing here generates zod from drizzle and no drizzle type becomes a wire
 * type; the test reads both models and compares them.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditStorageCapacity, collectBoundedColumns, formatStorageCapacityFindings } from '@kitchensink/contract-gen';
import type { ColumnAccount } from '@kitchensink/contract-gen';

import * as schema from '../index.js';

/** One entry per bounded column. Exhaustive by construction — the audit fails on anything unlisted. */
const accounts: readonly ColumnAccount[] = [
    {
        table: 'users',
        column: 'email',
        why:
            'varchar(320), written ONLY from the verified Clerk claim (UsersService.resolveOrCreateFromClaims) or ' +
            'the svix-verified webhook — never from a request body. The admin list filter matches on it with ' +
            'ILIKE, which is a comparison rather than a write and cannot overflow the column.',
    },
];

describe('storage capacity — every wire bound fits the column it writes', () => {
    it('holds for every bounded column in the identity service', () => {
        expect(formatStorageCapacityFindings(auditStorageCapacity({ tables: schema, accounts }))).toBe('');
    });

    it('accounts for EVERY bounded column, so a new one fails this test on arrival', () => {
        const bounded = collectBoundedColumns(schema).map((column) => `${column.table}.${column.column}`);
        const accounted = accounts.map((account) => `${account.table}.${account.column}`);

        expect([...accounted].sort()).toEqual([...bounded].sort());
    });

    it('recognizes every column type this schema uses (it THROWS on one it does not)', () => {
        expect(() => collectBoundedColumns(schema)).not.toThrow();
    });

    it('would REPORT a wire field that outgrew its column, so the exemption is not load-bearing', () => {
        // Proves the audit is actually checking rather than tolerating a `why`: bind the column to an
        // unbounded string and the finding must appear.
        const findings = auditStorageCapacity({
            tables: schema,
            accounts: [{ table: 'users', column: 'email', fields: [{ field: 'probe', schema: z.string().min(1) }] }],
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/users\.email/u);
    });

    it('would REPORT a string bound LONGER than varchar(320)', () => {
        const findings = auditStorageCapacity({
            tables: schema,
            accounts: [{ table: 'users', column: 'email', fields: [{ field: 'probe', schema: z.string().max(321) }] }],
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/321.*320/su);
    });
});
