/**
 * The reader behind `colourRoles.test.ts`: every place an app component takes a colour from somewhere other than a
 * colour ROLE (`docs/design/uiOverhaul/ownerDecisions.md` D15; `darkTheme.md` §6.6 and §7.3).
 *
 * A role re-themes: on web its utility compiles to `var(--color-{role})`, which the dark block overrides; on native it
 * is read from `useTheme()` at render. Anything else is one theme baked in. Six shapes are findings:
 *
 *  - `palette-import` — a value import of `palette`, `semantic` or `glass` (the unthemed tiers) from the design system.
 *  - `static-role-import` — a value import of `role` itself: the LIGHT record, read outside the theme.
 *  - `hex-literal` / `rgb-literal` — a colour written into a string.
 *  - `raw-colour-class` — a Tailwind colour utility over a palette, semantic or default colour, `white`/`black`, or an
 *    arbitrary `[#…]` value, under any variant and with any opacity modifier.
 *  - `dark-variant` — a `dark:` class: the media block is the one theme switch, so a component never branches on it.
 *  - `static-stylesheet-colour` — a colour key inside `StyleSheet.create`, which runs once at import and so bakes one
 *    theme (`darkTheme.md` §7.3).
 *
 * Read with the TypeScript parser, so a comment never counts and a string is read only where it is a string. The
 * colour NAMES come from parsing `tokens/colors.ts` itself, so a palette entry added tomorrow is a finding tomorrow.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { repoRoot } from './serviceSources.js';

/** One finding: its kind and the text that produced it. */
export interface ColourFinding {
    readonly kind:
        | 'palette-import'
        | 'static-role-import'
        | 'hex-literal'
        | 'rgb-literal'
        | 'raw-colour-class'
        | 'dark-variant'
        | 'static-stylesheet-colour';
    readonly text: string;
}

/** The colour utilities Tailwind v4 generates from a `--color-*` value. */
const COLOUR_UTILITY =
    /^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|from|via|to|fill|stroke|divide|placeholder|decoration|shadow|accent|caret|inset-ring|inset-shadow)-(.+?)(?:\/(?:\d+|\[[^\]]+\]))?$/u;

/** Tailwind's default colour scales (`red-500`, …). */
const DEFAULT_SCALE =
    /^(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive)-\d{2,3}$/u;

/** A hex colour inside a string: `#RGB`, `#RRGGBB` or `#RRGGBBAA`, not followed by more of a word. */
const HEX = /(?:^|[^&\w])#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z_-])/iu;

