/**
 * The verifier's COPY loader against real Postgres, connected as the seeder (curated catalog plan U6, KTD-3,
 * ADR-0051 §2).
 *
 * LOCAL target: a Docker Postgres the run provisions under the production role model. It proves what only a server
 * can: the seeder may create a session temp table (it holds TEMPORARY and no CREATE), and the CSV framing delivers
 * each committed line as one value, byte for byte, including the characters a naive framing rewrites. Rows are
 * compared as a multiset, because the verifier compares with `EXCEPT ALL` and never relies on order.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { parseSourcePins } from '../../src/foods/seed/archive/usdaSourceArchive.js';
import { copyLines, pgCopySession } from '../../src/foods/seed/verify/copyLoader.js';
import { isCopyFramingByteError } from '../../src/foods/seed/verify/copyLoader.errors.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';

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

describe.skipIf(!hasTestDatabase)('the verifier COPY loader, as the seeder', () => {
    let client: pg.Client;

    beforeAll(async () => {
        client = new pg.Client({ connectionString: foodE2eDb().seederUrl });
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
});
