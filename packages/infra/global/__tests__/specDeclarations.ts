/**
 * Structural parsers for the two things a feature specification declares that MUST be unique portfolio-wide:
 * its **task identifiers** and its **database table names**.
 *
 * Both defects this module exists to catch were found by accident, in documents that had already been reviewed:
 * feature 007 defined eight task IDs twice (so a traceability row could be marked done by the wrong task), and
 * feature 010 declared a `webhook_events` table that already ships in the very database ADR-0017 puts its
 * webhook in — with different columns, a different key and a different writer. Neither is a judgement call, so
 * neither should ever again depend on a human noticing.
 *
 * ## ⛔ Why this PARSES instead of grepping, stated because a text gate already failed in this repo
 *
 * A `grep`-shaped gate written in this repository passed against deliberately broken code because the docstring
 * above it contained the words the gate searched for. Markdown makes that failure mode routine rather than
 * exotic:
 *
 *   - Feature 007's dependency graph is a fenced code block full of `[T-001]`, `[T-004]` tokens. A line-wise
 *     regex for a task ID counts every one of them and reports ~30 phantom duplicates.
 *   - Feature 010's `plan.md` discusses the `webhook_events` collision in *prose*, at length, in the same file
 *     whose fenced DDL causes it. A text search cannot tell the DDL that creates a table from the paragraph
 *     that warns about it — so it either misses real declarations or drowns in commentary.
 *   - Shipped drizzle schemas write `pgTable(\n    'recipes',` across two lines, so even the obvious
 *     `pgTable\('name'` regex silently sees 3 of the repository's tables instead of all of them. That is not a
 *     hypothetical: it is what a first pass at this module measured before the parser replaced it.
 *   - SQL comments mention tables constantly (`-- drops webhook_events`), and a migration's `CREATE TABLE`
 *     inside a `/* … *\/` block is not a declaration at all.
 *
 * So: markdown is scanned with a CommonMark-correct fence tracker and a declaration is recognised ONLY inside a
 * fenced block whose info string says which language it is; SQL is scanned with comments and string literals
 * removed first; and TypeScript is parsed with the TypeScript compiler's own parser, which is the only thing
 * that reliably knows a `pgTable` call from the same nine characters inside a comment or a string.
 *
 * ## What counts as a DECLARATION (and why prose deliberately does not)
 *
 * A spec declares a table by writing its DDL — a fenced ```sql `CREATE TABLE`, or a fenced ```ts `pgTable(...)`.
 * Prose that names a table is a **reference**, not a declaration: 007 legitimately reads 001's
 * `recipe_ingredients`, and every feature that touches billing legitimately names `accounts`. Treating a mention
 * as a claim of ownership would make the gate fire on every cross-feature read, which is how a gate gets
 * disabled. The cost of this choice is stated rather than hidden: a feature that plans a table WITHOUT writing
 * its DDL is invisible to the collision check, which is exactly why {@link GR_021_STRUCTURAL_DECLARATION} is
 * worded as an obligation on the spec author.
 *
 * Every function here is pure. File reading lives in the suites.
 */
import ts from 'typescript';

/**
 * The governance requirement this module enforces, quoted so the failure message can cite it verbatim rather
 * than pointing at a document the reader then has to go find.
 */
export const GR_021_STRUCTURAL_DECLARATION =
    'GR-021: a feature declares a table by writing its DDL in a fenced ```sql or ```ts block. A table name is ' +
    'owned by exactly ONE feature or ONE shipped package; a second declarer needs an exemption with a `why`.';

/** How a table declaration was written. Named in failures, because the FIX differs per form. */
export type DeclarationForm = 'sql-ddl' | 'drizzle-pgTable';

