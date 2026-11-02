// @vitest-environment node
/**
 * Repo-wide guard: a migration that locks a table it did not create bounds its wait for the lock.
 *
 * The runner's own `lock_timeout` covers only its advisory lock. An `ALTER TABLE` takes ACCESS EXCLUSIVE on a table the
 * service is reading and writing, and a foreign key takes SHARE ROW EXCLUSIVE on the table it points to, also inside
 * `CREATE TABLE`. With no bound, the migration queues behind one long transaction and every query behind it queues too.
 * `SET LOCAL lock_timeout = '5s'` makes the deploy fail instead, and a re-run retries it (food 0025 to 0027 carry the
 * reasoning). Recipe 0060 shipped without it, and so did 0057 and 0059, which the first version of this guard missed
 * because it read only `ALTER TABLE`.
 *
 * Only files from `FLOOR` up are held to it: older, already-applied files cannot be changed without changing the schema
 * manifest of every stage that has them, and the floor is where the rule starts, not a list of exemptions.
 *
 * The SQL is read with PostgreSQL's own grammar (`libpg-query`), so a comment or string that says ALTER TABLE is not one.
 *
 * DESIGN PATTERN: Specification — {@link unboundedLocks} is the predicate, fired at a fixture table and at the tree.
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

type Statement = NonNullable<Awaited<ReturnType<typeof parse>>['stmts']>[number]['stmt'];

/** A table a statement locks, and the words for how. */
interface Lock {
    readonly table: string;
    readonly how: string;
}

