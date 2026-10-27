/**
 * The scanner behind `offScaleRadius.test.ts`: every corner radius a `packages/apps` source file draws that is not one
 * of the design system's steps (`sm` 8, `md` 12, `lg` 18, `xl` 24, `full`).
 *
 * Read through the TypeScript parser, not a regex over text. A comment that names `rounded-2xl` has no string literal
 * in it, so it is never scanned, and a `'https://…'` string cannot open a comment that swallows the code after it
 * (the defect `sourceComments.ts` exists for).
 *
 * - Web: a class token `rounded`, `rounded-<corner>` or either with a size, in a string literal or a template fragment.
 *   Only `sm`, `md`, `lg`, `xl`, `full` and `none` are steps. A bare `rounded` (4 px), `xs`, `2xl`, `3xl`, `4xl` and any
 *   `[arbitrary]` value are off the scale, except a spacing-token calc (`rounded-[calc(var(--spacing)*5.5)]`): half a
 *   control's own height, so a label that wraps at 200% text keeps a fixed corner instead of becoming a stadium
 *   (`surfaceClass.test.ts`, E2 I2).
 * - Native (and web style objects): a `borderRadius` or per-corner radius property whose value is not a radius token
 *   (`radius.md`, `nativeTokens.radius.lg`), `0`, or half of the box's own dimension (`HEIGHT / 2`: the same fixed-corner
 *   rule as the web calc). A bare number and `999` are off the scale: the pill is `radius.full`.
 *
 * - A fixed-size glyph (the 18 px checkbox) owns a corner no step fits, as a named `GLYPH_` constant. Only a module whose
 *   leading JSDoc carries a `@pattern Glyph` tag may read one; the radius scale gets no `xs` step.
 *
 * @pattern Visitor — a walk over the parsed syntax tree
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** The radius steps a class suffix or token name may be. */
const STEPS = ['sm', 'md', 'lg', 'xl', 'full'] as const;

/** A Tailwind radius utility: `rounded`, then an optional corner, then an optional size. */
const RADIUS_UTILITY = /^rounded(?:-(?:s|e|t|b|l|r|ss|se|ee|es|tl|tr|bl|br))?(?:-(.+))?$/u;

/** The one arbitrary web radius that is on the scale: half a height, spelled in spacing units. */
const SPACING_CALC = /^\[calc\(var\(--spacing\)\*\d+(?:\.\d+)?\)\]$/u;

/** A glyph's named corner. */
const GLYPH_CONSTANT = /^GLYPH_[A-Z_]+$/u;

/** A `@pattern Glyph` tag in the file's LEADING JSDoc block (a tag in a comment further down does not count). */
const GLYPH_PATTERN = /^\s*\/\*\*(?:(?!\*\/)[\s\S])*?@pattern\s+Glyph\b/u;

/** A radius property name: `borderRadius` or a per-corner one. */
const RADIUS_PROPERTY = /^border(?:(?:Top|Bottom)(?:Left|Right|Start|End)|(?:Start|End)(?:Start|End))?Radius$/u;

/** A radius token reference: `radius.md`, `nativeTokens.radius.lg`. */
const TOKEN_REFERENCE = new RegExp(`(?:^|\\.)radius\\.(?:${STEPS.join('|')})$`, 'u');

/** A directory the scan never enters. */
const SKIPPED_DIRECTORIES = new Set([
    'node_modules',
    'dist',
    '.next',
    '.expo',
    '.turbo',
    'coverage',
    '__tests__',
    '__fixtures__',
    'tests',
    'test-results',
    'playwright-report',
    'android',
    'ios',
]);

/** One off-scale radius: where it is and what it says. */
export interface Offender {
    readonly file: string;
    readonly line: number;
    readonly text: string;
}

/**
 * Whether a class token is an off-scale radius utility, behind any variant prefix (`sm:`, `hover:`, `[&>*]:`). Pure.
 *
 * @param token - One whitespace-free token.
 */
