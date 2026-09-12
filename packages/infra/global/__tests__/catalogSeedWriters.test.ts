// @vitest-environment node
/**
 * ⛔ Who writes food's item-keyed catalog (curated catalog plan U4, KTD-12, KTD-13).
 *
 * The ownership trigger decides at run time WHICH ROWS a role may change. This guard decides at review time WHICH
 * CODE may write a catalog table at all, so a new writer is a decision someone makes on purpose:
 *
 * - The seed-only tables (variants, their parts, forwards and the seed ledger) are written only under
 *   `foods/seed/catalog/` and by a writer registered for that table. The live path never creates a variant, and only
 *   U8's live retirement will write a forward; that writer is registered when it lands.
 * - Every other writer of `food_item`, the per-item tables and the nutrition tables is registered here, file by file,
 *   with the reason it writes.
 * - A `DELETE FROM food` is written only by the erasure pair and the seed: a root owns its item, and every deleter must
 *   delete the item too, or leave it ownerless and unreachable.
 *
 * Writes are read from the source with comments blanked: raw SQL (`INSERT INTO`, `UPDATE`, `DELETE FROM`), the same
 * with an interpolated Drizzle table, and Drizzle builder calls (`.insert(table)`, `.update(table)`, `.delete(table)`).
 * Nothing here lists tables: the guarded set is read from food's registry (`catalog.ts`), and which identifier names
 * which table from the `pgTable` declarations, so a newly registered catalog table is guarded with no edit here.
 */
import { describe, expect, it } from 'vitest';

import { readSource, withoutTsComments } from './roleSplitSources.js';
import { isTestFile, presentFiles } from './serviceSources.js';
import { findPgTables } from './specDeclarations.js';

const FOOD_SRC = 'packages/services/food-service/src';

/** The seed's own directory: the one writer of the seed-only tables. */
const SEED_CATALOG_DIR = `${FOOD_SRC}/foods/seed/catalog/`;

/**
 * The SC-007 perf fixture (curated plan U8). It sits under `tests/`, so the scan below would skip it, yet it writes a
 * seeded catalog the way the seed does, into a database `perfFixture.ts`'s allowlist names as disposable.
 */
const PERF_FIXTURE = 'packages/services/food-service/tests/load/preparePerfFixture.ts';

/** Food's Drizzle schema modules: the one place a table is declared. */
const SCHEMA_DIR = `${FOOD_SRC}/db/schema`;

/** The registry module whose table lists say which tables are the guarded catalog (KTD-13). */
const CATALOG_REGISTRY = `${SCHEMA_DIR}/catalog.ts`;

