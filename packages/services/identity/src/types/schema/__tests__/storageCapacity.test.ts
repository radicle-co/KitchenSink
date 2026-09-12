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
 * The identity schema is all `text`/`citext`/`timestamp`/enum today, so there is nothing to bound and
 * {@link accounts} is legitimately empty. The gate is exhaustive over COLUMNS rather than over today's known
 * defects: the day someone adds a `varchar(n)`, `smallint` or `numeric(p, s)`, the exhaustiveness assertion
 * fails until that column is either bound to the wire field that writes it or exempted with a stated reason.
 * Because an empty subject set would otherwise make the machinery unfalsifiable here, the negative controls run
 * against a SYNTHETIC bounded table — so "the audit really does report an overflow" stays proven locally
 * instead of being inherited on faith from another service's suite.
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
 * One entry per bounded column in the identity database. EMPTY, and measured rather than assumed: every column
 * in `@kitchensink/identity-db` is `text`, `citext`, `timestamp` or an enum, none of which has a length or a
 * range a wire value can overflow. A new bounded column fails the exhaustiveness assertion below on arrival.
 */
const accounts: readonly ColumnAccount[] = [];

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
        // The tell that distinguishes the real schema from the deleted duplicate. If this ever reports
        // `users.email`, the import has drifted back to a copy.
        expect(collectBoundedColumns(schema).map((column) => `${column.table}.${column.column}`)).toEqual([]);
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
