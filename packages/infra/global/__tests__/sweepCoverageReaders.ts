/**
 * THE PURE READERS BOTH SWEEP-COVERAGE GUARDS SHARE — the migration fold, the owner-column vocabulary, and the
 * AST reader over a sweep's SQL.
 *
 * ⚠️ EXTRACTED from `erasureSweepCoverage.test.ts` on 2026-09-13, not authored here, when ADR-0040 gave the recipe
 * database a SECOND sweep to gate (`purgeTestPrincipalRows`, gated by `testResetSweepCoverage.test.ts`). Every
 * subtlety these functions record — comment stripping before reading DDL, the whole clause list of a multi-clause
 * `ALTER`, a fold that subtracts a COLUMN rather than a table, mutating forms only — was paid for in a defect, and a
 * copy for the second guard would be a copy of every one of them, free to drift. The reasoning for each is kept
 * beside the code, and `erasureSweepCoverage.test.ts`'s module docstring still carries the history of why the fold
 * is shaped the way it is.
 *
 * ⛔ ONLY THE READERS LIVE HERE. The maps and pinned counts each guard enforces (`EXEMPT_FROM_SWEEP`,
 * `RETAINED_BY_RULING`, `EXEMPT_FROM_TEST_RESET`, the exact table counts) are DECISIONS about one sweep and stay in
 * that sweep's own test file: an erasure exemption and a test-purge exemption answer different questions, and a
 * shared map would let one silently excuse the other.
 *
 * DESIGN PATTERN: Specification module — pure verdicts over a `SourceFile`, driven at deliberately-violating fakes by
 * `erasureSweepCoverage.test.ts` as well as at the working tree. `readSource` and `migrationsOf` are the only impure
 * members, and they only READ.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { parse, presentFiles, repoRoot, visit, type SourceFile } from './serviceSources.js';

/**
 * The column names that make a row attributable to a person in this repository.
 *
 * There is no `users` table (D2), so every one of these holds an app-user ULID directly. A new spelling is
 * the one thing this gate cannot discover, which is why the set is small, closed, and stated here rather
 * than inferred from a shape.
 */
export const OWNER_COLUMNS = [
    'owner_id',
    'author_id',
    'user_id',
    'created_by',
    // The FOOD database's one spelling (plan U17): `fetch_requesters.requester_id` — an app-user ULID
    // since migration 0002 renamed it from the Clerk `sub`. Harmless to the recipe database (no recipe
    // table uses the spelling), and ONE vocabulary beats a per-database one: a spelling is a decision,
    // not a schema fact, and two lists would drift the day a table moves between services.
    'requester_id',
    // U11 (0040): `ingredients.food_owner_id` — the captured privacy fact for a private authored food.
    // An app-user ULID like every other member; the sweep's step 13 reaches it.
    'food_owner_id',
] as const;

/**
 * Strip SQL comments so prose about a column is never read as a column.
 *
 * @param sql - Raw migration text.
 * @returns The same text with `--` lines and `/* *\/` blocks blanked. Pure.
 */
export function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * The clause text of every `ALTER TABLE <table>` statement in one source, up to its `;`.
 *
 * ⛔ THIS EXISTS BECAUSE `ALTER TABLE` TAKES A COMMA-SEPARATED CLAUSE LIST, and this repository already
 * writes one — `0016_collection_source_provenance.sql` adds three columns under a single
 * `ALTER TABLE collections`. Every parser here used to anchor its clause pattern directly to
 * `ALTER TABLE <t>`, which sees the FIRST clause and no other. MEASURED while fixing this: a probe adding
 * `user_id` in clause position 2 to an unswept table left the whole gate GREEN — a user-bearing table
 * invisible to the check that exists to find exactly that.
 *
 * ⚠️ Splitting on `;` is sound HERE and would not be in general: comments are stripped before this runs,
 * and no migration in this tree puts a semicolon inside a string literal or a dollar-quoted body within an
 * `ALTER TABLE`. If one ever does, this is the line that needs a real tokenizer.
 *
 * @param sql - Comment-stripped migration text.
 * @param table - The table whose statements are wanted, or `undefined` for every table.
 * @returns One entry per matching statement: the table it alters, and its clause text. Pure.
 */
