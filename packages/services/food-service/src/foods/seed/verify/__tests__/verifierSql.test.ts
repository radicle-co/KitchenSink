/**
 * ⛔ The verifier's SQL keeps the rules that make it independent (curated catalog plan U6, KTD-2, KTD-3).
 *
 * - Every file in `sql/` is listed exactly once, so none sits unread and none listed is missing.
 * - A derivation file never names a catalog table: an expected state read off the catalog agrees with it by
 *   construction. `liveCatalog.sql` is the one exception, and it only defines views the checks read.
 * - Every catalog table a file names is schema-qualified. The session's temp schema is searched first, so an
 *   unqualified `food` could resolve to a temp table and the check would compare the seed with itself.
 * - Every object the SQL creates is a session object (`TEMP`, `pg_temp.`) prefixed `v_`.
 * - A check file is one statement that only reads, so it runs inside the READ ONLY transaction (KTD-2).
 * - No file reads `food_item.seed_owned`, the seeder's ownership column: rows are selected through their owners' natural
 *   keys, so a row the seeder marked wrongly is still compared (KTD-3).
 *
 * Each rule is a pure predicate below, fired first at fixture SQL that breaks it, so a predicate that matches nothing
 * cannot pass the real files vacuously.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FOOD_CATALOG_REGISTRY } from '../../../../db/schema/catalog.js';
import { CHECK_SQL, PREPARE_SQL, REFUSALS_SQL } from '../verifierSql.js';

const SQL_DIR = join(import.meta.dirname, '../sql');

/** The one derivation file that may name the catalog: it defines the views the checks read. */
const LIVE_VIEWS = 'liveCatalog.sql';

/** Every table the seed writes or reads: the catalog, the ledger and the dictionaries. */
const CATALOG_NAMES: readonly string[] = [
    ...FOOD_CATALOG_REGISTRY.catalog,
    ...FOOD_CATALOG_REGISTRY.serviceReadOnly,
    ...FOOD_CATALOG_REGISTRY.dictionaries,
];

/**
 * SQL with its comments and string literals blanked, so only code is matched. Pure.
 *
 * @param sql - A file's text.
 * @returns The text with every comment and quoted literal replaced by a space.
 */
function codeOf(sql: string): string {
    return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/gu, ' ');
}

/**
 * The catalog tables a text names, qualified or not. Pure.
 *
 * @param sql - SQL text.
 * @returns Each naming, as written.
 */
function catalogNamings(sql: string): string[] {
    const names = CATALOG_NAMES.join('|');

    return [...codeOf(sql).matchAll(new RegExp(`(?:\\b[a-z_]+\\.)?\\b(?:${names})\\b(?!\\s*\\()`, 'gu'))].map(
        (match) => match[0],
    );
}

/**
 * The catalog tables a text names without the `public.` schema. A name after any other qualifier is a column. Pure.
 *
 * @param sql - SQL text.
 * @returns Each unqualified naming.
 */
function unqualifiedCatalogNames(sql: string): string[] {
    return catalogNamings(sql).filter((naming) => !naming.includes('.'));
}

/**
 * The objects a text creates that are not session objects prefixed `v_`. Pure.
 *
 * @param sql - SQL text.
 * @returns Each offending `CREATE`, as written.
 */
