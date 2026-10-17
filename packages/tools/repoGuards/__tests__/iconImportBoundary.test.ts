/**
 * The icon boundary — screens name a MEANING from `@commise/ui/icon`, and only the icon Registry knows a glyph library
 * (`docs/architecture/uiOverhaulBlueprint.md` A9; `docs/design/uiOverhaul/buildSpec.md` §1.7, "no screen picks its own
 * glyph").
 *
 * Three rules, each read with the TypeScript parser so a comment, a string or a regex that mentions a package is never
 * mistaken for an import of it:
 *
 *  1. No module outside `packages/apps/commise/ui/src/icon/` imports `lucide-react` or `lucide-react-native` — value or
 *     type, static, re-exported, dynamic or `require`d. A type import counts: a screen that types against Lucide has
 *     picked the library, which is the decision the Registry owns.
 *  2. The native leaf reaches Lucide ONLY by deep path (`lucide-react-native/icons/<glyph>`). Metro does not tree-shake
 *     by default, so one root import ships every glyph Lucide has. And neither leaf crosses to the other platform's
 *     package.
 *  3. `@expo/vector-icons` is gone: no module imports it, no app manifest declares it and no Vitest config aliases it.
 *     Feather was the glyph set the Registry replaced (a ratchet from 29 that slice 2 took to 0); a surviving import is
 *     a screen choosing its own glyph again.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidates come from the FILESYSTEM; the specifier reader is proven against a fixture table
 * of every import shape below before it is trusted with the tree.
 *
 * ✅ THE FIX FOR A FAILURE: draw `<Icon name="…" />` from `@commise/ui/icon`. A meaning the Registry lacks is added to
 * `ui/src/icon/props.ts` and to BOTH glyph tables, which is a design decision for `staff-ux-engineer`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** The one folder allowed to know a glyph library. */
const REGISTRY_DIR = 'packages/apps/commise/ui/src/icon/';

/** The web and native glyph tables. */
const WEB_LEAF = `${REGISTRY_DIR}glyphs.ts`;
const NATIVE_LEAF = `${REGISTRY_DIR}glyphs.native.ts`;

/** The glyph-library packages, root or deep. */
const LUCIDE = /^lucide-react(-native)?(\/|$)/;

/** The Feather package the Registry replaced. */
const VECTOR_ICONS = /^@expo\/vector-icons(\/|$)/;

/**
 * Every module specifier a source file imports, in any form: `import`, `import type`, a side-effect import, `export …
 * from`, `import x = require()`, `require()` and dynamic `import()`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns The specifiers, in source order.
 */
