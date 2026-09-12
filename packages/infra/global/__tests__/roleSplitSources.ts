/**
 * The tracked TypeScript sources the role-split guards read — DISCOVERED from git, so a new package is covered the
 * day it lands rather than the day someone remembers to add it to a list.
 *
 * Production code only: tests, fixtures and generated output are excluded, because a test that NAMES a role or
 * issues a `DROP DATABASE` against a throwaway server is doing its job.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A test, fixture or generated path — not production code. */
const NOT_PRODUCTION =
    /(^|\/)(__tests__|__fixtures__|tests|dist|dist-lambda|cdk\.out|node_modules)\/|\.test\.ts$|\.d\.ts$/u;

/**
 * Every production `.ts` file under `packages/` and `shared/` in the WORKING TREE, repo-relative and sorted: tracked
 * or new-but-not-ignored, minus anything deleted — so the guards judge the tree being committed, not the last commit.
 */
export function productionSources(): readonly string[] {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages/*.ts', 'shared/*.ts'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter((path) => path.endsWith('.ts') && !NOT_PRODUCTION.test(path) && existsSync(join(REPO_ROOT, path)))
        .filter((path, index, all) => all.indexOf(path) === index)
        .sort();
}

/**
 * Every file the prototype-pollution sweep reads: production TypeScript, plus the `.tsx` and `.mjs` that
 * `productionSources()` excludes.
 *
 * ⛔ IT LIVES HERE SO TWO READERS SHARE ONE STATEMENT. `prototypePollutionSinks.test.ts` sweeps this set,
 * and `withoutTsComments.test.ts` asserts the blanking lemma that licenses that sweep's raw-text
 * pre-filter. Declared separately they drifted immediately: the lemma covered 1,254 files while the sweep
 * ran over 1,947, leaving the 693 `.tsx`/`.mjs` — exactly the ones the sweep had just been widened to
 * include — outside the assertion that says the sweep is sound.
 *
 * ⚠️ ADDITIVE, and `productionSources()` is deliberately NOT widened: ten other guards read that helper,
 * and "production TypeScript" is not this sweep's meaning to change on their behalf.
 *
 * @returns Sorted repo-relative paths.
 * @sideEffect Shells out to `git ls-files`.
 */
export function sinkScanSources(): readonly string[] {
    const extra = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.tsx', '*.mjs'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter((path) => path !== '' && !/node_modules\//u.test(path) && existsSync(join(REPO_ROOT, path)));

    return [...new Set([...productionSources(), ...extra])].sort();
}

/** A repo-relative file's text. */
export function readSource(path: string): string {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/**
 * The text with line and block comments blanked — prose is not code. Offsets and line numbers are kept, so a
 * match's position still points at the real source.
 *
 * ⛔ A SCANNER, NOT TWO REGEXES, AND THE DIFFERENCE IS A SILENT FAILURE. This stripped block comments first
 * and line comments second, so a `/*` sequence appearing INSIDE a line comment opened a block that ran to
 * the next close — blanking every line of real code in between. Writing the glob `packages/infra/global/**`
 * in an ordinary `//` comment does exactly that, which is how it was found: `logDrainRegister` reported that
 * `SandboxSchedulerStack` declares no subscription filter, with the filter plainly there.
 *
 * ⚠️ The direction that matters is the other one. Ten guards ask "does this file contain X" of this output,
 * and four of them — `lockOutReading`, `masterSecretConsumers`, `dbUserGrantRegister`,
 * `leaseFenceBypassRegister` — are security invariants whose PASS is "no match found". A stripper that eats
 * real code makes those pass over a violation, and nothing anywhere would say so.
 *
 * ⚠️ Strings are tracked for the same reason: `'https://…'` and `"a /* b"` are data, and the old lead-char
 * guard (`[^:'"\`]`) only covered the first of them.
 *
 * ⚠️ ONE FILE IS STILL DAMAGED, AND SAYING SO IS THE POINT. Measured against TypeScript's own
 * `createSourceFile` comment ranges over all 1,346 files the guards read, this scanner eats real code in
 * `packages/tools/local-sandbox/src/synthEnv.ts` (16 characters), where a QUOTE inside a regex character
 * class — `/['"]…['"]/gu` — opens a string the scanner never closes. The regex pair it replaced damaged
 * EIGHT files, so this is a large net improvement and not a clean one. No eaten region carries a literal
 * any guard matches on (checked: the role names, `rds-db`, `DB_SECRET_ARN`, `:DatabaseSecretArn`, the
 * lease fence, and SQL), so no verdict moves today — which is a fact about this tree, not a property of
 * the scanner, and is exactly why it is written down instead of implied. Closing it means lexing regex
 * literals, which means a real tokenizer.
 *
 * @param text - One source file.
 * @returns The same text with comment bodies replaced by spaces. Pure.
 */
export function withoutTsComments(text: string): string {
    let state: ScanState = 'code';
    let quote = '';
    let out = '';

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i] ?? '';
        const next = text[i + 1] ?? '';

        if (state === 'line') {
            // A line comment ends at the newline, which is kept so line numbers do not move.
            state = char === '\n' ? 'code' : 'line';
            out += char === '\n' ? char : ' ';
            continue;
        }

        if (state === 'block') {
            if (char === '*' && next === '/') {
                state = 'code';
                out += '  ';
                i += 1;
                continue;
            }

            out += char === '\n' ? char : ' ';
            continue;
        }

        if (state === 'string') {
            // An escape consumes the next character whatever it is, so `"\""` does not end here.
            if (char === '\\') {
                out += text.slice(i, i + 2);
                i += 1;
                continue;
            }

            state = char === quote ? 'code' : 'string';
            out += char;
            continue;
        }

        // ⛔ AN ESCAPE IN CODE POSITION CONSUMES WHAT FOLLOWS, and this line is worth eight files. A regex
        // literal writes a slash as `\\/`, so `/^https?:\\/\\//i` presented `//` to the check below and the
        // rest of the line was read as a comment. Measured against TypeScript's own `createSourceFile`
        // comment ranges over all 1,346 files the guards read: 8 files damaged without this line, 1 with it
        // (`local-sandbox/src/synthEnv.ts`, whose cause is a quote inside a character class, not a slash).
        // A bare backslash in code position is otherwise only legal inside a string or a regex, so this
        // cannot mis-fire.
        if (char === '\\') {
            out += text.slice(i, i + 2);
            i += 1;
            continue;
        }

        if (char === '/' && next === '/') {
            state = 'line';
            out += '  ';
            i += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            state = 'block';
            out += '  ';
            i += 1;
            continue;
        }

        // ⛔ A REGEX LITERAL IS SKIPPED WHOLE, because its BODY is not code and may contain anything —
        // a quote, a `//`, a `/*`. `synthEnv.ts`'s `/…\[['\"]…/u` put a lone `'` inside a character
        // class, the scanner entered string state and never left, and sixteen characters of real code
        // after it were blanked. Escaping the quote in that file would have hidden the defect in the
        // scanner rather than fixing it.
        //
        // ⚠️ The discriminator is the PRECEDING token, the standard lexer heuristic: a `/` can only begin
        // a regex where a value cannot already have ended, so it follows an operator, a comma, an opening
        // bracket, `return`, or the start of a statement. After an identifier, a closing bracket or a
        // number it is division. That is not a complete JavaScript grammar and does not claim to be — it
        // is the same rule syntax highlighters use, and `withoutTsComments.test.ts` pins both directions.
        if (char === '/' && startsRegexLiteral(out)) {
            const end = skipRegexLiteral(text, i);

            if (end > i) {
                out += text.slice(i, end);
                i = end - 1;
                continue;
            }
        }

        if (char === "'" || char === '"' || char === '`') {
            state = 'string';
            quote = char;
        }

        out += char;
    }

    return out;
}

