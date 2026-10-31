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

/** A local binding of a Tamagui `styled(…)` call: `const Row = styled(XStack, {…})`. */
export interface StyledDeclaration {
    readonly name: string;
    readonly call: ts.CallExpression;
}

/**
 * Every local binding of a Tamagui `styled(…)` call in a module. Pure.
 *
 * @param file - The parsed module.
 * @param styledNames - Its local names for Tamagui's `styled` (`tamaguiStyledNames`).
 */
export function styledDeclarations(
    file: ts.SourceFile,
    styledNames: ReadonlySet<string>,
): readonly StyledDeclaration[] {
    const declarations: StyledDeclaration[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            isTamaguiStyledCall(node.initializer, styledNames)
        ) {
            declarations.push({ name: node.name.text, call: node.initializer });
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return declarations;
}

function styledBindings(file: ts.SourceFile, styledNames: ReadonlySet<string>): readonly string[] {
    return styledDeclarations(file, styledNames).map(({ name }) => name);
}

/**
 * What a Tamagui element lays out as: a `view` (a container: `View`, the stacks, `ScrollView`), a `text`, or `other`
 * (a Tamagui element no guard classifies).
 */
export type TamaguiKind = 'view' | 'text' | 'other';

/** The Tamagui exports that are View-like. A `styled(Base, …)` is View-like when its base is. */
const VIEW_LIKE = new Set(['View', 'Stack', 'XStack', 'YStack', 'ZStack', 'ScrollView']);

/** The Tamagui exports that are Text-like. */
const TEXT_LIKE = new Set(['Text']);

function kindOfExport(exported: string): TamaguiKind {
    if (VIEW_LIKE.has(exported)) {
        return 'view';
    }

    return TEXT_LIKE.has(exported) ? 'text' : 'other';
}

function unwrapBase(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isNonNullExpression(expression)
        ? unwrapBase(expression.expression)
        : expression;
}

/**
 * The kind of each local `styled(…)` binding: that of its base, followed through chains of local bindings to any depth
 * (`styled(Row, …)` where `Row = styled(XStack, …)`). A base that is neither a Tamagui export, a namespace member nor a
 * local binding is `other`. Pure.
 */
function localStyledKinds(
    declarations: readonly StyledDeclaration[],
    importKinds: ReadonlyMap<string, TamaguiKind>,
    namespaces: ReadonlySet<string>,
): ReadonlyMap<string, TamaguiKind> {
    const kinds = new Map<string, TamaguiKind>();

    const baseKind = (base: ts.Expression | undefined): TamaguiKind => {
        const expression = base === undefined ? undefined : unwrapBase(base);

        if (expression !== undefined && ts.isIdentifier(expression)) {
            return kinds.get(expression.text) ?? importKinds.get(expression.text) ?? 'other';
        }

        if (
            expression !== undefined &&
            ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            namespaces.has(expression.expression.text)
        ) {
            return kindOfExport(expression.name.text);
        }

        return 'other';
    };

    // A binding may name one declared further down, so resolve until nothing changes (a chain is at most as long as the list).
    for (let pass = 0; pass <= declarations.length; pass += 1) {
        let changed = false;

        for (const { name, call } of declarations) {
            const kind = baseKind(call.arguments[0]);

            if (kinds.get(name) !== kind) {
                kinds.set(name, kind);
                changed = true;
            }
        }

        if (!changed) {
            break;
        }
    }

    return kinds;
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

/** The exported names of in-place declarations (`export const Text = styled(…)`), each with its kind. */
function exportedDeclarations(
    statement: ts.Statement,
    styledLocals: ReadonlyMap<string, TamaguiKind>,
): readonly (readonly [string, TamaguiKind])[] {
    if (!isExported(statement) || !ts.isVariableStatement(statement)) {
        return [];
    }

    return statement.declarationList.declarations.flatMap((declaration) => {
        const kind = ts.isIdentifier(declaration.name) ? styledLocals.get(declaration.name.text) : undefined;

        return kind === undefined || !ts.isIdentifier(declaration.name) ? [] : [[declaration.name.text, kind] as const];
    });
}

/** The exported names of an `export { … }` clause whose source name is in `styled`, each with its kind. */
function listedNames(
    clause: ts.NamedExportBindings | undefined,
    styled: ReadonlyMap<string, TamaguiKind>,
): readonly (readonly [string, TamaguiKind])[] {
    if (clause === undefined || !ts.isNamedExports(clause)) {
        return [];
    }

    return clause.elements.flatMap((element) => {
        const kind = styled.get((element.propertyName ?? element.name).text);

        return kind === undefined ? [] : [[element.name.text, kind] as const];
    });
}

/** Names re-exported from a relative module: `export { X } from './X.js'` or `export * from './x.js'`. */
function reExportedNames(
    statement: ts.ExportDeclaration,
    file: string,
    seen: ReadonlySet<string>,
): readonly (readonly [string, TamaguiKind])[] {
    const specifier = statement.moduleSpecifier;

    if (specifier === undefined || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) {
        return [];
    }

    const leaf = leafOf(file, specifier.text);
    const styledThere =
        leaf === undefined ? new Map<string, TamaguiKind>() : styledKindsOfFile(leaf, new Set([...seen, file]));

    return statement.exportClause === undefined ? [...styledThere] : listedNames(statement.exportClause, styledThere);
}

/**
 * The kinds of the names one module exports as Tamagui `styled(…)` components: declared and exported in place, listed
 * in a local `export { … }`, or re-exported from a relative module, followed to any depth (a cycle stops). Reads files.
 */
function styledKindsOfFile(file: string, seen: ReadonlySet<string>): ReadonlyMap<string, TamaguiKind> {
    if (seen.has(file) || !existsSync(file)) {
        return new Map();
    }

    const source = parseModule(file, readFileSync(file, 'utf8'));
    const styledLocals = localKindsOf(source);

    return new Map(
        source.statements.flatMap((statement) => {
            if (!ts.isExportDeclaration(statement)) {
                return exportedDeclarations(statement, styledLocals);
            }

            if (statement.isTypeOnly) {
                return [];
            }

            return statement.moduleSpecifier === undefined
                ? listedNames(statement.exportClause, styledLocals)
                : reExportedNames(statement, file, seen);
        }),
    );
}

/** The kind of each local Tamagui `styled(…)` binding of a module. Pure. */
function localKindsOf(file: ts.SourceFile): ReadonlyMap<string, TamaguiKind> {
    const tamagui = valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier));
    const importKinds = new Map<string, TamaguiKind>();

    for (const [exported, locals] of tamagui.locals) {
        locals.forEach((local) => importKinds.set(local, kindOfExport(exported)));
    }

    return localStyledKinds(styledDeclarations(file, tamaguiStyledNames(file)), importKinds, tamagui.namespaces);
}

