/**
 * The verifier's COPY loader against real Postgres, connected as the seeder (curated catalog plan U6, KTD-3,
 * ADR-0051 §2).
 *
 * LOCAL target: a Docker Postgres the run provisions under the production role model. It proves what only a server
 * can: the seeder may create a session temp table (it holds TEMPORARY and no CREATE), the line framing delivers each
 * committed line as one value, byte for byte, including the characters a naive framing rewrites, and the CSV framing
 * reads the pinned USDA archives with Postgres's own parser, a quoted newline and the header check included. Lines are
 * compared as a multiset, because the verifier compares with `EXCEPT ALL`; the one order it relies on is `ordinal`,
 * which must be the line's position in the file.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { openPinnedArchive, parseSourcePins } from '../../src/foods/seed/archive/usdaSourceArchive.js';
import { copyCsv, copyLines, pgCopySession } from '../../src/foods/seed/verify/copyLoader.js';
import { isCopyFramingByteError } from '../../src/foods/seed/verify/copyLoader.errors.js';
import { foodDb } from '../support/roleDb.js';

/** The committed seed data. */
const DATA_DIR = join(import.meta.dirname, '../../src/foods/seed/data');

/**
 * The committed files the loader is proven on, each for a character a framing could rewrite. The Branded extract is
 * named by its pin rather than by a dated file name, so a rebuilt extract is still the one tested.
 *
 * @returns Each file's path and the character it must hold for its case to mean anything.
 */
async function committedFiles(): Promise<readonly (readonly [path: string, holds: string])[]> {
    const pins = parseSourcePins(await readFile(join(DATA_DIR, 'usda/sourcePins.json'), 'utf8'));

    return [
        [join(DATA_DIR, 'curatedCatalog.jsonl'), '"'],
        [join(DATA_DIR, 'usda', pins.brandedFoods.extract), '\\'],
        [join(DATA_DIR, 'sourceCandidates.tsv'), '\t'],
    ];
}

/** The pinned USDA archives, by the name the pins give them. */
async function pinnedArchives(): Promise<readonly (readonly [name: string, path: string, sha256: string])[]> {
    const pins = parseSourcePins(await readFile(join(DATA_DIR, 'usda/sourcePins.json'), 'utf8'));

    return [
        ['srLegacy', join(DATA_DIR, 'usda', pins.srLegacy.file), pins.srLegacy.upstreamSha256],
        ['foundation', join(DATA_DIR, 'usda', pins.foundation.file), pins.foundation.upstreamSha256],
    ];
}

/** The header every pinned archive's `food.csv` carries, which `HEADER MATCH` holds the file to. */
const FOOD_COLUMNS = ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'];

/** Every `line` in a temp table, sorted by code unit so both sides of a comparison sort alike. */
async function linesOf(client: pg.Client, table: string): Promise<string[]> {
    const result = await client.query<{ line: string }>(`SELECT line FROM ${pg.escapeIdentifier(table)}`);

    return result.rows.map((row) => row.line).sort();
}

/** The lines of a newline-terminated text, sorted the same way. */
function linesOfText(text: string): string[] {
    expect(text.endsWith('\n'), 'a committed text file ends with a newline').toBe(true);

    return text.slice(0, -1).split('\n').sort();
}