/** Where the scanner is as it walks a source file. */
type ScanState = 'code' | 'line' | 'block' | 'string';

/**
 * Whether a `/` at this point begins a REGEX LITERAL rather than a division.
 *
 * ⚠️ Decided by the last non-whitespace character already emitted — the standard lexer heuristic. A regex
 * can only start where a value cannot already have ended, so `= /…/`, `( /…/`, `, /…/`, `return /…/` and a
 * statement start are regexes, while `x / y`, `) / 2` and `arr[0] / n` are division.
 *
 * @param emitted - The output produced so far, whose tail is the preceding token.
 * @returns Whether to treat the `/` as opening a regex. Pure.
 */
function startsRegexLiteral(emitted: string): boolean {
    const tail = emitted.replace(/\s+$/u, '');

    if (tail === '') {
        return true;
    }

    const last = tail.at(-1) ?? '';

    if (/[A-Za-z0-9_$)\]]/u.test(last)) {
        // An identifier can still be a KEYWORD that takes an expression after it.
        return /\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/u.test(tail);
    }

    return true;
}

/**
 * The index just past a regex literal starting at `start`, or `start` when it does not terminate on the line.
 *
 * ⚠️ A regex literal cannot span a newline, so an unterminated one means the `/` was not a regex after all —
 * returning `start` lets the caller fall through to its other rules rather than swallowing the rest of the
 * file, which is the failure mode this whole function exists to remove.
 *
 * @param text - The whole source.
 * @param start - The index of the opening `/`.
 * @returns The index after the closing `/` and its flags, or `start`. Pure.
 */
