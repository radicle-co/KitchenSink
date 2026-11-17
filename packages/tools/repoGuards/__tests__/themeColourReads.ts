/**
 * G3 (ADR-0080): every read of a role colour or a press fill through the design system's `useTheme()`. See
 * `themeColourReads.test.ts` for why they are counted.
 *
 * The theme reaches a component three ways, and all three are followed: destructured (`const { colors } = useTheme()`,
 * renamed or not), bound whole (`const theme = useTheme()`, then `theme.colors.ink`), or read off the call
 * (`useTheme().colors.ink`). A member read counts once (`colors.ink`, `colors[role]`); the record passed whole counts
 * once (`stylesFor(colors)`), and so does the whole theme handed on (`fieldStyle(theme)`, `stylesFor(useTheme())`),
 * because what is read inside either is out of sight. A rest binding (`{ colors, ...rest }`) is the theme again, and a
 * nested destructure (`{ colors: { ink } }`) counts each name it takes. Names are matched by their text within
 * the module; a local that shadows `colors` with something else would be counted, and none does today.
 *
 * @pattern Specification — one predicate over a parsed module
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { localsOf, valueBindingsOf } from './moduleBindings.js';

/** One read: where it is and its text. */
export interface ThemeRead {
    readonly line: number;
    readonly text: string;
}

/** What one module reads. */
export interface ThemeReads {
    readonly colour: readonly ThemeRead[];
    readonly press: readonly ThemeRead[];
}

/** The design system's hook: its package export, or a relative import of its leaf inside the package. */
const isThemeHookModule = (specifier: string): boolean =>
    specifier === '@commise/ui/theme' || /^\.{1,2}\/(?:.*\/)?useTheme(?:\.native)?\.js$/u.test(specifier);

type Kind = 'colour' | 'press';

const KIND_OF_MEMBER: Readonly<Record<string, Kind>> = { colors: 'colour', press: 'press' };

/**
 * Every role-colour and press-fill read in one module. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @returns The reads, by kind.
 */
export function themeColourReads(source: string, fileName: string): ThemeReads {
    const file = parseModule(fileName, source);
    const hooks = localsOf(valueBindingsOf(file, isThemeHookModule), 'useTheme');
    const reads: Record<Kind, ThemeRead[]> = { colour: [], press: [] };
    const recordLocals = new Map<string, Kind>();
    const themeLocals = new Set<string>();

    const record = (kind: Kind, node: ts.Node): void => {
        reads[kind].push({ line: lineOf(file, node), text: node.getText(file) });
    };

    // A member of the record (`colors.ink`, `colors[role]`) is the read; the record alone is read whole.
    const readOfRecord = (kind: Kind, node: ts.Node): void => {
        const { parent } = node;
        const member =
            (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
            parent.expression === node;

        record(kind, member ? parent : node);
    };

    // The name being declared (`const theme = …`, `{ colors }`) is not a use of it.
    const isBindingSite = (node: ts.Identifier): boolean =>
        (ts.isVariableDeclaration(node.parent) && node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.propertyName === node);

    const isHookCall = (node: ts.Node): node is ts.CallExpression =>
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) && hooks.has(node.expression.text);

    // The theme itself: the hook's call, or a local bound to it.
    const isTheme = (node: ts.Node): boolean =>
        isHookCall(node) || (ts.isIdentifier(node) && themeLocals.has(node.text) && !isBindingSite(node));

    // `{ colors, press: p, ...rest }` taken from the theme: a record local each, a rest local as the theme itself, and a
    // nested pattern (`{ colors: { ink } }`) as one read per name it takes, since those names are colours, not records.
    const bindPattern = (pattern: ts.ObjectBindingPattern): void => {
        for (const element of pattern.elements) {
            if (element.dotDotDotToken !== undefined && ts.isIdentifier(element.name)) {
                themeLocals.add(element.name.text);
                continue;
            }

            const property = element.propertyName ?? element.name;
            const kind = ts.isIdentifier(property) ? KIND_OF_MEMBER[property.text] : undefined;

            if (kind !== undefined && ts.isIdentifier(element.name)) {
                recordLocals.set(element.name.text, kind);
            } else if (kind !== undefined && ts.isObjectBindingPattern(element.name)) {
                element.name.elements.forEach((leaf) => {
                    record(kind, leaf);
                });
            }
        }
    };

    // First pass: which locals hold the theme, or one of its records.
    const bind = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isTheme(node.initializer)) {
            if (ts.isIdentifier(node.name)) {
                themeLocals.add(node.name.text);
            } else if (ts.isObjectBindingPattern(node.name)) {
                bindPattern(node.name);
            }
        }

        ts.forEachChild(node, bind);
    };

    // The whole theme handed on (`fieldStyle(theme)`, `stylesFor(useTheme())`): what is read from it is out of sight, so
    // it counts once. A member read off it, or a declaration that takes it, is handled where it is bound.
    const handedOn = (node: ts.Node): boolean => {
        const { parent } = node;

        return (
            isTheme(node) &&
            !(ts.isPropertyAccessExpression(parent) && parent.expression === node) &&
            !(ts.isVariableDeclaration(parent) && parent.initializer === node)
        );
    };

    // A use of a record local: `colors.ink`, `colors[role]`, or `colors` handed on.
    const recordUse = (node: ts.Node): Kind | undefined => {
        if (!ts.isIdentifier(node) || isBindingSite(node)) {
            return undefined;
        }

        const { parent } = node;
        const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === node;

        return isMemberName ? undefined : recordLocals.get(node.text);
    };

    // `theme.colors` and `useTheme().colors`: the record read off the theme.
    const recordOffTheme = (node: ts.Node): Kind | undefined =>
        ts.isPropertyAccessExpression(node) && isTheme(node.expression) ? KIND_OF_MEMBER[node.name.text] : undefined;

    // Second pass: every use of them.
    const visit = (node: ts.Node): void => {
        const used = recordUse(node);
        const offTheme = recordOffTheme(node);

        if (used !== undefined) {
            readOfRecord(used, node);
        }

        if (handedOn(node)) {
            record('colour', node);
        }

        if (offTheme !== undefined) {
            readOfRecord(offTheme, node);
        }

        ts.forEachChild(node, visit);
    };

    if (hooks.size > 0) {
        bind(file);
        visit(file);
    }

    return reads;
}