/** One place a table name is declared. */
export interface TableDeclaration {
    /** The bare, unqualified table name, lowercased. */
    readonly table: string;
    /**
     * Who declares it: a feature directory name (`007-grocery-lists`) for a spec, or the repo-relative path of
     * the owning package (`packages/shared/identity-db`) for shipped code. Collisions are computed over THIS,
     * so that a feature declaring one table across three of its own files is not a collision with itself.
     */
    readonly owner: string;
    /** Whether this declaration is a plan (`spec`) or already deployed (`shipped`). */
    readonly origin: 'spec' | 'shipped';
    /** Repo-relative path of the declaring file. */
    readonly file: string;
    /** 1-based line number of the declaration. */
    readonly line: number;
    /** How it was written. */
    readonly form: DeclarationForm;
}

/** How a task identifier was written. Both forms are real in this repository. */
export type TaskIdForm = 'checkbox' | 'heading';

/** One place a task identifier is DEFINED (not merely referenced). */
export interface TaskIdDefinition {
    /** The identifier exactly as written, e.g. `T001`, `T-001`, `T001-alb`. */
    readonly id: string;
    /** 1-based line number of the definition. */
    readonly line: number;
    /** How it was written. */
    readonly form: TaskIdForm;
}

/**
 * A deliberate exemption from the one-declarer rule.
 *
 * `why` is REQUIRED and required to be substantive, following the precedent of `contract-gen`'s
 * `AllowedPackageImport.why` and the storage-capacity account: the difference between recording a decision and
 * silencing a gate is that somebody had to write down the reason. A `why`-less entry is a hard failure, not a
 * lenient default — see {@link validateExemptions}.
 */
export interface TableExemption {
    /** The colliding table name, lowercased. */
    readonly table: string;
    /**
     * The EXACT set of owners permitted to declare it. Matched as a set, never as a floor: a third declarer
     * appearing later fails even though the table is exempt for the first two, because the third is new
     * information nobody has ruled on.
     */
    readonly owners: readonly string[];
    /** Why two owners declaring one table is correct — or, for a recorded defect, what the defect is. */
    readonly why: string;
}

