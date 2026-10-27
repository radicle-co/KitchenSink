/**
 * `@commise/ui/testing/*` is test equipment, and runtime source must never import it. The package exports it (a test in
 * another workspace has no other way to reach `pressedPressable`, `withPlatformOs`, the stubbed `react-native`
 * scheme), so the export map cannot keep it out of an app bundle: a stray import from a component would ship a test
 * double, and some of them (`lucide-native`, `safe-area-context`) replace a real module.
 *
 * Allowed importers: a test (`__tests__/`, `tests/`, `test/`, `*.test.*`: already outside `appSourceModules`), the helpers
 * themselves (`ui/src/testing/`), the vitest configs (they name the shared setup shim), and the vitest SETUP files,
 * which are read out of those configs (`setupFiles: ['./…']`) and not listed here, so a new setup file is covered the
 * day it is configured.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript, through `appSources.ts`. Read with the
 * TypeScript parser: a comment that names the path is not an import.
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { APP_SOURCE_EXCLUDED, appSourceModules, parseModule } from './appSources.js';
import { presentFiles, repoRoot } from './serviceSources.js';

/** The test-equipment entry points: `@commise/ui/testing/<name>`. */
const TESTING_SPECIFIER = /^@commise\/ui\/testing\//u;

/** The helpers' own home: they may name each other by package path. */
const HELPERS_HOME = /^packages\/apps\/commise\/ui\/src\/testing\//u;

/**
 * The line of every module specifier that reaches `@commise/ui/testing/*`: a static import, a re-export, a dynamic
 * `import()`, or a `require()`. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 * @returns 1-based lines.
 */
export function testingImportLines(fileName: string, source: string): readonly number[] {
    const file = parseModule(fileName, source);
    const lines: number[] = [];

    const record = (specifier: ts.Expression | undefined): void => {
        if (specifier !== undefined && ts.isStringLiteralLike(specifier) && TESTING_SPECIFIER.test(specifier.text)) {
            lines.push(file.getLineAndCharacterOfPosition(specifier.getStart(file)).line + 1);
        }
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            record(node.moduleSpecifier);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
            record(node.arguments[0]);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            record(node.argument.literal as ts.Expression);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return lines;
}

/**
 * The relative `setupFiles` entries of a vitest config, as repo-relative paths. Pure.
 *
 * @param configPath - The config's repo-relative path.
 * @param source - Its text.
 */
export function relativeSetupFiles(configPath: string, source: string): readonly string[] {
    const file = parseModule(configPath, source);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'setupFiles' &&
            ts.isArrayLiteralExpression(node.initializer)
        ) {
            for (const element of node.initializer.elements) {
                if (ts.isStringLiteralLike(element) && element.text.startsWith('./')) {
                    found.push(path.posix.join(path.posix.dirname(configPath), element.text));
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

describe('the testing-import reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly lines: readonly number[] }[] = [
        {
            shape: 'a static import',
            source: `import { withPlatformOs } from '@commise/ui/testing/platform-os';`,
            lines: [1],
        },
        { shape: 'a side-effect import', source: `\nimport '@commise/ui/testing/screen-reader-shim';`, lines: [2] },
        { shape: 'a re-export', source: `export { rgb } from '@commise/ui/testing/system-color-scheme';`, lines: [1] },
        {
            shape: 'a dynamic import inside a mock factory',
            source: `vi.mock('x', async () => {\n  const m = await import('@commise/ui/testing/pressed-pressable');\n});`,
            lines: [2],
        },
        { shape: 'a require', source: `const m = require('@commise/ui/testing/lucide-native');`, lines: [1] },
        { shape: 'a type import', source: `type T = import('@commise/ui/testing/platform-os').NativeOs;`, lines: [1] },
        {
            shape: 'a comment that names the path',
            source: `// import { x } from '@commise/ui/testing/platform-os';\nexport const A = 1;`,
            lines: [],
        },
        {
            shape: 'a string that is not a module specifier',
            source: `export const A = '@commise/ui/testing/platform-os';`,
            lines: [],
        },
        { shape: 'another @commise/ui entry', source: `import { Button } from '@commise/ui/button';`, lines: [] },
        { shape: 'a lookalike package', source: `import { x } from '@commise/ui-testing/x';`, lines: [] },
    ];

    for (const { shape, source, lines } of cases) {
        it(`reads ${shape}`, () => {
            expect(testingImportLines('fixture.tsx', source)).toEqual(lines);
        });
    }
});

describe('the setup-file reader', () => {
    it('reads relative entries and skips package ones', () => {
        const source = `export default { test: { setupFiles: [jsdom, '@commise/ui/testing/screen-reader-shim', './vitest.setup.ts'] } };`;

        expect(relativeSetupFiles('packages/apps/commise/web/vitest.config.ts', source)).toEqual([
            'packages/apps/commise/web/vitest.setup.ts',
        ]);
    });
});

describe('apps keep test equipment out of runtime source', () => {
    const configs = presentFiles(['packages/apps']).filter((file) => /(?:^|\/)vitest\.[\w.]*config\.ts$/u.test(file));
    const setupFiles = new Set(
        configs.flatMap((config) => relativeSetupFiles(config, readFileSync(path.join(repoRoot, config), 'utf8'))),
    );
    // A setup file under `tests/` is already outside the discovery; one beside the config is not.
    const runtime = appSourceModules(['packages/apps'], APP_SOURCE_EXCLUDED).filter(
        (file) => !HELPERS_HOME.test(file) && !setupFiles.has(file) && !configs.includes(file),
    );

    it('discovers the vitest setup files and the runtime modules (a vacuous pass would hide the rule)', () => {
        expect(setupFiles.has('packages/apps/commise/features/recipes/vitest.setup.native.ts')).toBe(true);
        expect(runtime).toContain('packages/apps/commise/ui/src/button/Button.native.tsx');
        expect(runtime).not.toContain('packages/apps/commise/ui/src/testing/pressedPressable.ts');
    });

    it('lets no runtime module import @commise/ui/testing/*', () => {
        const offenders = runtime.flatMap((file) =>
            testingImportLines(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (line) => `${file}:${String(line)}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
