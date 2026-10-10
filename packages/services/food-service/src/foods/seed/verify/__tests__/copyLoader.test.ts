/**
 * The COPY loader (curated catalog plan U6, KTD-3): the committed bytes reach a session temp table unchanged, or not at
 * all.
 *
 * The session is a fake, so these cases pin what the loader sends and how it fails. What Postgres makes of the framing
 * (each line one row, byte for byte) is `tests/e2e/copyLoader.e2e.test.ts`'s, because only a real server can show it.
 */
import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { copyCsv, copyLines, createCsvTable, type CopySession, type CopyTarget } from '../copyLoader.js';
import { isCopyFramingByteError } from '../copyLoader.errors.js';

/** A COPY target that keeps every byte, and reports one row per newline once finished, as the server would. */
class FakeCopyTarget extends Writable implements CopyTarget {
    public rowCount = 0;
    public readonly received: Buffer[] = [];

    public override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.received.push(chunk);
        callback();
    }

    public override _final(callback: (error?: Error | null) => void): void {
        this.rowCount = Buffer.concat(this.received).toString('utf8').split('\n').length - 1;
        callback();
    }
}

/** A fake session that records each statement and hands out one {@link FakeCopyTarget}. */
function makeFakeSession(): { session: CopySession; statements: string[]; target: FakeCopyTarget } {
    const statements: string[] = [];
    const target = new FakeCopyTarget();

    return {
        statements,
        target,
        session: {
            execute: async (sql) => {
                statements.push(sql);
            },
            copyFrom: (sql) => {
                statements.push(sql);

                return target;
            },
        },
    };
}

/** A source that yields the given chunks, in order. */
const chunks = (...parts: readonly string[]): Readable => Readable.from(parts.map((part) => Buffer.from(part, 'utf8')));

/** The error a promise rejects with. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('expected a rejection');
}

describe('copyLines', () => {
    it('creates the temp table, then copies into it with a framing that reads one line as one value', async () => {
        const { session, statements } = makeFakeSession();

        await copyLines(session, 'raw_curated', chunks('{"a":1}\n'));

        // The identity column numbers the lines in the order COPY reads them, so a file whose meaning spans lines (a
        // pretty-printed JSON document) can be put back together, and a refusal can name its line.
        expect(statements).toEqual([
            'CREATE TEMP TABLE "raw_curated" (ordinal bigint GENERATED ALWAYS AS IDENTITY, line text NOT NULL)',
            `COPY "raw_curated" (line) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02', FORCE_NOT_NULL (line), ENCODING 'UTF8')`,
        ]);
    });

    it('streams every byte unchanged, across chunk boundaries, and answers the rows copied', async () => {
        const { session, target } = makeFakeSession();
        const parts = ['{"name":"caf\u00e9 \\"au\\" lait"}\n', '\tback\\slash,"quoted"\n\n', '\\.\n'];

        const rows = await copyLines(session, 'raw_lines', chunks(...parts));

        expect(Buffer.concat(target.received).equals(Buffer.from(parts.join(''), 'utf8'))).toBe(true);
        expect(rows).toBe(4);
    });

    it('quotes the table name as an identifier', async () => {
        const { session, statements } = makeFakeSession();

        await copyLines(session, 'raw"odd', chunks('x\n'));

        expect(statements[0]).toBe(
            'CREATE TEMP TABLE "raw""odd" (ordinal bigint GENERATED ALWAYS AS IDENTITY, line text NOT NULL)',
        );
    });

    it.each([
        ['the delimiter byte', '\u0001', 7],
        ['the quote byte', '\u0002', 7],
    ])('⛔ refuses a line holding %s, and abandons the COPY rather than finishing it', async (_case, byte, offset) => {
        const { session, target } = makeFakeSession();

        const error = await rejectionOf(copyLines(session, 'raw_lines', chunks('first\n', `x${byte}y\n`)));

        expect(isCopyFramingByteError(error)).toBe(true);
        expect(error).toMatchObject({ table: 'raw_lines', offset });
        expect(target.destroyed).toBe(true);
        expect(target.writableFinished).toBe(false);
    });

    it('⛔ propagates a source failure and abandons the COPY', async () => {
        const { session, target } = makeFakeSession();
        const failing = new Readable({
            read(): void {
                this.destroy(new Error('disk gone'));
            },
        });

        const error = await rejectionOf(copyLines(session, 'raw_lines', failing));

        expect(error).toMatchObject({ message: 'disk gone' });
        expect(target.destroyed).toBe(true);
        expect(target.writableFinished).toBe(false);
    });
});

describe('copyCsv', () => {
    it("creates a text column per header field, then lets Postgres's CSV parser read the file against that header", async () => {
        const { session, statements } = makeFakeSession();

        await copyCsv(session, 'raw_food', ['fdc_id', 'description'], chunks('"fdc_id","description"\n"1","Oil"\n'));

        // HEADER MATCH makes the server refuse a file whose header is not exactly these names in this order, and
        // FORCE_NOT_NULL keeps an unquoted empty field the empty string the seeder's reader sees, never NULL.
        expect(statements).toEqual([
            'CREATE TEMP TABLE "raw_food" (ordinal bigint GENERATED ALWAYS AS IDENTITY, "fdc_id" text NOT NULL, "description" text NOT NULL)',
            `COPY "raw_food" ("fdc_id", "description") FROM STDIN WITH (FORMAT csv, HEADER MATCH, FORCE_NOT_NULL ("fdc_id", "description"), ENCODING 'UTF8')`,
        ]);
    });

    it('streams every byte unchanged, a quoted newline included, and answers the rows copied', async () => {
        const { session, target } = makeFakeSession();
        const text = '"id","name"\n"1","two\nlines"\n';

        await copyCsv(session, 'raw_quoted', ['id', 'name'], chunks(text));

        expect(Buffer.concat(target.received).toString('utf8')).toBe(text);
    });

    it('quotes the table and every column as identifiers', async () => {
        const { session, statements } = makeFakeSession();

        await copyCsv(session, 'raw"odd', ['NDB_number', 'odd"col'], chunks('x\n'));

        expect(statements[0]).toBe(
            'CREATE TEMP TABLE "raw""odd" (ordinal bigint GENERATED ALWAYS AS IDENTITY, "NDB_number" text NOT NULL, "odd""col" text NOT NULL)',
        );
    });

    it('⛔ refuses an empty column list before sending anything, since a table with no fields cannot hold a file', async () => {
        const { session, statements } = makeFakeSession();

        await expect(copyCsv(session, 'raw_empty', [], chunks('x\n'))).rejects.toBeInstanceOf(RangeError);
        expect(statements).toEqual([]);
    });

    it('⛔ propagates a source failure and abandons the COPY', async () => {
        const { session, target } = makeFakeSession();
        const failing = new Readable({
            read(): void {
                this.destroy(new Error('zip entry gone'));
            },
        });

        const error = await rejectionOf(copyCsv(session, 'raw_food', ['fdc_id'], failing));

        expect(error).toMatchObject({ message: 'zip entry gone' });
        expect(target.destroyed).toBe(true);
        expect(target.writableFinished).toBe(false);
    });
});

describe('createCsvTable', () => {
    it('creates the table copyCsv would, with no rows, for an optional file the archive does not hold', async () => {
        const { session, statements } = makeFakeSession();

        await createCsvTable(session, 'raw_measure_unit', ['id', 'name']);

        expect(statements).toEqual([
            'CREATE TEMP TABLE "raw_measure_unit" (ordinal bigint GENERATED ALWAYS AS IDENTITY, "id" text NOT NULL, "name" text NOT NULL)',
        ]);
    });
});
