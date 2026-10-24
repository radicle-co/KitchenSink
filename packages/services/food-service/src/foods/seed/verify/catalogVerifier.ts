/**
 * The catalog verifier: proves the seeded catalog equals the committed seed, independently of the seeder (curated
 * catalog plan U6, KTD-2, KTD-3, R39).
 *
 * @pattern N-version check — a second derivation of the catalog from the committed bytes, in another language and with
 *   no import of the seeder, compared with what the seeder wrote; any shared mistake must be made twice
 * @pattern Port — {@link VerifierSession} is all the verifier knows of a connection; {@link pgVerifierSession} binds it
 *   to a `pg` client
 *
 * Two phases, because Postgres refuses `CREATE` inside the READ ONLY transaction an empty plan verifies in (KTD-2):
 *
 * - {@link prepareVerifier}, before any transaction: COPY every committed input into temp tables
 *   (`committedInputs.ts`), run the derivation SQL that builds the expected catalog from those bytes alone, and refuse a
 *   seed the derivation cannot read.
 * - the returned `verify`, inside the seed transaction: run each check, one `SELECT` apiece, which compares the live
 *   rows with `EXCEPT ALL` in both directions and runs the one-way history checks. It throws
 *   {@link CatalogVerificationError} naming every failing table and fact.
 *
 * Both phases run on ONE session: temp tables belong to it, so `verify` refuses any other.
 *
 * {@link createCatalogVerifier} is the shape the seed transaction calls (`CatalogSeedVerifier` in
 * `catalog/catalogSeedTransaction.ts`, which the fence keeps this module from importing; the two meet structurally).
 */
import type pg from 'pg';
import { z } from 'zod';

import { CatalogVerificationError, type VerificationFailure } from './catalogVerifier.errors.js';
import { loadCommittedInputs } from './committedInputs.js';
import { pgCopySession, type CopySession } from './copyLoader.js';
import { CHECK_SQL, PREPARE_SQL, REFUSALS_SQL, readVerifierSql } from './verifierSql.js';

