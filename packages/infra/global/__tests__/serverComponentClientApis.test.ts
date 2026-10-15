// @vitest-environment node
/**
 * Repo-wide guard: no module a Next.js SERVER component reaches imports a client-only React API.
 *
 * In the App Router every module is a Server Component unless it, or a module above it on the import path, starts with
 * `'use client'`. `next build` refuses a server-graph module that imports `useState`, `useEffect`, `useRef` and the
 * rest of React's client-only surface — and NOTHING else in this repo sees that: `tsc` types the import fine, and a
 * vitest suite renders the component in jsdom, where every module is a client module. CI run 38791689080 is the
 * measured case: `RecipeVisibilityStatement.tsx` imported `dialogFocus`'s hooks (which import `useEffect`) with no
 * directive, `app/[locale]/discover/page.tsx` reached it through `@commise/features-recipes`' index, and only the
 * build failed.
 *
 * So this walks the import graph exactly as the build does: from every `src/app` module that is not itself a client
 * module, through every non-type import (resolved by TypeScript's own resolver with the web app's `tsconfig.json`, so
 * workspace packages are followed into their source), stopping at a module that declares `'use client'`. A reached
 * module that imports a name in {@link CLIENT_ONLY_APIS} is a violation, reported with the path that reached it.
 *
 * The API list is Next's own (`react_server_components.rs`, the `invalid_server_react_apis` and
 * `invalid_server_react_dom_apis` sets); `useContext`, `useId`, `useMemo` and `useCallback` are NOT on it, because the
 * React server build provides them.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The names a server-graph module may not import, by the module they come from (Next's own two lists). */
const CLIENT_ONLY_APIS: Readonly<Record<string, ReadonlySet<string>>> = {
    react: new Set([
        'Component',
        'createContext',
        'createFactory',
        'PureComponent',
        'useActionState',
        'useDeferredValue',
        'useEffect',
        'useEffectEvent',
        'useImperativeHandle',
        'useInsertionEffect',
        'useLayoutEffect',
        'useOptimistic',
        'useReducer',
        'useRef',
        'useState',
        'useSyncExternalStore',
        'useTransition',
    ]),
    'react-dom': new Set(['flushSync', 'unstable_batchedUpdates', 'useFormState', 'useFormStatus']),
};

/** One file's source. */
interface Source {
    readonly file: string;
    readonly contents: string;
}

/** What one module says about itself: its directive, its client-only imports, and the modules it imports. */
interface ModuleFacts {
    readonly usesClient: boolean;
    /** `module:name` for every client-only API it imports. */
    readonly clientApis: readonly string[];
    /** Every specifier it imports or re-exports at runtime (type-only imports excluded). */
    readonly specifiers: readonly string[];
}

/** Parse as TSX when the file is TSX: a JSX body parsed as TS still yields its imports, but not reliably. */
function parseSource({ file, contents }: Source): ts.SourceFile {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

    return ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, false, kind);
}

/** Whether a module opens with the `'use client'` directive (only comments may precede it). Pure. */
function declaresUseClient(sourceFile: ts.SourceFile): boolean {
    for (const statement of sourceFile.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
            return false;
        }

        if (statement.expression.text === 'use client') {
            return true;
        }
    }

    return false;
}

/** The runtime names an import declaration binds, or `[]` when it is type-only. Pure. */
function runtimeNamedImports(node: ts.ImportDeclaration): readonly string[] {
    const clause = node.importClause;

    if (clause === undefined || clause.isTypeOnly) {
        return [];
    }

    const bindings = clause.namedBindings;

    if (bindings === undefined || !ts.isNamedImports(bindings)) {
        return [];
    }

    return bindings.elements
        .filter((element) => !element.isTypeOnly)
        .map((element) => (element.propertyName ?? element.name).text);
}

/** Whether an import or re-export brings anything in at runtime. Pure. */
function isRuntimeEdge(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
    if (ts.isExportDeclaration(node)) {
        if (node.isTypeOnly) {
            return false;
        }

        const clause = node.exportClause;

        return clause === undefined || !ts.isNamedExports(clause) || clause.elements.some((e) => !e.isTypeOnly);
    }

    const clause = node.importClause;

    if (clause === undefined) {
        return true; // a side-effect import
    }

    if (clause.isTypeOnly) {
        return false;
    }

    const bindings = clause.namedBindings;

    return (
        clause.name !== undefined ||
        bindings === undefined ||
        !ts.isNamedImports(bindings) ||
        bindings.elements.length === 0 ||
        bindings.elements.some((element) => !element.isTypeOnly)
    );
}

/**
 * What one module says about itself. Pure.
 *
 * A namespace import of React (`import * as React from 'react'`) is read through its member accesses, so
 * `React.useState` counts as `useState`.
 */
