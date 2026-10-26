/**
 * Every closed vocabulary the bulk-import tables enforce in SQL is the SAME set the code names (ADR-0072 §5).
 *
 * A `CHECK (col IN (...))` is a second statement of a vocabulary the code already owns as a const, and nothing in
 * TypeScript relates the two: add a value to the const and the column still refuses it at the INSERT (a 500), or add it
 * to the CHECK and the code never produces it. So each pair is compared as SETS, read from the migration's own text.
 *
 * `bound_by` is the one the ADR names (one-way door for stored rows); the rest are the same defect waiting. The gate
 * fires at deliberate violations too (the second `describe`): a locator that quietly stopped matching would turn every
 * assertion here into one over an empty list.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MATCH_MODES, ITEM_REVIEWS } from '../../import/domain/importBindingPolicy.js';
import { boundBySchema } from '@kitchensink/recipe-core';

import { BOUND_BY_VALUES } from '../../recipes/domain/bindingOriginCarryForward.js';
import { importMatchModeSchema, importReviewMarkSchema, importStageSchema } from '../../recipes/import.schema.js';
import {
    IMPORT_ITEM_REVIEWS,
    IMPORT_LINE_REVIEWS,
    IMPORT_MATCH_MODES,
    IMPORT_MATCHED_BY,
    IMPORT_SOURCE_KINDS,
    IMPORT_STAGES,
    IMPORT_STATEMENT_KINDS,
    IMPORT_VISIBILITIES,
} from '../schema/recipeImports.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const read = (file: string): string => readFileSync(join(migrationsDir, file), 'utf8');

/**
 * The values of the `CHECK (<column> IN (...))` written on `<column>`'s own definition, as a sorted list.
 *
 * @param sql - The migration text.
 * @param table - The `CREATE TABLE` (or `ALTER TABLE`) block the column is in, so a same-named column elsewhere cannot answer.
 * @param column - The column name.
 * @returns The values, sorted; `undefined` when the column has no such CHECK in that block. Pure.
 */
function inListOf(sql: string, table: string, column: string): string[] | undefined {
    const start = sql.indexOf(table);

    if (start === -1) {
        return undefined;
    }

    const rest = sql.slice(start);
    const next = rest.slice(1).search(/\n(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE|COMMENT ON)/u);
    const block = next === -1 ? rest : rest.slice(0, next + 1);
    const match = new RegExp(`\\b${column}\\b[^,;()]*?CHECK \\(\\s*${column} IN \\(([^)]*)\\)\\)`, 'u').exec(block);

    if (match?.[1] === undefined) {
        return undefined;
    }

    return [...match[1].matchAll(/'([^']*)'/gu)].map((value) => value[1] ?? '').sort();
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

const MIGRATION_0059 = read('0059_recipe_imports.sql');
const MIGRATION_0060 = read('0060_ingredient_binding_origin.sql');

describe('the bulk-import CHECK vocabularies are the code vocabularies', () => {
    it.each([
        ['recipe_imports.match_mode', 'CREATE TABLE recipe_imports', 'match_mode', MATCH_MODES],
        ['recipe_imports.visibility', 'CREATE TABLE recipe_imports', 'visibility', IMPORT_VISIBILITIES],
        ['recipe_import_items.stage', 'CREATE TABLE recipe_import_items', 'stage', IMPORT_STAGES],
        ['recipe_import_items.review', 'CREATE TABLE recipe_import_items', 'review', ITEM_REVIEWS],
        [
            'recipe_import_items.statement_kind',
            'CREATE TABLE recipe_import_items',
            'statement_kind',
            IMPORT_STATEMENT_KINDS,
        ],
        ['recipe_import_items.source_kind', 'CREATE TABLE recipe_import_items', 'source_kind', IMPORT_SOURCE_KINDS],
        ['recipe_import_items.visibility', 'CREATE TABLE recipe_import_items', 'visibility', IMPORT_VISIBILITIES],
        ['recipe_import_lines.matched_by', 'CREATE TABLE recipe_import_lines', 'matched_by', IMPORT_MATCHED_BY],
        ['recipe_import_lines.review', 'CREATE TABLE recipe_import_lines', 'review', IMPORT_LINE_REVIEWS],
    ] as const)('%s', (_name, table, column, vocabulary) => {
        expect(inListOf(MIGRATION_0059, table, column)).toStrictEqual(sorted(vocabulary));
    });

    it('⛔ ingredients.bound_by is exactly BOUND_BY_VALUES (ADR-0072 §5: a one-way door for stored rows)', () => {
        const check = /CONSTRAINT ingredients_bound_by_check\s+CHECK \(bound_by IN \(([^)]*)\)\)/u.exec(MIGRATION_0060);
        const values = [...(check?.[1] ?? '').matchAll(/'([^']*)'/gu)].map((value) => value[1] ?? '').sort();

        expect(values.length).toBeGreaterThan(0);
        expect(values).toStrictEqual(sorted(BOUND_BY_VALUES));
    });
});

describe('the drizzle mirror names the same vocabularies as the domain', () => {
    it('match modes and item reviews', () => {
        expect(sorted(IMPORT_MATCH_MODES)).toStrictEqual(sorted(MATCH_MODES));
        expect(sorted(IMPORT_ITEM_REVIEWS)).toStrictEqual(sorted(ITEM_REVIEWS));
    });
});

describe('the wire contract names the same vocabularies as the tables', () => {
    it('stages, review marks and match modes', () => {
        expect(sorted(importStageSchema.options)).toStrictEqual(sorted(IMPORT_STAGES));
        expect(sorted(importReviewMarkSchema.options)).toStrictEqual(sorted(IMPORT_ITEM_REVIEWS));
        expect(sorted(importMatchModeSchema.options)).toStrictEqual(sorted(IMPORT_MATCH_MODES));
    });

    it("⛔ the recipe line's boundBy (recipe-core), BOUND_BY_VALUES (the domain) and the CHECK are ONE set", () => {
        expect(sorted(boundBySchema.options)).toStrictEqual(sorted(BOUND_BY_VALUES));
    });
});

describe('the locator fires at deliberate violations', () => {
    const sql = `CREATE TABLE t (
    mode text NOT NULL CHECK (mode IN ('a', 'b')),
    other text CHECK (other IN ('x'))
);
CREATE TABLE u (
    mode text CHECK (mode IN ('z'))
);`;

    it('reads the named column of the named table, and no other', () => {
        expect(inListOf(sql, 'CREATE TABLE t', 'mode')).toStrictEqual(['a', 'b']);
        expect(inListOf(sql, 'CREATE TABLE u', 'mode')).toStrictEqual(['z']);
    });

    it('answers undefined for a column with no IN-list CHECK, so an assertion cannot pass over nothing', () => {
        expect(inListOf(sql, 'CREATE TABLE t', 'missing')).toBeUndefined();
        expect(inListOf(sql, 'CREATE TABLE nowhere', 'mode')).toBeUndefined();
    });

    it('detects a vocabulary that gained or lost a value on one side', () => {
        expect(inListOf(sql, 'CREATE TABLE t', 'mode')).not.toStrictEqual(sorted(['a']));
        expect(inListOf(sql, 'CREATE TABLE t', 'mode')).not.toStrictEqual(sorted(['a', 'b', 'c']));
    });
});
