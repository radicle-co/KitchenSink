// @vitest-environment node
/**
 * ⛔ Every generated column in every migration must declare `STORED` (plan U13, R50).
 *
 * ## The defect this exists to prevent
 *
 * PostgreSQL 16 accepts only `STORED` generated columns — omitting the keyword is a syntax error, so the
 * mistake is UNMAKEABLE and the omission cannot reach a database. PostgreSQL 18 adds `VIRTUAL` generated
 * columns and makes **`VIRTUAL` the default when the keyword is omitted**. The same DDL text therefore
 * means two different things either side of the upgrade this release performs, and the 18 meaning fails
 * silently rather than loudly: the migration succeeds, the column reads correctly, and the failure surfaces
 * only where a virtual column cannot be used — it cannot be INDEXED.
 *
 * That is not a hypothetical shape here. Both generated columns in the tree are `tsvector`s that exist
 * ONLY to carry a GIN index (`food_search_vector_idx`, `food_aliases_search_vector_idx`) — the whole point
 * of materialising them. A virtual one would fail at `CREATE INDEX` in the best case and, in a migration
 * that adds the column without the index, would leave full-text search recomputing `to_tsvector` per row
 * per query against a 50,000-food catalog.
 *
 * ⚠️ The two columns that exist today already declare `STORED` — they had to, on 16. This gate is not for
 * them. It binds the migrations written AFTER the engine moves, when the keyword becomes optional and its
 * absence stops being an error. That is exactly the window in which nothing else would notice.
 *
 * ## Verified non-issue: the Drizzle side cannot express the mistake
 *
 * Checked against the installed `drizzle-orm` rather than assumed. `pg-core`'s
 * `generatedAlwaysAs(as)` takes NO config parameter (the base `column-builder` overload does; the pg
 * override does not) and its body hardcodes `mode: "stored"`; drizzle-kit's pg dialect emits that mode into
 * the DDL. So a `generatedAlwaysAs` in `schema/*.ts` cannot produce a virtual column, and a gate over the
 * TypeScript would be asserting a library constant. The risk lives entirely in the HAND-WRITTEN migration
 * SQL this repo actually deploys, which is what is read below.
 *
 * ## Library-first: what was checked (2026-08-22)
 *
 * A real PostgreSQL grammar would be the right tool for a broad SQL invariant. `libpg-query` / `pgsql-parser`
 * wrap the server's own parser and are the correct answer for anything semantic — but they are native
 * bindings, none is already in the tree, and this invariant is LEXICAL: does the token `STORED` follow the
 * generation expression. A native build step and a new dependency for one guard is disproportionate to that.
 * What IS borrowed from parser practice is the part a naive `grep` gets wrong — comments and quoted text are
 * lexed away before the invariant is evaluated, because `0007_food_aliases.sql` explains the PG 17
 * `SET EXPRESSION` constraint in a comment that QUOTES the DDL, and a textual gate that reports its own
 * rationale as a violation is a gate that gets deleted.
 *
 * DESIGN PATTERN: Specification module over pure predicates — {@link stripSqlComments} and
 * {@link generatedColumnFaults} are pure functions over one file's text, fired at deliberately-violating
 * fakes below as well as at every tracked migration.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Every SQL file in the tree, discovered rather than enumerated, so a new service's migrations are covered. */
const SUBJECT_PATHSPECS = ['*.sql'];

/**
 * The index just past a quoted run starting at `start`.
 *
 * Handles SQL's doubled-quote escape (`'it''s'`, `"a""b"`). An unterminated quote consumes the rest of the
 * file, which is the only safe reading — treating it as closed would let the tail be mis-lexed as code.
 *
 * @param sql - The text being lexed.
 * @param start - Index of the opening quote.
 * @param quote - The quote character.
 * @returns Index just past the closing quote. Pure.
 */
function endOfQuoted(sql: string, start: number, quote: string): number {
    let index = start + 1;

    while (index < sql.length) {
        if (sql[index] === quote) {
            if (sql[index + 1] === quote) {
                index += 2;
                continue;
            }

            return index + 1;
        }

        index += 1;
    }

    return sql.length;
}

/** A dollar-quote opening tag (`$$`, `$fn$`) anchored at the scan position. */
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y;

/**
 * The index just past the balanced parenthesis group opening at `start`, or `undefined` when unbalanced.
 *
 * Parentheses inside quoted text do not count — `coalesce(name, '(')` closes once, not twice.
 *
 * @param sql - The text being scanned, already comment-stripped.
 * @param start - Index of the opening `(`.
 * @returns Index just past the matching `)`, or `undefined`. Pure.
 */
