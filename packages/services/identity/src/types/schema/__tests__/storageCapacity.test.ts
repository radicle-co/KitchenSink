/**
 * THE STORAGE-CAPACITY GATE for the identity service.
 *
 * > For every wire field that writes to a bounded column, the zod max must be ≤ what the column can
 * > physically store.
 *
 * The invariant, the machinery and the reasoning are shared — they live once in
 * `@kitchensink/contract-gen`'s `storageCapacity.ts`, which was built for the recipe service, where nine
 * fields were answering `500` (`22003 … out of range for type integer`) for what were plainly bad requests.
 *
 * ⚠️ THIS GATE AUDITED A SCHEMA THE DATABASE DOES NOT HAVE, AND ITS ONLY SUBJECT WAS FICTIONAL.
 *
 * It read `import * as schema from '../index.js'` — the identity service's own drizzle copy of the identity
 * schema, which had DRIFTED from the authoritative `@kitchensink/identity-db` and which nothing in production
 * imported (`src/database/index.ts` re-exports the real one to the DAOs). Measured before this change:
 *
 * ```
 * collectBoundedColumns(@kitchensink/identity-db) → []            // the real schema: NO bounded columns
 * collectBoundedColumns(src/types/schema)         → ['users.email'] // the dead copy: varchar(320)
 * ```
 *
 * `users.email` is `citext` in the real database — case-insensitive and UNBOUNDED. So the one column this file
 * exempted, and the two negative controls that probed it, were all about a column that does not exist, and a
 * genuine new `varchar(n)` in `identity-db` could never have failed the gate. That is the whole purpose of
 * §15.5.3, defeated by an import.
 *
 * It now audits the AUTHORITATIVE schema, via the package entry point, and the duplicate is deleted so the old
 * import cannot resolve.
 *
 * ── WHY IT STILL EARNS ITS PLACE WITH ZERO SUBJECTS ──
 *
 * The identity schema was all `text`/`citext`/`timestamp`/enum, so there was nothing to bound and
 * {@link accounts} was legitimately empty. The gate is exhaustive over COLUMNS rather than over today's known
 * defects, and it DID ITS JOB: U10's two `integer` columns arrived and the exhaustiveness assertion failed
 * until each was exempted with a stated reason. The negative controls still run against a SYNTHETIC bounded
 * table, because the two real ones are server-owned and have no wire field to overflow them — so "the audit
 * really does report an overflow" stays proven locally instead of being inherited on faith.
 *
 * ⚠️ ASSERTION, NOT DERIVATION. Nothing here generates zod from drizzle and no drizzle type becomes a wire
 * type; the test reads both models and compares them.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pgTable, varchar, smallint } from 'drizzle-orm/pg-core';
import { auditStorageCapacity, collectBoundedColumns, formatStorageCapacityFindings } from '@kitchensink/contract-gen';
import type { ColumnAccount } from '@kitchensink/contract-gen';

import * as schema from '@kitchensink/identity-db';

/**
 * One entry per bounded column in the identity database.
 *
 * ⚠️ It was EMPTY, and measured rather than assumed: every column in `@kitchensink/identity-db` was `text`,
 * `citext`, `timestamp` or an enum, none of which has a length or a range a wire value can overflow. U10's
 * two integers are the first entries, and they are SERVER-OWNED — which the audit needs told explicitly,
 * because "nothing client-supplied writes this" is exactly the claim it cannot make for itself.
 */
const accounts: readonly ColumnAccount[] = [
    {
        table: 'users',
        column: 'status_version',
        why: 'U10: incremented by the service inside the transaction that changes the status. No wire field sets it, and a person would need 2^31 status changes to overflow it.',
    },
    {
        table: 'users',
        column: 'status_applied_version',
        why: 'U10: written by the deletion worker as the version it just brought the provider to — always a value read from status_version, so it is bounded by that column. No wire field sets it.',
    },
];

/**
 * A synthetic table, used ONLY by the negative controls. The real schema has no bounded column, so without
 * this the "would REPORT an overflow" assertions would have nothing to probe and the gate's machinery would be
 * unfalsifiable in this service — which is precisely the state this file was in when it probed the dead copy's
 * fictional `users.email`.
 */
const probeTables = {
    probe: pgTable('probe', {
        label: varchar('label', { length: 320 }),
        count: smallint('count'),
    }),
};

describe('storage capacity — every wire bound fits the column it writes', () => {
    it('holds for every bounded column in the identity database', () => {
        expect(formatStorageCapacityFindings(auditStorageCapacity({ tables: schema, accounts }))).toBe('');
    });

    // The assertion that makes an empty `accounts` list safe rather than vacuous.
    it('accounts for EVERY bounded column, so a new one fails this test on arrival', () => {
        const bounded = collectBoundedColumns(schema).map((column) => `${column.table}.${column.column}`);
        const accounted = accounts.map((account) => `${account.table}.${account.column}`);

        expect([...accounted].sort()).toEqual([...bounded].sort());
    });

    it('audits the AUTHORITATIVE schema — the real users.email is unbounded citext, not varchar(320)', () => {
        // ⚠️ REWRITTEN from `toEqual([])` when U10 added the first two bounded columns. The claim is
        // unchanged and is NOT "nothing is bounded" — it is "this import resolves the real schema rather
        // than the deleted duplicate", and `users.email` is the tell: the copy declared it `varchar(320)`,
        // the authoritative one declares it unbounded `citext`. Asserting emptiness happened to prove that
        // only while emptiness held, so the tell is now asserted directly, and the set by equality beside it.
        const bounded = collectBoundedColumns(schema).map((column) => `${column.table}.${column.column}`);

        expect(bounded).not.toContain('users.email');
        expect(bounded.sort()).toEqual(['users.status_applied_version', 'users.status_version']);
    });

    it('recognizes every column type this schema uses (it THROWS on one it does not)', () => {
        expect(() => collectBoundedColumns(schema)).not.toThrow();
    });

    it('would REPORT a wire field bound to an unbounded string on a varchar(320) column', () => {
        const findings = auditStorageCapacity({
            tables: probeTables,
            accounts: [{ table: 'probe', column: 'label', fields: [{ field: 'probe', schema: z.string().min(1) }] }],
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/probe\.label/u);
    });

    it('would REPORT a string bound LONGER than varchar(320)', () => {
        const findings = auditStorageCapacity({
            tables: probeTables,
            accounts: [{ table: 'probe', column: 'label', fields: [{ field: 'probe', schema: z.string().max(321) }] }],
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/321.*320/su);
    });

    it('would REPORT a numeric bound outside what a smallint can hold', () => {
        const findings = auditStorageCapacity({
            tables: probeTables,
            accounts: [
                { table: 'probe', column: 'count', fields: [{ field: 'probe', schema: z.number().max(40_000) }] },
            ],
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/probe\.count/u);
    });
});
