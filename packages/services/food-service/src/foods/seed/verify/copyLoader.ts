/**
 * Stream committed bytes into session temp tables, unchanged (curated catalog plan U6, KTD-3).
 *
 * @pattern Port — {@link CopySession} is all the loader knows of a connection
 * @pattern Adapter over pg-copy-streams — {@link pgCopySession} binds the port to a `pg` client
 *
 * The verifier derives the expected catalog in SQL from the committed bytes, so those bytes must reach Postgres
 * without any of our code reading them. Two framings do it:
 *
 * - {@link copyLines}, for a JSON-lines or tab-separated file: a line becomes one `text` value through `COPY ... FORMAT
 *   csv` with a delimiter and a quote no text file holds. CSV has no backslash escapes (the text format would rewrite
 *   every `\` in a JSON line), and `FORCE_NOT_NULL` keeps an empty line an empty string rather than NULL. The two
 *   reserved bytes are refused on the way through, because a quote byte would silently merge lines (see
 *   {@link CopyFramingByteError}).
 * - {@link copyCsv}, for a USDA CSV: Postgres's own CSV parser reads the file into one `text` column per field, so a
 *   quoted newline (Foundation's `food.csv` holds one) stays inside its field. `HEADER MATCH` makes the server refuse a
 *   file whose header is not the declared columns, in order, so a re-pinned archive with a changed layout fails loudly
 *   rather than shifting fields.
 *
 * Every table numbers its rows in the order COPY reads them (`ordinal`), because some meaning is in the order: a
 * pretty-printed JSON document spans lines, and the seeder keeps the first of two nutrient rows in file order.
 *
 * A table is created by the session before any transaction (KTD-2) and lives until the connection ends. A refused or
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

/** Every loaded table's first column: the row's position in the file, 1-based, assigned as COPY reads it. */
const ORDINAL_COLUMN = 'ordinal bigint GENERATED ALWAYS AS IDENTITY';

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
 * Create a session temp table `(ordinal, line text NOT NULL)` and COPY the bytes into it, one row per line.
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

    await session.execute(`CREATE TEMP TABLE ${target} (${ORDINAL_COLUMN}, line text NOT NULL)`);

    const copy = session.copyFrom(
        `COPY ${target} (line) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02', FORCE_NOT_NULL (line), ENCODING 'UTF8')`,
    );

    await pipeline(bytes, refuseReservedBytes(table), copy);

    return copy.rowCount;
}

/**
 * Create the session temp table a CSV file of these columns loads into, with no rows: the shape {@link copyCsv} fills,
 * and the whole of an optional file an archive does not hold.
 *
 * @param session - The connection, outside any transaction or inside one that may create a table.
 * @param table - The temp table's name. Quoted as an identifier.
 * @param columns - The file's header fields, in order. Each becomes a `text NOT NULL` column of that name.
 * @throws {RangeError} for an empty column list; nothing is sent.
 * @sideEffect Creates a temp table on the session.
 */
export async function createCsvTable(session: CopySession, table: string, columns: readonly string[]): Promise<void> {
    if (columns.length === 0) {
        throw new RangeError(`The CSV table '${table}' needs at least one column.`);
    }

    const fields = columns.map((column) => `${pg.escapeIdentifier(column)} text NOT NULL`).join(', ');

    await session.execute(`CREATE TEMP TABLE ${pg.escapeIdentifier(table)} (${ORDINAL_COLUMN}, ${fields})`);
}

/**
 * Create a session temp table with one `text` column per header field, and COPY a CSV file into it with Postgres's CSV
 * parser. The header must equal `columns`, in order (`HEADER MATCH`), or the server refuses the file.
 *
 * @param session - The connection, outside any transaction or inside one that may create a table.
 * @param table - The temp table's name. Quoted as an identifier.
 * @param columns - The file's header fields, in order.
 * @param bytes - The file's bytes.
 * @returns The rows the server copied, the header excluded.
 * @throws {RangeError} for an empty column list; nothing is sent.
 * @sideEffect Creates a temp table on the session and writes to it.
 */
export async function copyCsv(
    session: CopySession,
    table: string,
    columns: readonly string[],
    bytes: Readable,
): Promise<number> {
    await createCsvTable(session, table, columns);

    const fields = columns.map((column) => pg.escapeIdentifier(column)).join(', ');
    const copy = session.copyFrom(
        `COPY ${pg.escapeIdentifier(table)} (${fields}) FROM STDIN WITH (FORMAT csv, HEADER MATCH, FORCE_NOT_NULL (${fields}), ENCODING 'UTF8')`,
    );

    await pipeline(bytes, copy);

    return copy.rowCount;
}
