// @vitest-environment node
/**
 * Repo-wide guard: no migration opens, ends or splits the transaction its runner applies it in.
 *
 * The runner (`applyMigrations` in `@kitchensink/db-schema-guard`) sends each `.sql` file inside its own BEGIN and
 * COMMIT, and records the file in `schema_migrations` in that same transaction. A top-level COMMIT in the file commits
 * the transaction halfway: the statements above it stay, the file is never recorded, and every later run re-runs a
 * half-applied file and stops on its first CREATE. A reviewer reproduced exactly that on PostgreSQL 18 (2026-10-02).
 * BEGIN, ROLLBACK, SAVEPOINT and PREPARE TRANSACTION break the same boundary in other ways.
 *
 * The SQL is read with PostgreSQL's own grammar (`libpg-query`, the server's parser compiled to WebAssembly), never a
 * regex: migration comments discuss transactions all the time, and the word inside a string or a function body is not
 * a statement. A COMMIT inside a `DO` block or a procedure is PL/pgSQL, and the server refuses it inside the runner's
 * transaction block ("invalid transaction termination"), so it fails the migration instead of splitting it.
 *
 * Nothing is enumerated: every `.sql` in a `migrations` directory under `packages` is read, and the discovery is
 * anchored on `DATABASE_ROLES`, so a database whose migrations stop being found fails here instead of passing empty.
 *
 * DESIGN PATTERN: Specification — {@link transactionControlIn} is the predicate, fired at a fixture table of shapes
 * as well as at the tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'libpg-query';
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { presentFiles, repoRoot } from './serviceSources.js';

/**
 * Every top-level transaction-control statement in a migration, one sentence each.
 *
 * @param file - The file, for the message.
 * @param sql - Its text.
 * @returns One sentence per `TransactionStmt`, or one naming the parse error; empty when the file is clean.
 */
export async function transactionControlIn(file: string, sql: string): Promise<readonly string[]> {
    let statements: Awaited<ReturnType<typeof parse>>['stmts'];

    try {
        statements = (await parse(sql)).stmts;
    } catch (error) {
        // A guard cannot vouch for SQL it cannot read, and the server would refuse it anyway.
        return [`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`];
    }

    return (statements ?? []).flatMap(({ stmt }, index) =>
        stmt !== undefined && 'TransactionStmt' in stmt
            ? [`${file}: statement ${index + 1} is ${String(stmt.TransactionStmt.kind).replace(/^TRANS_STMT_/u, '')}`]
            : [],
    );
}

/**
 * Every migration `.sql` under `packages`, discovered from the working tree.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git.
 */
const migrationFiles = (): readonly string[] => [...presentFiles(['packages/**/migrations/*.sql'])].sort();

/** The shapes the predicate must tell apart: the text, and what it must report. */
const SHAPES: readonly (readonly [shape: string, sql: string, reported: readonly string[]])[] = [
    [
        'a comment that says COMMIT',
        "-- A COMMIT here would split the runner's transaction.\nCREATE TABLE a (id int);\n",
        [],
    ],
    ['a block comment that says BEGIN and COMMIT', '/* BEGIN; COMMIT; */\nCREATE TABLE a (id int);\n', []],
    ['a string literal that says COMMIT', "COMMENT ON TABLE a IS 'COMMIT;';\n", []],
    [
        'a function body holding COMMIT as a string',
        "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'COMMIT' $$;\n",
        [],
    ],
    ['a DO body', 'DO $$ BEGIN PERFORM 1; COMMIT; END $$;\n', []],
    [
        'a real COMMIT',
        'CREATE TABLE a (id int);\nCOMMIT;\nCREATE TABLE b (id int);\n',
        ['fixture.sql: statement 2 is COMMIT'],
    ],
    ['BEGIN', 'BEGIN;\nCREATE TABLE a (id int);\n', ['fixture.sql: statement 1 is BEGIN']],
    ['START TRANSACTION', 'START TRANSACTION;\n', ['fixture.sql: statement 1 is START']],
    ['ROLLBACK', 'CREATE TABLE a (id int);\nROLLBACK;\n', ['fixture.sql: statement 2 is ROLLBACK']],
    ['SAVEPOINT', 'SAVEPOINT s;\n', ['fixture.sql: statement 1 is SAVEPOINT']],
    ['PREPARE TRANSACTION', "PREPARE TRANSACTION 'x';\n", ['fixture.sql: statement 1 is PREPARE']],
    ['text that does not parse', 'CREATE TABLE (;\n', ['fixture.sql does not parse: syntax error at or near "("']],
];

describe('no migration opens, ends or splits the runner’s transaction', () => {
    it.each(SHAPES)('reports %s exactly as the table says', async (_shape, sql, reported) => {
        expect(await transactionControlIn('fixture.sql', sql)).toStrictEqual(reported);
    });

    it('discovers the migrations of every database in DATABASE_ROLES', () => {
        // ⛔ The anchor: the next case is a flatMap over this list, and a pathspec that stopped matching would turn it
        // into a check of nothing.
        const files = migrationFiles();
        const undiscovered = Object.keys(DATABASE_ROLES).filter(
            (service) => !files.some((file) => file.startsWith(`packages/services/${service}`)),
        );

        expect(undiscovered).toStrictEqual([]);
    });

    it('⛔ finds no transaction-control statement in any migration', async () => {
        const violations = await Promise.all(
            migrationFiles().map((file) => transactionControlIn(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        expect(
            violations.flat(),
            'the runner applies each file in one transaction with its schema_migrations row; a statement that ends or ' +
                'opens a transaction leaves a half-applied file that is never recorded',
        ).toStrictEqual([]);
    });
});