function moduleFacts(source: Source): ModuleFacts {
    const sourceFile = parseSource(source);
    const clientApis: string[] = [];
    const specifiers: string[] = [];
    const namespaces = new Map<string, string>();

    for (const statement of sourceFile.statements) {
        if (
            (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
            statement.moduleSpecifier !== undefined &&
            ts.isStringLiteral(statement.moduleSpecifier)
        ) {
            const specifier = statement.moduleSpecifier.text;
            const forbidden = CLIENT_ONLY_APIS[specifier];

            if (isRuntimeEdge(statement)) {
                specifiers.push(specifier);
            }

            if (forbidden !== undefined && ts.isImportDeclaration(statement)) {
                for (const name of runtimeNamedImports(statement)) {
                    if (forbidden.has(name)) {
                        clientApis.push(`${specifier}:${name}`);
                    }
                }

                const bindings = statement.importClause?.namedBindings;
                const defaultName = statement.importClause?.name;

                if (statement.importClause?.isTypeOnly !== true) {
                    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
                        namespaces.set(bindings.name.text, specifier);
                    }

                    if (defaultName !== undefined) {
                        namespaces.set(defaultName.text, specifier);
                    }
                }
            }
        }
    }

    if (namespaces.size > 0) {
        const walk = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
                const specifier = namespaces.get(node.expression.text);

                if (specifier !== undefined && CLIENT_ONLY_APIS[specifier]?.has(node.name.text) === true) {
                    clientApis.push(`${specifier}:${node.name.text}`);
                }
            }

            ts.forEachChild(node, walk);
        };

        walk(sourceFile);
    }

    return { usesClient: declaresUseClient(sourceFile), clientApis: [...new Set(clientApis)], specifiers };
}

/** A server-graph module that imports a client-only API, and the import path that reached it. */
interface Violation {
    readonly module: string;
    readonly apis: readonly string[];
    readonly via: readonly string[];
}

/**
 * Walk the server graph from `entries`. Pure over its two ports.
 *
 * @param entries - The server entry modules.
 * @param read - A module's facts, by file.
 * @param resolve - The file a specifier resolves to from a module, or `undefined` for one outside the repo's source
 *     (a package in `node_modules`, a missing file) — those are not walked.
 * @returns Every reached module that imports a client-only API, and the number of modules reached.
 */
function serverGraphViolations(
    entries: readonly string[],
    read: (file: string) => ModuleFacts,
    resolve: (specifier: string, from: string) => string | undefined,
): { readonly violations: readonly Violation[]; readonly reached: ReadonlySet<string> } {
    const reached = new Set<string>();
    const violations: Violation[] = [];
    const queue: { readonly file: string; readonly via: readonly string[] }[] = entries.map((file) => ({
        file,
        via: [file],
    }));

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const { file, via } = next;

        if (reached.has(file)) {
            continue;
        }

        const facts = read(file);

        if (facts.usesClient) {
            continue; // a client boundary: everything below it is the client graph
        }

        reached.add(file);

        if (facts.clientApis.length > 0) {
            violations.push({ module: file, apis: facts.clientApis, via });
        }

        for (const specifier of facts.specifiers) {
            const target = resolve(specifier, file);

            if (target !== undefined && !reached.has(target)) {
                queue.push({ file: target, via: [...via, target] });
            }
        }
    }

    return { violations, reached };
}

// ---------------------------------------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------------------------------------

const WEB = 'packages/apps/commise/web';

/** The web app's compiler options, as `tsc` and the editor read them. */
function webCompilerOptions(): ts.CompilerOptions {
    const configPath = path.join(repoRoot, WEB, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));

    return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options;
}

/** Whether a file is server-graph source the walk should follow: repo source, not a test, not a native twin. */
function isWalkedSource(absolute: string): boolean {
    const relative = path.relative(repoRoot, absolute);

    return (
        !relative.startsWith('..') &&
        !relative.includes('node_modules') &&
        /\.(ts|tsx)$/.test(relative) &&
        !relative.endsWith('.d.ts') &&
        !/\.native\.tsx?$/.test(relative)
    );
}

