/**
 * ⛔ EVERY Drizzle model in the barrel is EXECUTED against the real migrated table — not just the ones a
 * DAL happens to exercise.
 *
 * ## The hole this closes
 *
 * A Drizzle `pgTable` is a *claim* about a table that the hand-authored `src/database/migrations/*.sql`
 * actually creates. Nothing in TypeScript relates the two: the model can name a column the table does not
 * have, spell a type differently, or disagree about nullability, and `tsc` is content — the drift only
 * appears as a runtime `42703` on the query that first names the wrong column.
 *
 * For most tables a DAL integration suite incidentally covers this: the DAL selects, Postgres accepts, the
 * model is proved. The failure mode is the model with **no live consumer**. `ingredient_parse_cache` became
 * exactly that on 2026-09-02, when `parseCache.dal.ts` was deleted as dead code while the model was
 * deliberately KEPT (recipe-service owns migration 0028, the model is in the barrel passed to
 * `drizzle(pool, { schema })`, and it carries a live KTD-14 erasure argument). With the DAL gone, nothing
 * executed that model against a migrated database, so it was an unvalidated representation of the table.
 *
 * ⛔ This suite is deliberately NOT a bespoke `ingredient_parse_cache` exercise. A bespoke test would close
 * one hole and leave the class open — the next model to lose its last consumer would be unvalidated again,
 * silently. The subjects are DISCOVERED from the barrel, so a table added tomorrow is covered the day it
 * lands and cannot opt out by not being mentioned. This is the same reasoning
 * `schemaMigrationBarrier.test.ts` records for `executeBefore`: a copy of a list cannot detect that the
 * list is incomplete.
 *
 * ## What each claim buys, and why the metadata comparison is not enough on its own
 *
 * - **C1 the table exists** — the migration that creates it was filed in THIS package and really ran. This
 *   is the runner's own `expectedTables()` postcondition, which until now was never exercised against a
 *   real recipe database (identity and food both have a `migrate.integration.test.ts`; recipe-service had
 *   none). `migrationRunner.integration.test.ts` now runs the real runner; this asserts the same property
 *   from the model's side, so a barrel export that is not a table reds here too.
 * - **C2 every declared column exists** — the DANGEROUS direction. Drizzle emits the full declared column
 *   list on every `select()`/`insert()`, so one undeclared-in-the-database column breaks *every* query
 *   against the table, not the one that reads it.
 * - **C3 types match** and **C4 nullability matches** — a model that says `text` over a `jsonb` column, or
 *   `notNull()` over a nullable one, type-checks and lies to every reader of the inferred row type.
 * - **C5 a table column absent from the MODEL is a documented expand-first exception.** This is the SAFE
 *   direction and, under ADR-0022's standing expand-first precondition, a legitimate in-flight state: a
 *   contracting migration ships a release LATER than the code that stopped reading the column. So it is not
 *   forbidden — it is required to carry a reason. An undocumented one is a column somebody added and nobody
 *   modelled.
 * - **C6 the model is EXECUTED.** The metadata comparison is a comparison of two descriptions; it cannot
 *   prove Postgres accepts the SQL Drizzle actually renders (identifier quoting, a type Drizzle serialises
 *   differently, a generated column it tries to select). `select().from(table).limit(0)` is the cheapest
 *   statement that names every declared column and returns no rows.
 *
 * ## Why this tier
 *
 * Every property above is a property of the DATABASE. A unit test mocking the pool proves the model calls
 * the mock. Only a real, migrated Postgres can observe that the column is there. Guarded with
 * `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips in lockstep with
 * `tests/globalSetup.ts`.
 *
 * ## The gates fire at deliberate violations
 *
 * {@link conformanceViolations} is pure, and the second `describe` fires it at models built to break each
 * claim. Without that, a discovery predicate that quietly stopped matching would turn every assertion here
 * into an assertion over an empty list — the one way a guard like this rots unnoticed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import * as schema from '../../../src/database/schema/index.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/**
 * Real columns that NO model declares, each with the reason it is absent.
 *
 * ⚠️ A map, not a denylist of names — the value is the argument, and it has to be written down. Under
 * ADR-0022's expand-first precondition a column whose readers have gone but whose `DROP` has not shipped is
 * a normal, temporary state; what is not normal is nobody knowing which of those two things is happening.
 *
 * An entry that stops being true (the `DROP` lands) reds this suite from the other side, which is the
 * prompt to delete the entry.
 */
const UNMODELLED_BY_RULING: ReadonlyMap<string, string> = new Map([
    [
        'recipe_versions.device_label',
        'Owner ruling 2026-08-26 removed device attribution; the DROP is deferred a release under ' +
            "ADR-0022's expand-first precondition. See src/database/schema/versions.ts.",
    ],
]);

