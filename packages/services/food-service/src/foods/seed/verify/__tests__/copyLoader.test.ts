/**
 * The COPY loader (curated catalog plan U6, KTD-3): the committed bytes reach a session temp table unchanged, or not at
 * all.
 *
 * The session is a fake, so these cases pin what the loader sends and how it fails. What Postgres makes of the framing
 * (each line one row, byte for byte) is `tests/e2e/copyLoader.e2e.test.ts`'s, because only a real server can show it.
 */
import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { copyLines, type CopySession, type CopyTarget } from '../copyLoader.js';
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

        expect(statements).toEqual([
            'CREATE TEMP TABLE "raw_curated" (line text NOT NULL)',
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

        expect(statements[0]).toBe('CREATE TEMP TABLE "raw""odd" (line text NOT NULL)');
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
