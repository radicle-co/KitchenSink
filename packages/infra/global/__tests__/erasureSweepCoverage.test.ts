// @vitest-environment node
/**
 * Every table in the recipe database that carries a person's identifier must be reached by the account-
 * erasure sweep, or be EXEMPT for a written reason.
 *
 * ## The class of defect this exists for — three instances and counting
 *
 * `ingredient_resolution_mappings` (migration 0021) shipped with `author_id` and `source_phrase` and NO
 * sweep coverage; its own header recorded that as a stated residual and handed it off. `ingredient_resolution
 * _memos` (0021, amended by 0026) shipped with a user's typed phrase and no author column at all, so no
 * predicate existed to sweep on. Both were RETROFITTED, months later, by someone who happened to notice.
 * `ingredient_parse_corrections` (0029) would have been the third.
 *
 * Nothing failed in either case, and nothing could: a table with an owner column and no sweep is a
 * fully-green test suite that quietly retains personal data through a legal erasure request. The symptom is
 * not a crash — it is a right exercised, reported complete, and not honoured. That is exactly the shape a
 * gate has to cover, because review cannot: the sweep lives in `recipe-workers` and the table arrives in
 * `recipe-service`, in a different package, usually in a different change.
 *
 * ## What is asserted, and why it is bidirectional
 *
 * The owner-bearing tables are DISCOVERED from the migration files — never enumerated here — and the swept
 * tables are DISCOVERED from the statements `eraseRecipeRows` actually issues. Then:
 *
 *  * every discovered owner-bearing table is swept, or named in {@link EXEMPT_FROM_SWEEP} with its reason;
 *  * every exemption names a table that still EXISTS and still carries an owner column, so an exemption
 *    cannot outlive the thing it excused;
 *  * no exemption is also swept, so an exemption that has quietly been closed is reported rather than left
 *    standing as a lie about the sweep.
 *
 * A non-vacuity floor guards the discovery itself: if the parser stops finding tables — a syntax change, a
 * moved directory, a renamed function — the gate must go RED rather than pass by finding nothing, which is
 * the failure mode `natEgressConsumers.test.ts` was written against and this file mirrors deliberately.
 *
 * ## ⚠️ WHY THE PARSER AND NOT grep, on BOTH sides
 *
 * Migration headers in this repository are long and quote SQL: 0021's header prints the exact prescribed
 * sweep, `author_id` and all, and 0026's discusses `owner_id` at length. A `grep` over the file would find a
 * table "covered" by a comment ABOUT covering it. Likewise `eraseRecipeRows`' docstring names every table it
 * touches and several it deliberately does not. So SQL comments are stripped before the schema is read, and
 * the sweep side is read from the TypeScript AST — where a comment is a comment and only a real template
 * literal counts.
 *
 * ## ⚠️ SCOPE, stated so it is not over-read
 *
 * This gate covers ONE database and ONE sweep: the recipe database and `eraseRecipeRows`. `identity` and
 * `food` have their own erasure surfaces, which this file makes no claim about. A second database that gains
 * a sweep adds an entry to {@link SWEPT_DATABASES}; the pure predicates below are subject-neutral so that
 * costs one line and no new logic.
 *
 * DESIGN PATTERN: Specification module over two pure parsers — {@link ownerBearingTablesIn} and
 * {@link sweptTablesIn} are pure verdicts over a source, fired at deliberately-violating fakes below as well
 * as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, presentFiles, repoRoot, visit, type SourceFile } from './serviceSources.js';

/**
 * The column names that make a row attributable to a person in this repository.
 *
 * There is no `users` table (D2), so every one of these holds an app-user ULID directly. A new spelling is
 * the one thing this gate cannot discover, which is why the set is small, closed, and stated here rather
 * than inferred from a shape.
 */
const OWNER_COLUMNS = ['owner_id', 'author_id', 'user_id', 'created_by'] as const;

/** One database whose owner-bearing tables are gated, and the sweep that must reach them. */
interface SweptDatabase {
    /** Repo-relative migrations directory whose files define the schema. */
    readonly migrations: string;
    /** Repo-relative source declaring the sweep. */
    readonly sweepFile: string;
    /** The exported function whose statements ARE the sweep. */
    readonly sweepFunction: string;
}

/** The databases this gate covers. See the module docstring's scope note before adding one. */
const SWEPT_DATABASES: readonly SweptDatabase[] = [
    {
        migrations: 'packages/services/recipe-service/src/database/migrations',
        sweepFile: 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts',
        sweepFunction: 'eraseRecipeRows',
    },
];

/**
 * Tables that carry an owner column and are DELIBERATELY not swept by a statement of their own.
 *
 * ⛔ An exemption is a claim that erasure still reaches the data by some OTHER means, and it is checked in
 * both directions below: it must name a table that exists and still carries an owner column, and it must not
 * name a table the sweep already touches. "It seemed fine" is not an entry.
 */