/**
 * Tables in the recipe database that this service deliberately does not model.
 *
 * `verification_spend` is ADR-0024's reserve-then-settle counter, written by `recipe-workers` against this
 * same logical database. Recipe-service neither reads nor writes it, so a model here would be a second,
 * unowned representation of a table another deployable owns.
 *
 * ⚠️ Listed so the "tables in the database with no model" check can be an EQUALITY rather than a silence.
 * A new unmodelled table is then a deliberate act rather than something nobody notices.
 */
const UNMODELLED_TABLES: readonly string[] = ['verification_spend'];

/** Bookkeeping the migration runner owns; not part of any service's Drizzle schema. */
const RUNNER_TABLES: readonly string[] = ['schema_migrations'];

/** One column as the Drizzle model declares it. */
interface ModelColumn {
    readonly name: string;
    /** Drizzle's rendering of the column type — `text`, `varchar(255)`, `numeric(10, 3)`, `jsonb`… */
    readonly sqlType: string;
    readonly notNull: boolean;
}

/** One table as the Drizzle model declares it. */
interface ModelTable {
    readonly name: string;
    readonly columns: readonly ModelColumn[];
}

/** One column as PostgreSQL actually has it. */
interface ActualColumn {
    readonly name: string;
    /** `format_type(atttypid, atttypmod)` — `text`, `character varying(255)`, `numeric(10,3)`, `jsonb`… */
    readonly pgType: string;
    readonly notNull: boolean;
}

/**
 * Reduce a type spelling to the form both sides agree on.
 *
 * Drizzle and `format_type` render the SAME type two ways in exactly two places, and both are pure
 * spelling: Drizzle writes the SQL-standard alias `varchar(n)` where Postgres canonicalises to
 * `character varying(n)`, and Drizzle puts a space after the comma in a modifier list (`numeric(10, 3)`)
 * where Postgres does not.
 *
 * ⛔ Deliberately NARROW. Every other type in this schema — `text`, `jsonb`, `uuid`, `integer`, `text[]`,
 * `tsvector`, `timestamp with time zone` — already matches character for character, verified against the
 * real migrated database. A looser normalizer (stripping all modifiers, say) would make `numeric(10, 3)`
 * and `numeric(8, 2)` compare equal and silently stop detecting a precision change, which is a type change
 * that rounds every stored quantity.
 *
 * @param sqlType - Either side's rendering.
 * @returns The comparable form.
 */
function normalizeType(sqlType: string): string {
    return sqlType.replace(/^varchar\b/u, 'character varying').replace(/,\s+/gu, ',');
}

/**
 * ⛔ Every way a model and its real table disagree.
 *
 * Pure, so the gates below can be fired at models built to break each claim rather than only run over a
 * tree that happens to be clean.
 *
 * @param model - The table as the Drizzle model declares it.
 * @param actual - The table's real columns, or `undefined` when the table does not exist.
 * @param unmodelledByRuling - Documented `table.column` exceptions for C5.
 * @returns One message per disagreement; empty when the model faithfully represents the table.
 */
export function conformanceViolations(
    model: ModelTable,
    actual: readonly ActualColumn[] | undefined,
    unmodelledByRuling: ReadonlyMap<string, string> = UNMODELLED_BY_RULING,
): readonly string[] {
    if (actual === undefined) {
        return [
            `${model.name}: the Drizzle barrel declares this table and no migration creates it — every ` +
                'query against the model raises 42P01 the first time it runs',
        ];
    }

    const byName = new Map(actual.map((column) => [column.name, column]));
    const violations: string[] = [];

    for (const column of model.columns) {
        const real = byName.get(column.name);

        if (real === undefined) {
            violations.push(
                `${model.name}.${column.name}: declared by the model, absent from the table — Drizzle names ` +
                    'every declared column on every statement, so this breaks EVERY query against the table',
            );
            continue;
        }

        if (normalizeType(column.sqlType) !== normalizeType(real.pgType)) {
            violations.push(
                `${model.name}.${column.name}: the model declares \`${column.sqlType}\` and the column is ` +
                    `\`${real.pgType}\` — the inferred row type lies to every reader`,
            );
        }

        if (column.notNull !== real.notNull) {
            violations.push(
                `${model.name}.${column.name}: the model says notNull=${String(column.notNull)} and the ` +
                    `column says ${String(real.notNull)} — one of the two is wrong about what may be absent`,
            );
        }
    }

    const declared = new Set(model.columns.map((column) => column.name));

    for (const real of actual) {
        if (declared.has(real.name) || unmodelledByRuling.has(`${model.name}.${real.name}`)) {
            continue;
        }

        violations.push(
            `${model.name}.${real.name}: the table has this column and no model declares it. If that is an ` +
                'expand-first contraction in flight (ADR-0022 §3), record it in UNMODELLED_BY_RULING with ' +
                'its reason; otherwise the column was added and never modelled',
        );
    }

    return violations;
}