/** The server entry modules: every App Router module under `src/app`, tests excluded. */
function serverEntries(): readonly string[] {
    return presentFiles([`${WEB}/src/app`]).filter(
        (file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__') && !/\.test\.tsx?$/.test(file),
    );
}

function realTreeWalk(): ReturnType<typeof serverGraphViolations> {
    const options = webCompilerOptions();
    const cache = new Map<string, ModuleFacts>();

    const read = (file: string): ModuleFacts => {
        const known = cache.get(file);

        if (known !== undefined) {
            return known;
        }

        const facts = moduleFacts({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') });
        cache.set(file, facts);

        return facts;
    };

    const resolve = (specifier: string, from: string): string | undefined => {
        const resolved = ts.resolveModuleName(specifier, path.join(repoRoot, from), options, ts.sys).resolvedModule;

        if (resolved === undefined) {
            return undefined;
        }

        const absolute = ts.sys.realpath?.(resolved.resolvedFileName) ?? resolved.resolvedFileName;

        return isWalkedSource(absolute) && existsSync(absolute) ? path.relative(repoRoot, absolute) : undefined;
    };

    return serverGraphViolations(serverEntries(), read, resolve);
}

// ---------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------

describe('moduleFacts — what one module says about itself', () => {
    it.each<[string, string, Partial<ModuleFacts>]>([
        ['a named client-only import', "import { useState } from 'react';", { clientApis: ['react:useState'] }],
        ['an aliased one', "import { useEffect as onMount } from 'react';", { clientApis: ['react:useEffect'] }],
        ['a server-safe hook', "import { useId, useMemo, useCallback, useContext } from 'react';", { clientApis: [] }],
        ['a type-only import', "import type { useRef } from 'react';", { clientApis: [] }],
        ['a type-only specifier', "import { type Component } from 'react';", { clientApis: [] }],
        [
            'a namespace import read through its members',
            "import * as React from 'react';\nconst [a] = React.useState(0);\nReact.useId();",
            { clientApis: ['react:useState'] },
        ],
        ['a react-dom client API', "import { flushSync } from 'react-dom';", { clientApis: ['react-dom:flushSync'] }],
        ['the same name from another module', "import { useState } from './store.js';", { clientApis: [] }],
        ['the directive', "'use client';\n\nimport { useState } from 'react';", { usesClient: true }],
        ['the directive after a comment', "/** Doc. */\n'use client';\n", { usesClient: true }],
        ['the directive in double quotes', '"use client";\n', { usesClient: true }],
        ['no directive', "import { useState } from 'react';\n'use client';", { usesClient: false }],
        ['the words in a string later on', "const label = 'use client';", { usesClient: false }],
        ['a runtime import edge', "import { a } from './a.js';", { specifiers: ['./a.js'] }],
        ['a re-export edge', "export { a } from './a.js';", { specifiers: ['./a.js'] }],
        ['a side-effect import edge', "import './styles.css';", { specifiers: ['./styles.css'] }],
        ['no edge for a type-only import', "import type { A } from './a.js';", { specifiers: [] }],
        ['no edge for a type-only re-export', "export type { A } from './a.js';", { specifiers: [] }],
        ['no edge when every specifier is type-only', "import { type A, type B } from './a.js';", { specifiers: [] }],
    ])('%s', (_label, contents, expected) => {
        expect(moduleFacts({ file: 'fixture.tsx', contents })).toMatchObject(expected);
    });
});

describe('serverGraphViolations — the walk', () => {
    /** A fixture graph: each module's facts, and `./name` resolving to `name`. */
    function walk(graph: Readonly<Record<string, Partial<ModuleFacts>>>, entries: readonly string[]) {
        return serverGraphViolations(
            entries,
            (file) => ({ usesClient: false, clientApis: [], specifiers: [], ...graph[file] }),
            (specifier) => {
                const name = specifier.replace(/^\.\//, '');

                return name in graph ? name : undefined;
            },
        );
    }

    it('⛔ flags a hook module reached TRANSITIVELY through a component with no directive (the CI failure)', () => {
        const { violations } = walk(
            {
                page: { specifiers: ['./index'] },
                index: { specifiers: ['./statement'] },
                statement: { specifiers: ['./dialogFocus'] },
                dialogFocus: { clientApis: ['react:useEffect'] },
            },
            ['page'],
        );

        expect(violations).toStrictEqual([
            { module: 'dialogFocus', apis: ['react:useEffect'], via: ['page', 'index', 'statement', 'dialogFocus'] },
        ]);
    });

    it('stops at a module that declares use client', () => {
        const { violations, reached } = walk(
            {
                page: { specifiers: ['./index'] },
                index: { specifiers: ['./statement'] },
                statement: { usesClient: true, specifiers: ['./dialogFocus'] },
                dialogFocus: { clientApis: ['react:useEffect'] },
            },
            ['page'],
        );

        expect(violations).toStrictEqual([]);
        expect([...reached]).toStrictEqual(['page', 'index']);
    });

    it('does not walk below a client ENTRY', () => {
        expect(walk({ page: { usesClient: true, clientApis: ['react:useState'] } }, ['page']).violations).toEqual([]);
    });

    it('flags the entry itself', () => {
        expect(walk({ page: { clientApis: ['react:useState'] } }, ['page']).violations).toHaveLength(1);
    });

    it('terminates on a cycle and reports each module once', () => {
        const { violations, reached } = walk(
            { a: { specifiers: ['./b'] }, b: { specifiers: ['./a'], clientApis: ['react:useRef'] } },
            ['a', 'b'],
        );

        expect(violations.map((violation) => violation.module)).toStrictEqual(['b']);
        expect(reached.size).toBe(2);
    });

    it('does not follow an edge the resolver places outside the source', () => {
        expect(walk({ page: { specifiers: ['./missing'] } }, ['page']).reached.size).toBe(1);
    });
});

describe('the web app’s server graph', () => {
    const { violations, reached } = realTreeWalk();

    it('reaches the shared feature packages through their exports (non-vacuity)', () => {
        expect(serverEntries().length).toBeGreaterThanOrEqual(10);
        expect(
            [...reached].some((file) => file.startsWith('packages/apps/commise/features/recipes/src/')),
            'the walk never crossed into @commise/features-recipes',
        ).toBe(true);
    });

    it('⛔ imports no client-only React API without a use client boundary above it', () => {
        expect(
            violations.map(({ module, apis, via }) => `${module} (${apis.join(', ')}) via ${via.join(' → ')}`),
        ).toEqual([]);
    });
});
