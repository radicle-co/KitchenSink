/**
 * The catalog verifier's orchestration (curated catalog plan U6, KTD-2, KTD-3), on a recording session.
 *
 * The session is a fake: it records every statement and consumes every COPY, so these cases pin what the verifier
 * sends and in what order, and how it reports a failure. The committed data directory and SQL directory are the real
 * ones, so a renamed input or an unlisted SQL file fails here. What the SQL computes is the LOCAL e2e tier's
 * (`tests/e2e/catalogVerifierParity.e2e.test.ts`, `tests/e2e/catalogVerifierCompare.e2e.test.ts`).
 *
 * Three facts carry the design:
 *
 * - Everything that creates (temp tables, temp functions, the expected state) happens in `prepare`, before any
 *   transaction: Postgres refuses `CREATE` inside the READ ONLY transaction an empty plan verifies in (KTD-2).
 * - `verify` sends the check files and nothing else, each one `SELECT`, so it runs in that READ ONLY transaction.
 * - A failure names every failing table and fact, not the first.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { prepareVerifier, type VerifierSession } from '../src/foods/seed/verify/catalogVerifier.js';
import { isCatalogVerificationError } from '../src/foods/seed/verify/catalogVerifier.errors.js';
import { RAW_TABLES } from '../src/foods/seed/verify/committedInputs.js';
import type { CopyTarget } from '../src/foods/seed/verify/copyLoader.js';
import { CHECK_SQL, PREPARE_SQL, REFUSALS_SQL } from '../src/foods/seed/verify/verifierSql.js';

const DATA_DIR = join(import.meta.dirname, '../src/foods/seed/data');
const SQL_DIR = join(import.meta.dirname, '../src/foods/seed/verify/sql');

/** One statement the session received, and how. */
interface Sent {
    readonly via: 'execute' | 'copy' | 'rows';
    readonly sql: string;
}

/** A COPY target that discards what it is sent. */
class DiscardingTarget extends Writable implements CopyTarget {
    public readonly rowCount = 0;

    public override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        callback();
    }
}

/** The rows a check answers: none, or the failures a case scripts. */
type Answers = (sql: string) => readonly Readonly<Record<string, unknown>>[];

/**
 * A session that records every statement and answers `rows` from a script.
 *
 * @param answers - What each `rows` call returns; none by default.
 * @returns The session and its record.
 */
function recordingSession(answers: Answers = () => []): { session: VerifierSession; sent: Sent[] } {
    const sent: Sent[] = [];

    return {
        sent,
        session: {
            execute: async (sql) => {
                sent.push({ via: 'execute', sql });
            },
            copyFrom: (sql): CopyTarget => {
                sent.push({ via: 'copy', sql });

                return new DiscardingTarget();
            },
            rows: async (sql) => {
                sent.push({ via: 'rows', sql });

                return answers(sql);
            },
        },
    };
}

/** The text of each listed SQL file, as the verifier must send it. */
async function sqlTexts(names: readonly string[]): Promise<string[]> {
    return Promise.all(names.map(async (name) => readFile(join(SQL_DIR, name), 'utf8')));
}

/** The error a promise rejects with. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('expected a rejection');
}

/** A statement that opens, ends or reconfigures a transaction. */
const TRANSACTIONAL = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SET\s+TRANSACTION|SAVEPOINT)\b/iu;