function endOfParens(sql: string, start: number): number | undefined {
    let depth = 0;
    let index = start;

    while (index < sql.length) {
        const char = sql[index];

        if (char === "'" || char === '"') {
            index = endOfQuoted(sql, index, char);
            continue;
        }

        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;

            if (depth === 0) {
                return index + 1;
            }
        }

        index += 1;
    }

    return undefined;
}

/**
 * The same SQL with every comment blanked out.
 *
 * Comments become spaces rather than being deleted, and newlines are preserved, so every byte offset — and
 * therefore every reported line number — still refers to the original file. Quoted text and dollar-quoted
 * bodies are skipped intact: a `--` inside a string literal is not a comment.
 *
 * @param sql - The file's text.
 * @returns The text with comments replaced by spaces, same length. Pure.
 */
export function stripSqlComments(sql: string): string {
    const out = [...sql];
    let index = 0;

    const blank = (from: number, to: number): void => {
        for (let cursor = from; cursor < to; cursor += 1) {
            if (out[cursor] !== '\n') {
                out[cursor] = ' ';
            }
        }
    };

    while (index < sql.length) {
        const char = sql[index];

        if (char === "'" || char === '"') {
            index = endOfQuoted(sql, index, char);
            continue;
        }

        if (char === '$') {
            DOLLAR_TAG.lastIndex = index;
            const tag = DOLLAR_TAG.exec(sql)?.[0];

            if (tag !== undefined) {
                const close = sql.indexOf(tag, index + tag.length);

                index = close === -1 ? sql.length : close + tag.length;
                continue;
            }
        }

        if (char === '-' && sql[index + 1] === '-') {
            const newline = sql.indexOf('\n', index);
            const stop = newline === -1 ? sql.length : newline;

            blank(index, stop);
            index = stop;
            continue;
        }

        if (char === '/' && sql[index + 1] === '*') {
            // PostgreSQL block comments NEST, unlike C's — `/* a /* b */ c */` is one comment, not two.
            let depth = 1;
            let cursor = index + 2;

            while (cursor < sql.length && depth > 0) {
                if (sql.startsWith('/*', cursor)) {
                    depth += 1;
                    cursor += 2;
                } else if (sql.startsWith('*/', cursor)) {
                    depth -= 1;
                    cursor += 2;
                } else {
                    cursor += 1;
                }
            }

            blank(index, cursor);
            index = cursor;
            continue;
        }

        index += 1;
    }

    return out.join('');
}

/** `GENERATED ALWAYS AS`, the only spelling that introduces a generation expression. */
const GENERATED_ALWAYS_AS = /GENERATED\s+ALWAYS\s+AS\b/giu;

/**
 * Every generated column in one SQL file that fails to declare `STORED`.
 *
 * @param file - Repo-relative path, for the message.
 * @param sql - The file's text, comments included.
 * @returns One sentence per fault, empty when the file is correct. Pure.
 */
export function generatedColumnFaults(file: string, sql: string): readonly string[] {
    const code = stripSqlComments(sql);
    const faults: string[] = [];

    for (const match of code.matchAll(GENERATED_ALWAYS_AS)) {
        const start = match.index;
        const rest = code.slice(start + match[0].length);
        const line = code.slice(0, start).split('\n').length;
        const at = `${file}:${line}`;

        // `GENERATED ALWAYS AS IDENTITY` is an identity column, not a generation expression. It takes no
        // storage keyword and PG 18 changes nothing about it.
        if (/^\s*IDENTITY\b/iu.test(rest)) {
            continue;
        }

        const open = rest.search(/\S/u);

        if (open === -1 || rest[open] !== '(') {
            faults.push(`${at} — GENERATED ALWAYS AS is followed by neither a parenthesised expression nor IDENTITY`);
            continue;
        }

        const close = endOfParens(rest, open);

        if (close === undefined) {
            faults.push(`${at} — the generation expression's parentheses are unbalanced, so STORED cannot be read`);
            continue;
        }

        if (!/^\s*STORED\b/iu.test(rest.slice(close))) {
            faults.push(
                `${at} — generated column omits STORED. PostgreSQL 18 defaults an omitted keyword to ` +
                    'VIRTUAL, and a virtual column cannot be indexed',
            );
        }
    }

    return faults;
}

/**
 * Every tracked SQL file, read.
 *
 * @returns Repo-relative path and text, one per file.
 * @sideEffect Shells out to git and reads the working tree.
 */
function sqlFiles(): readonly { readonly file: string; readonly contents: string }[] {
    return presentFiles(SUBJECT_PATHSPECS).map((file) => ({
        file,
        contents: readFileSync(path.join(repoRoot, file), 'utf8'),
    }));
}

