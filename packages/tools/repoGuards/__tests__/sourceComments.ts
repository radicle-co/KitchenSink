/**
 * The ONE owner of "this source text without its comments", for every guard that asks of source text
 * "does it contain X".
 *
 * ⛔ WHY THERE IS ONE. A guard whose PASS is "no match found" is only as sound as the stripper it reads through:
 * a stripper that removes too much answers "no violation" over a violation that is right there. Twenty-two sites
 * carried a regex pair (`/\/\*[\s\S]*?\*\//` then `/\/\/.*$/m`) that eats everything after the `//` of an
 * `'https://…'` string, and opens a "comment" at a `/*` inside a regex literal that never closes. A regex cannot
 * tell a comment from the same characters inside a string, a template literal, a regex literal or JSX text,
 * because that distinction is the grammar. So the TypeScript text is read by TypeScript's own parser.
 *
 * ⚠️ DESIGN PATTERN: Adapter over `typescript`'s parser — comment RANGES come from the compiler, and this module only
 * blanks them. It replaces `roleSplitSources`' hand-written scanner, whose own docblock named its remaining gap
 * ("closing it means a real tokenizer").
 *
 * The contract every caller leans on, pinned by `withoutTsComments.test.ts` over the whole corpus: the output is
 * the SAME LENGTH as the input and every character it changes becomes a SPACE (a newline is kept, so line numbers do
 * not move). Together those give `stripped[i] ∈ {raw[i], ' '}`, which is what lets a guard screen the RAW text for a
 * space-free token before paying for the strip.
 *
 * Placement: ADR-0066 — a helper that guards in several packages read stays a test helper in `__tests__/`, published
 * as one module per subpath export with no barrel, so it stays out of the scanners that read production source.
 */
import ts from 'typescript';

/** A half-open `[start, end)` character range. */
interface Range {
    readonly start: number;
    readonly end: number;
}

/**
 * The parser mode for a path. `.tsx` and `.jsx` need JSX on (it changes how `<` and text parse); a `.ts` file must
 * NOT have it on, because `<T>value` is a type assertion there.
 */
function scriptKindOf(path: string): ts.ScriptKind {
    if (/\.tsx$/u.test(path)) {
        return ts.ScriptKind.TSX;
    }

    if (/\.jsx$/u.test(path)) {
        return ts.ScriptKind.JSX;
    }

    if (/\.[cm]?js$/u.test(path)) {
        return ts.ScriptKind.JS;
    }

    if (/\.json$/u.test(path)) {
        return ts.ScriptKind.JSON;
    }

    return ts.ScriptKind.TS;
}

/** Every token's surrounding trivia is read from the token's start; a JSDoc subtree is comment text, not tokens. */
function isJsDocNode(node: ts.Node): boolean {
    return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/**
 * The comment ranges of one source file, from the compiler's own token stream.
 *
 * ⚠️ Both `getLeadingCommentRanges` AND `getTrailingCommentRanges` are read at every token, because the compiler
 * splits the trivia before a token at the first newline: a comment on the previous token's line is that token's
 * TRAILING comment and is not reported as this token's leading one. Reading only one half drops half the comments.
 *
 * ⚠️ A `JsxText` node is skipped: its "trivia" is the text itself, and `see http://x` is text, not a comment.
 * A JSDoc subtree is skipped for the opposite reason — it is already inside a comment, and a range read from the
 * middle of one could run past its close.
 *
 * @param text - One source file.
 * @param path - Its path, which selects the parser mode.
 * @returns The comment ranges, ascending and non-overlapping. Pure.
 */
function commentRanges(text: string, path: string): readonly Range[] {
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
    const found = new Map<number, Range>();

    const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
        for (const range of ranges ?? []) {
            found.set(range.pos, { start: range.pos, end: range.end });
        }
    };

    const visit = (node: ts.Node): void => {
        if (isJsDocNode(node) || node.kind === ts.SyntaxKind.JsxText) {
            return;
        }

        const children = node.getChildren(file);

        if (children.length === 0) {
            add(ts.getLeadingCommentRanges(text, node.pos));
            add(ts.getTrailingCommentRanges(text, node.pos));

            return;
        }

        for (const child of children) {
            visit(child);
        }
    };

    visit(file);

    const ascending = [...found.values()].sort((a, b) => a.start - b.start);
    const result: Range[] = [];

    for (const range of ascending) {
        const previous = result.at(-1);

        if (previous === undefined || range.start >= previous.end) {
            result.push(range);
        }
    }

    return result;
}