describe('prepareVerifier', () => {
    it('loads every committed input into its own temp table, each created before its COPY', async () => {
        const { session, sent } = recordingSession();

        await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        const created = sent.flatMap((statement) => {
            const match = /^CREATE TEMP TABLE "([^"]+)"/u.exec(statement.sql);

            return match?.[1] === undefined ? [] : [match[1]];
        });

        expect([...created].sort()).toEqual([...RAW_TABLES].sort());

        for (const [index, statement] of sent.entries()) {
            if (statement.via === 'copy') {
                const table = /^COPY "([^"]+)"/u.exec(statement.sql)?.[1];

                expect(sent[index - 1]?.sql, `${String(table)} is created just before its COPY`).toMatch(
                    new RegExp(`^CREATE TEMP TABLE "${String(table)}"`, 'u'),
                );
            }
        }
    });

    it('derives the expected catalog after every input is loaded, file by file in the declared order, then asks for refusals', async () => {
        const { session, sent } = recordingSession();

        await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        const lastLoad = sent
            .map((statement) => statement.via === 'copy' || /^CREATE TEMP TABLE "v_raw_/u.test(statement.sql))
            .lastIndexOf(true);
        const derivation = sent.slice(lastLoad + 1);

        expect(derivation).toEqual([
            ...(await sqlTexts(PREPARE_SQL)).map((sql) => ({ via: 'execute', sql })),
            { via: 'rows', sql: (await sqlTexts([REFUSALS_SQL]))[0] },
        ]);
    });

    it('⛔ never opens, ends or reconfigures a transaction: the caller owns that (KTD-2)', async () => {
        const { session, sent } = recordingSession();

        const verify = await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        await verify(session);

        expect(sent.filter((statement) => TRANSACTIONAL.test(statement.sql))).toEqual([]);
    });

    it('⛔ refuses a seed the expected catalog cannot be derived from, naming the input and the fact', async () => {
        const [refusals] = await sqlTexts([REFUSALS_SQL]);
        const { session } = recordingSession((sql) =>
            sql === refusals
                ? [
                      {
                          table_name: 'curatedCatalog.jsonl',
                          fact: 'a cited entry is in no candidate row',
                          row_count: 2,
                          sample: ['curated:x', 'curated:y'],
                      },
                  ]
                : [],
        );

        const error = await rejectionOf(prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR }));

        expect(isCatalogVerificationError(error)).toBe(true);
        expect(error).toMatchObject({
            stage: 'prepare',
            failures: [
                {
                    table: 'curatedCatalog.jsonl',
                    fact: 'a cited entry is in no candidate row',
                    rows: 2,
                    sample: ['curated:x', 'curated:y'],
                },
            ],
        });
    });
});

describe('verify', () => {
    it('sends each check, in the declared order, as one query that only reads, and nothing else', async () => {
        const { session, sent } = recordingSession();
        const verify = await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });
        const before = sent.length;

        await verify(session);

        const checks = await sqlTexts(CHECK_SQL);

        expect(sent.slice(before)).toEqual(checks.map((sql) => ({ via: 'rows', sql })));
    });

    it('resolves when no check reports a failure', async () => {
        const { session } = recordingSession();
        const verify = await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        await expect(verify(session)).resolves.toBeUndefined();
    });

    it('⛔ names every failing table and fact, across checks, never only the first', async () => {
        const checks = await sqlTexts(CHECK_SQL);
        const [first, second] = checks;
        const { session } = recordingSession((sql) => {
            if (sql === first) {
                return [
                    {
                        table_name: 'food',
                        fact: 'an expected root is absent or differs',
                        row_count: 3,
                        sample: ['a', 'b'],
                    },
                    {
                        table_name: 'food',
                        fact: 'a live seed root the seed does not hold',
                        row_count: 1,
                        sample: ['c'],
                    },
                ];
            }

            return sql === second
                ? [
                      {
                          table_name: 'food_item',
                          fact: 'an expected item is absent or differs',
                          row_count: '12',
                          sample: null,
                      },
                  ]
                : [];
        });
        const verify = await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        const error = await rejectionOf(verify(session));

        expect(isCatalogVerificationError(error)).toBe(true);
        expect(error).toMatchObject({
            stage: 'verify',
            failures: [
                { table: 'food', fact: 'an expected root is absent or differs', rows: 3, sample: ['a', 'b'] },
                { table: 'food', fact: 'a live seed root the seed does not hold', rows: 1, sample: ['c'] },
                { table: 'food_item', fact: 'an expected item is absent or differs', rows: 12, sample: [] },
            ],
        });
        expect(String(error)).toMatch(/food: an expected root is absent or differs \(3 rows, e\.g\. a \| b\)/u);
        expect(String(error)).toMatch(/food_item: an expected item is absent or differs \(12 rows\)/u);
    });

    it('⛔ refuses a check row it cannot read, rather than passing it as no failure', async () => {
        const [first] = await sqlTexts(CHECK_SQL);
        const { session } = recordingSession((sql) => (sql === first ? [{ table_name: 'food' }] : []));
        const verify = await prepareVerifier(session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        await expect(verify(session)).rejects.toBeInstanceOf(TypeError);
    });

    it('⛔ refuses a session it was not prepared on, whose temp tables would not exist', async () => {
        const prepared = recordingSession();
        const other = recordingSession();
        const verify = await prepareVerifier(prepared.session, { dataDir: DATA_DIR, sqlDir: SQL_DIR });

        await expect(verify(other.session)).rejects.toBeInstanceOf(TypeError);
        expect(other.sent).toEqual([]);
    });
});