/** The kind of each name a design-system subpath exports as a Tamagui `styled(…)` component. */
export type StyledKindsOf = (subpath: string) => ReadonlyMap<string, TamaguiKind>;

/**
 * A reader of the names each subpath of a design-system package (`@commise/ui/text`) exports as Tamagui `styled(…)`
 * components, and what each is (`TamaguiKind`), through the package's `exports` map and every relative re-export
 * behind it.
 *
 * @param packageRoot - The package's directory.
 * @returns The reader, which caches by subpath.
 * @sideEffect The reader reads the package manifest and the exported modules.
 */
export function styledKindsReader(packageRoot: string): StyledKindsOf {
    const cache = new Map<string, ReadonlyMap<string, TamaguiKind>>();

    return (subpath) => {
        const known = cache.get(subpath);

        if (known !== undefined) {
            return known;
        }

        const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
            readonly exports?: Readonly<Record<string, unknown>>;
        };
        const target = manifest.exports?.[`./${subpath.slice(DESIGN_SYSTEM_PACKAGE.length)}`];
        const kinds =
            typeof target === 'string' && /\.tsx?$/u.test(target)
                ? styledKindsOfFile(path.join(packageRoot, target), new Set())
                : new Map<string, TamaguiKind>();

        cache.set(subpath, kinds);

        return kinds;
    };
}

/**
 * The names-only view of {@link styledKindsReader}: which names each subpath exports as Tamagui `styled(…)`
 * components.
 *
 * @param packageRoot - The package's directory.
 * @returns The reader, which caches by subpath.
 * @sideEffect The reader reads the package manifest and the exported modules.
 */
export function styledExportsReader(packageRoot: string): StyledExportsOf {
    const kindsOf = styledKindsReader(packageRoot);

    return (subpath) => new Set(kindsOf(subpath).keys());
}

/** The design system's own readers (`@commise/ui`). */
export const designSystemStyledKinds: StyledKindsOf = styledKindsReader(UI_ROOT);

/** The design system's own reader of styled export names (`@commise/ui`). */
export const designSystemStyledExports: StyledExportsOf = styledExportsReader(UI_ROOT);

/**
 * What each JSX tag that renders a Tamagui element is: `view`, `text` or `other`. A Tamagui `View`, stack or
 * `ScrollView` is a `view`, `Text` is a `text`; a `styled(Base, …)` is that of its base, followed through local
 * bindings; a design-system export is what its own `styled(…)` says. Pure, given `styledKindsOf`.
 *
 * @param file - The parsed module.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a styled component.
 * @returns Tag names as written (`View`, `Row`, `T.View`) and their kinds, for exactly the names
 *   {@link tamaguiElementNames} reads.
 */
export function tamaguiElementKinds(
    file: ts.SourceFile,
    styledKindsOf: StyledKindsOf,
): ReadonlyMap<string, TamaguiKind> {
    const names = tamaguiElementNames(file, (subpath) => new Set(styledKindsOf(subpath).keys()));
    const tamagui = valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier));
    const kinds = new Map<string, TamaguiKind>();

    for (const name of names) {
        kinds.set(name, 'other');
    }

    for (const [exported, locals] of tamagui.locals) {
        locals.forEach((local) => {
            if (names.has(local)) {
                kinds.set(local, kindOfExport(exported));
            }
        });
    }

    for (const name of names) {
        const member = /^([A-Za-z_$][\w$]*)\.(\w+)$/u.exec(name);

        if (member !== null && tamagui.namespaces.has(member[1] ?? '')) {
            kinds.set(name, kindOfExport(member[2] ?? ''));
        }
    }

    for (const [local, kind] of localKindsOf(file)) {
        kinds.set(local, kind);
    }

    const designSystemSpecifiers = file.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => statement.moduleSpecifier)
        .filter(ts.isStringLiteral)
        .map((specifier) => specifier.text)
        .filter((specifier) => specifier.startsWith(DESIGN_SYSTEM_PACKAGE));

    for (const specifier of new Set(designSystemSpecifiers)) {
        const bindings = valueBindingsOf(file, (candidate) => candidate === specifier);

        for (const [exported, kind] of styledKindsOf(specifier)) {
            localsOf(bindings, exported).forEach((local) => kinds.set(local, kind));
        }
    }

    return kinds;
}