function nonSessionCreates(sql: string): string[] {
    return [
        ...codeOf(sql).matchAll(
            /\bCREATE\s+(?:OR\s+REPLACE\s+)?[A-Z ]*?\b(?:TABLE|VIEW|FUNCTION|INDEX|SEQUENCE)\s+[^\s(]+/giu,
        ),
    ]
        .map((match) => match[0].replace(/\s+/gu, ' '))
        .filter(
            (statement) =>
                !/^CREATE TEMP (?:TABLE|VIEW) v_[a-z0-9_]+$/u.test(statement) &&
                !/^CREATE FUNCTION pg_temp\.v_[a-z0-9_]+$/u.test(statement),
        );
}

/**
 * The session objects a text names without `pg_temp.`. A check runs with `pg_temp` LAST on the search path (the seed
 * transaction sets it so), where an unqualified name would let a same-named permanent table stand in for the expected
 * state. Pure.
 *
 * @param sql - SQL text.
 * @returns Each unqualified `v_` name.
 */
function unqualifiedSessionNames(sql: string): string[] {
    return [...codeOf(sql).matchAll(/(?<![.\w])v_[a-z0-9_]+/gu)].map((match) => match[0]);
}

/**
 * Whether a text reads the seeder's ownership column. Pure.
 *
 * @param sql - SQL text.
 * @returns `true` when code (not a comment) names `seed_owned`.
 */
function readsOwnershipColumn(sql: string): boolean {
    return /\bseed_owned\b/u.test(codeOf(sql));
}

/**
 * Why a check file is not one read-only statement, if it is not. Pure.
 *
 * @param sql - A check file's text.
 * @returns The reason, or `undefined` when it is one `SELECT` or `WITH … SELECT` that writes nothing.
 */
function checkShapeFault(sql: string): string | undefined {
    const code = codeOf(sql).trim().replace(/;\s*$/u, '');

    if (code.includes(';')) {
        return 'holds more than one statement';
    }

    if (!/^(?:SELECT|WITH)\b/iu.test(code)) {
        return 'does not start with SELECT or WITH';
    }

    const writes = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|SET)\b/iu.exec(code);

    return writes === null ? undefined : `holds ${writes[0]}`;
}

/** Every SQL file in the directory, by name. */
function sqlFiles(): ReadonlyMap<string, string> {
    return new Map(
        readdirSync(SQL_DIR)
            .filter((name) => name.endsWith('.sql'))
            .map((name) => [name, readFileSync(join(SQL_DIR, name), 'utf8')]),
    );
}

describe('the predicates catch what they claim to', () => {
    it.each<[string, string, readonly string[]]>([
        ['an unqualified table', 'SELECT * FROM food root', ['food']],
        ['an unqualified join', 'SELECT 1 FROM public.food f JOIN food_item i ON true', ['food_item']],
        ['a dictionary', 'SELECT name FROM nutrient', ['nutrient']],
        ['the ledger', 'SELECT 1 FROM catalog_seed_ledger', ['catalog_seed_ledger']],
        ['a qualified table', 'SELECT 1 FROM public.food_sources', []],
        ['a column of the same stem', 'SELECT food_id, item.food_variant_id FROM v_expected_root', []],
        ['a prefixed temp table', 'SELECT 1 FROM v_usda_food_category', []],
        ['a comment or a literal', "-- food\nSELECT 'food' AS table_name", []],
    ])('unqualifiedCatalogNames: %s', (_case, sql, expected) => {
        expect(unqualifiedCatalogNames(sql)).toEqual(expected);
    });

    it.each<[string, string, readonly string[]]>([
        ['a permanent table', 'CREATE TABLE food_copy (x int)', ['CREATE TABLE food_copy']],
        [
            'an unprefixed temp table',
            'CREATE TEMP TABLE expected_root AS SELECT 1',
            ['CREATE TEMP TABLE expected_root'],
        ],
        ['a public function', 'CREATE FUNCTION v_fold(t text) RETURNS text', ['CREATE FUNCTION v_fold']],
        ['an index', 'CREATE INDEX v_index ON v_expected_root (seed_key)', ['CREATE INDEX v_index']],
        ['a session table and function', 'CREATE TEMP TABLE v_a AS SELECT 1; CREATE FUNCTION pg_temp.v_f()', []],
    ])('nonSessionCreates: %s', (_case, sql, expected) => {
        expect(nonSessionCreates(sql)).toEqual(expected);
    });

    it.each<[string, string, readonly string[]]>([
        ['an unqualified expected table', 'SELECT * FROM v_expected_root', ['v_expected_root']],
        ['an unqualified view', 'SELECT 1 FROM pg_temp.v_a JOIN v_live_owner o ON true', ['v_live_owner']],
        ['a qualified table', 'SELECT * FROM pg_temp.v_expected_root', []],
        ['a column that starts with v_', 'SELECT root.v_count FROM pg_temp.v_x root', []],
    ])('unqualifiedSessionNames: %s', (_case, sql, expected) => {
        expect(unqualifiedSessionNames(sql)).toEqual(expected);
    });

    it.each<[string, string, boolean]>([
        ['a selection by ownership', 'SELECT 1 FROM public.food_item item WHERE item.seed_owned', true],
        ['a comment that names it', '-- never seed_owned\nSELECT 1', false],
        ['a column of a longer name', 'SELECT seed_owned_count FROM pg_temp.v_x', false],
    ])('readsOwnershipColumn: %s', (_case, sql, expected) => {
        expect(readsOwnershipColumn(sql)).toBe(expected);
    });

    it.each<[string, string, string | undefined]>([
        ['two statements', 'SELECT 1; SELECT 2', 'holds more than one statement'],
        ['a write', 'WITH gone AS (DELETE FROM public.food RETURNING id) SELECT * FROM gone', 'holds DELETE'],
        ['a temp write', 'INSERT INTO v_failures SELECT 1', 'does not start with SELECT or WITH'],
        ['a setting', 'SELECT set_config(1); SET LOCAL x = 1', 'holds more than one statement'],
        ['one read', "WITH a AS (SELECT 1) SELECT 'DELETE' FROM a;\n", undefined],
    ])('checkShapeFault: %s', (_case, sql, expected) => {
        expect(checkShapeFault(sql)).toBe(expected);
    });
});