/** `const x = pgTable('name'`: a Drizzle table declaration, whose call may span lines. */
const PG_TABLE_DECLARATION = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*pgTable\(\s*'([a-z_][a-z0-9_]*)'/gu;

/**
 * The Drizzle table objects declared in some schema sources, by the table each declares. Pure.
 *
 * @param sources - The schema modules' texts.
 * @returns Each declared identifier with its table name.
 */
export function drizzleTablesIn(sources: readonly string[]): ReadonlyMap<string, string> {
    return new Map(
        sources.flatMap((text) =>
            [...withoutTsComments(text).matchAll(PG_TABLE_DECLARATION)].map((match): readonly [string, string] => [
                match[1] ?? '',
                match[2] ?? '',
            ]),
        ),
    );
}

/**
 * The identifiers a registry module lists in its named table arrays. Pure.
 *
 * @param text - The registry module's text.
 * @param lists - The array constants to read.
 * @returns Every listed identifier, in source order.
 */
export function listedTables(text: string, lists: readonly string[]): readonly string[] {
    const code = withoutTsComments(text);

    return lists.flatMap((list) => {
        const body = new RegExp(`\\bconst\\s+${list}\\b[^=]*=\\s*\\[([^\\]]*)\\]`, 'u').exec(code)?.[1];

        return body === undefined
            ? []
            : body
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter((entry) => entry !== '');
    });
}

/** The schema modules, read once. */
const schemaSources = (): readonly string[] => presentFiles([`${SCHEMA_DIR}/*.ts`]).map((file) => readSource(file));

/** The Drizzle table objects a writer can name, by the table each declares. */
const DRIZZLE_TABLES: ReadonlyMap<string, string> = drizzleTablesIn(schemaSources());

/** The registry lists naming the guarded tables: the seeded catalog and the seeder-appended ledger. */
const GUARDED_LISTS: readonly string[] = ['CATALOG_TABLES', 'SERVICE_READ_ONLY_TABLES'];

/** The guarded tables, by name, read from the registry rather than restated here. */
const GUARDED_TABLES: ReadonlySet<string> = new Set(
    listedTables(readSource(CATALOG_REGISTRY), GUARDED_LISTS).flatMap((identifier) => {
        const table = DRIZZLE_TABLES.get(identifier);

        return table === undefined ? [] : [table];
    }),
);

/** Tables only the seed writes. */
const SEED_ONLY_TABLES: readonly string[] = [
    'food_variant',
    'food_variant_part',
    'food_forward',
    'catalog_seed_ledger',
];

/** The erasure pair: the only live code that deletes a root, and each deletes its item in the same statement. */
const FOOD_DELETERS: readonly string[] = [
    `${FOOD_SRC}/foods/eraseFoodRows.ts`,
    `${FOOD_SRC}/foods/purgeTestPrincipalFoods.ts`,
];

/** Why the perf fixture writes a catalog table: it seeds the SC-007 store, outside the deploy seed. */
const PERF_FIXTURE_REASON = 'the perf fixture seeds a synthetic catalog into a disposable database (perfFixture.ts)';

/** Every writer outside the seed of a catalog table, and why it writes. */
const REGISTERED_WRITERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    food_variant: {
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_variant_part: {
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_item: {
        [`${FOOD_SRC}/foods/dao/foodItem.dao.ts`]: 'the item gateway creates every live root with its item',
        [`${FOOD_SRC}/foods/eraseFoodRows.ts`]: 'erasure deletes each erased root’s item',
        [`${FOOD_SRC}/foods/purgeTestPrincipalFoods.ts`]: 'the test-principal purge deletes each purged root’s item',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_sources: {
        [`${FOOD_SRC}/foods/dao/foodSources.dao.ts`]: 'the live merge records each contributing item',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_field_provenance: {
        [`${FOOD_SRC}/foods/dao/foodFieldProvenance.dao.ts`]: 'the live merge records which item supplied a field',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_category_assignment: {
        [`${FOOD_SRC}/foods/dao/foodCategory.dao.ts`]: 'the category gateway assigns a live food',
    },
    food_portions: {
        [`${FOOD_SRC}/foods/dao/foodPortions.dao.ts`]: 'the live merge writes each item’s portions',
        [`${FOOD_SRC}/foods/dao/authoredFoods.dao.ts`]: 'an author writes and replaces their own portions',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_nutrition: {
        [`${FOOD_SRC}/foods/dao/foodNutrition.dao.ts`]: 'a live or authored root gets its one header',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_nutrition_citation: {
        [`${FOOD_SRC}/foods/dao/foodNutrition.dao.ts`]: 'the live merge cites each contributing item',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
    food_nutrition_value: {
        [`${FOOD_SRC}/foods/dao/foodNutrition.dao.ts`]:
            'the live merge writes each winning value, and an author replaces their own uncited values',
        [PERF_FIXTURE]: PERF_FIXTURE_REASON,
    },
};

/** One write a source file makes. */
export interface CatalogWrite {
    readonly file: string;
    readonly table: string;
    readonly verb: 'INSERT' | 'UPDATE' | 'DELETE';
}

const RAW_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_][a-z0-9_]*)"?/giu;
/** A raw write that names its table by interpolating a Drizzle table object: ``sql`DELETE FROM ${foodItem}` ``. */
const INTERPOLATED_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\$\{\s*([A-Za-z_$][\w$]*)\s*\}/giu;
const BUILDER_WRITE = /\.(insert|update|delete)\(\s*([A-Za-z_$][\w$]*)\s*\)/gu;

/**
 * The catalog writes in one file's code. Pure.
 *
 * @param file - The file's repo-relative path.
 * @param text - Its text.
 * @returns One entry per raw-SQL or builder write that names a catalog table.
 */
export function catalogWritesIn(file: string, text: string): readonly CatalogWrite[] {
    const code = withoutTsComments(text);
    const verbOf = (written: string): string | undefined => written.toUpperCase().split(/\s+/u)[0];
    const named = (verb: string | undefined, table: string | undefined): readonly CatalogWrite[] =>
        table !== undefined &&
        GUARDED_TABLES.has(table) &&
        (verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE')
            ? [{ file, table, verb }]
            : [];

    return [
        ...[...code.matchAll(RAW_WRITE)].flatMap((match) =>
            named(verbOf(match[1] ?? ''), (match[2] ?? '').toLowerCase()),
        ),
        ...[...code.matchAll(INTERPOLATED_WRITE)].flatMap((match) =>
            named(verbOf(match[1] ?? ''), DRIZZLE_TABLES.get(match[2] ?? '')),
        ),
        ...[...code.matchAll(BUILDER_WRITE)].flatMap((match) =>
            named(verbOf(match[1] ?? ''), DRIZZLE_TABLES.get(match[2] ?? '')),
        ),
    ];
}

/**
 * Every write the rules refuse. Pure.
 *
 * @param writes - The writes found.
 * @returns One message per refused write.
 */
export function writerViolations(writes: readonly CatalogWrite[]): readonly string[] {
    const inSeed = (file: string): boolean => file.startsWith(SEED_CATALOG_DIR);

    return writes.flatMap(({ file, table, verb }) => {
        if (inSeed(file)) {
            return [];
        }

        if (SEED_ONLY_TABLES.includes(table)) {
            return REGISTERED_WRITERS[table]?.[file] === undefined
                ? [`${file}: ${verb} ${table} — only foods/seed/catalog/ writes a seed-only table`]
                : [];
        }

        if (table === 'food') {
            return verb === 'DELETE' && !FOOD_DELETERS.includes(file)
                ? [`${file}: DELETE food — only the erasure pair deletes a root, with its item`]
                : [];
        }

        return REGISTERED_WRITERS[table]?.[file] === undefined
            ? [`${file}: ${verb} ${table} — an unregistered writer; register it with its reason`]
            : [];
    });
}

/** Every production source of the food service, and the perf fixture. */
const foodSources = (): readonly string[] => [
    ...presentFiles([`${FOOD_SRC}/**/*.ts`]).filter((file) => !isTestFile(file)),
    ...presentFiles([PERF_FIXTURE]),
];

describe('catalogWritesIn and writerViolations', () => {
    const cases: readonly (readonly [string, string, string, readonly string[]])[] = [
        [
            'a raw item insert by a registered writer',
            `${FOOD_SRC}/foods/dao/foodItem.dao.ts`,
            'sql`INSERT INTO food_item (id) VALUES (1)`',
            [],
        ],
        [
            'a raw item insert by an unregistered file',
            `${FOOD_SRC}/foods/rogue.ts`,
            'sql`INSERT INTO food_item (id) VALUES (1)`',
            [`${FOOD_SRC}/foods/rogue.ts: INSERT food_item — an unregistered writer; register it with its reason`],
        ],
        [
            'a builder write to a seed-only table outside the seed',
            `${FOOD_SRC}/foods/dao/food.dao.ts`,
            'await tx.insert(foodVariant).values({})',
            [
                `${FOOD_SRC}/foods/dao/food.dao.ts: INSERT food_variant — only foods/seed/catalog/ writes a seed-only table`,
            ],
        ],
        [
            'a seed-only write by the writer registered for that table',
            PERF_FIXTURE,
            'sql`INSERT INTO food_variant (id) VALUES (1)`',
            [],
        ],
        [
            'a seed-only write by a registered writer of other tables only',
            PERF_FIXTURE,
            'sql`INSERT INTO food_forward (source_id) VALUES (1)`',
            [`${PERF_FIXTURE}: INSERT food_forward — only foods/seed/catalog/ writes a seed-only table`],
        ],
        [
            'a seed-only write inside the seed',
            `${SEED_CATALOG_DIR}apply.ts`,
            'sql`DELETE FROM food_forward WHERE true`',
            [],
        ],
        [
            'a bare DELETE FROM food outside the erasure pair',
            `${FOOD_SRC}/foods/foods.service.ts`,
            'sql`DELETE FROM food WHERE id = x`',
            [`${FOOD_SRC}/foods/foods.service.ts: DELETE food — only the erasure pair deletes a root, with its item`],
        ],
        [
            'a builder delete of food outside the erasure pair',
            `${FOOD_SRC}/foods/foods.service.ts`,
            'await db.delete(food).where(x)',
            [`${FOOD_SRC}/foods/foods.service.ts: DELETE food — only the erasure pair deletes a root, with its item`],
        ],
        [
            'a DELETE FROM food inside the erasure pair',
            `${FOOD_SRC}/foods/eraseFoodRows.ts`,
            'sql`DELETE FROM food WHERE x`',
            [],
        ],
        [
            'a raw write naming its table by an interpolated Drizzle table',
            `${FOOD_SRC}/foods/rogue.ts`,
            'sql`DELETE FROM ${foodItem} WHERE id = x`',
            [`${FOOD_SRC}/foods/rogue.ts: DELETE food_item — an unregistered writer; register it with its reason`],
        ],
        ['an UPDATE of food anywhere', `${FOOD_SRC}/foods/foods.service.ts`, "sql`UPDATE food SET status = 'X'`", []],
        ['a write in a comment', `${FOOD_SRC}/foods/rogue.ts`, '// INSERT INTO food_variant (id) VALUES (1)', []],
        ['an upsert clause naming no table', `${FOOD_SRC}/foods/rogue.ts`, 'sql`ON CONFLICT DO UPDATE SET a = 1`', []],
    ];

    it.each(cases)('judges %s', (_case, file, text, expected) => {
        expect(writerViolations(catalogWritesIn(file, text))).toStrictEqual(expected);
    });
});

describe('the table maps the guard reads from food’s schema', () => {
    it('reads a declaration that spans lines, and none from a comment', () => {
        const declared = drizzleTablesIn([
            "export const foodItem = pgTable(\n    'food_item',\n    { id: text('id') },\n);",
            "// export const ghost = pgTable('ghost_table', {});",
        ]);

        expect([...declared]).toStrictEqual([['foodItem', 'food_item']]);
    });

    it('reads the identifiers of the named lists only', () => {
        const text =
            'const CATALOG_TABLES: readonly PgTable[] = [\n    foodItem,\n    food,\n];\nconst OTHER = [fetchQueue];';

        expect(listedTables(text, ['CATALOG_TABLES'])).toStrictEqual(['foodItem', 'food']);
    });

    it('finds every table the TypeScript parser finds, so a declaration the pattern misses cannot hide a table', () => {
        const parsed = schemaSources().flatMap((text) => findPgTables(text).map(({ table }) => table));

        expect([...DRIZZLE_TABLES.values()].sort()).toStrictEqual([...parsed].sort());
    });

    it('resolves every identifier the registry lists, so a guarded table cannot fall out of the guard', () => {
        const listed = listedTables(readSource(CATALOG_REGISTRY), GUARDED_LISTS);

        expect(listed.filter((identifier) => !DRIZZLE_TABLES.has(identifier))).toStrictEqual([]);
        expect(listed.length).toBe(GUARDED_TABLES.size);
        expect(GUARDED_TABLES).toContain('food_item');
        expect(GUARDED_TABLES).toContain('catalog_seed_ledger');
    });
});

describe('the food service’s catalog writers', () => {
    it('discovers the service’s sources and its catalog writes — an empty scan would pass everything below', () => {
        const files = foodSources();
        const writes = files.flatMap((file) => catalogWritesIn(file, readSource(file)));

        expect(files.length).toBeGreaterThan(100);
        expect(writes.length).toBeGreaterThan(10);
        // The fixture is named, not globbed: a rename would drop it from the scan and pass everything below.
        expect(writes).toContainEqual({ file: PERF_FIXTURE, table: 'food_variant', verb: 'INSERT' });
    });

    it('⛔ writes no seed-only table outside the seed, deletes no root outside the erasure pair, and has no unregistered writer', () => {
        const writes = foodSources().flatMap((file) => catalogWritesIn(file, readSource(file)));

        expect(writerViolations(writes)).toStrictEqual([]);
    });

    it('registers only writers that still write their table, so the register cannot rot', () => {
        const writes = foodSources().flatMap((file) => catalogWritesIn(file, readSource(file)));
        const stale = Object.entries(REGISTERED_WRITERS).flatMap(([table, writers]) =>
            Object.keys(writers)
                .filter((file) => !writes.some((write) => write.table === table && write.file === file))
                .map((file) => `${table}: ${file}`),
        );

        expect(stale).toStrictEqual([]);
    });
});
