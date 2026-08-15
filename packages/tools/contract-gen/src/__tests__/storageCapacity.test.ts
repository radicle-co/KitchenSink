/**
 * THE STORAGE-CAPACITY GATE's unit suite.
 *
 * The invariant under test is one sentence: **for every wire field that writes to a bounded column, the
 * zod max must be ≤ what the column can physically store.** Everything here is written to FAIL if that
 * check is weakened — a suite that only proved the happy path would let the gate be deleted line by line
 * while staying green.
 *
 * The "tables" are hand-built objects carrying drizzle's REGISTERED symbols (`Symbol.for('drizzle:…')`),
 * not real `pgTable`s: `@kitchensink/contract-gen` deliberately has no `drizzle-orm` dependency (it is
 * imported by every service and must not drag an ORM around), so the structural contract it reads is
 * exactly what this suite pins. Each service's own `storageCapacity.test.ts` runs the same functions
 * against the REAL drizzle schemas, which is what proves the structural assumption still holds against the
 * installed drizzle.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    auditStorageCapacity,
    collectBoundedColumns,
    describeColumnCapacity,
    formatStorageCapacityFindings,
    wireUpperBound,
    INT2_MAX,
    INT4_MAX,
    INT8_MAX,
} from '../storageCapacity.js';

const DRIZZLE_NAME = Symbol.for('drizzle:Name');
const DRIZZLE_COLUMNS = Symbol.for('drizzle:Columns');

/** Build a fake drizzle column exposing exactly the runtime surface the gate reads. */
function column(
    name: string,
    columnType: string,
    sqlType: string,
    extra: { length?: number; precision?: number; scale?: number; baseColumn?: unknown } = {},
): unknown {
    return { name, columnType, getSQLType: () => sqlType, ...extra };
}

/** Build a fake drizzle table with drizzle's registered symbols, keyed by property name. */
function table(sqlName: string, columns: Record<string, unknown>): unknown {
    return { [DRIZZLE_NAME]: sqlName, [DRIZZLE_COLUMNS]: columns };
}