describe('every generated column in the tree declares STORED', () => {
    it('finds SQL to read at all, so the sweep cannot pass vacuously', () => {
        expect(sqlFiles().length, 'no .sql file discovered — this gate has stopped reading anything').toBeGreaterThan(
            0,
        );
    });

    it('⛔ leaves no generated column relying on the PostgreSQL 18 default', () => {
        expect(
            sqlFiles().flatMap(({ file, contents }) => generatedColumnFaults(file, contents)),
            'PostgreSQL 16 rejected an omitted storage keyword outright; 18 accepts it and silently means ' +
                'VIRTUAL. Declare STORED explicitly — see docs/runbooks/pg18-upgrade.md.',
        ).toEqual([]);
    });
});

describe('the generated-column verdict detects the absence of what it asserts', () => {
    const column = (tail: string): string =>
        `ALTER TABLE "food" ADD COLUMN "v" tsvector\n    GENERATED ALWAYS AS ${tail}`;

    it('passes an explicit STORED', () => {
        expect(
            generatedColumnFaults('f.sql', column(`(to_tsvector('english', coalesce("name", ''))) STORED;`)),
        ).toEqual([]);
    });

    it('⛔ fails an omitted storage keyword — the PG 18 defect itself', () => {
        expect(generatedColumnFaults('f.sql', column(`(to_tsvector('english', "name"));`)).join(' ')).toContain(
            'omits STORED',
        );
    });

    it('fails an explicit VIRTUAL', () => {
        expect(generatedColumnFaults('f.sql', column(`(lower("name")) VIRTUAL;`)).join(' ')).toContain('omits STORED');
    });

    it('reports the line the column is declared on', () => {
        expect(generatedColumnFaults('f.sql', column(`(lower("name"));`))[0]).toContain('f.sql:2');
    });

    it('ignores an identity column, which takes no storage keyword', () => {
        expect(
            generatedColumnFaults('f.sql', 'ALTER TABLE "t" ADD COLUMN "id" int GENERATED ALWAYS AS IDENTITY;'),
        ).toEqual([]);
    });

    it('ignores GENERATED BY DEFAULT AS IDENTITY', () => {
        expect(
            generatedColumnFaults('f.sql', 'ALTER TABLE "t" ADD COLUMN "id" int GENERATED BY DEFAULT AS IDENTITY;'),
        ).toEqual([]);
    });

    it('⛔ does NOT report a comment quoting the DDL as a violation', () => {
        const sql = [
            "-- Changing this needs PG 17's `ALTER COLUMN ... SET EXPRESSION`; the 16 equivalent is",
            "-- DROP + ADD COLUMN: `GENERATED ALWAYS AS (to_tsvector('english', aliases))` rewrites the table.",
            '/* Also mentioned here: GENERATED ALWAYS AS (lower(name)) and nothing follows it. */',
            column(`(lower("name")) STORED;`),
        ].join('\n');

        expect(generatedColumnFaults('f.sql', sql)).toEqual([]);
    });

    it('handles a nested expression, so a deep call does not truncate the scan', () => {
        expect(
            generatedColumnFaults(
                'f.sql',
                column(`(to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))) STORED;`),
            ),
        ).toEqual([]);
    });

    it('does not treat a parenthesis inside a string literal as closing the expression', () => {
        expect(generatedColumnFaults('f.sql', column(`(coalesce("name", ')(')) STORED;`))).toEqual([]);
    });

    it('does not treat `--` inside a string literal as a comment', () => {
        expect(generatedColumnFaults('f.sql', column(`(coalesce("name", '--')));`)).join(' ')).toContain(
            'omits STORED',
        );
    });

    it('reads a generated column inside a dollar-quoted function body as code, not as a comment', () => {
        expect(stripSqlComments('CREATE FUNCTION f() AS $fn$ -- kept\n$fn$;')).toContain('-- kept');
    });

    it('blanks a line comment while preserving every byte offset, so line numbers stay true', () => {
        const source = 'SELECT 1; -- note\nSELECT 2;';
        const stripped = stripSqlComments(source);

        expect(stripped).toHaveLength(source.length);
        expect(stripped).not.toContain('note');
        expect(stripped.indexOf('\n')).toBe(source.indexOf('\n'));
        expect(stripped.indexOf('SELECT 2;')).toBe(source.indexOf('SELECT 2;'));
    });

    it('blanks a NESTED block comment as ONE comment, not two', () => {
        const source = 'a /* x /* y */ z */ b';
        const stripped = stripSqlComments(source);

        // The naive non-nesting reading stops at the FIRST `*/` and leaves `z */ b` as code.
        expect(stripped).toHaveLength(source.length);
        expect(stripped.replace(/ /gu, '')).toBe('ab');
        expect(stripped.indexOf('b')).toBe(source.indexOf('b'));
    });
});