/**
 * The text with `ranges` blanked: every UTF-16 code UNIT becomes a space, a line break is kept.
 *
 * ⚠️ No `u` flag on the replace, deliberately: with it an astral character (an emoji in a comment) is ONE match and
 * becomes ONE space, so the output is shorter than the input and every offset after it is wrong. Found by the
 * length-preservation test over the corpus, on `RecipeCard.tsx`.
 */
function blank(text: string, ranges: readonly Range[]): string {
    let out = '';
    let cursor = 0;

    for (const { start, end } of ranges) {
        out += text.slice(cursor, start) + text.slice(start, end).replace(/[^\r\n]/g, ' ');
        cursor = end;
    }

    return out + text.slice(cursor);
}

/**
 * TypeScript, JavaScript, JSX or JSONC text with its comments blanked.
 *
 * @param text - One source file.
 * @param path - Its path, used only to choose the parser mode (`.tsx`/`.jsx` turn JSX on). ⚠️ Pass it whenever the file
 *   could be `.tsx`: the default reads the text as plain TypeScript, where JSX text such as `see http://x` is code
 *   and its `//` opens a comment that blanks the rest of the line. A caller holding a `.ts`-only snippet may omit it.
 * @returns The same text, same length, with every comment character replaced by a space and every line break kept.
 *   A file that does not parse still yields the compiler's best-effort tree, so this never throws. Pure.
 */
export function withoutTsComments(text: string, path = 'source.ts'): string {
    return blank(text, commentRanges(text, path));
}

/** What the SQL scanner is inside. */
type SqlState = 'code' | 'line' | 'block' | 'string' | 'quoted' | 'dollar';

/**
 * The SQL scan shared by both public SQL functions.
 *
 * @param sql - SQL text.
 * @param blankLiterals - Also blank the body of single-quoted string literals.
 * @returns The same text, same length, comments (and optionally string bodies) blanked. Pure.
 */
function scanSql(sql: string, blankLiterals: boolean): string {
    let state: SqlState = 'code';
    let depth = 0;
    let dollarTag = '';
    let out = '';

    // Where a comment or a literal returns to: a dollar-quoted body is scanned as SQL, so it returns INTO the body.
    const home = (): SqlState => (dollarTag === '' ? 'code' : 'dollar');
    const space = (char: string): string => (char === '\n' || char === '\r' ? char : ' ');

    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i] ?? '';
        const next = sql[i + 1] ?? '';

        if (state === 'line') {
            state = char === '\n' ? home() : 'line';
            out += space(char);
            continue;
        }

        if (state === 'block') {
            // PostgreSQL block comments NEST, unlike C's.
            if (char === '/' && next === '*') {
                depth += 1;
                out += '  ';
                i += 1;
            } else if (char === '*' && next === '/') {
                depth -= 1;
                state = depth === 0 ? home() : 'block';
                out += '  ';
                i += 1;
            } else {
                out += space(char);
            }

            continue;
        }

        if (state === 'string') {
            // A doubled quote is an escaped quote and stays inside the literal.
            if (char === "'" && next === "'") {
                out += blankLiterals ? '  ' : "''";
                i += 1;
            } else {
                state = char === "'" ? home() : 'string';
                out += blankLiterals && char !== "'" ? space(char) : char;
            }

            continue;
        }

        if (state === 'quoted') {
            state = char === '"' ? home() : 'quoted';
            out += char;
            continue;
        }

        if (state === 'dollar' && sql.startsWith(dollarTag, i)) {
            state = 'code';
            out += dollarTag;
            i += dollarTag.length - 1;
            dollarTag = '';
            continue;
        }

        if (char === '-' && next === '-') {
            state = 'line';
            out += '  ';
            i += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            state = 'block';
            depth = 1;
            out += '  ';
            i += 1;
            continue;
        }

        if (char === "'") {
            state = 'string';
            out += char;
            continue;
        }

        if (char === '"') {
            state = 'quoted';
            out += char;
            continue;
        }

        if (char === '$' && state === 'code') {
            const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(i))?.[0];
            const previous = sql[i - 1] ?? '';

            if (tag !== undefined && !/[A-Za-z0-9_]/u.test(previous)) {
                state = 'dollar';
                dollarTag = tag;
                out += tag;
                i += tag.length - 1;
                continue;
            }
        }

        out += char;
    }

    return out;
}