const EXEMPT_FROM_SWEEP: ReadonlyMap<string, string> = new Map([
    [
        'recipe_versions',
        // `eraseRecipeRows`' own docstring, verbatim in substance: mutations are owner-only and `created_by`
        // cannot diverge from its recipe's `owner_id`, so the recipe DELETE cascades over it. A "defensive"
        // delete here would destroy the version history of a user who never asked to be erased, if that
        // invariant ever broke.
        'covered by the cascade from `recipes`; `created_by` cannot diverge from the recipe’s `owner_id`',
    ],
]);

/**
 * The fewest owner-bearing tables a working discovery must find.
 *
 * A floor, never the list — the point of discovery is that the list is not written down. It exists so a
 * parser that silently stops matching goes RED instead of green, which is the failure a gate over a derived
 * set is most exposed to.
 */
const MINIMUM_OWNER_BEARING_TABLES = 6;

/**
 * Strip SQL comments so prose about a column is never read as a column.
 *
 * @param sql - Raw migration text.
 * @returns The same text with `--` lines and `/* *\/` blocks blanked. Pure.
 */
function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * The parenthesised body that opens at `start`, respecting nesting.
 *
 * @param text - The text to scan.
 * @param start - Index of the opening parenthesis.
 * @returns The body between the matching parentheses, or `''` when unbalanced. Pure.
 */
