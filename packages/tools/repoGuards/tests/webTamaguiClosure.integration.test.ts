/**
 * G1, by resolution (ADR-0080): the web app never reaches Tamagui. `tamaguiImportRules` checks each module's own import
 * lines; this follows them. It builds the TypeScript program the web app's own `tsconfig.json` describes, rooted at its
 * production sources, and asserts that no file the program resolves belongs to `tamagui`, an `@tamagui/*` package, or
 * the design system's Tamagui config. A shared module that reached Tamagui through two innocent-looking hops would
 * pass the per-module rule and fail here.
 *
 * The web tsconfig resolves as a bundler with no `.native` suffix, so each `@commise/ui` subpath resolves to its web
 * leaf, the same file Next bundles. A first case proves the walk can fail: a module served from memory imports
 * `tamagui`, and must be flagged.
 */
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const TAMAGUI_FILE = /\/node_modules\/(?:tamagui|@tamagui\/[^/]+)\/|\/packages\/apps\/commise\/ui\/src\/tamagui\//u;

const TEST_OR_FIXTURE = /(?:\/(?:__tests__|__fixtures__|tests|test)\/)|(?:\.(?:test|spec)\.tsx?$)/u;

/**
 * Every file a program over `rootNames` resolves. Builds the program. `virtual` serves files that exist only in memory,
 * so a probe needs nothing written to the work tree.
 *
 * @sideEffect Reads the files the program resolves.
 */
function resolvedFiles(
    rootNames: readonly string[],
    options: ts.CompilerOptions,
    virtual: ReadonlyMap<string, string> = new Map(),
): readonly string[] {
    const compilerOptions = { ...options, noEmit: true, incremental: false };
    const host = ts.createCompilerHost(compilerOptions);
    const { fileExists, readFile, getSourceFile } = host;

    host.fileExists = (fileName) => virtual.has(fileName) || fileExists(fileName);
    host.readFile = (fileName) => virtual.get(fileName) ?? readFile(fileName);

    host.getSourceFile = (fileName, languageVersion, ...rest) => {
        const text = virtual.get(fileName);

        return text === undefined
            ? getSourceFile(fileName, languageVersion, ...rest)
            : ts.createSourceFile(fileName, text, languageVersion);
    };

    return ts
        .createProgram({ rootNames, options: compilerOptions, host })
        .getSourceFiles()
        .map((file) => file.fileName);
}

const tamaguiIn = (files: readonly string[]): readonly string[] => files.filter((file) => TAMAGUI_FILE.test(file));

describe('the web app never reaches Tamagui', () => {
    it('flags a module that imports Tamagui (the walk can fail)', () => {
        // Served from memory at a path inside this package, so resolution walks up to the repository's `node_modules`.
        const entry = path.join(repoRoot, 'packages/tools/repoGuards/tests/virtualTamaguiEntry.ts');
        const reached = tamaguiIn(
            resolvedFiles(
                [entry],
                { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true },
                new Map([[entry, `import { View } from 'tamagui';\nexport const used = View;\n`]]),
            ),
        );

        expect(reached.length).toBeGreaterThan(0);
    });

    it('resolves no Tamagui file from the web app’s production sources', { timeout: 300_000 }, () => {
        const configPath = path.join(repoRoot, 'packages/apps/commise/web/tsconfig.json');
        const parsed = ts.getParsedCommandLineOfConfigFile(
            configPath,
            {},
            {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
                },
            },
        );

        if (parsed === undefined) {
            throw new Error(`Could not read ${configPath}`);
        }

        const roots = parsed.fileNames.filter((file) => /\/web\/src\//u.test(file) && !TEST_OR_FIXTURE.test(file));

        const files = resolvedFiles(roots, parsed.options);

        expect(roots.length, 'the web app has production sources to walk').toBeGreaterThan(100);
        // The walk crossed into the design system, so a pass is not a walk that stopped at the app's edge.
        expect(files.some((file) => /\/packages\/apps\/commise\/ui\/src\/button\//u.test(file))).toBe(true);
        expect(tamaguiIn(files)).toEqual([]);
    });
});