/** A fenced-code-block state, tracked per CommonMark's fence rules. */
interface Fence {
    readonly char: string;
    readonly length: number;
    readonly lang: string;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/u;

/** Info strings that mean "this block is SQL". */
const SQL_LANGS = new Set(['sql', 'postgres', 'postgresql', 'psql', 'plpgsql', 'ddl']);

/** Info strings that mean "this block is TypeScript". */
const TS_LANGS = new Set(['ts', 'typescript', 'tsx']);

/**
 * Split markdown into lines tagged with the fenced-code language in force, `undefined` outside any fence.
 *
 * Implements CommonMark's fence rules that matter here: a fence opens with 3+ backticks or tildes indented at
 * most 3 spaces, and closes only on the SAME character at the same length or longer with no info string. That
 * last part is load-bearing — a ```` ```sql ```` block containing a nested ``` ``` ```` would otherwise close
 * early and spill DDL detection into the prose that follows.
 *
 * ⚠️ Indented (4-space) code blocks are deliberately NOT treated as code. Every `tasks.md` in this portfolio
 * indents its `- Depends on:` continuations by four spaces; treating those as code would hide most of the file
 * from both parsers.
 *
 * @param markdown - Full file text.
 * @returns One entry per line, in order: the raw text, and the fence language (lowercased) or `undefined`. Pure.
 */
export function tagFencedLines(markdown: string): readonly { readonly text: string; readonly lang?: string }[] {
    const out: { text: string; lang?: string }[] = [];
    let fence: Fence | undefined;

    for (const text of markdown.split('\n')) {
        const match = FENCE_PATTERN.exec(text);

        if (match !== null) {
            const marker = match[1] ?? '';
            const info = (match[2] ?? '').toLowerCase();

            if (fence === undefined) {
                fence = { char: marker[0] ?? '`', length: marker.length, lang: info };
                out.push({ text });
                continue;
            }

            if (marker[0] === fence.char && marker.length >= fence.length && info === '') {
                fence = undefined;
                out.push({ text });
                continue;
            }
        }

        out.push(fence === undefined ? { text } : { text, lang: fence.lang });
    }

    return out;
}

/**
 * Strip SQL comments and single-quoted string literals, preserving line structure.
 *
 * Replacing rather than deleting keeps every remaining character on its original line, so a declaration's
 * reported line number is the real one. Postgres doubles a quote to escape it (`'it''s'`), which this scanner
 * handles by simply staying in the string until an unpaired quote — the doubled pair never terminates it.
 *
 * @param sql - SQL text, possibly multi-line.
 * @returns The same text with comment and literal bodies blanked out. Pure.
 */
export function stripSqlNoise(sql: string): string {
    let out = '';
    let index = 0;
    let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code';

    while (index < sql.length) {
        const char = sql[index] ?? '';
        const next = sql[index + 1] ?? '';

        if (state === 'code') {
            if (char === '-' && next === '-') {
                state = 'line-comment';
                out += '  ';
                index += 2;
                continue;
            }

            if (char === '/' && next === '*') {
                state = 'block-comment';
                out += '  ';
                index += 2;
                continue;
            }

            if (char === "'") {
                state = 'string';
                out += ' ';
                index += 1;
                continue;
            }

            out += char;
            index += 1;
            continue;
        }

        if (state === 'line-comment') {
            if (char === '\n') {
                state = 'code';
                out += '\n';
            } else {
                out += ' ';
            }

            index += 1;
            continue;
        }

        if (state === 'block-comment') {
            if (char === '*' && next === '/') {
                state = 'code';
                out += '  ';
                index += 2;
                continue;
            }

            out += char === '\n' ? '\n' : ' ';
            index += 1;
            continue;
        }

        // state === 'string'
        if (char === "'") {
            state = 'code';
            out += ' ';
            index += 1;
            continue;
        }

        out += char === '\n' ? '\n' : ' ';
        index += 1;
    }

    return out;
}

const CREATE_TABLE_PATTERN =
    /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMPORARY|TEMP|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[a-z_][a-z0-9_$]*"?\s*\.\s*)?"?([a-z_][a-z0-9_$]*)"?/giu;

/**
 * Find every `CREATE TABLE` in SQL text, with its 1-based line number.
 *
 * Runs over {@link stripSqlNoise}'d text, so a commented-out `CREATE TABLE` and a table name inside a string
 * literal are both invisible — which they must be, since neither creates anything. A schema-qualified name
 * (`billing.webhook_events`) yields the bare table name, because two schemas is a namespacing DECISION that has
 * to be recorded as an exemption rather than assumed by the parser.
 *
 * @param sql - SQL text.
 * @returns Table names with line numbers, in source order. Pure.
 */
export function findCreateTables(sql: string): readonly { readonly table: string; readonly line: number }[] {
    const cleaned = stripSqlNoise(sql);
    const found: { table: string; line: number }[] = [];

    for (const match of cleaned.matchAll(CREATE_TABLE_PATTERN)) {
        const table = (match[1] ?? '').toLowerCase();

        if (table === '') {
            continue;
        }

        const line = cleaned.slice(0, match.index).split('\n').length;
        found.push({ table, line });
    }

    return found;
}

/**
 * Find every `pgTable('name', …)` in TypeScript source, using the TypeScript compiler's parser.
 *
 * The parser is not a nicety here. Real schemas in this repository write the call across lines:
 *
 * ```ts
 * export const recipes = pgTable(
 *     'recipes',
 *     { … },
 * );
 * ```
 *
 * A single-line regex sees 3 of this repository's tables; the AST sees all of them. It also cannot be fooled by
 * the string `"pgTable('users'"` inside a docblock, which is how a text gate ends up asserting that a comment
 * declares a table.
 *
 * A non-literal first argument (`pgTable(NAME, …)`) is skipped rather than guessed at: the name is not knowable
 * without evaluating the module, and a gate that guesses is worse than one with a stated blind spot.
 *
 * @param source - TypeScript source text.
 * @param fileName - Used only for the parser's diagnostics; may be a placeholder.
 * @returns Table names with 1-based line numbers, in source order. Pure.
 */
export function findPgTables(
    source: string,
    fileName = 'schema.ts',
): readonly { readonly table: string; readonly line: number }[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const found: { table: string; line: number }[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isIdentifier(callee)
                ? callee.text
                : ts.isPropertyAccessExpression(callee)
                  ? callee.name.text
                  : undefined;

            if (name === 'pgTable') {
                const first = node.arguments[0];

                if (first !== undefined && ts.isStringLiteralLike(first)) {
                    found.push({
                        table: first.text.toLowerCase(),
                        line: sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile)).line + 1,
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
}

/**
 * Find the table declarations inside a markdown document.
 *
 * Only fenced blocks are considered, and only those whose info string names SQL or TypeScript. A fence with no
 * info string is ignored on purpose: the ASCII architecture diagrams and dependency graphs throughout these
 * specs are unfenced-language blocks, and several of them contain the word `TABLE`.
 *
 * @param markdown - Full file text.
 * @returns Table names with 1-based line numbers and the form used. Pure.
 */
export function findMarkdownTableDeclarations(
    markdown: string,
): readonly { readonly table: string; readonly line: number; readonly form: DeclarationForm }[] {
    const tagged = tagFencedLines(markdown);
    const found: { table: string; line: number; form: DeclarationForm }[] = [];

    // Accumulate each fenced block whole, so a CREATE TABLE spanning lines is seen as one statement.
    let blockLang: string | undefined;
    let blockStart = 0;
    let blockLines: string[] = [];

    const flush = (): void => {
        if (blockLang === undefined || blockLines.length === 0) {
            blockLang = undefined;
            blockLines = [];

            return;
        }

        const body = blockLines.join('\n');

        if (SQL_LANGS.has(blockLang)) {
            for (const hit of findCreateTables(body)) {
                found.push({ table: hit.table, line: blockStart + hit.line - 1, form: 'sql-ddl' });
            }
        } else if (TS_LANGS.has(blockLang)) {
            for (const hit of findPgTables(body)) {
                found.push({ table: hit.table, line: blockStart + hit.line - 1, form: 'drizzle-pgTable' });
            }
        }

        blockLang = undefined;
        blockLines = [];
    };

    tagged.forEach((entry, index) => {
        if (entry.lang === undefined) {
            flush();

            return;
        }

        if (blockLang === undefined) {
            blockLang = entry.lang;
            blockStart = index + 1;
            blockLines = [];
        }

        blockLines.push(entry.text);
    });
    flush();

    return found;
}

const CHECKBOX_TASK_PATTERN = /^\s*[-*+]\s+\[[ xX~-]\]\s*(?:\*\*|__)?\s*(T-?\d+[A-Za-z]?(?:-[A-Za-z][A-Za-z0-9]*)*)/u;
const HEADING_TASK_PATTERN = /^#{2,6}\s+(?:\*\*)?\s*(T-?\d+[A-Za-z]?(?:-[A-Za-z][A-Za-z0-9]*)*)/u;

/**
 * Find every task identifier DEFINED in a `tasks.md`, ignoring every reference to one.
 *
 * The definition/reference distinction is the whole point, and it is structural rather than textual:
 *
 *   - A **definition** carries a done-state. It is a checkbox list item (`- [ ] **T-004** …`) or — in a file that
 *     uses no checkboxes at all — a heading (`### T-001 · …`). Feature 004 defines its 31 tasks as headings;
 *     every other feature uses checkboxes.
 *   - A **reference** is anything else: a `- Depends on: T-002` continuation, a `| T-003 |` matrix row, a
 *     `[T-004]` node in a fenced dependency graph, or prose. None of these can be "marked done", so a repeated
 *     reference is normal and correct.
 *
 * ## ⚠️ The regime rule, and the false positive that forced it
 *
 * A heading is ambiguous by shape: `### T-001 · Author the wire contract` (feature 004) is a definition, while
 * `### T-202 — measured evidence (2026-08-11)` (feature 003) is a documentation section ABOUT a task defined by a
 * checkbox 100 lines earlier. Counting both reported T-198 and T-202 as duplicates in a file that is perfectly
 * correct — and a gate with false positives is a gate somebody deletes.
 *
 * So the form is decided **per file, structurally**: if the file contains any checkbox definition, checkboxes are
 * the definitions and every heading is a reference; only a file with **zero** checkbox definitions falls back to
 * headings. Measured across the portfolio, that split is unambiguous — 13 files are checkbox-only (003 also
 * carrying 3 evidence headings) and exactly one, feature 004, is heading-only with 31.
 *
 * This is deliberately not a text discriminator (004 happens to use `·` and 003 `—`); separators drift, and the
 * whole point of this module is to stop depending on what characters somebody typed.
 *
 * Identifier suffixes are part of the identifier: `T001`, `T001a` and `T001-alb` are three DIFFERENT tasks in
 * feature 001, and truncating the suffix (as a naive `T\d+` match does) manufactures ~50 phantom duplicates.
 *
 * @param markdown - Full file text of a `tasks.md`.
 * @returns One entry per definition, in source order — including repeats, so callers can report both sites.
 *   Pure.
 */
export function findTaskIdDefinitions(markdown: string): readonly TaskIdDefinition[] {
    const lines = tagFencedLines(markdown);
    const checkboxes: TaskIdDefinition[] = [];
    const headings: TaskIdDefinition[] = [];

    lines.forEach((entry, index) => {
        if (entry.lang !== undefined) {
            return;
        }

        const checkbox = CHECKBOX_TASK_PATTERN.exec(entry.text);

        if (checkbox !== null) {
            checkboxes.push({ id: checkbox[1] ?? '', line: index + 1, form: 'checkbox' });

            return;
        }

        const heading = HEADING_TASK_PATTERN.exec(entry.text);

        if (heading !== null) {
            headings.push({ id: heading[1] ?? '', line: index + 1, form: 'heading' });
        }
    });

    return checkboxes.length > 0 ? checkboxes : headings;
}

/** One task identifier defined more than once in a single file. */
export interface DuplicateTaskId {
    readonly id: string;
    readonly lines: readonly number[];
}

/**
 * Reduce a definition list to the identifiers defined more than once.
 *
 * @param definitions - Output of {@link findTaskIdDefinitions}.
 * @returns Duplicated identifiers with every line that defines them, ordered by first definition. Pure.
 */
export function findDuplicateTaskIds(definitions: readonly TaskIdDefinition[]): readonly DuplicateTaskId[] {
    const byId = new Map<string, number[]>();

    for (const definition of definitions) {
        const lines = byId.get(definition.id);

        if (lines === undefined) {
            byId.set(definition.id, [definition.line]);
        } else {
            lines.push(definition.line);
        }
    }

    return [...byId.entries()]
        .filter(([, lines]) => lines.length > 1)
        .map(([id, lines]) => ({ id, lines: [...lines] }));
}

/** A table name declared by more than one owner. */
export interface TableCollision {
    readonly table: string;
    readonly owners: readonly string[];
    readonly declarations: readonly TableDeclaration[];
}

/**
 * Reduce a declaration list to the tables claimed by more than one owner, minus the ruled exemptions.
 *
 * An exemption applies ONLY when the observed owner set matches the recorded one exactly. A third owner joining
 * an exempted pair is reported, because "two of these were ruled acceptable" says nothing about a third — and
 * silently absorbing it is how a baseline turns into a blanket.
 *
 * @param declarations - Every declaration found across specs and shipped code.
 * @param exemptions - The ruled exemptions. Validate with {@link validateExemptions} first.
 * @returns Unexempted collisions, ordered by table name. Pure.
 */
export function findTableCollisions(
    declarations: readonly TableDeclaration[],
    exemptions: readonly TableExemption[],
): readonly TableCollision[] {
    const byTable = new Map<string, TableDeclaration[]>();

    for (const declaration of declarations) {
        const list = byTable.get(declaration.table);

        if (list === undefined) {
            byTable.set(declaration.table, [declaration]);
        } else {
            list.push(declaration);
        }
    }

    const exemptByTable = new Map(exemptions.map((entry) => [entry.table, entry]));
    const collisions: TableCollision[] = [];

    for (const [table, list] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const owners = [...new Set(list.map((entry) => entry.owner))].sort();

        if (owners.length < 2) {
            continue;
        }

        const exemption = exemptByTable.get(table);

        if (exemption !== undefined && sameOwnerSet(exemption.owners, owners)) {
            continue;
        }

        collisions.push({ table, owners, declarations: [...list] });
    }

    return collisions;
}

/**
 * Whether two owner sets contain the same members.
 *
 * @param a - First set.
 * @param b - Second set.
 * @returns True when both contain exactly the same owners. Pure.
 */
function sameOwnerSet(a: readonly string[], b: readonly string[]): boolean {
    const left = [...new Set(a)].sort();
    const right = [...new Set(b)].sort();

    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** The minimum length of a `why` that counts as a reason rather than a shrug. */
const MIN_WHY_LENGTH = 40;

/**
 * Validate the exemption registry itself.
 *
 * The registry is the gate's only escape hatch, so it is checked at least as strictly as the thing it exempts.
 * Four failures, each of which turns the gate off in a way that looks like it is on:
 *
 *   1. A missing or blank `why` — the entry records nothing, so the next reader cannot tell a ruling from a
 *      shrug. Precedent: `contract-gen`'s `AllowedPackageImport.why` and `ColumnAccount.why` are both mandatory.
 *   2. A `why` too short to say anything ("legacy", "shared", "ok"). The threshold is crude on purpose; the
 *      point is that a one-word excuse fails loudly at the moment somebody tries it.
 *   3. Fewer than two owners — an exemption for a table only one owner declares is either stale or a typo, and
 *      either way it is pre-authorising a collision nobody has seen.
 *   4. Two entries for one table, where whichever loses the lookup silently stops applying.
 *
 * @param exemptions - The registry.
 * @returns Human-readable problems; empty when the registry is sound. Pure.
 */
export function validateExemptions(exemptions: readonly TableExemption[]): readonly string[] {
    const problems: string[] = [];
    const seen = new Set<string>();

    for (const entry of exemptions) {
        const label = `exemption for \`${entry.table}\``;

        if (typeof entry.why !== 'string' || entry.why.trim() === '') {
            problems.push(`${label} has no \`why\`. An exemption without a written reason is a silenced gate.`);
        } else if (entry.why.trim().length < MIN_WHY_LENGTH) {
            problems.push(
                `${label} has a \`why\` of ${entry.why.trim().length} characters; at least ${MIN_WHY_LENGTH} are ` +
                    'required. State the reason the two owners are correct, or what the recorded defect is.',
            );
        }

        if (new Set(entry.owners).size < 2) {
            problems.push(
                `${label} lists ${new Set(entry.owners).size} distinct owner(s). An exemption needs the two or ` +
                    'more owners it excuses; one owner is not a collision.',
            );
        }

        if (seen.has(entry.table)) {
            problems.push(`${label} is declared twice. Merge them — only one entry can win the lookup.`);
        }

        seen.add(entry.table);
    }

    return problems;
}

/**
 * Render collisions as a failure message an implementer can act on without opening the parser.
 *
 * @param collisions - Output of {@link findTableCollisions}.
 * @returns A multi-line message naming every declaring site. Pure.
 */
export function describeTableCollisions(collisions: readonly TableCollision[]): string {
    return [
        `${collisions.length} table name(s) declared by more than one owner.`,
        GR_021_STRUCTURAL_DECLARATION,
        '',
        ...collisions.flatMap((collision) => [
            `  ⛔ \`${collision.table}\` — owners: ${collision.owners.join(', ')}`,
            ...collision.declarations.map(
                (declaration) =>
                    `       ${declaration.origin} ${declaration.file}:${declaration.line} (${declaration.form}) ` +
                    `owner=${declaration.owner}`,
            ),
            '     Resolve by renaming one, namespacing per writer, or modelling one shared table with a',
            '     discriminator — then record the choice. If two owners are genuinely correct, add a',
            '     TableExemption with a substantive `why` in specTableCollisions.test.ts.',
        ]),
    ].join('\n');
}