function skipRegexLiteral(text: string, start: number): number {
    let inClass = false;

    for (let i = start + 1; i < text.length; i += 1) {
        const char = text[i] ?? '';

        if (char === '\n') {
            return start;
        }

        if (char === '\\') {
            i += 1;
            continue;
        }

        if (char === '[') {
            inClass = true;
            continue;
        }

        if (char === ']') {
            inClass = false;
            continue;
        }

        if (char === '/' && !inClass) {
            let end = i + 1;

            while (end < text.length && /[a-z]/u.test(text[end] ?? '')) {
                end += 1;
            }

            return end;
        }
    }

    return start;
}

/** A test, fixture or generated path in ANY language — not production code. */
const NOT_PRODUCTION_ANY =
    /(^|\/)(__tests__|__fixtures__|tests|test|dist|dist-lambda|cdk\.out|node_modules)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/u;

/** The languages a database statement could be written in here. */
const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]s|sh|sql)$/u;

/**
 * Every production file that could carry a SQL statement — TypeScript, JavaScript, shell and SQL — under `packages/`,
 * `shared/`, `scripts/` and `.github/`, in the working tree.
 */
export function productionScripts(): readonly string[] {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages', 'shared', 'scripts', '.github'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
    )
        .split('\n')
        .filter(
            (path) =>
                SCRIPT_EXTENSIONS.test(path) && !NOT_PRODUCTION_ANY.test(path) && existsSync(join(REPO_ROOT, path)),
        )
        .filter((path, index, all) => all.indexOf(path) === index)
        .sort();
}

