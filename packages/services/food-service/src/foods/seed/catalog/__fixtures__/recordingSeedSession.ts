/**
 * A recording stand-in for the seed's one connection (curated catalog plan U6), for suites that prove ORDER and COUNT
 * without a database.
 *
 * @pattern Test Double (fake) — it implements `CatalogSeedSession` and answers just enough to run a seed: the ledger's
 *   head, each marked step's row count, and the failures a case injects
 *
 * Every statement is recorded with its step: the `catalogSeed:<step>` marker the apply and the transaction open their
 * statements with, else the statement's own text (`BEGIN …`, `SET LOCAL …`, `COMMIT`, the lock's statements). A step's
 * row count defaults to what it was asked to touch: its staged table's COPYed rows, else its first list's length.
 */
import { Writable } from 'node:stream';

import type { CatalogSeedSession, SeedQueryResult } from '../catalogSeedSession.js';

/** One statement the session ran. */
export interface RecordedStatement {
    readonly step: string;
    readonly sql: string;
    readonly values: readonly unknown[] | undefined;
}

/** How the session answers. */
export interface RecordingSeedSessionOptions {
    /** The row count a step reports, given how many rows it was asked to touch. */
    readonly countOf: (step: string, asked: number) => number;
    /** The digest the ledger's newest row holds, or `null` for an empty ledger. */
    readonly ledgerHead: string | null;
    /** Statements that fail: the first whose predicate matches throws its error. */
    readonly failures: readonly { readonly when: (statement: RecordedStatement) => boolean; readonly error: unknown }[];
}

/** The marker a seed statement opens with. */
const MARKER = /^\/\* catalogSeed:([A-Za-z_]+(?::[A-Za-z_]+)?) \*\//u;

/** A recording session. */
export class RecordingSeedSession implements CatalogSeedSession {
    public readonly ran: RecordedStatement[] = [];
    /** COPY payloads by staged table. */
    public readonly copied = new Map<string, string>();

    public constructor(private readonly options: RecordingSeedSessionOptions) {}

    /** The steps, in order. */
    public get steps(): string[] {
        return this.ran.map((statement) => statement.step);
    }

    public async query(sql: string, values?: unknown[]): Promise<SeedQueryResult> {
        const statement = { step: MARKER.exec(sql)?.[1] ?? sql.trim(), sql, values };

        this.ran.push(statement);
        this.failIfAsked(statement);

        if (statement.step === 'ledgerHead') {
            const head = this.options.ledgerHead;

            return { rows: head === null ? [] : [{ seed_sha: head }], rowCount: head === null ? 0 : 1 };
        }

        return { rows: [], rowCount: this.options.countOf(statement.step, this.asked(sql, values)) };
    }

    public copyFrom(sql: string): Writable {
        const step = MARKER.exec(sql)?.[1] ?? sql.trim();
        const statement = { step, sql, values: undefined };
        const chunks: string[] = [];

        this.ran.push(statement);
        this.failIfAsked(statement);

        return new Writable({
            write: (chunk: Buffer | string, _encoding, callback) => {
                chunks.push(chunk.toString());
                callback();
            },
            final: (callback) => {
                this.copied.set(step.replace(/^copy:/u, ''), chunks.join(''));
                callback();
            },
        });
    }

    /**
     * The rows a COPY staged in a table.
     *
     * @param table - The staged table's suffix.
     * @returns Its rows, one string per line.
     */
    public stagedRows(table: string): string[] {
        return (this.copied.get(table) ?? '').split('\n').filter((line) => line !== '');
    }

    /**
     * Throw the error a case injected for this statement, if any.
     *
     * @param statement - The statement.
     * @throws The injected error.
     */
    private failIfAsked(statement: RecordedStatement): void {
        const failure = this.options.failures.find((candidate) => candidate.when(statement));

        if (failure !== undefined) {
            throw failure.error;
        }
    }

    /**
     * How many rows a statement was asked to touch: its staged table's rows, else its first list's length.
     *
     * @param sql - The statement.
     * @param values - Its values.
     * @returns The count.
     */
    private asked(sql: string, values: readonly unknown[] | undefined): number {
        const staged = /FROM pg_temp\.catalog_seed_([a-z_]+)/u.exec(sql)?.[1];

        if (staged !== undefined) {
            return this.stagedRows(staged).length;
        }

        const [first] = values ?? [];

        return Array.isArray(first) ? first.length : 0;
    }
}

/**
 * A recording session.
 *
 * @param options - Overrides: by default every step touches what it was asked to, the ledger is empty and nothing fails.
 * @returns The session.
 */
export function makeRecordingSeedSession(options: Partial<RecordingSeedSessionOptions> = {}): RecordingSeedSession {
    return new RecordingSeedSession({
        countOf: (_step, asked) => asked,
        ledgerHead: null,
        failures: [],
        ...options,
    });
}