/**
 * Every `pgTable` the barrel exports, reduced to the shape {@link conformanceViolations} compares.
 *
 * Discovered from the barrel — the same object `client.ts` hands `drizzle(pool, { schema })` — so the
 * subjects here are exactly the models the service runs on.
 *
 * @returns One descriptor per exported table.
 */
function modelTables(): readonly ModelTable[] {
    return (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => ({
            name: getTableName(table),
            columns: Object.values(getTableColumns(table)).map((column) => ({
                name: column.name,
                sqlType: column.getSQLType(),
                notNull: column.notNull,
            })),
        }));
}

/**
 * Every ordinary table in `public`, with its real columns.
 *
 * `pg_attribute` + `format_type` rather than `information_schema.columns`, because `information_schema`
 * splits a type across `data_type` + `character_maximum_length` + `numeric_precision` + `numeric_scale`,
 * and reassembling those is a second place for the comparison to be wrong. `format_type` is the renderer
 * Postgres itself uses.
 *
 * @param pool - A pool on the migrated database.
 * @returns Table name → its columns.
 * @sideEffect Reads the database catalog.
 */
async function actualTables(pool: pg.Pool): Promise<ReadonlyMap<string, readonly ActualColumn[]>> {
    const { rows } = await pool.query<{
        table_name: string;
        column_name: string;
        pg_type: string;
        not_null: boolean;
    }>(
        `SELECT c.relname AS table_name,
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS pg_type,
                a.attnotnull AS not_null
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY c.relname, a.attnum`,
    );

    const byTable = new Map<string, ActualColumn[]>();

    for (const row of rows) {
        const columns = byTable.get(row.table_name) ?? [];

        columns.push({ name: row.column_name, pgType: row.pg_type, notNull: row.not_null });
        byTable.set(row.table_name, columns);
    }

    return byTable;
}