describe('describeColumnCapacity — the physical ceiling of a column', () => {
    it('maps integer to the int4 ceiling', () => {
        expect(describeColumnCapacity(column('n', 'PgInteger', 'integer'))).toEqual({
            kind: 'numeric',
            max: 2_147_483_647,
        });
    });

    it('exports the int4 ceiling as a named constant equal to what it derives', () => {
        expect(INT4_MAX).toBe(2_147_483_647);
        expect(describeColumnCapacity(column('n', 'PgInteger', 'integer'))).toEqual({ kind: 'numeric', max: INT4_MAX });
    });

    it('maps smallint to the int2 ceiling', () => {
        expect(describeColumnCapacity(column('n', 'PgSmallInt', 'smallint'))).toEqual({ kind: 'numeric', max: 32_767 });
        expect(INT2_MAX).toBe(32_767);
    });

    it('maps varchar(n) to a length ceiling of n', () => {
        expect(describeColumnCapacity(column('v', 'PgVarchar', 'varchar(255)', { length: 255 }))).toEqual({
            kind: 'length',
            maxLength: 255,
        });
    });

    it('treats varchar with NO declared length as unbounded (Postgres accepts any length)', () => {
        expect(describeColumnCapacity(column('v', 'PgVarchar', 'varchar'))).toEqual({ kind: 'unbounded' });
    });

    it.each([
        // numeric(p,s) holds at most 10^(p-s) - 10^(-s): the largest value that cannot round up out of range.
        [8, 2, 999_999.99],
        [3, 2, 9.99],
        [8, 1, 9_999_999.9],
        [10, 3, 9_999_999.999],
        [5, 0, 99_999],
    ])('maps numeric(%i, %i) to a ceiling of %d', (precision, scale, max) => {
        expect(
            describeColumnCapacity(column('n', 'PgNumeric', `numeric(${precision}, ${scale})`, { precision, scale })),
        ).toEqual({ kind: 'numeric', max });
    });

    it('treats numeric with NO precision as unbounded (arbitrary precision)', () => {
        expect(describeColumnCapacity(column('n', 'PgNumeric', 'numeric'))).toEqual({ kind: 'unbounded' });
    });

    it.each(['PgText', 'PgUUID', 'PgBoolean', 'PgTimestamp', 'PgJsonb', 'PgDate', 'PgDoublePrecision', 'PgReal'])(
        'treats %s as unbounded for this audit',
        (columnType) => {
            expect(describeColumnCapacity(column('c', columnType, 'whatever'))).toEqual({ kind: 'unbounded' });
        },
    );

    it('looks THROUGH an array to its element type, so varchar(n)[] is still bounded', () => {
        const base = column('t', 'PgVarchar', 'varchar(10)', { length: 10 });

        expect(describeColumnCapacity(column('t', 'PgArray', 'varchar(10)[]', { baseColumn: base }))).toEqual({
            kind: 'length',
            maxLength: 10,
        });
    });

    it('treats text[] as unbounded', () => {
        const base = column('t', 'PgText', 'text');

        expect(describeColumnCapacity(column('t', 'PgArray', 'text[]', { baseColumn: base }))).toEqual({
            kind: 'unbounded',
        });
    });

    it('maps serial to the INT4 ceiling — it is an integer with a sequence default, not a wider type', () => {
        expect(describeColumnCapacity(column('n', 'PgSerial', 'serial'))).toEqual({ kind: 'numeric', max: INT4_MAX });
    });

    it('maps bigint and bigserial to the int8 ceiling, which is a REAL ceiling (1e300 overflows it)', () => {
        expect(describeColumnCapacity(column('n', 'PgBigInt64', 'bigint'))).toEqual({ kind: 'numeric', max: INT8_MAX });
        expect(describeColumnCapacity(column('n', 'PgBigSerial64', 'bigserial'))).toEqual({
            kind: 'numeric',
            max: INT8_MAX,
        });
    });

    it('maps the mode:number bigint variants to the safe-integer ceiling drizzle already narrows them to', () => {
        expect(describeColumnCapacity(column('n', 'PgBigInt53', 'bigint'))).toEqual({
            kind: 'numeric',
            max: Number.MAX_SAFE_INTEGER,
        });
        expect(describeColumnCapacity(column('n', 'PgBigSerial53', 'bigserial'))).toEqual({
            kind: 'numeric',
            max: Number.MAX_SAFE_INTEGER,
        });
    });

    it('THROWS on an unrecognized column type rather than assuming it is unbounded', () => {
        // The safety property, and it has already earned its keep: this mapping originally omitted
        // `PgBigSerial64`, and the food service's `bigserial` primary keys threw here rather than being
        // silently reported unbounded.
        expect(() => describeColumnCapacity(column('c', 'PgInterval', 'interval'))).toThrow(/PgInterval/u);
    });
});

describe('collectBoundedColumns — the exhaustive inventory the audit must account for', () => {
    const schema = {
        widgets: table('widgets', {
            id: column('id', 'PgUUID', 'uuid'),
            label: column('label', 'PgVarchar', 'varchar(40)', { length: 40 }),
            note: column('note', 'PgText', 'text'),
            count: column('count', 'PgInteger', 'integer'),
        }),
        // Not a table — the schema barrel also exports value sets, row types and custom column helpers.
        WIDGET_KINDS: ['a', 'b'],
        tsvector: () => undefined,
    };

    it('lists every bounded column and NOTHING else', () => {
        expect(collectBoundedColumns(schema)).toEqual([
            {
                table: 'widgets',
                column: 'count',
                property: 'count',
                sqlType: 'integer',
                capacity: { kind: 'numeric', max: 2_147_483_647 },
            },
            {
                table: 'widgets',
                column: 'label',
                property: 'label',
                sqlType: 'varchar(40)',
                capacity: { kind: 'length', maxLength: 40 },
            },
        ]);
    });

    it('ignores non-table exports instead of throwing on them', () => {
        expect(collectBoundedColumns({ NOT_A_TABLE: 42 })).toEqual([]);
    });
});