/** The text with the comments of its language blanked: `#` for shell, `--` for SQL, `//` and `/* *\/` otherwise. */
export function withoutComments(path: string, text: string): string {
    if (path.endsWith('.sh')) {
        return text.replace(/^\s*#.*$/gmu, '');
    }

    if (path.endsWith('.sql')) {
        return text.replace(/--.*$/gmu, '');
    }

    return withoutTsComments(text);
}

/**
 * Every file the SERVICE integration and e2e tiers execute: each service's `vitest.integration.config.ts` and
 * `vitest.e2e.config.ts`, the specs their `include` globs reach, their `globalSetup`s, and — transitively — the
 * modules those import from within the package.
 *
 * ⛔ Discovered, never listed. `productionSources()` deliberately excludes `tests/`, which is right for every
 * other role-split guard and exactly wrong for this one: the role a test connects as IS the thing under guard.
 *
 * ⚠️ Both tiers, because both boot the service against a database. A scan of the integration config alone drew
 * the line THROUGH a shared module: `recipe-service/tests/e2e/harness.ts` was converted (ten integration specs
 * import it) while its fifteen e2e callers kept binding their own pools from `DATABASE_URL` — so the tier gated
 * on one variable and connected on another. `tests/load/**` stays out: those are k6 fixtures that seed a database
 * an OPERATOR names, and sweeping them would make the guard assert something it does not mean.
 */
export function integrationTierSources(): readonly string[] {
    const configs = trackedFiles(
        'packages/services/*/vitest.integration.config.ts',
        'packages/services/*/vitest.e2e.config.ts',
    );
    const found = new Set<string>();

    for (const config of configs) {
        const directory = config.slice(0, config.lastIndexOf('/'));
        const text = readSource(config);
        const patterns = [
            ...[...text.matchAll(/include:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
            ...[...text.matchAll(/globalSetup:\s*\[([^\]]*)\]/gu)].flatMap((match) => quotedStrings(match[1] ?? '')),
        ];
        // ⚠️ `tests/load/` is EXCLUDED — see the module docstring.
        const candidates = trackedFiles(`${directory}/tests`, `${directory}/__tests__`).filter(
            (path) => !path.includes('/tests/load/'),
        );

        found.add(config);

        for (const pattern of patterns) {
            for (const path of candidates.filter((candidate) => matchesGlob(pattern, directory, candidate))) {
                addWithImports(path, found);
            }
        }
    }

    return [...found].sort();
}

/** Tracked-or-new, not-ignored `.ts` files under the given pathspecs, minus anything deleted from the tree. */
function trackedFiles(...pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((path) => path.endsWith('.ts') && existsSync(join(REPO_ROOT, path)))
        .filter((path, index, all) => all.indexOf(path) === index);
}

/** The single- or double-quoted strings in a fragment of config source. Pure. */
function quotedStrings(fragment: string): readonly string[] {
    return [...fragment.matchAll(/['"]([^'"]+)['"]/gu)].map((match) => match[1] as string);
}

/**
 * Whether `path` is what `pattern` names, relative to the package `directory`. Supports the two glob forms the
 * configs use: `**` across directories and `*` within one. Pure.
 */
function matchesGlob(pattern: string, directory: string, path: string): boolean {
    const relative = pattern.replace(/^\.\//u, '');
    // Placeholders first: translating `**` into a pattern that itself contains `*` would then be re-translated
    // by the `*` rule, which silently produces an expression matching nothing.
    const expression = `${directory}/${relative}`
        .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
        .replace(/\*\*\//gu, '\uE000')
        .replace(/\*\*/gu, '\uE001')
        .replace(/\*/gu, '[^/]*')
        .replace(/\uE000/gu, '(?:[^/]+/)*')
        .replace(/\uE001/gu, '.*');

    return new RegExp(`^${expression}$`, 'u').test(path);
}

/**
 * Add `path` and every module it imports from a TEST directory, transitively.
 *
 * ⚠️ It stops at `src/`: production modules are `productionSources()`'s subject and have their own guards. A
 * seed module a global setup imports is production code that the tier merely calls.
 */
function addWithImports(path: string, found: Set<string>): void {
    if (found.has(path)) {
        return;
    }

    found.add(path);

    const directory = path.slice(0, path.lastIndexOf('/'));

    for (const match of readSource(path).matchAll(/from\s+['"](\.[^'"]+)['"]/gu)) {
        const specifier = (match[1] as string).replace(/\.js$/u, '.ts');
        const resolved = join(directory, specifier).replace(/\\/gu, '/');

        const inTestTier = /(^|\/)(tests|__tests__)\//u.test(resolved) && !resolved.includes('/tests/load/');

        if (inTestTier && existsSync(join(REPO_ROOT, resolved))) {
            addWithImports(resolved, found);
        }
    }
}