function importedSpecifiers(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        }

        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            specifiers.push(node.moduleReference.expression.text);
        }

        if (ts.isCallExpression(node)) {
            const [first] = node.arguments;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;

            if ((isRequire || isDynamicImport) && first !== undefined && ts.isStringLiteralLike(first)) {
                specifiers.push(first.text);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return specifiers;
}

/**
 * Every app module on disk, sources AND tests AND configs: a test or a config that imports a glyph library is as much a
 * choice of glyph as a screen is. Build output and dependencies are not app modules.
 */
const appModules = (): readonly string[] =>
    globSync('packages/apps/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
        cwd: repoRoot,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**', '**/android/**', '**/ios/**'],
    }).sort();

/** The specifiers one app module imports. */
const specifiersOf = (file: string): readonly string[] =>
    importedSpecifiers(readFileSync(path.join(repoRoot, file), 'utf8'), file);

describe('the import reader', () => {
    // A guard is only as good as its reading of an import. Every shape a module can use to reach a package, plus the
    // shapes that mention one without importing it.
    const shapes: readonly { readonly name: string; readonly source: string; readonly expected: readonly string[] }[] =
        [
            { name: 'a named import', source: "import { House } from 'lucide-react';", expected: ['lucide-react'] },
            {
                name: 'a default import',
                source: "import H from 'lucide-react-native/icons/house';",
                expected: ['lucide-react-native/icons/house'],
            },
            { name: 'a namespace import', source: "import * as L from 'lucide-react';", expected: ['lucide-react'] },
            {
                name: 'a type-only import',
                source: "import type { LucideIcon } from 'lucide-react';",
                expected: ['lucide-react'],
            },
            { name: 'a side-effect import', source: "import 'lucide-react';", expected: ['lucide-react'] },
            { name: 'a re-export', source: "export { House } from 'lucide-react';", expected: ['lucide-react'] },
            {
                name: 'a star re-export',
                source: "export * from 'lucide-react-native';",
                expected: ['lucide-react-native'],
            },
            {
                name: 'an import-equals require',
                source: "import L = require('lucide-react');",
                expected: ['lucide-react'],
            },
            {
                name: 'a require call',
                source: "const L = require('@expo/vector-icons');",
                expected: ['@expo/vector-icons'],
            },
            {
                name: 'a dynamic import',
                source: "void import('@expo/vector-icons/Feather');",
                expected: ['@expo/vector-icons/Feather'],
            },
            { name: 'a comment', source: "// import { House } from 'lucide-react';\nexport {};", expected: [] },
            { name: 'a string', source: "export const name = 'lucide-react';", expected: [] },
            { name: 'a regex', source: 'export const deep = /^lucide-react-native\\/icons\\//;', expected: [] },
            { name: 'an object key', source: "export const alias = { '@expo/vector-icons': './stub' };", expected: [] },
        ];

    it.each(shapes)('reads $name', ({ source, expected }) => {
        expect(importedSpecifiers(source, 'fixture.tsx')).toEqual(expected);
    });
});

describe('the icon boundary', () => {
    it('discovers the app modules, including both glyph tables (a vacuous pass would hide every rule below)', () => {
        const modules = appModules();

        expect(modules.length).toBeGreaterThan(500);
        expect(modules).toContain(WEB_LEAF);
        expect(modules).toContain(NATIVE_LEAF);
    });

    it('reads Lucide in both glyph tables, so the reader sees the real files', () => {
        expect(specifiersOf(WEB_LEAF).filter((specifier) => LUCIDE.test(specifier))).not.toHaveLength(0);
        expect(specifiersOf(NATIVE_LEAF).filter((specifier) => LUCIDE.test(specifier))).not.toHaveLength(0);
    });

    it('lets no module outside the icon Registry import a glyph library', () => {
        const offenders = appModules()
            .filter((file) => !file.startsWith(REGISTRY_DIR))
            .flatMap((file) =>
                specifiersOf(file)
                    .filter((specifier) => LUCIDE.test(specifier))
                    .map((specifier) => `${file}: ${specifier}`),
            );

        expect(offenders).toEqual([]);
    });

    it('reaches lucide-react-native only by deep glyph path, from the native table only', () => {
        const offenders = appModules()
            .filter((file) => file.startsWith(REGISTRY_DIR))
            .flatMap((file) =>
                specifiersOf(file)
                    .filter((specifier) => specifier.startsWith('lucide-react-native'))
                    .filter(
                        (specifier) =>
                            file !== NATIVE_LEAF || !/^lucide-react-native\/icons\/[a-z0-9-]+$/.test(specifier),
                    )
                    .map((specifier) => `${file}: ${specifier}`),
            );

        expect(offenders).toEqual([]);
    });

    it('reaches lucide-react from the web table only', () => {
        const offenders = appModules()
            .filter((file) => file.startsWith(REGISTRY_DIR) && file !== WEB_LEAF)
            .flatMap((file) =>
                specifiersOf(file)
                    .filter((specifier) => /^lucide-react(\/|$)/.test(specifier))
                    .map((specifier) => `${file}: ${specifier}`),
            );

        expect(offenders).toEqual([]);
    });
});

describe('Feather is gone', () => {
    /**
     * The modules that import `@expo/vector-icons`. It was a RATCHET from 29 while the overhaul's slice 2 moved every
     * glyph onto the Registry; it reached 0 there, and stays 0.
     */
    it('is imported by no app module', () => {
        const importers = appModules().filter((file) =>
            specifiersOf(file).some((specifier) => VECTOR_ICONS.test(specifier)),
        );

        expect(importers).toEqual([]);
    });

    it('is declared by no app manifest', () => {
        const manifests = globSync('packages/apps/**/package.json', { cwd: repoRoot, ignore: ['**/node_modules/**'] });
        const declaring = manifests.filter((manifest) => {
            const json = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as Record<string, unknown>;

            return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => {
                const block = json[field];

                return typeof block === 'object' && block !== null && '@expo/vector-icons' in block;
            });
        });

        expect(manifests.length).toBeGreaterThan(3);
        expect(declaring).toEqual([]);
    });

    it('is aliased by no Vitest config, so no test can stand in for a glyph set the apps no longer draw', () => {
        const aliasing = appModules()
            .filter((file) => /vitest\.[a-z.]*config\.ts$/u.test(file))
            .filter((file) => readFileSync(path.join(repoRoot, file), 'utf8').includes("'@expo/vector-icons'"));

        expect(aliasing).toEqual([]);
    });
});