describe.skipIf(!hasDatabaseUrl)('every Drizzle model faithfully represents its migrated table', () => {
    let pool: pg.Pool;
    let actual: ReadonlyMap<string, readonly ActualColumn[]>;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        actual = await actualTables(pool);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('discovers the models at all, including the ones no DAL exercises', () => {
        // ⛔ The ANCHOR, and the reason it is here rather than being tidied away. Every assertion below is
        // a `flatMap` over this list; a barrel that failed to load, or an `is(value, PgTable)` that stopped
        // matching after a Drizzle upgrade, would turn all of them into assertions over nothing and the
        // suite would go green having proved less than nothing.
        //
        // `ingredient_parse_cache` is named because it is the model this suite exists for — the one whose
        // last consumer was deleted. It is the anchor, never the subject: the gates enumerate nothing.
        const names = modelTables().map((table) => table.name);

        expect(names).toContain('ingredient_parse_cache');
        expect(names.length).toBeGreaterThan(20);
    });

    it('⛔ declares no table, column, type or nullability the database disagrees with', () => {
        const violations = modelTables().flatMap((model) => conformanceViolations(model, actual.get(model.name)));

        expect(
            violations,
            'a Drizzle model is a CLAIM about the migrated table and nothing in TypeScript relates the two — ' +
                'drift surfaces as a runtime 42703 on the first query that names the wrong column',
        ).toStrictEqual([]);
    });

    it('⛔ accounts for every table in the database — modelled, another deployable’s, or the runner’s', () => {
        // The mirror of the assertion above, and it catches the case that one structurally cannot: a
        // migration that creates a table this service was supposed to model and nobody did. Stated as an
        // EQUALITY so a new unmodelled table is a deliberate act rather than a silence.
        const modelled = new Set(modelTables().map((table) => table.name));
        const unaccounted = [...actual.keys()]
            .filter((name) => !modelled.has(name))
            .filter((name) => !UNMODELLED_TABLES.includes(name) && !RUNNER_TABLES.includes(name))
            .sort();

        expect(unaccounted, 'a table with no model and no recorded owner is one nobody is maintaining').toStrictEqual(
            [],
        );
    });

    it('⛔ EXECUTES every model against the real table, not just its description', async () => {
        // ⛔ Not redundant with the metadata comparison above. That compares two DESCRIPTIONS; this runs the
        // SQL Drizzle actually renders — identifier quoting, array and enum serialisation, a generated
        // column it should not have selected. `limit(0)` names every declared column and returns no rows,
        // so it is the cheapest statement that proves Postgres accepts the model.
        const db = createRecipeDrizzle(pool);
        const failures: string[] = [];

        for (const table of (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
            is(value, PgTable),
        )) {
            try {
                await db.select().from(table).limit(0);
            } catch (error) {
                failures.push(`${getTableName(table)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        expect(failures, 'a model Postgres refuses is a model no query can use').toStrictEqual([]);
    });

    it('keeps UNMODELLED_BY_RULING honest — every entry names a column that is really there', () => {
        // ⛔ The exception map's own gate. An entry that outlives the column it excuses is a standing licence
        // for a future column of that name to go unmodelled, which is exactly the silence C5 exists to break.
        const stale = [...UNMODELLED_BY_RULING.keys()].filter((key) => {
            const [tableName, columnName] = key.split('.');

            return !(actual.get(tableName ?? '') ?? []).some((column) => column.name === columnName);
        });

        expect(stale, 'the DROP has landed — delete the entry rather than leaving a licence behind').toStrictEqual([]);
    });
});

// ───────────────────────────── deliberately-violating models ─────────────────────────────
//
// Each claim is fired at a model built to break it, so a gate that silently stops matching fails HERE
// rather than passing vacuously over a clean schema forever.

/** A real table, faithfully modelled — the baseline every fake below is one edit away from. */
const FAITHFUL: { model: ModelTable; actual: readonly ActualColumn[] } = {
    model: {
        name: 'ingredient_parse_cache',
        columns: [
            { name: 'parse_key', sqlType: 'text', notNull: true },
            { name: 'engine', sqlType: 'text', notNull: true },
        ],
    },
    actual: [
        { name: 'parse_key', pgType: 'text', notNull: true },
        { name: 'engine', pgType: 'text', notNull: true },
    ],
};

describe('the gates fire — each one, at a model built to break it', () => {
    it('passes a model that faithfully represents its table', () => {
        expect(conformanceViolations(FAITHFUL.model, FAITHFUL.actual)).toStrictEqual([]);
    });

    it('catches a model whose table no migration creates', () => {
        expect(conformanceViolations(FAITHFUL.model, undefined)).toStrictEqual([
            expect.stringContaining('no migration creates it') as unknown as string,
        ]);
    });

    it('catches a declared column the table does not have — the 42703 direction', () => {
        const model: ModelTable = {
            ...FAITHFUL.model,
            columns: [...FAITHFUL.model.columns, { name: 'owner_id', sqlType: 'text', notNull: false }],
        };

        expect(conformanceViolations(model, FAITHFUL.actual)).toStrictEqual([
            expect.stringContaining('declared by the model, absent from the table') as unknown as string,
        ]);
    });

    it('catches a type the model spells differently in SUBSTANCE, past the two spellings it forgives', () => {
        // ⛔ Both halves matter. `varchar(255)` vs `character varying(255)` is the SAME type and must pass,
        // or the suite is red on a clean schema and gets deleted. `numeric(10, 3)` vs `numeric(8, 2)` is a
        // precision change that silently rounds every stored quantity and must NOT pass.
        const spelling = conformanceViolations(
            { name: 't', columns: [{ name: 'c', sqlType: 'varchar(255)', notNull: true }] },
            [{ name: 'c', pgType: 'character varying(255)', notNull: true }],
        );
        const precision = conformanceViolations(
            { name: 't', columns: [{ name: 'c', sqlType: 'numeric(10, 3)', notNull: true }] },
            [{ name: 'c', pgType: 'numeric(8,2)', notNull: true }],
        );

        expect(spelling).toStrictEqual([]);
        expect(precision).toStrictEqual([
            expect.stringContaining('the model declares `numeric(10, 3)`') as unknown as string,
        ]);
    });

    it('catches a nullability the model and the column disagree about', () => {
        expect(
            conformanceViolations({ name: 't', columns: [{ name: 'c', sqlType: 'text', notNull: true }] }, [
                { name: 'c', pgType: 'text', notNull: false },
            ]),
        ).toStrictEqual([expect.stringContaining('the model says notNull=true') as unknown as string]);
    });

    it('catches an UNDOCUMENTED table column no model declares, and forgives a documented one', () => {
        const withExtra: readonly ActualColumn[] = [
            ...FAITHFUL.actual,
            { name: 'device_label', pgType: 'text', notNull: false },
        ];

        expect(conformanceViolations(FAITHFUL.model, withExtra, new Map())).toStrictEqual([
            expect.stringContaining('the table has this column and no model declares it') as unknown as string,
        ]);
        expect(
            conformanceViolations(
                FAITHFUL.model,
                withExtra,
                new Map([['ingredient_parse_cache.device_label', 'expand-first contraction in flight']]),
            ),
        ).toStrictEqual([]);
    });
});