describe('the verifier SQL', () => {
    it('lists every file in sql/ exactly once', () => {
        const listed = [...PREPARE_SQL, REFUSALS_SQL, ...CHECK_SQL];

        expect(new Set(listed).size).toBe(listed.length);
        expect([...sqlFiles().keys()].sort()).toEqual([...listed].sort());
    });

    it('⛔ derives the expected catalog without reading the catalog', () => {
        const faults = [...PREPARE_SQL, REFUSALS_SQL]
            .filter((name) => name !== LIVE_VIEWS)
            .flatMap((name) => catalogNamings(sqlFiles().get(name) ?? '').map((naming) => `${name}: ${naming}`));

        expect(faults).toEqual([]);
    });

    it('⛔ schema-qualifies every catalog table it names', () => {
        const faults = [...sqlFiles()].flatMap(([name, sql]) =>
            unqualifiedCatalogNames(sql).map((naming) => `${name}: ${naming}`),
        );

        expect(faults).toEqual([]);
        expect(catalogNamings(sqlFiles().get(LIVE_VIEWS) ?? '').length).toBeGreaterThan(0);
    });

    it('⛔ creates only session objects prefixed v_', () => {
        const faults = [...sqlFiles()].flatMap(([name, sql]) =>
            nonSessionCreates(sql).map((statement) => `${name}: ${statement}`),
        );

        expect(faults).toEqual([]);
    });

    it('⛔ names every session object by pg_temp in the checks, which run with pg_temp last on the path', () => {
        const faults = CHECK_SQL.flatMap((name) =>
            unqualifiedSessionNames(sqlFiles().get(name) ?? '').map((naming) => `${name}: ${naming}`),
        );

        expect(faults).toEqual([]);
    });

    it("⛔ never reads the seeder's ownership column", () => {
        expect([...sqlFiles()].filter(([, sql]) => readsOwnershipColumn(sql)).map(([name]) => name)).toEqual([]);
    });

    it('⛔ makes each check, and the refusals, one statement that only reads', () => {
        const faults = [...CHECK_SQL, REFUSALS_SQL].flatMap((name) => {
            const fault = checkShapeFault(sqlFiles().get(name) ?? '');

            return fault === undefined ? [] : [`${name} ${fault}`];
        });

        expect(faults).toEqual([]);
    });
});
