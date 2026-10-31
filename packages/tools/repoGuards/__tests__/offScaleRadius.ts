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
 * - Tamagui (ADR-0080): a radius on a Tamagui element or in a Tamagui `styled(…)` object is a `$` token whose name is a key
 *   of `tamaguiTokens.radius` ({@link tamaguiRadiusFindings}); a number, a percentage, a cast and a variable are off
 *   the scale. The native reader above leaves a `styled(…)` object to that rule.
 *
 * - A fixed-size glyph (the 18 px checkbox) owns a corner no step fits, as a named `GLYPH_` constant. Only a module whose
 *   leading JSDoc carries a `@pattern Glyph` tag may read one; the radius scale gets no `xs` step.
 *
 * @pattern Visitor — a walk over the parsed syntax tree
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { appSourceModules, classTokensOf, parseModule, stringLikeTexts } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import { isTamaguiStyledCall, tamaguiStyledNames, type StyledExportsOf } from './tamaguiElements.js';
import { styleSiteFindings } from './tamaguiStyleSites.js';
import { attributeValueOf, isTokenValue } from './tamaguiTokenValues.js';

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

/**
 * Every off-scale radius in one source file. Pure.
 *
 * @param file - The path, which selects the parser mode.
 * @param text - The source.
 */
export function offScaleRadiusIn(file: string, text: string): readonly Offender[] {
    const source = parseModule(file, text);
    const glyph = GLYPH_PATTERN.test(text);
    const found: Offender[] = [];
    const styledNames = tamaguiStyledNames(source);

    const report = (node: ts.Node, offending: string): void => {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

        found.push({ file, line, text: offending });
    };

    // The class tokens come from the shared string reader (`appSources.ts`); only the style properties are walked here.
    for (const { node, text: fragment, openEnded } of stringLikeTexts(file, text)) {
        for (const token of classTokensOf(fragment, openEnded)) {
            if (isOffScaleClass(token)) {
                report(node, token);
            }
        }
    }

    const visit = (node: ts.Node): void => {
        if (isTamaguiStyledCall(node, styledNames)) {
            // Judged by `tamaguiRadiusFindings`, where a radius is a `$` token and not a `radius.md` reference.
            return;
        }

        if (ts.isPropertyAssignment(node) && RADIUS_PROPERTY.test(node.name.getText(source))) {
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

/**
 * The app source files the guard reads: `appSourceModules()`, the one discovery every app guard shares.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git and stats the working tree.
 */
export function appSources(): readonly string[] {
    return appSourceModules();
}

/**
 * Every off-scale radius under `packages/apps`, as `path:line  text`.
 *
 * @returns One line per offender, the path repo-relative.
 * @sideEffect Reads the file system.
 */
export function offScaleRadiusUnder(): readonly string[] {
    return appSources().flatMap((file) =>
        offScaleRadiusIn(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
            (hit) => `${hit.file}:${String(hit.line)}  ${hit.text}`,
        ),
    );
}

/**
 * Every radius on a Tamagui element, or in a Tamagui `styled(…)` object, that is not a `$` token naming a radius step,
 * plus every `styled(…)` part the walk cannot read. ⚠️ Only the long prop names are read, as the other Tamagui style
 * guards do: a shorthand is not seen. Pure, given `styledExportsOf`.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @param radiusKeys - The keys of `tamaguiTokens.radius` (`tamaguiScaleKeys.ts`), which a `$` token must name.
 * @returns One `file:line text` entry per finding.
 */
export function tamaguiRadiusFindings(
    source: string,
    fileName: string,
    styledExportsOf: StyledExportsOf,
    radiusKeys: ReadonlySet<string>,
): readonly string[] {
    const isRadiusToken = (token: string): boolean => token.startsWith('$') && radiusKeys.has(token.slice(1));

    return styleSiteFindings(source, fileName, styledExportsOf, {
        attribute: (attribute, file) => {
            if (!ts.isJsxAttribute(attribute) || !RADIUS_PROPERTY.test(attribute.name.getText(file))) {
                return false;
            }

            const value = attributeValueOf(attribute);

            return value === undefined || !isTokenValue(value, isRadiusToken);
        },
        property: ({ key, value }) => RADIUS_PROPERTY.test(key) && !isTokenValue(value, isRadiusToken),
    });
}