describe('wireUpperBound — what a zod schema actually promises', () => {
    it('reads a numeric max', () => {
        expect(wireUpperBound(z.number().max(5))).toEqual({ kind: 'numeric', max: 5 });
    });

    it('reads an exclusive numeric max as the exclusive value', () => {
        expect(wireUpperBound(z.number().lt(5))).toEqual({ kind: 'numeric', max: 5, exclusive: true });
    });

    it('reads a string maxLength', () => {
        expect(wireUpperBound(z.string().max(200))).toEqual({ kind: 'length', maxLength: 200 });
    });

    it('sees through optional, nullable and default wrappers', () => {
        expect(wireUpperBound(z.number().max(7).optional())).toEqual({ kind: 'numeric', max: 7 });
        expect(wireUpperBound(z.number().max(7).nullable().optional())).toEqual({ kind: 'numeric', max: 7 });
        expect(wireUpperBound(z.coerce.number().int().max(7).default(1))).toEqual({ kind: 'numeric', max: 7 });
    });

    it('sees through an array to its element bound, because the ELEMENT is what lands in the column', () => {
        expect(wireUpperBound(z.array(z.string().max(9)).max(50))).toEqual({ kind: 'length', maxLength: 9 });
    });

    it('derives a length bound from an enum, since the longest member is the widest value', () => {
        expect(wireUpperBound(z.enum(['easy', 'medium', 'hard']))).toEqual({ kind: 'length', maxLength: 6 });
    });

    it('reports an unbounded plain number as unbounded', () => {
        expect(wireUpperBound(z.number().nonnegative())).toBeUndefined();
    });

    it('reports an unbounded string as unbounded', () => {
        expect(wireUpperBound(z.string().min(1))).toBeUndefined();
    });

    it('reports zod`s implicit safe-integer ceiling for a bare int, which is FAR above int4', () => {
        // This is the measured defect the gate exists to catch: `z.number().int()` promises only that the
        // value is a safe integer — 9007199254740991 — which is 4.2 million times the int4 ceiling.
        expect(wireUpperBound(z.number().int().positive())).toEqual({ kind: 'numeric', max: 9_007_199_254_740_991 });
    });
});

// ── The audit ─────────────────────────────────────────────────────────────────────────────────────

const auditSchema = {
    widgets: table('widgets', {
        label: column('label', 'PgVarchar', 'varchar(40)', { length: 40 }),
        count: column('count', 'PgInteger', 'integer'),
    }),
};