/** The connection the verifier runs on: statements, COPYs, and queries whose rows it reads. */
export interface VerifierSession extends CopySession {
    /**
     * Run one query.
     *
     * @param sql - One statement.
     * @returns Its rows.
     */
    rows(sql: string): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

/** Where the verifier reads its inputs. */
export interface CatalogVerifierOptions {
    /** The seed data directory, the one the seeder reads. */
    readonly dataDir: string;
    /** The verifier's SQL directory (`verify/sql/` in the source tree). */
    readonly sqlDir: string;
}

/** The second phase: compare, on the session the first phase prepared. */
export type VerifySession = (session: VerifierSession) => Promise<void>;

/** The second phase, for a caller holding a `pg` client. */
export type VerifyCatalog = (client: pg.ClientBase) => Promise<void>;

/** One row a check or the refusals query answers. `row_count` is a `bigint`, which `pg` returns as a string. */
const failureRowSchema = z.object({
    table_name: z.string().min(1),
    fact: z.string().min(1),
    row_count: z.union([
        z.number().int().positive(),
        z
            .string()
            .regex(/^[1-9][0-9]*$/u)
            .transform(Number),
    ]),
    sample: z.array(z.string()).nullable(),
});

/**
 * Read the failures a check answered. Pure.
 *
 * @param rows - The check's rows.
 * @returns One failure per row.
 * @throws {TypeError} for a row that is not a failure row, so a malformed check can never read as a pass.
 */
function failuresOf(rows: readonly Readonly<Record<string, unknown>>[]): VerificationFailure[] {
    return rows.map((row) => {
        const parsed = failureRowSchema.safeParse(row);

        if (!parsed.success) {
            throw new TypeError(`A verifier check answered a row it cannot read: ${JSON.stringify(row)}`);
        }

        return {
            table: parsed.data.table_name,
            fact: parsed.data.fact,
            rows: parsed.data.row_count,
            sample: parsed.data.sample ?? [],
        };
    });
}

/**
 * The session a connected `pg` client offers.
 *
 * @param client - A connected client.
 * @returns The session.
 */
function pgVerifierSession(client: pg.ClientBase): VerifierSession {
    return {
        ...pgCopySession(client),
        rows: async (sql) => (await client.query<Record<string, unknown>>(sql)).rows,
    };
}

/**
 * Load the committed seed and derive the expected catalog, before any transaction.
 *
 * @param session - The connection, outside any transaction; `verify` must run on this same session.
 * @param options - The data and SQL directories.
 * @returns `verify`, which compares the catalog on the same session.
 * @throws {CatalogVerificationError} at stage `prepare` when the committed seed does not yield an expected catalog.
 * @throws {SourcePinMismatchError} when a pinned input differs from its pin.
 * @sideEffect Reads the data and SQL directories; creates and fills session temp tables and functions.
 */
export async function prepareVerifier(
    session: VerifierSession,
    options: CatalogVerifierOptions,
): Promise<VerifySession> {
    const [derivation, [refusals = ''], checks] = await Promise.all([
        readVerifierSql(options.sqlDir, PREPARE_SQL),
        readVerifierSql(options.sqlDir, [REFUSALS_SQL]),
        readVerifierSql(options.sqlDir, CHECK_SQL),
    ]);

    await loadCommittedInputs(session, options.dataDir);

    for (const sql of derivation) {
        await session.execute(sql);
    }

    const refused = failuresOf(await session.rows(refusals));

    if (refused.length > 0) {
        throw new CatalogVerificationError('prepare', refused);
    }

    return async (verifying) => {
        if (verifying !== session) {
            throw new TypeError('verify must run on the session prepareVerifier ran on: the temp tables are its own.');
        }

        const failures: VerificationFailure[] = [];

        for (const sql of checks) {
            failures.push(...failuresOf(await verifying.rows(sql)));
        }

        if (failures.length > 0) {
            throw new CatalogVerificationError('verify', failures);
        }
    };
}

/**
 * {@link prepareVerifier} for a caller holding a `pg` client: the seed transaction calls this before it opens a
 * transaction, then calls the returned `verify` with the same client inside it.
 *
 * @param client - The seed's one connection, outside any transaction.
 * @param options - The data and SQL directories.
 * @returns `verify`, which refuses any client but this one.
 * @throws {CatalogVerificationError} at stage `prepare` when the committed seed does not yield an expected catalog.
 * @sideEffect As {@link prepareVerifier}.
 */
export async function prepareCatalogVerifier(
    client: pg.ClientBase,
    options: CatalogVerifierOptions,
): Promise<VerifyCatalog> {
    const session = pgVerifierSession(client);
    const verify = await prepareVerifier(session, options);

    return async (verifying) => {
        if (verifying !== client) {
            throw new TypeError(
                'verify must run on the client prepareCatalogVerifier ran on: the temp tables are its own.',
            );
        }

        await verify(session);
    };
}

/** The verifier as the seed transaction calls it: `prepare` before any transaction, `check` inside it. */
export interface SeedVerifier {
    /**
     * Load the committed seed and derive the expected catalog.
     *
     * @param client - The apply's connection, outside any transaction.
     * @sideEffect As {@link prepareCatalogVerifier}.
     */
    prepare(client: pg.ClientBase): Promise<void>;
    /**
     * Prove the catalog equals the committed seed.
     *
     * @param client - The same connection, inside the apply's transaction.
     * @throws {CatalogVerificationError} at stage `verify`, naming every failing table and fact.
     * @sideEffect Reads the catalog and the session's temp tables.
     */
    check(client: pg.ClientBase): Promise<void>;
}

/**
 * The verifier for one apply: it holds what `prepare` derived until `check` compares against it.
 *
 * @param options - The data and SQL directories.
 * @returns The two phases; `check` refuses to run before `prepare`, or on another client.
 */
export function createCatalogVerifier(options: CatalogVerifierOptions): SeedVerifier {
    let verify: VerifyCatalog | undefined;

    return {
        prepare: async (client) => {
            verify = await prepareCatalogVerifier(client, options);
        },
        check: async (client) => {
            if (verify === undefined) {
                throw new TypeError('check ran before prepare: the verifier has no expected catalog to compare with.');
            }

            await verify(client);
        },
    };
}
