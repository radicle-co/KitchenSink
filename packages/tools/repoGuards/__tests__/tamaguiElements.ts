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

function isExported(statement: ts.Statement): boolean {
    return (
        ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
    );
}

function leafOf(from: string, specifier: string): string | undefined {
    const target = path.resolve(path.dirname(from), specifier).replace(/\.js$/u, '');

    return [`${target}.native.tsx`, `${target}.native.ts`, `${target}.tsx`, `${target}.ts`].find(existsSync);
}

/**
 * The names one module exports as Tamagui `styled(…)` components: declared and exported in place, listed in a local
 * `export { … }`, or re-exported from a relative module, followed to any depth (a cycle stops). Reads files.
 */
function styledExportsOfFile(file: string, seen: ReadonlySet<string>): ReadonlySet<string> {
    if (seen.has(file) || !existsSync(file)) {
        return new Set();
    }

    const source = parseModule(file, readFileSync(file, 'utf8'));
    const styledNames = tamaguiStyledNames(source);
    const styledLocals = new Set(styledBindings(source, styledNames));
    const names = new Set<string>();

    for (const statement of source.statements) {
        if (isExported(statement) && ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && styledLocals.has(declaration.name.text)) {
                    names.add(declaration.name.text);
                }
            }
        }

        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) {
            continue;
        }

        const clause = statement.exportClause;
        const specifier = statement.moduleSpecifier;

        if (specifier === undefined) {
            // `export { Pill }`: a list of this module's own names.
            if (clause !== undefined && ts.isNamedExports(clause)) {
                clause.elements
                    .filter((element) => styledLocals.has((element.propertyName ?? element.name).text))
                    .forEach((element) => names.add(element.name.text));
            }

            continue;
        }

        if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) {
            continue;
        }

        const leaf = leafOf(file, specifier.text);
        const styledThere =
            leaf === undefined ? new Set<string>() : styledExportsOfFile(leaf, new Set([...seen, file]));

        if (clause !== undefined && ts.isNamedExports(clause)) {
            clause.elements
                .filter((element) => styledThere.has((element.propertyName ?? element.name).text))
                .forEach((element) => names.add(element.name.text));
        } else if (clause === undefined) {
            styledThere.forEach((name) => names.add(name));
        }
    }

    return names;
}

/**
 * A reader of the names each subpath of a design-system package (`@commise/ui/text`) exports as Tamagui `styled(…)`
 * components, through the package's `exports` map and every relative re-export behind it.
 *
 * @param packageRoot - The package's directory.
 * @returns The reader, which caches by subpath.
 * @sideEffect The reader reads the package manifest and the exported modules.
 */
export function styledExportsReader(packageRoot: string): StyledExportsOf {
    const cache = new Map<string, ReadonlySet<string>>();

    return (subpath) => {
        const known = cache.get(subpath);

        if (known !== undefined) {
            return known;
        }

        const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
            readonly exports?: Readonly<Record<string, unknown>>;
        };
        const target = manifest.exports?.[`./${subpath.slice(DESIGN_SYSTEM_PACKAGE.length)}`];
        const names =
            typeof target === 'string' && /\.tsx?$/u.test(target)
                ? styledExportsOfFile(path.join(packageRoot, target), new Set())
                : new Set<string>();

        cache.set(subpath, names);

        return names;
    };
}

/** The design system's own reader (`@commise/ui`). */
export const designSystemStyledExports: StyledExportsOf = styledExportsReader(UI_ROOT);