/** A functional colour inside a string. */
const RGB = /\brgba?\(\s*\d/iu;

/** Style keys that carry a colour. */
const COLOUR_KEY =
    /^(?:color|backgroundColor|border(?:Top|Right|Bottom|Left|Start|End|Block|Inline)?Color|shadowColor|tintColor|textDecorationColor|textShadowColor|overlayColor|placeholderTextColor)$/u;

/** The design-system modules a component can take a colour tier from. */
const TOKEN_MODULE =
    /(?:^@commise\/ui(?:\/(?:colors|tokens))?$|tokens\/(?:colors|gradients|index)\.js$|^\.\.?\/(?:colors|gradients)\.js$)/u;

/**
 * The object keys of one exported `const` in a module, read with the parser. Pure.
 *
 * @param source - The module's text.
 * @param name - The exported constant.
 * @returns Its keys (kebab spellings are kept as written).
 */
export function objectKeys(source: string, name: string): readonly string[] {
    const file = ts.createSourceFile('colors.ts', source, ts.ScriptTarget.Latest, true);
    let keys: readonly string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name &&
            node.initializer !== undefined
        ) {
            const literal = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;

            if (ts.isObjectLiteralExpression(literal)) {
                keys = literal.properties.flatMap((property) => {
                    if (
                        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
                        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                    ) {
                        return [property.name.text];
                    }

                    return [];
                });
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return keys;
}

/** `camelCase` → `kebab-case`, as `themeCss.ts` emits a key. Pure. */
const kebab = (key: string): string => key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);

/** The unthemed colour names: palette and semantic keys as utilities spell them, plus `white`/`black`. */
export function unthemedColourNames(colorsSource: string): ReadonlySet<string> {
    return new Set([
        ...objectKeys(colorsSource, 'palette').map(kebab),
        ...objectKeys(colorsSource, 'semantic').map(kebab),
        'white',
        'black',
    ]);
}

/** The colour names as read from the real `tokens/colors.ts`. */
export const realUnthemedColourNames = (): ReadonlySet<string> =>
    unthemedColourNames(readFileSync(path.join(repoRoot, 'packages/apps/commise/ui/src/tokens/colors.ts'), 'utf8'));

/** Whether one class token is a colour utility over an unthemed colour, or a `dark:` variant. */
function classFinding(token: string, names: ReadonlySet<string>): ColourFinding | null {
    const parts = token.split(':');
    const variants = parts.slice(0, -1);
    const utility = (parts.at(-1) ?? '').replace(/^!|!$/gu, '').replace(/^-/u, '');

    if (variants.includes('dark')) {
        return { kind: 'dark-variant', text: token };
    }

    const colour = COLOUR_UTILITY.exec(utility)?.[1];

    if (colour === undefined) {
        return null;
    }

    if (names.has(colour) || DEFAULT_SCALE.test(colour) || /^\[(?:#|rgb|hsl|oklch|color)/iu.test(colour)) {
        return { kind: 'raw-colour-class', text: token };
    }

    return null;
}

/** The findings in one string's text. Pure. */
function stringFindings(text: string, names: ReadonlySet<string>): readonly ColourFinding[] {
    const findings: ColourFinding[] = [];

    if (HEX.test(text)) {
        findings.push({ kind: 'hex-literal', text });
    }

    if (RGB.test(text)) {
        findings.push({ kind: 'rgb-literal', text });
    }

    for (const token of text.split(/\s+/u)) {
        const finding = token === '' ? null : classFinding(token, names);

        if (finding !== null) {
            findings.push(finding);
        }
    }

    return findings;
}

/** Whether a call is `StyleSheet.create(…)`. */
const isStyleSheetCreate = (node: ts.CallExpression): boolean =>
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'create' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'StyleSheet';

/**
 * Every colour finding in one source file. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @param names - The unthemed colour names ({@link unthemedColourNames}).
 * @returns The findings, in source order.
 */
export function colourFindings(source: string, fileName: string, names: ReadonlySet<string>): readonly ColourFinding[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const findings: ColourFinding[] = [];

    const visitStyleSheet = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
            const transparent = ts.isStringLiteral(node.initializer) && node.initializer.text === 'transparent';

            if (COLOUR_KEY.test(node.name.text) && !transparent) {
                findings.push({ kind: 'static-stylesheet-colour', text: node.getText(file) });
            }
        }

        ts.forEachChild(node, visitStyleSheet);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.importClause?.namedBindings;

            if (
                node.importClause?.isTypeOnly !== true &&
                TOKEN_MODULE.test(node.moduleSpecifier.text) &&
                bindings !== undefined &&
                ts.isNamedImports(bindings)
            ) {
                for (const element of bindings.elements) {
                    const imported = (element.propertyName ?? element.name).text;

                    if (element.isTypeOnly) {
                        continue;
                    }

                    // `glass` is a light-only white rgba tier (`tokens/gradients.ts`): a card wearing it stays white
                    // on the dark canvas, so it is an unthemed tier like the palette.
                    if (imported === 'palette' || imported === 'semantic' || imported === 'glass') {
                        findings.push({ kind: 'palette-import', text: imported });
                    }

                    if (imported === 'role') {
                        findings.push({ kind: 'static-role-import', text: imported });
                    }
                }
            }

            return;
        }

        if (ts.isCallExpression(node) && isStyleSheetCreate(node)) {
            node.arguments.forEach(visitStyleSheet);
        }

        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            findings.push(...stringFindings(node.text, names));
        }

        if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            findings.push(...stringFindings(node.text, names));
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return findings;
}