describe('the verifier COPY loader, as the seeder', () => {
    let client: pg.Client;

    beforeAll(async () => {
        client = new pg.Client({ connectionString: foodDb().seederUrl });
        await client.connect();
    });

    afterAll(async () => {
        await client.end();
    });

    it('runs as the seeder, so a pass proves its own grants suffice', async () => {
        const result = await client.query<{ who: string }>('SELECT current_user AS who');

        expect(result.rows[0]?.who).toBe(DATABASE_ROLES.food.seeder);
    });

    it('loads committed files so that every line arrives as itself', async () => {
        const files = await committedFiles();

        for (const [index, [file, holds]] of files.entries()) {
            const text = await readFile(file, 'utf8');
            const expected = linesOfText(text);
            const table = `raw_committed_${index}`;

            expect(text.includes(holds), `${file} holds ${JSON.stringify(holds)}`).toBe(true);

            const rows = await copyLines(pgCopySession(client), table, createReadStream(file));

            expect(rows, file).toBe(expected.length);
            expect(await linesOf(client, table), file).toEqual(expected);
        }
    });

    it('numbers each line by its position in the file', async () => {
        await copyLines(pgCopySession(client), 'raw_numbered', Readable.from([Buffer.from('c\na\n\nb\n', 'utf8')]));

        const result = await client.query<{ ordinal: string; line: string }>(
            'SELECT ordinal::text, line FROM raw_numbered ORDER BY ordinal',
        );

        expect(result.rows).toEqual([
            { ordinal: '1', line: 'c' },
            { ordinal: '2', line: 'a' },
            { ordinal: '3', line: '' },
            { ordinal: '4', line: 'b' },
        ]);
    });

    it('keeps the characters a naive framing would rewrite', async () => {
        const crafted = [
            '',
            'back\\slash and \\n and \\t',
            '"quoted", with a comma',
            'tab\there',
            '\\.',
            '\\N',
            '  padded  ',
            'café \u{1F95A}',
            '{"name":"caf\\u00e9 \\"au\\" lait"}',
        ];

        const rows = await copyLines(
            pgCopySession(client),
            'raw_crafted',
            Readable.from([Buffer.from(`${crafted.join('\n')}\n`, 'utf8')]),
        );

        expect(rows).toBe(crafted.length);
        expect(await linesOf(client, 'raw_crafted')).toEqual([...crafted].sort());
    });

    it('⛔ refuses a reserved byte, copies nothing, and leaves the connection usable', async () => {
        const refused = copyLines(
            pgCopySession(client),
            'raw_refused',
            Readable.from([Buffer.from('fine\nnot\u0002fine\n', 'utf8')]),
        );

        await expect(refused).rejects.toSatisfy(isCopyFramingByteError);

        const after = await client.query<{ rows: string }>('SELECT count(*)::text AS rows FROM raw_refused');

        expect(after.rows[0]?.rows).toBe('0');
    });

    it("reads each pinned archive's food.csv with the server's CSV parser, a quoted newline staying in its field", async () => {
        for (const [name, path, sha256] of await pinnedArchives()) {
            const archive = await openPinnedArchive(path, sha256);
            const table = `raw_${name}_food`;

            try {
                const bytes = await archive.open('food.csv');

                expect(bytes, `${name} holds food.csv`).toBeDefined();

                const rows = await copyCsv(pgCopySession(client), table, FOOD_COLUMNS, bytes ?? Readable.from([]));
                const result = await client.query<{ rows: string; ordinals: string; multiline: string }>(
                    `SELECT count(*)::text AS rows, count(DISTINCT ordinal)::text AS ordinals,
                            count(*) FILTER (WHERE description LIKE E'%\n%')::text AS multiline
                       FROM ${pg.escapeIdentifier(table)}`,
                );

                expect(result.rows[0]?.rows, name).toBe(String(rows));
                expect(result.rows[0]?.ordinals, name).toBe(String(rows));

                // Measured 2026-10-01: Foundation's food.csv holds 87,990 records on 87,992 physical lines, because one
                // description holds a newline. A line framing would have split that record in two.
                if (name === 'foundation') {
                    expect(rows).toBe(87_990);
                    expect(result.rows[0]?.multiline).toBe('1');
                } else {
                    expect(rows).toBe(7793);
                }
            } finally {
                archive.close();
            }
        }
    });

    it('⛔ refuses a CSV whose header is not the declared columns, in order', async () => {
        const swapped = copyCsv(
            pgCopySession(client),
            'raw_swapped',
            ['fdc_id', 'description'],
            Readable.from([Buffer.from('"description","fdc_id"\n"Oil","1"\n', 'utf8')]),
        );

        await expect(swapped).rejects.toThrow(/header/u);

        const after = await client.query<{ rows: string }>('SELECT count(*)::text AS rows FROM raw_swapped');

        expect(after.rows[0]?.rows).toBe('0');
    });

    it("keeps an empty field the empty string, quoted or not, as the seeder's reader does", async () => {
        await copyCsv(
            pgCopySession(client),
            'raw_empty_fields',
            ['id', 'amount', 'modifier'],
            Readable.from([Buffer.from('"id","amount","modifier"\n"1","",\n', 'utf8')]),
        );

        const result = await client.query<{ amount: string | null; modifier: string | null }>(
            'SELECT amount, modifier FROM raw_empty_fields',
        );

        expect(result.rows).toEqual([{ amount: '', modifier: '' }]);
    });
});
