// @vitest-environment node
/**
 * Repo-wide guard: no migration replaces a ranking helper in place (ADR-0070).
 *
 * The ranking columns of `food` (`rank_head`, `rank_alias_keys`, `rank_default_keys`) are STORED generated columns, and
 * each calls an IMMUTABLE `rank_*` helper. A stored generated column is computed when its row is written. So
 * `CREATE OR REPLACE FUNCTION rank_…` changes the rule for new writes only: every existing row keeps the value the old
 * body computed, and the SQL mirror silently disagrees with `rankingTerms.ts` on exactly the rows nobody rewrote. The
 * rule in migration 0025's header is "add a new function and run `SET EXPRESSION`"; this makes it a check.
 *
 * The SQL is read with PostgreSQL's own grammar (`libpg-query`), never a regex: the migrations that state the rule say
 * "Never CREATE OR REPLACE it" in comments and in `COMMENT ON FUNCTION` strings, and a guard that reported its own
 * rationale would be deleted.
 *
 * DESIGN PATTERN: Specification — {@link rankHelperReplacementsIn} is the predicate, fired at a fixture table of shapes
 * as well as at every migration in the tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'libpg-query';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The prefix every ranking helper a generated column calls carries. */
const RANK_HELPER_PREFIX = 'rank_';

/** A function name as the parse tree spells it: one `String` node per dotted part. */
interface NamePart {
    readonly String?: { readonly sval?: string };
}

/**
 * Every statement in one migration that replaces a `rank_*` function in place, one sentence each.
 *
 * @param file - The file, for the message.
 * @param sql - Its text.
 * @returns One sentence per `CREATE OR REPLACE FUNCTION rank_…`, or one naming the parse error; empty when clean.
 */
export async function rankHelperReplacementsIn(file: string, sql: string): Promise<readonly string[]> {
    let statements: Awaited<ReturnType<typeof parse>>['stmts'];

    try {
        statements = (await parse(sql)).stmts;
    } catch (error) {
        return [`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`];
    }

    return (statements ?? []).flatMap(({ stmt }, index) => {
        if (stmt === undefined || !('CreateFunctionStmt' in stmt)) {
            return [];
        }

        const { replace, funcname } = stmt.CreateFunctionStmt;
        const parts = (funcname ?? []) as readonly NamePart[];
        const name = parts[parts.length - 1]?.String?.sval ?? '';

        return replace === true && name.startsWith(RANK_HELPER_PREFIX)
            ? [`${file}: statement ${String(index + 1)} replaces ${name} in place`]
            : [];
    });
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
    ['a new rank helper', 'CREATE FUNCTION rank_x(t text) RETURNS text LANGUAGE sql IMMUTABLE RETURN t;\n', []],
    ['a comment that says it', '-- Never CREATE OR REPLACE FUNCTION rank_head_of: add a new one.\nSELECT 1;\n', []],
    ['a COMMENT ON string that says it', "COMMENT ON TABLE a IS 'never CREATE OR REPLACE FUNCTION rank_x';\n", []],
    [
        'a replaced function that is not a rank helper',
        'CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n',
        [],
    ],
    [
        'a rank helper replaced in place',
        'CREATE OR REPLACE FUNCTION rank_head_of(t text) RETURNS text LANGUAGE sql IMMUTABLE RETURN t;\n',
        ['fixture.sql: statement 1 replaces rank_head_of in place'],
    ],
    [
        'a schema-qualified rank helper replaced in place, in lower case',
        'select 1;\ncreate or replace function public.rank_alias_keys_of(a text) returns text[] language sql immutable return null;\n',
        ['fixture.sql: statement 2 replaces rank_alias_keys_of in place'],
    ],
    ['text that does not parse', 'CREATE FUNCTION (;\n', ['fixture.sql does not parse: syntax error at or near "("']],
];

describe('no migration replaces a rank_* helper in place (ADR-0070)', () => {
    it.each(SHAPES)('reports %s exactly as the table says', async (_shape, sql, reported) => {
        expect(await rankHelperReplacementsIn('fixture.sql', sql)).toStrictEqual(reported);
    });

    it('discovers the migrations that define the rank helpers', () => {
        // ⛔ The anchor: a pathspec that stopped matching would turn the next case into a check of nothing.
        const sources = migrationFiles().map((file) => readFileSync(path.join(repoRoot, file), 'utf8'));

        expect(sources.filter((sql) => /CREATE FUNCTION rank_/u.test(sql)).length).toBeGreaterThanOrEqual(3);
    });

    it('⛔ finds no CREATE OR REPLACE FUNCTION rank_… in any migration', async () => {
        const violations = await Promise.all(
            migrationFiles().map((file) =>
                rankHelperReplacementsIn(file, readFileSync(path.join(repoRoot, file), 'utf8')),
            ),
        );

        expect(
            violations.flat(),
            'a STORED generated column keeps the value it computed at write time, so replacing its helper in place ' +
                'leaves every existing row stale: add a new function and run SET EXPRESSION (migration 0025)',
        ).toStrictEqual([]);
    });
});