export function isOffScaleClass(token: string): boolean {
    const base = token.split(/:(?![^[]*\])/u).at(-1) ?? '';
    const match = RADIUS_UTILITY.exec(base.replace(/^!/u, ''));

    if (match === null) {
        return false;
    }

    const size = match[1];

    return (
        size === undefined || (!([...STEPS, 'none'] as readonly string[]).includes(size) && !SPACING_CALC.test(size))
    );
}

/**
 * Whether a style value is a radius the system draws: a token reference, `0`, or a choice between those. Pure.
 *
 * @param value - The property's initialiser.
 * @param glyph - Whether the module is a glyph, which may read a `GLYPH_` constant.
 */
function isOnScaleValue(value: ts.Expression, glyph: boolean): boolean {
    if (ts.isParenthesizedExpression(value)) {
        return isOnScaleValue(value.expression, glyph);
    }

    if (ts.isConditionalExpression(value)) {
        return isOnScaleValue(value.whenTrue, glyph) && isOnScaleValue(value.whenFalse, glyph);
    }

    if (glyph && ts.isIdentifier(value) && GLYPH_CONSTANT.test(value.text)) {
        return true;
    }

    if (
        ts.isBinaryExpression(value) &&
        value.operatorToken.kind === ts.SyntaxKind.SlashToken &&
        ts.isNumericLiteral(value.right) &&
        value.right.text === '2' &&
        !ts.isNumericLiteral(value.left)
    ) {
        return true;
    }

    if (ts.isNumericLiteral(value)) {
        return Number(value.text) === 0;
    }

    return TOKEN_REFERENCE.test(value.getText());
}

/** The class tokens of one string fragment; a fragment that runs into a `${}` drops its unfinished last token. */
function tokensOf(text: string, openEnded: boolean): readonly string[] {
    const tokens = text.split(/\s+/u).filter((token) => token !== '');

    return openEnded && !/\s$/u.test(text) ? tokens.slice(0, -1) : tokens;
}

/**
 * Every off-scale radius in one source file. Pure.
 *
 * @param file - The path, which selects the parser mode.
 * @param text - The source.
 */
export function offScaleRadiusIn(file: string, text: string): readonly Offender[] {
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const glyph = GLYPH_PATTERN.test(text);
    const found: Offender[] = [];

    const report = (node: ts.Node, offending: string): void => {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

        found.push({ file, line, text: offending });
    };

    const scanText = (node: ts.Node, fragment: string, openEnded: boolean): void => {
        for (const token of tokensOf(fragment, openEnded)) {
            if (isOffScaleClass(token)) {
                report(node, token);
            }
        }
    };

    const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            scanText(node, node.text, false);
        } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
            scanText(node, node.text, true);
        } else if (ts.isTemplateTail(node)) {
            scanText(node, node.text, false);
        } else if (ts.isPropertyAssignment(node) && RADIUS_PROPERTY.test(node.name.getText(source))) {
            if (!isOnScaleValue(node.initializer, glyph)) {
                report(node, node.getText(source).replace(/\s+/gu, ' '));
            }
        } else if (ts.isShorthandPropertyAssignment(node) && RADIUS_PROPERTY.test(node.name.text)) {
            report(node, node.name.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
}

/** Every app source file (not a test, fixture or build output) under a directory. Impure. */
function sourcesUnder(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourcesUnder(full);
        }

        return /\.tsx?$/u.test(entry.name) && !/\.(?:test|spec|d)\.tsx?$/u.test(entry.name) ? [full] : [];
    });
}

/**
 * The app source files the guard reads.
 *
 * @param appsRoot - The absolute path of `packages/apps`.
 * @sideEffect Reads the file system.
 */
export function appSources(appsRoot: string): readonly string[] {
    return sourcesUnder(appsRoot);
}

/**
 * Every off-scale radius under `packages/apps`, as `path:line  text`.
 *
 * @param appsRoot - The absolute path of `packages/apps`.
 * @sideEffect Reads the file system.
 */
export function offScaleRadiusUnder(appsRoot: string): readonly string[] {
    return appSources(appsRoot).flatMap((file) =>
        offScaleRadiusIn(file, readFileSync(file, 'utf8')).map(
            (hit) => `${path.relative(appsRoot, hit.file)}:${String(hit.line)}  ${hit.text}`,
        ),
    );
}