/** What the file has made so far. A table or index it made itself has no other session holding it. */
interface Made {
    readonly tables: Set<string>;
    readonly indexes: Set<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every table a foreign key inside the statement points at, in `CREATE TABLE` columns, table constraints and `ALTER
 * TABLE` commands alike. A foreign key takes SHARE ROW EXCLUSIVE on the table it references, which blocks that table's
 * writes and waits behind any open transaction on it.
 *
 * @param node - A parsed statement, or any part of one.
 * @returns The referenced table names, in order.
 */
function foreignKeyTargets(node: unknown): readonly string[] {
    if (Array.isArray(node)) {
        return node.flatMap((item: unknown) => foreignKeyTargets(item));
    }

    if (!isRecord(node)) {
        return [];
    }

    return Object.entries(node).flatMap(([key, value]) => {
        if (key === 'Constraint' && isRecord(value) && value['contype'] === 'CONSTR_FOREIGN') {
            const target = isRecord(value['pktable']) ? value['pktable']['relname'] : undefined;

            return typeof target === 'string' ? [target] : [];
        }

        return foreignKeyTargets(value);
    });
}

/** The last name of each object in a `DROP`, which is the table or index itself when the name is schema-qualified. */
function droppedNames(objects: unknown): readonly string[] {
    if (!Array.isArray(objects)) {
        return [];
    }

    return objects.flatMap((object: unknown) => {
        const items = isRecord(object) && isRecord(object['List']) ? object['List']['items'] : undefined;
        const last: unknown = Array.isArray(items) ? items.at(-1) : undefined;
        const name = isRecord(last) && isRecord(last['String']) ? last['String']['sval'] : undefined;

        return typeof name === 'string' ? [name] : [];
    });
}

/**
 * Every lock a statement takes on a table or index the file did not make. Pure apart from recording what the
 * statement makes into `made`.
 *
 * Covered: `CREATE TABLE` and `ALTER TABLE` foreign keys, `ALTER TABLE`, `CREATE INDEX` without `CONCURRENTLY`, renames
 * of a table or column, `CREATE TRIGGER`, `DROP TABLE` and `DROP INDEX`, and `INSERT`, `UPDATE` and `DELETE`.
 *
 * @param stmt - The parsed statement.
 * @param made - What the file made before it. A `CREATE TABLE` or `CREATE INDEX` adds its own name first.
 * @returns The locks, in the order the sentences read.
 */
function locksOf(stmt: NonNullable<Statement>, made: Made): readonly Lock[] {
    const locks: Lock[] = [];

    if ('CreateStmt' in stmt) {
        made.tables.add(stmt.CreateStmt.relation?.relname ?? '');
        locks.push(...foreignKeyTargets(stmt.CreateStmt).map((table) => ({ table, how: 'references' })));
    } else if ('AlterTableStmt' in stmt) {
        if (stmt.AlterTableStmt.objtype === 'OBJECT_TABLE') {
            locks.push({ table: stmt.AlterTableStmt.relation?.relname ?? '', how: 'alters' });
        }

        locks.push(...foreignKeyTargets(stmt.AlterTableStmt).map((table) => ({ table, how: 'references' })));
    } else if ('IndexStmt' in stmt) {
        if (stmt.IndexStmt.concurrent !== true) {
            locks.push({ table: stmt.IndexStmt.relation?.relname ?? '', how: 'indexes' });
        }

        made.indexes.add(stmt.IndexStmt.idxname ?? '');
    } else if ('RenameStmt' in stmt) {
        if (['OBJECT_TABLE', 'OBJECT_COLUMN', 'OBJECT_TABCONSTRAINT'].includes(stmt.RenameStmt.renameType ?? '')) {
            locks.push({ table: stmt.RenameStmt.relation?.relname ?? '', how: 'renames' });
        }
    } else if ('CreateTrigStmt' in stmt) {
        locks.push({ table: stmt.CreateTrigStmt.relation?.relname ?? '', how: 'adds a trigger to' });
    } else if ('DropStmt' in stmt) {
        const removing = stmt.DropStmt.removeType;
        const own = removing === 'OBJECT_INDEX' ? made.indexes : made.tables;

        if (removing === 'OBJECT_TABLE' || removing === 'OBJECT_INDEX') {
            locks.push(
                ...droppedNames(stmt.DropStmt.objects)
                    .filter((name) => !own.has(name))
                    .map((table) => ({ table, how: 'drops' })),
            );
        }
    } else if ('InsertStmt' in stmt) {
        locks.push({ table: stmt.InsertStmt.relation?.relname ?? '', how: 'writes to' });
    } else if ('UpdateStmt' in stmt) {
        locks.push({ table: stmt.UpdateStmt.relation?.relname ?? '', how: 'writes to' });
    } else if ('DeleteStmt' in stmt) {
        locks.push({ table: stmt.DeleteStmt.relation?.relname ?? '', how: 'writes to' });
    }

    // A dropped index is not a table name, so only the table-shaped locks are checked against `made.tables`.
    return locks.filter(({ table, how }) => how === 'drops' || !made.tables.has(table));
}

/**
 * Every lock on a table or index the file did not make that no earlier `SET LOCAL lock_timeout` covers.
 *
 * @param file - The file, for the message.
 * @param sql - Its text.
 * @returns One sentence per unbounded lock, or one naming the parse error. Empty when the file is clean.
 */
export async function unboundedLocks(file: string, sql: string): Promise<readonly string[]> {
    let statements: Awaited<ReturnType<typeof parse>>['stmts'];

    try {
        statements = (await parse(sql)).stmts;
    } catch (error) {
        return [`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`];
    }

    const made: Made = { tables: new Set(), indexes: new Set() };
    let bounded = false;
    const found: string[] = [];

    (statements ?? []).forEach(({ stmt }, index) => {
        if (stmt === undefined) {
            return;
        }

        if ('VariableSetStmt' in stmt) {
            const set = stmt.VariableSetStmt;
            bounded ||= set.name === 'lock_timeout' && set.is_local === true && set.kind === 'VAR_SET_VALUE';

            return;
        }

        for (const { table, how } of locksOf(stmt, made)) {
            if (!bounded) {
                found.push(`${file}: statement ${index + 1} ${how} ${table} with no SET LOCAL lock_timeout before it`);
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
    // A foreign key takes SHARE ROW EXCLUSIVE on the table it points to, also inside CREATE TABLE.
    [
        'a column foreign key to an existing table',
        'CREATE TABLE a (i int REFERENCES b (id));\n',
        ['fixture.sql: statement 1 references b with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a table foreign key to an existing table',
        'CREATE TABLE a (i int, FOREIGN KEY (i) REFERENCES b (id));\n',
        ['fixture.sql: statement 1 references b with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a foreign key to a table the file created',
        'CREATE TABLE b (id int PRIMARY KEY);\nCREATE TABLE a (i int REFERENCES b (id));\n',
        [],
    ],
    [
        'a foreign key after the timeout',
        "SET LOCAL lock_timeout = '5s';\nCREATE TABLE a (i int REFERENCES b (id));\n",
        [],
    ],
    [
        'a foreign key added to a created table, pointing outside',
        'CREATE TABLE a (i int);\nALTER TABLE a ADD FOREIGN KEY (i) REFERENCES z (id);\n',
        ['fixture.sql: statement 2 references z with no SET LOCAL lock_timeout before it'],
    ],
    [
        'an alter that adds a column with a foreign key reports both tables',
        'ALTER TABLE a ADD COLUMN b int REFERENCES z (id);\n',
        [
            'fixture.sql: statement 1 alters a with no SET LOCAL lock_timeout before it',
            'fixture.sql: statement 1 references z with no SET LOCAL lock_timeout before it',
        ],
    ],
    [
        'an index on an existing table',
        'CREATE INDEX i ON a (c);\n',
        ['fixture.sql: statement 1 indexes a with no SET LOCAL lock_timeout before it'],
    ],
    ['an index built concurrently', 'CREATE INDEX CONCURRENTLY i ON a (c);\n', []],
    ['an index on a table the file created', 'CREATE TABLE a (c int);\nCREATE INDEX i ON a (c);\n', []],
    [
        'a table rename',
        'ALTER TABLE a RENAME TO c;\n',
        ['fixture.sql: statement 1 renames a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a column rename',
        'ALTER TABLE a RENAME COLUMN b TO c;\n',
        ['fixture.sql: statement 1 renames a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a trigger on an existing table',
        'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();\n',
        ['fixture.sql: statement 1 adds a trigger to a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a dropped table',
        'DROP TABLE a;\n',
        ['fixture.sql: statement 1 drops a with no SET LOCAL lock_timeout before it'],
    ],
    ['a dropped table the file created', 'CREATE TABLE a (c int);\nDROP TABLE a;\n', []],
    [
        'a dropped index the file did not create',
        'DROP INDEX i;\n',
        ['fixture.sql: statement 1 drops i with no SET LOCAL lock_timeout before it'],
    ],
    ['a dropped index the file created', 'CREATE TABLE a (c int);\nCREATE INDEX i ON a (c);\nDROP INDEX i;\n', []],
    [
        'an update of an existing table',
        'UPDATE a SET b = 1;\n',
        ['fixture.sql: statement 1 writes to a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'a delete from an existing table',
        'DELETE FROM a;\n',
        ['fixture.sql: statement 1 writes to a with no SET LOCAL lock_timeout before it'],
    ],
    [
        'an insert into an existing table',
        'INSERT INTO a SELECT 1;\n',
        ['fixture.sql: statement 1 writes to a with no SET LOCAL lock_timeout before it'],
    ],
    ['an insert into a table the file created', 'CREATE TABLE a (c int);\nINSERT INTO a SELECT 1;\n', []],
    ['a comment that says REFERENCES', '-- REFERENCES b\nCREATE TABLE c (i int);\n', []],
];

const numberOf = (file: string): number => Number.parseInt(path.basename(file).slice(0, 4), 10);

const heldFiles = (): readonly string[] =>
    [...presentFiles(['packages/services/*/src/**/migrations/*.sql'])]
        .filter((file) => numberOf(file) >= (FLOOR[path.dirname(file)] ?? Number.POSITIVE_INFINITY))
        .sort();

describe('a migration bounds its wait for the lock on a table it did not create', () => {
    it.each(SHAPES)('reports %s exactly as the table says', async (_shape, sql, reported) => {
        expect(await unboundedLocks('fixture.sql', sql)).toStrictEqual(reported);
    });

    it('discovers the migrations of both databases, so the next case is not a check of nothing', () => {
        const files = heldFiles();

        expect(files.some((file) => file.includes('recipe-service'))).toBe(true);
        expect(files.some((file) => file.includes('food-service'))).toBe(true);
    });

    it('⛔ finds no unbounded lock on an existing table in a migration from the floor up', async () => {
        const violations = await Promise.all(
            heldFiles().map((file) => unboundedLocks(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        expect(violations.flat()).toStrictEqual([]);
    });
});
