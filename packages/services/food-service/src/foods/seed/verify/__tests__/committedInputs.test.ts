/**
 * The verifier's committed-input register restates the seeder's data layout and feeds the SQL every table it reads
 * (curated catalog plan U6, KTD-3, KTD-20).
 *
 * `committedInputs.ts` may not import `tableExtractFiles.ts` (the fence), so it restates where each table dataset's pins
 * and extract live. These cases hold the two to one answer per dataset, and hold the register to the SQL in both
 * directions: a loaded table nothing reads is an input the derivation silently ignores, and a `v_raw_` table the SQL
 * reads that nothing loads fails only on a real server.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { tablePinsPathOf } from '../../archive/tableExtractFiles.js';
import { TABLE_DATASETS } from '../../citationDatasets.js';
import { RAW_TABLES, TABLE_EXTRACTS, extractPinsPathOf } from '../committedInputs.js';

const SQL_DIR = join(import.meta.dirname, '../sql');

/** Every SQL file's text, joined. */
const ALL_SQL = readdirSync(SQL_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(SQL_DIR, name), 'utf8'))
    .join('\n');

describe('the committed-input register', () => {
    it('lists every table dataset the seeder reads, in its order', () => {
        expect(TABLE_EXTRACTS.map((extract) => extract.dataset)).toEqual([...TABLE_DATASETS]);
    });

    it.each(TABLE_EXTRACTS.map((extract) => [extract.dataset, extract] as const))(
        "finds %s's pins where the seeder does",
        (dataset, extract) => {
            expect(extractPinsPathOf('/data', extract.directory)).toBe(tablePinsPathOf('/data', dataset));
        },
    );

    it('names each table once, as an unquoted identifier the SQL can spell', () => {
        expect(new Set(RAW_TABLES).size).toBe(RAW_TABLES.length);
        expect(RAW_TABLES.filter((table) => !/^v_raw_[a-z0-9_]+$/u.test(table))).toEqual([]);
    });

    it('⛔ loads nothing the SQL never reads', () => {
        expect(RAW_TABLES.filter((table) => !new RegExp(`\\b${table}\\b`, 'u').test(ALL_SQL))).toEqual([]);
    });

    it('⛔ leaves no table the SQL reads unloaded', () => {
        const read = new Set([...ALL_SQL.matchAll(/\bv_raw_[a-z0-9_]+\b/gu)].map((match) => match[0]));

        expect([...read].filter((table) => !RAW_TABLES.includes(table)).sort()).toEqual([]);
    });
});
