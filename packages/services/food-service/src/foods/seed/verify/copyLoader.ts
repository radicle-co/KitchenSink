/**
 * Stream committed bytes into a session temp table, one row per line, unchanged (curated catalog plan U6, KTD-3).
 *
 * @pattern Port — {@link CopySession} is all the loader knows of a connection
 * @pattern Adapter over pg-copy-streams — {@link pgCopySession} binds the port to a `pg` client
 *
 * The verifier derives the expected catalog in SQL from the committed bytes, so those bytes must reach Postgres
 * without any of our code reading them. A line becomes one `text` value through `COPY ... FORMAT csv` with a
 * delimiter and a quote no text file holds: CSV has no backslash escapes (the text format would rewrite every `\` in
 * a JSON line), and `FORCE_NOT_NULL` keeps an empty line an empty string rather than NULL. The two reserved bytes are
 * refused on the way through, because a quote byte would silently merge lines (see {@link CopyFramingByteError}).
 *
 * The table is created by the session before any transaction (KTD-2) and lives until the connection ends. A refused or
 * failed stream abandons the COPY with a CopyFail, which leaves the table empty and the connection usable.
 */
import { Transform, type TransformCallback, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import pg from 'pg';
import copyStreams from 'pg-copy-streams';

import { CopyFramingByteError } from './copyLoader.errors.js';

/** The writable end of a `COPY ... FROM STDIN`, which reports the rows the server copied once it has finished. */
export interface CopyTarget extends Writable {
    readonly rowCount: number;
}

/** The connection the loader runs on: one statement at a time, or one COPY. */
export interface CopySession {
    /**
     * Run one statement.
     *
     * @param sql - The statement.
     */
    execute(sql: string): Promise<void>;
    /**
     * Open a `COPY ... FROM STDIN`.
     *
     * @param sql - The COPY statement.
     * @returns Its writable end.
     */
    copyFrom(sql: string): CopyTarget;
}

/** The delimiter byte the framing reserves. */
const DELIMITER = 0x01;

/** The quote byte the framing reserves. */
const QUOTE = 0x02;

/**
 * The session a connected `pg` client offers.
 *
 * @param client - A connected client.
 * @returns The session.
 */
export function pgCopySession(client: pg.ClientBase): CopySession {
    return {
        execute: async (sql) => {
            await client.query(sql);
        },
        copyFrom: (sql) => client.query(copyStreams.from(sql)),
    };
}

/**
 * A pass-through that refuses the framing's reserved bytes. Pure until piped.
 *
 * @param table - The table being loaded, for the refusal.
 */
function refuseReservedBytes(table: string): Transform {
    let offset = 0;

    return new Transform({
        transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
            const at = chunk.findIndex((byte) => byte === DELIMITER || byte === QUOTE);

            if (at !== -1) {
                callback(new CopyFramingByteError(table, chunk[at] ?? DELIMITER, offset + at));

                return;
            }

            offset += chunk.length;
            callback(null, chunk);
        },
    });
}

/**
 * Create a session temp table `(line text NOT NULL)` and COPY the bytes into it, one row per line.
 *
 * A line is the bytes between two newlines (a CRLF file's carriage return is the server's to strip). A final line
 * without a newline is still a row.
 *
 * @param session - The connection, outside any transaction or inside one that may create a table.
 * @param table - The temp table's name. Quoted as an identifier.
 * @param bytes - The committed file's bytes.
 * @returns The rows the server copied.
 * @throws {CopyFramingByteError} when the bytes hold a reserved byte; nothing is copied.
 * @sideEffect Creates a temp table on the session and writes to it.
 */
export async function copyLines(session: CopySession, table: string, bytes: Readable): Promise<number> {
    const target = pg.escapeIdentifier(table);

    await session.execute(`CREATE TEMP TABLE ${target} (line text NOT NULL)`);

    const copy = session.copyFrom(
        `COPY ${target} (line) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02', FORCE_NOT_NULL (line), ENCODING 'UTF8')`,
    );

    await pipeline(bytes, refuseReservedBytes(table), copy);

    return copy.rowCount;
}