export function alterClausesIn(sql: string, table?: string): readonly { table: string; clauses: string }[] {
    const name = table === undefined ? '([a-z_][a-z0-9_]*)' : `(${table})`;
    const found: { table: string; clauses: string }[] = [];

    for (const match of sql.matchAll(new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?"?${name}"?\\s`, 'gi'))) {
        const start = (match.index ?? 0) + match[0].length;
        const end = sql.indexOf(';', start);

        if (match[1] !== undefined) {
            found.push({ table: match[1], clauses: sql.slice(start, end === -1 ? sql.length : end) });
        }
    }

    return found;
}

/**
 * The parenthesised body that opens at `start`, respecting nesting.
 *
 * @param text - The text to scan.
 * @param start - Index of the opening parenthesis.
 * @returns The body between the matching parentheses, or `''` when unbalanced. Pure.
 */
export function balancedBody(text: string, start: number): string {
    let depth = 0;

    for (let i = start; i < text.length; i += 1) {
        if (text[i] === '(') {
            depth += 1;
        } else if (text[i] === ')') {
            depth -= 1;

            if (depth === 0) {
                return text.slice(start + 1, i);
            }
        }
    }

    return '';
}

/** Leading words of a `CREATE TABLE` clause that introduces a constraint rather than a column. */
const NOT_A_COLUMN: ReadonlySet<string> = new Set([
    'constraint',
    'check',
    'primary',
    'unique',
    'foreign',
    'exclude',
    'like',
]);

/**
 * The columns DECLARED by a `CREATE TABLE` body — its clauses that define a column rather than a constraint.
 *
 * ⚠️ Splits on TOP-LEVEL commas, not on newlines, and that is load-bearing in both directions. Real
 * migrations in this tree write one column per line; the deliberately-violating fakes below write a whole
 * table on one line. A newline split reads the fakes as a single `id` column, which would silently disarm
 * every case that drives this parser at a violation. Depth tracking is what makes the comma split safe over
 * `varchar(255)` and `numeric(10, 2)`.
 *
 * @param body - The parenthesised body of a `CREATE TABLE`, comments already stripped.
 * @returns The declared column names, in declaration order. Pure.
 */
export function declaredColumnsIn(body: string): readonly string[] {
    const columns: string[] = [];
    let depth = 0;
    let start = 0;

    const take = (clause: string): void => {
        const definition = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i.exec(clause);

        if (definition?.[1] !== undefined && !NOT_A_COLUMN.has(definition[1].toLowerCase())) {
            columns.push(definition[1]);
        }
    };

    for (let i = 0; i < body.length; i += 1) {
        if (body[i] === '(') {
            depth += 1;
        } else if (body[i] === ')') {
            depth -= 1;
        } else if (body[i] === ',' && depth === 0) {
            take(body.slice(start, i));
            start = i + 1;
        }
    }

    take(body.slice(start));

    return columns;
}

/**
 * What one migration file does to the columns a predicate TRACKS: which tables it gives one, and which it
 * takes one away from.
 *
 * ⚠️ Parameterized by the predicate rather than hardcoding {@link OWNER_COLUMNS}, because two different
 * vocabularies are folded over the same DDL — owner columns (a sweep's predicate) and handle columns (a
 * sweep's payload). One tested fold, two subjects; a copy for the second would be a copy of every subtlety
 * the comments below record.
 *
 * Reads the four spellings that occur in this repository — a `CREATE TABLE` whose body declares the column,
 * an `ALTER TABLE … ADD COLUMN` that adds one later (0026's shape), an `ALTER TABLE … DROP COLUMN` that
 * removes one (0033's), and an `ALTER TABLE … RENAME COLUMN` that changes which spelling a table carries
 * (0033's again). Quoting is optional on all four, because every style is present in the tree.
 *
 * ⚠️ Comments are stripped FIRST, and that is load-bearing for the two new forms in a way it was not for the
 * two old ones: this repository's migration headers quote their own `ALTER` statements in prose — 0031's
 * prints its backfills, 0033's prints what it drops — so an unstripped read would let a DESCRIPTION of a drop
 * remove a real column from the derived schema. Asserted directly by a fake below.
 *
 * @param source - One migration file.
 * @param tracked - Whether a column name is one this fold follows.
 * @returns The `[table, column]` pairs it introduces and retires. PAIRS, not tables — see
 *   `userBearingTablesAfter` for why a table leaves the set only when its last one goes. Pure.
 */
export function columnEffectsIn(
    source: SourceFile,
    tracked: (column: string) => boolean,
): {
    readonly gained: readonly (readonly [string, string])[];
    readonly lost: readonly (readonly [string, string])[];
} {
    const sql = stripSqlComments(source.contents);
    const gained: [string, string][] = [];
    const lost: [string, string][] = [];
    const isUserColumn = tracked;

    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
        const body = balancedBody(sql, sql.indexOf('(', (match.index ?? 0) + match[0].length - 1));

        for (const column of declaredColumnsIn(body)) {
            if (match[1] !== undefined && isUserColumn(column)) {
                gained.push([match[1], column]);
            }
        }
    }

    // ⛔ Every `ALTER` form below reads the statement's WHOLE clause list — see `alterClausesIn`. A pattern
    // anchored to `ALTER TABLE <t> ADD COLUMN <user>` sees only the first clause, which is how a user column
    // in position 2+ became invisible to this gate.
    for (const { table, clauses } of alterClausesIn(sql)) {
        for (const add of clauses.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (add[1] !== undefined && isUserColumn(add[1])) {
                gained.push([table, add[1]]);
            }
        }

        for (const drop of clauses.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (drop[1] !== undefined && isUserColumn(drop[1])) {
                lost.push([table, drop[1]]);
            }
        }

        // A RENAME is BOTH — it retires one spelling and may introduce another. Tracked per COLUMN rather
        // than per table, so a table carrying two user columns that loses one stays user-bearing.
        for (const rename of clauses.matchAll(
            /\bRENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi,
        )) {
            const [, from, to] = rename;

            if (from === undefined || to === undefined) {
                continue;
            }

            if (isUserColumn(from)) {
                lost.push([table, from]);
            }

            if (isUserColumn(to)) {
                gained.push([table, to]);
            }
        }
    }

    return { gained, lost };
}

/**
 * The tables that carry a user column AFTER the whole ordered migration set has been applied.
 *
 * ⛔ A FOLD, not a union, and the order therefore matters — see the module docstring for why it changed. The
 * caller is responsible for supplying the sources in APPLY order; {@link migrationsOf} sorts them.
 *
 * @param migrations - The migration files, in apply order.
 * @returns The user-bearing table names, sorted. Pure.
 */
export function userBearingTablesAfter(migrations: readonly SourceFile[]): readonly string[] {
    return [...trackedColumnsAfter(migrations, isOwnerColumn).keys()].sort();
}

/** Whether a column name is one a sweep can KEY ON — an identifier for a person. Pure. */
export function isOwnerColumn(column: string): boolean {
    return (OWNER_COLUMNS as readonly string[]).includes(column);
}

/**
 * The tracked columns each table carries AFTER the whole ordered migration set has been applied.
 *
 * ⛔ A FOLD, not a union, and the order therefore matters — see the module docstring for why it changed. The
 * caller is responsible for supplying the sources in APPLY order; {@link migrationsOf} sorts them.
 *
 * ⛔ Keyed by table to a SET OF COLUMNS, never to a bare table flag. A table leaves the derived set only when
 * its LAST tracked column goes — subtracting the table on any drop would take a two-tracked-column table out
 * on losing one of them, which is the fold's one genuinely dangerous direction.
 *
 * @param migrations - The migration files, in apply order.
 * @param tracked - Whether a column name is one this fold follows.
 * @returns Table name → the tracked columns it still carries. Pure.
 */
export function trackedColumnsAfter(
    migrations: readonly SourceFile[],
    tracked: (column: string) => boolean,
): ReadonlyMap<string, ReadonlySet<string>> {
    const carried = new Map<string, Set<string>>();

    for (const source of migrations) {
        const { gained, lost } = columnEffectsIn(source, tracked);

        for (const [table, column] of lost) {
            const columns = carried.get(table);

            if (columns !== undefined) {
                columns.delete(column);

                if (columns.size === 0) {
                    carried.delete(table);
                }
            }
        }

        for (const [table, column] of gained) {
            const columns = carried.get(table) ?? new Set<string>();

            columns.add(column);
            carried.set(table, columns);
        }
    }

    return carried;
}

/**
 * The tables any migration EVER gave a user column — the pre-fold union.
 *
 * Kept only so the fold can be checked against it: a fold may remove and must never add, and comparing the
 * two is what catches a parser bug in the add direction without anyone enumerating a table.
 *
 * @param migrations - The migration files.
 * @returns The union's table names, sorted. Pure.
 */
export function userBearingTablesEver(migrations: readonly SourceFile[]): readonly string[] {
    return [
        ...new Set(
            migrations.flatMap((source) => columnEffectsIn(source, isOwnerColumn).gained.map(([table]) => table)),
        ),
    ].sort();
}

/**
 * The tables the named function's SQL actually MUTATES.
 *
 * Reads the TEMPLATE LITERALS inside the function's declaration, so the docstring above it — which names
 * every table it touches and several it deliberately leaves alone — contributes nothing. Only `UPDATE`,
 * `DELETE FROM` and `INSERT INTO` count: a table the sweep merely reads is not a table the sweep erases.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns The table names its statements mutate. Pure.
 */
export function sweptTablesIn(source: SourceFile, functionName: string): readonly string[] {
    const swept = new Set<string>();

    for (const text of statementTextsIn(source, functionName)) {
        // ⛔ MUTATING forms only. A bare `FROM` would count a table the sweep merely READS — the removed-
        // set `SELECT … FROM recipes` is one — as covered, which is a false NEGATIVE in the one direction
        // that matters: a table this sweep looks at but never erases would be reported as reached.
        for (const match of text.matchAll(/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (match[1] !== undefined) {
                swept.add(match[1]);
            }
        }
    }

    return [...swept];
}

/**
 * The SQL text of every template literal inside the named function's declaration.
 *
 * Interpolations become ` ? `, so a bound parameter can never be mistaken for a literal and a fragment
 * spliced in from ANOTHER template literal (the sweep's shared `ownerOnly` predicate is one) contributes to
 * its own text rather than to this statement's. Read from the AST for the reason the header gives: the
 * docstring above the function names every table it touches and several it deliberately does not.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns One string per template literal. Pure.
 */
export function statementTextsIn(source: SourceFile, functionName: string): readonly string[] {
    const texts: string[] = [];

    visit(parse(source), (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== functionName) {
            return;
        }

        visit(node, (inner) => {
            if (!ts.isTemplateLiteral(inner)) {
                return;
            }

            texts.push(
                ts.isNoSubstitutionTemplateLiteral(inner)
                    ? inner.text
                    : [inner.head.text, ...inner.templateSpans.map((span) => span.literal.text)].join(' ? '),
            );
        });
    });

    return texts;
}

/**
 * Read one repo-relative file.
 *
 * @param file - Repo-relative path.
 * @returns The source, read. Impure.
 * @sideEffect Reads the working tree.
 */
export function readSource(file: string): SourceFile {
    return { file, contents: readFileSync(path.join(repoRoot, file), 'utf8') };
}

/**
 * Every migration file under one migrations directory, read, in APPLY order.
 *
 * The FILES are discovered from git, so a migration that lands tomorrow is covered the day it does and cannot opt
 * out by not being listed.
 *
 * ⛔ {@link presentFiles}, NOT `trackedFiles` — and this is not a style preference. `trackedFiles` reports the INDEX,
 * so a migration that exists on disk but has not been committed is INVISIBLE to it, which is exactly the window in
 * which someone is still writing the sweep that should reach it. Measured while building the erasure gate: with
 * `trackedFiles`, deleting the parse-correction sweep left the gate GREEN.
 *
 * @param migrationsDir - Repo-relative migrations directory.
 * @returns Its migrations, sorted by filename. Impure.
 * @throws {Error} When the directory yields no `.sql` file — a gate over a derived set must go RED when discovery
 *   stops finding anything, never pass by finding nothing.
 * @sideEffect Shells out to git and reads the working tree.
 */
export function migrationsOf(migrationsDir: string): readonly SourceFile[] {
    const files = presentFiles([migrationsDir]).filter((file) => file.endsWith('.sql'));

    if (files.length === 0) {
        throw new Error(`no migrations found under ${migrationsDir} — the gate has stopped discovering`);
    }

    // ⛔ SORTED HERE, explicitly. `presentFiles` de-duplicates through a `Set`, and a set union is
    // order-independent — a FOLD is not. The numeric filename prefix IS the apply order, exactly as
    // `recipe-service/src/lambdas/migrate/handler.ts`'s `discoverMigrations` derives it ("sorted by filename
    // so the numeric prefix drives a deterministic order"). Relying on git's listing order instead would make
    // this gate's correctness depend on an undocumented implementation detail of `git ls-files`.
    return [...files].sort().map((file) => readSource(file));
}
