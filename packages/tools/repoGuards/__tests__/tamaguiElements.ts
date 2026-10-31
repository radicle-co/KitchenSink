/**
 * Which JSX tags in a module render a Tamagui element, shared by the Tamagui guards (ADR-0080). A tag missed here is a
 * Tamagui element no guard sees, so the reading is written once.
 *
 * A tag is Tamagui when its name is a PascalCase value import from `tamagui` or an `@tamagui/*` package (renamed or
 * not), a member of a namespace import of one (`T.View`), a local `styled(…)` binding whose `styled` is Tamagui's, or a
 * design-system export that is itself a Tamagui `styled(…)` (`designSystemStyledExports`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { parseModule } from './appSources.js';
import { localsOf, valueBindingsOf } from './moduleBindings.js';
import { repoRoot } from './serviceSources.js';

/** `tamagui` itself or one of its `@tamagui/*` packages. */
export const TAMAGUI_MODULE = /^(?:tamagui|@tamagui\/[^/]+)$/u;

/** The design-system package's prefix. */
const DESIGN_SYSTEM_PACKAGE = '@commise/ui/';

const UI_ROOT = path.join(repoRoot, 'packages/apps/commise/ui');

/** The names a design-system subpath exports as Tamagui `styled(…)` components. */
export type StyledExportsOf = (subpath: string) => ReadonlySet<string>;

/**
 * The local name `styled` is bound to from a Tamagui module, if any. Pure.
 *
 * @param file - The parsed module.
 * @returns The local names.
 */
export function tamaguiStyledNames(file: ts.SourceFile): ReadonlySet<string> {
    return localsOf(
        valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier)),
        'styled',
    );
}

/**
 * Whether a call is Tamagui's `styled(…)`. Pure.
 *
 * @param node - The node.
 * @param styledNames - The module's local names for Tamagui's `styled`.
 */
export function isTamaguiStyledCall(node: ts.Node, styledNames: ReadonlySet<string>): node is ts.CallExpression {
    return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && styledNames.has(node.expression.text);
}

function styledBindings(file: ts.SourceFile, styledNames: ReadonlySet<string>): readonly string[] {
    const names: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            isTamaguiStyledCall(node.initializer, styledNames)
        ) {
            names.push(node.name.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return names;
}

/**
 * The local JSX tag names that render a Tamagui element. Pure, given `styledExportsOf`.
 *
 * @param file - The parsed module.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @returns Tag names as written: `View`, `Pill`, `T.View`.
 */
export function tamaguiElementNames(file: ts.SourceFile, styledExportsOf: StyledExportsOf): ReadonlySet<string> {
    const names = new Set<string>();
    const tamagui = valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier));
    const { namespaces } = tamagui;

    for (const [exported, locals] of tamagui.locals) {
        if (/^[A-Z]/u.test(exported)) {
            locals.forEach((local) => names.add(local));
        }
    }

    const designSystemSpecifiers = new Set(
        file.statements
            .filter(ts.isImportDeclaration)
            .map((statement) => statement.moduleSpecifier)
            .filter(ts.isStringLiteral)
            .map((specifier) => specifier.text)
            .filter((specifier) => specifier.startsWith(DESIGN_SYSTEM_PACKAGE)),
    );

    for (const specifier of designSystemSpecifiers) {
        const bindings = valueBindingsOf(file, (candidate) => candidate === specifier);

        for (const exported of styledExportsOf(specifier)) {
            localsOf(bindings, exported).forEach((local) => names.add(local));
        }
    }

    styledBindings(file, tamaguiStyledNames(file)).forEach((name) => names.add(name));

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            ts.isPropertyAccessExpression(node.tagName) &&
            ts.isIdentifier(node.tagName.expression) &&
            namespaces.has(node.tagName.expression.text)
        ) {
            names.add(node.tagName.getText(file));
        }

        ts.forEachChild(node, visit);
    };

    if (namespaces.size > 0) {
        visit(file);
    }

    return names;
}

/**
 * Every opening JSX element of a module whose tag is a Tamagui element. Pure.
 *
 * @param file - The parsed module.
 * @param names - Its Tamagui tag names (`tamaguiElementNames`).
 */
export function tamaguiOpeningElements(
    file: ts.SourceFile,
    names: ReadonlySet<string>,
): readonly ts.JsxOpeningLikeElement[] {
    const elements: ts.JsxOpeningLikeElement[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            names.has(node.tagName.getText(file))
        ) {
            elements.push(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return elements;
}

const uiExports = (): Readonly<Record<string, unknown>> =>
    (JSON.parse(readFileSync(path.join(UI_ROOT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> })
        .exports;

function styledExportsOfFile(file: string, seen: ReadonlySet<string>): ReadonlySet<string> {
    if (seen.has(file) || !existsSync(file)) {
        return new Set();
    }

    const source = parseModule(file, readFileSync(file, 'utf8'));
    const styledNames = tamaguiStyledNames(source);
    const names = new Set<string>();

    for (const statement of source.statements) {
        const exported = ts
            .getModifiers(statement as ts.HasModifiers)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

        if (exported === true && ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (
                    ts.isIdentifier(declaration.name) &&
                    declaration.initializer !== undefined &&
                    isTamaguiStyledCall(declaration.initializer, styledNames)
                ) {
                    names.add(declaration.name.text);
                }
            }
        }

        if (
            ts.isExportDeclaration(statement) &&
            statement.moduleSpecifier !== undefined &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text.startsWith('.')
        ) {
            const target = path.resolve(path.dirname(file), statement.moduleSpecifier.text).replace(/\.js$/u, '');
            const leaf = [`${target}.native.tsx`, `${target}.native.ts`, `${target}.tsx`, `${target}.ts`].find(
                existsSync,
            );
            const styledThere =
                leaf === undefined ? new Set<string>() : styledExportsOfFile(leaf, new Set([...seen, file]));
            const clause = statement.exportClause;

            if (clause !== undefined && ts.isNamedExports(clause)) {
                for (const element of clause.elements) {
                    if (styledThere.has((element.propertyName ?? element.name).text)) {
                        names.add(element.name.text);
                    }
                }
            } else if (clause === undefined) {
                styledThere.forEach((name) => names.add(name));
            }
        }
    }

    return names;
}

const styledExportCache = new Map<string, ReadonlySet<string>>();

/**
 * The names a design-system subpath (`@commise/ui/text`) exports as Tamagui `styled(…)` components, read through the
 * package's `exports` map and one level of re-export per hop.
 *
 * @param subpath - The import specifier.
 * @returns The exported names.
 * @sideEffect Reads `ui/package.json` and the exported modules.
 */
export const designSystemStyledExports: StyledExportsOf = (subpath) => {
    const known = styledExportCache.get(subpath);

    if (known !== undefined) {
        return known;
    }

    const target = uiExports()[`./${subpath.slice(DESIGN_SYSTEM_PACKAGE.length)}`];
    const names =
        typeof target === 'string' && /\.tsx?$/u.test(target)
            ? styledExportsOfFile(path.join(UI_ROOT, target), new Set())
            : new Set<string>();

    styledExportCache.set(subpath, names);

    return names;
};