function balancedBody(text: string, start: number): string {
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

/**
 * The tables one migration file declares (or extends) with an owner-identifying column.
 *
 * Reads both spellings that occur in this repository: a `CREATE TABLE` whose body declares the column, and
 * an `ALTER TABLE … ADD COLUMN` that adds one later (migration 0026's shape). Quoting is optional on both,
 * because both styles are present in the tree.
 *
 * @param source - One migration file.
 * @returns The table names it makes owner-bearing. Pure.
 */
function ownerBearingTablesIn(source: SourceFile): readonly string[] {
    const sql = stripSqlComments(source.contents);
    const owned = new Set<string>();
    const ownerColumn = new RegExp(`"?\\b(?:${OWNER_COLUMNS.join('|')})\\b"?`);

    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
        const body = balancedBody(sql, sql.indexOf('(', (match.index ?? 0) + match[0].length - 1));

        if (ownerColumn.test(body) && match[1] !== undefined) {
            owned.add(match[1]);
        }
    }

    for (const match of sql.matchAll(
        new RegExp(
            `ALTER\\s+TABLE\\s+"?([a-z_][a-z0-9_]*)"?\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?(?:${OWNER_COLUMNS.join('|')})\\b`,
            'gi',
        ),
    )) {
        if (match[1] !== undefined) {
            owned.add(match[1]);
        }
    }

    return [...owned];
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
function sweptTablesIn(source: SourceFile, functionName: string): readonly string[] {
    const swept = new Set<string>();

    visit(parse(source), (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== functionName) {
            return;
        }

        visit(node, (inner) => {
            if (!ts.isTemplateLiteral(inner)) {
                return;
            }

            const text = ts.isNoSubstitutionTemplateLiteral(inner)
                ? inner.text
                : [inner.head.text, ...inner.templateSpans.map((span) => span.literal.text)].join(' ? ');

            // ⛔ MUTATING forms only. A bare `FROM` would count a table the sweep merely READS — the removed-
            // set `SELECT … FROM recipes` is one — as covered, which is a false NEGATIVE in the one direction
            // that matters: a table this sweep looks at but never erases would be reported as reached.
            for (const match of text.matchAll(/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
                if (match[1] !== undefined) {
                    swept.add(match[1]);
                }
            }
        });
    });

    return [...swept];
}

/**
 * Read one repo-relative file.
 *
 * @param file - Repo-relative path.
 * @returns The source, read. Impure.
 * @sideEffect Reads the working tree.
 */
function readSource(file: string): SourceFile {
    return { file, contents: readFileSync(path.join(repoRoot, file), 'utf8') };
}

/**
 * Every owner-bearing table in one database's migrations.
 *
 * The FILES are discovered from git, so a migration that lands tomorrow is covered the day it does and
 * cannot opt out by not being listed.
 *
 * ⛔ {@link presentFiles}, NOT `trackedFiles` — and this is not a style preference. `trackedFiles` reports
 * the INDEX, so a migration that exists on disk but has not been committed is INVISIBLE to it, which is
 * exactly the window in which someone is still writing the sweep that should reach it. Measured here while
 * building this gate: with `trackedFiles`, deleting the parse-correction sweep left the gate GREEN.
 *
 * @param database - The database to read.
 * @returns Its owner-bearing table names, sorted. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function ownerBearingTables(database: SweptDatabase): readonly string[] {
    const files = presentFiles([database.migrations]).filter((file) => file.endsWith('.sql'));

    expect(
        files.length,
        `no migrations found under ${database.migrations} — the gate has stopped discovering`,
    ).toBeGreaterThan(0);

    return [...new Set(files.flatMap((file) => ownerBearingTablesIn(readSource(file))))].sort();
}

describe('account-erasure sweep coverage', () => {
    for (const database of SWEPT_DATABASES) {
        describe(database.sweepFunction, () => {
            it('reaches every owner-bearing table, or exempts it for a written reason', () => {
                const owned = ownerBearingTables(database);
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                expect(
                    owned.length,
                    'fewer owner-bearing tables than this database is known to have — discovery has broken',
                ).toBeGreaterThanOrEqual(MINIMUM_OWNER_BEARING_TABLES);
                expect(
                    swept.size,
                    `${database.sweepFunction} addresses no tables — the parser has broken`,
                ).toBeGreaterThan(0);

                // ⛔ A table here is personal data with no route to erasure. Add a statement to the sweep, or
                // add an exemption above SAYING how erasure reaches it — never neither.
                expect(owned.filter((table) => !swept.has(table) && !EXEMPT_FROM_SWEEP.has(table))).toEqual([]);
            });

            it('carries no exemption for a table that no longer bears an owner column', () => {
                const owned = new Set(ownerBearingTables(database));

                // An exemption outliving its table is a claim about nothing, and it would silently excuse a
                // FUTURE table that happened to reuse the name.
                expect([...EXEMPT_FROM_SWEEP.keys()].filter((table) => !owned.has(table))).toEqual([]);
            });

            it('carries no exemption for a table the sweep already reaches', () => {
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                // A closed gap left standing as an exemption reads as "erasure does not touch this", which is
                // the opposite of the truth and the sort of note a later reader reasons correctly from.
                expect([...EXEMPT_FROM_SWEEP.keys()].filter((table) => swept.has(table))).toEqual([]);
            });
        });
    }

    it('states a real reason for every exemption', () => {
        // An exemption is the one place this gate accepts a human's word. A blank or throwaway entry would
        // turn "no route to erasure" into "somebody typed something", which is worse than no gate at all
        // because it reads as reviewed.
        for (const [table, why] of EXEMPT_FROM_SWEEP) {
            expect(why.trim().length, `the exemption for ${table} must say how erasure reaches it`).toBeGreaterThan(20);
        }
    });

    it('⛔ FAILS a table that carries an owner column and no sweep statement', () => {
        const migration = {
            file: 'fake/0099_new_table.sql',
            contents: `
                -- The sweep for "widgets" is described in this comment and nowhere else.
                CREATE TABLE "widgets" (
                    "id" uuid PRIMARY KEY,
                    "owner_id" varchar(255),
                    "payload" jsonb NOT NULL
                );
            `,
        };
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                /** Sweeps recipes and widgets. */
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`DELETE FROM recipes WHERE owner_id = \${ownerId}\`);
                };
            `,
        };

        const owned = ownerBearingTablesIn(migration);
        const swept = new Set(sweptTablesIn(sweep, 'eraseRows'));

        expect(owned).toEqual(['widgets']);
        // Named in the docstring, named in a SQL comment, and swept by neither — which is precisely how
        // `ingredient_resolution_mappings` and `ingredient_resolution_memos` both shipped.
        expect(owned.filter((table) => !swept.has(table))).toEqual(['widgets']);
    });

    it('reads a column from SQL but not from the prose describing it', () => {
        expect(
            ownerBearingTablesIn({
                file: 'fake/0100_prose.sql',
                contents: `
                    -- This table deliberately carries NO owner_id; the prescribed sweep would have been
                    --   UPDATE "notes" SET author_id = NULL WHERE author_id = $1;
                    CREATE TABLE "notes" ("id" uuid PRIMARY KEY, "body" text NOT NULL);
                `,
            }),
        ).toEqual([]);
    });

    it('reads a column added by a later ALTER, not only one declared at CREATE', () => {
        expect(
            ownerBearingTablesIn({
                file: 'fake/0101_alter.sql',
                contents: `ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "owner_id" text;`,
            }),
        ).toEqual(['memos']);
    });

    it('reads the sweep’s MUTATIONS, not its docstring and not the tables it merely reads', () => {
        const swept = sweptTablesIn(
            {
                file: 'fake/docstring.ts',
                contents: `
                    /**
                     * Deletes from recipes, collections and author_handles, and deliberately never touches
                     * the shared ingredients table.
                     */
                    export const eraseRows = async (tx) => {
                        await tx.execute(sql\`SELECT id FROM widgets WHERE owner_id = \${ownerId}\`);
                        await tx.execute(sql\`DELETE FROM collections WHERE owner_id = \${ownerId}\`);
                    };
                `,
            },
            'eraseRows',
        );

        // `widgets` is READ, never erased — counting it would report a table as reached by a sweep that
        // only looks at it, which is the false negative this gate cannot afford.
        expect([...swept]).toEqual(['collections']);
    });
});