describe('auditStorageCapacity — the invariant', () => {
    it('passes when every bounded column is accounted for and every wire max fits', () => {
        expect(
            auditStorageCapacity({
                tables: auditSchema,
                accounts: [
                    {
                        table: 'widgets',
                        column: 'label',
                        fields: [{ field: 'CreateWidget.label', schema: z.string().min(1).max(40) }],
                    },
                    {
                        table: 'widgets',
                        column: 'count',
                        fields: [{ field: 'CreateWidget.count', schema: z.number().int().max(2_147_483_647) }],
                    },
                ],
            }),
        ).toEqual([]);
    });

    it('FAILS a wire max above the column ceiling — the 500-that-should-be-400', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'not client-writable' },
                {
                    table: 'widgets',
                    column: 'count',
                    fields: [{ field: 'CreateWidget.count', schema: z.number().int().positive() }],
                },
            ],
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            kind: 'exceeds-capacity',
            table: 'widgets',
            column: 'count',
            field: 'CreateWidget.count',
        });
        expect(formatStorageCapacityFindings(findings)).toMatch(/9007199254740991.*2147483647/su);
    });

    it('FAILS a wire field with no upper bound at all against a bounded column', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                {
                    table: 'widgets',
                    column: 'label',
                    fields: [{ field: 'CreateWidget.label', schema: z.string().min(1) }],
                },
                { table: 'widgets', column: 'count', why: 'server-assigned' },
            ],
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'unbounded-wire-field', field: 'CreateWidget.label' });
    });

    it('FAILS a bounded column nobody accounted for — this is what catches a NEW column on arrival', () => {
        const findings = auditStorageCapacity({ tables: auditSchema, accounts: [] });

        expect(findings.map((finding) => finding.kind)).toEqual(['unaccounted-column', 'unaccounted-column']);
        expect(formatStorageCapacityFindings(findings)).toMatch(/widgets\.count/u);
        expect(formatStorageCapacityFindings(findings)).toMatch(/widgets\.label/u);
    });

    it('FAILS a stale account entry, so a widened or deleted column cannot leave dead bookkeeping', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'x' },
                { table: 'widgets', column: 'count', why: 'y' },
                { table: 'widgets', column: 'gone', why: 'z' },
                { table: 'nosuch', column: 'count', why: 'w' },
            ],
        });

        expect(findings.map((finding) => finding.kind)).toEqual(['stale-account', 'stale-account']);
    });

    it('FAILS a duplicate account entry for one column, so two entries cannot disagree', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'x' },
                { table: 'widgets', column: 'label', why: 'y' },
                { table: 'widgets', column: 'count', why: 'z' },
            ],
        });

        expect(findings.map((finding) => finding.kind)).toEqual(['duplicate-account']);
    });

    it('FAILS a string wire field bound against a numeric column (and the reverse)', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                {
                    table: 'widgets',
                    column: 'label',
                    fields: [{ field: 'CreateWidget.label', schema: z.number().max(40) }],
                },
                {
                    table: 'widgets',
                    column: 'count',
                    fields: [{ field: 'CreateWidget.count', schema: z.string().max(9) }],
                },
            ],
        });

        expect(findings.map((finding) => finding.kind)).toEqual(['bound-kind-mismatch', 'bound-kind-mismatch']);
    });

    it('accepts an EXCLUSIVE wire max equal to the ceiling, and rejects one above it', () => {
        const ok = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'x' },
                {
                    table: 'widgets',
                    column: 'count',
                    fields: [{ field: 'f', schema: z.number().int().lt(2_147_483_648) }],
                },
            ],
        });

        expect(ok).toEqual([]);

        const bad = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'x' },
                {
                    table: 'widgets',
                    column: 'count',
                    fields: [{ field: 'f', schema: z.number().int().lt(2_147_483_649) }],
                },
            ],
        });

        expect(bad.map((finding) => finding.kind)).toEqual(['exceeds-capacity']);
    });

    it('checks EVERY field bound to one column, not just the first', () => {
        const findings = auditStorageCapacity({
            tables: auditSchema,
            accounts: [
                { table: 'widgets', column: 'label', why: 'x' },
                {
                    table: 'widgets',
                    column: 'count',
                    fields: [
                        { field: 'ok', schema: z.number().int().max(10) },
                        { field: 'bad', schema: z.number().int().max(3_000_000_000) },
                    ],
                },
            ],
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'exceeds-capacity', field: 'bad' });
    });

    it('rejects an account entry that supplies NEITHER fields nor a reason', () => {
        expect(() =>
            auditStorageCapacity({
                tables: auditSchema,
                accounts: [{ table: 'widgets', column: 'label' } as never],
            }),
        ).toThrow(/widgets\.label/u);
    });

    it('rejects an EMPTY `fields` array, which would silently assert nothing', () => {
        expect(() =>
            auditStorageCapacity({
                tables: auditSchema,
                accounts: [{ table: 'widgets', column: 'label', fields: [] }],
            }),
        ).toThrow(/widgets\.label/u);
    });
});

describe('formatStorageCapacityFindings', () => {
    it('renders an empty finding list as an empty string, so a passing audit prints nothing', () => {
        expect(formatStorageCapacityFindings([])).toBe('');
    });

    it('names the table, the column, the SQL type and the wire field in the message', () => {
        const message = formatStorageCapacityFindings(
            auditStorageCapacity({
                tables: auditSchema,
                accounts: [
                    { table: 'widgets', column: 'count', why: 'x' },
                    {
                        table: 'widgets',
                        column: 'label',
                        fields: [{ field: 'CreateWidget.label', schema: z.string().max(41) }],
                    },
                ],
            }),
        );

        expect(message).toContain('widgets.label');
        expect(message).toContain('varchar(40)');
        expect(message).toContain('CreateWidget.label');
    });
});
