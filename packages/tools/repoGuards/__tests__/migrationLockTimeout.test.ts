// @vitest-environment node
/**
 * Repo-wide guard: a migration that ALTERs a table it did not create bounds its wait for the table lock.
 *
 * The runner's own `lock_timeout` covers only its advisory lock. An `ALTER TABLE` takes ACCESS EXCLUSIVE on a table the
 * service is reading and writing; with no bound, the migration queues behind one long transaction and every query behind
 * it queues too. `SET LOCAL lock_timeout = '5s'` makes the deploy fail instead, and a re-run retries it (food 0025 to
 * 0027 carry the reasoning). Recipe 0060 shipped without it.
 *
 * Only files from `FLOOR` up are held to it: older, already-applied files cannot be changed without changing the schema
 * manifest of every stage that has them, and the floor is where the rule starts, not a list of exemptions.
 *
 * The SQL is read with PostgreSQL's own grammar (`libpg-query`), so a comment or string that says ALTER TABLE is not one.
 *
 * DESIGN PATTERN: Specification — {@link unboundedAlters} is the predicate, fired at a fixture table and at the tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'libpg-query';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The first migration number held to the rule, per migrations directory. */
const FLOOR: Readonly<Record<string, number>> = {
    'packages/services/recipe-service/src/database/migrations': 57,
    'packages/services/food-service/src/db/migrations': 25,
};

/**
 * Every `ALTER TABLE` of a table the file did not create, that no earlier `SET LOCAL lock_timeout` covers.
 *
 * @param file - The file, for the message.
 * @param sql - Its text.
 * @returns One sentence per unbounded alter, or one naming the parse error; empty when the file is clean.
 */
export async function unboundedAlters(file: string, sql: string): Promise<readonly string[]> {
    let statements: Awaited<ReturnType<typeof parse>>['stmts'];

    try {
        statements = (await parse(sql)).stmts;
    } catch (error) {
        return [`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`];
    }

    const created = new Set<string>();
    let bounded = false;
    const found: string[] = [];

    (statements ?? []).forEach(({ stmt }, index) => {
        if (stmt === undefined) {
            return;
        }
        if ('VariableSetStmt' in stmt) {
            const set = stmt.VariableSetStmt;
            bounded ||= set.name === 'lock_timeout' && set.is_local === true && set.kind === 'VAR_SET_VALUE';
        } else if ('CreateStmt' in stmt) {
            created.add(stmt.CreateStmt.relation?.relname ?? '');
        } else if ('AlterTableStmt' in stmt) {
            const table = stmt.AlterTableStmt.relation?.relname ?? '';
            if (stmt.AlterTableStmt.objtype === 'OBJECT_TABLE' && !created.has(table) && !bounded) {
                found.push(`${file}: statement ${index + 1} alters ${table} with no SET LOCAL lock_timeout before it`);
            }
        }
    });

    return found;
}

const SHAPES: readonly (readonly [shape: string, sql: string, reported: readonly string[]])[] = [
    ['an alter after the timeout', "SET LOCAL lock_timeout = '5s';\nALTER TABLE a ADD COLUMN b int;\n", []],
    ['an alter of a table created in the file', 'CREATE TABLE a (i int);\nALTER TABLE a ADD COLUMN b int;\n', []],
    ['a comment that says ALTER TABLE', '-- ALTER TABLE a ADD COLUMN b int;\nCREATE TABLE c (i int);\n', []],
    [
        'an alter with no timeout',
        'ALTER TABLE a ADD COLUMN b int;\n',
        ['fixture.sql: statement 1 alters a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a timeout that comes after the alter',
        "ALTER TABLE a ADD COLUMN b int;\nSET LOCAL lock_timeout = '5s';\n",
        ['fixture.sql: statement 1 alters a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a session-wide timeout, which outlives the migration transaction',
        "SET lock_timeout = '5s';\nALTER TABLE a ADD COLUMN b int;\n",
        ['fixture.sql: statement 2 alters a with no SET LOCAL lock_timeout before it'],
    ],
];

const numberOf = (file: string): number => Number.parseInt(path.basename(file).slice(0, 4), 10);

const heldFiles = (): readonly string[] =>
    [...presentFiles(['packages/services/*/src/**/migrations/*.sql'])]
        .filter((file) => numberOf(file) >= (FLOOR[path.dirname(file)] ?? Number.POSITIVE_INFINITY))
        .sort();

describe('a migration bounds its wait for the lock on a table it alters', () => {
    it.each(SHAPES)('reports %s exactly as the table says', async (_shape, sql, reported) => {
        expect(await unboundedAlters('fixture.sql', sql)).toStrictEqual(reported);
    });

    it('discovers the migrations of both databases, so the next case is not a check of nothing', () => {
        const files = heldFiles();

        expect(files.some((file) => file.includes('recipe-service'))).toBe(true);
        expect(files.some((file) => file.includes('food-service'))).toBe(true);
    });

    it('⛔ finds no unbounded ALTER TABLE in a migration from the floor up', async () => {
        const violations = await Promise.all(
            heldFiles().map((file) => unboundedAlters(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        expect(violations.flat()).toStrictEqual([]);
    });
});