/**
 * SQL text with its comments (`--` and nested block comments) blanked, leaving string literals, quoted identifiers
 * and dollar-quoted bodies intact.
 *
 * @param sql - SQL text.
 * @returns The same text, same length, comment characters replaced by spaces and line breaks kept. Pure.
 */
export function withoutSqlComments(sql: string): string {
    return scanSql(sql, false);
}

/**
 * SQL text with its comments AND the bodies of its single-quoted string literals blanked, so only code is matched.
 *
 * @param sql - SQL text.
 * @returns The same text, same length. Pure.
 */
export function withoutSqlCommentsAndLiterals(sql: string): string {
    return scanSql(sql, true);
}

/**
 * CSS text with its block comments blanked, leaving a `/*` inside a string or `url(…)` alone.
 *
 * @param css - A stylesheet's text.
 * @returns The same text, same length. Pure.
 */
export function withoutCssComments(css: string): string {
    let out = '';
    let quote = '';

    for (let i = 0; i < css.length; i += 1) {
        const char = css[i] ?? '';

        if (quote !== '') {
            // An escape consumes the next character, so `"\""` does not end the string.
            if (char === '\\') {
                out += css.slice(i, i + 2);
                i += 1;
                continue;
            }

            quote = char === quote ? '' : quote;
            out += char;
            continue;
        }

        if (char === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            const end = close === -1 ? css.length : close + 2;

            out += css.slice(i, end).replace(/[^\r\n]/g, ' ');
            i = end - 1;
            continue;
        }

        quote = char === '"' || char === "'" ? char : '';
        out += char;
    }

    return out;
}

/**
 * Hash-comment text (shell, YAML) with its WHOLE-LINE comments blanked. A `#` after code is left alone: in shell it
 * may be a `${#var}` or part of a word, and a guard that needs those lines reads them as code.
 */
function withoutHashLineComments(text: string): string {
    return text.replace(/^[ \t]*#.*$/gmu, (line) => ' '.repeat(line.length));
}

/**
 * Any file the guards read, with its comments blanked by the rules of ITS language, chosen by extension.
 *
 * ⛔ The language matters: a `//` is a comment in TypeScript and a URL scheme in shell, YAML and SQL, so one
 * language-blind pass over a mixed list of files is exactly the regex pair's defect over again.
 *
 * @param path - The file's path; only its extension is read.
 * @param text - The file's text.
 * @returns The text with comments replaced by spaces (same length, line breaks kept). Pure.
 */
export function withoutComments(path: string, text: string): string {
    if (/\.(?:sh|ya?ml)$/u.test(path)) {
        return withoutHashLineComments(text);
    }

    if (path.endsWith('.sql')) {
        return withoutSqlComments(text);
    }

    if (path.endsWith('.css')) {
        return withoutCssComments(text);
    }

    return withoutTsComments(text, path);
}
