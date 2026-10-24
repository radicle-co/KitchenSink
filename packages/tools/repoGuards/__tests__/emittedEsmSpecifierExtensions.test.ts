/**
 * Repo-wide guard: every relative `import`/`export … from` specifier in EMITTED ESM names a file extension
 * Node can load.
 *
 * ## The defect this exists to prevent
 *
 * `packages/services/identity/src/auth/decorators/index.ts` re-exported from `./currentUser.decorator` —
 * no `.js`. The package is `"type": "module"` and its build is `nest build` under `module: preserve`, so
 * `tsc` emits that specifier verbatim, and Node's ESM resolver performs no extension search: the first
 * `import` of the compiled file is `ERR_MODULE_NOT_FOUND`. Nothing stood in the way:
 *
 *  - TypeScript enforces the rule (TS2835) ONLY under `moduleResolution: NodeNext`. The three NestJS
 *    services deliberately use `Bundler` (for `nest build`), which accepts the extensionless form and
 *    resolves it happily against the `.ts` on disk.
 *  - ESLint's `import-x/extensions` cannot express it. With the shared config's `.js → .ts` resolver alias
 *    it reports every CORRECT `./x.js` specifier as `Missing file extension "ts"` (measured: 8 false errors
 *    across identity's already-conformant files), and the `{ ts: 'never' }` variant silences the genuine
 *    miss along with the false ones.
 *  - The barrel had no importer, so no test ever loaded it. It was latent — one `from './decorators'` away
 *    from a crash at container start, in production.
 *
 * ## What is asserted
 *
 * For every workspace that is `"type": "module"` AND whose build project EMITS (`noEmit` unset), every
 * relative specifier in the files that project compiles ends in one of {@link LOADABLE_EXTENSIONS}. Two
 * choices keep this from being a hand-rolled linter:
 *
 *  - The FILE SET is TypeScript's own answer — `tsconfig.build.json` when present, else `tsconfig.json`,
 *    parsed by the compiler's config reader — so it is exactly what `tsc`/`nest build` would emit, test
 *    exclusions included.
 *  - The SPECIFIERS come from TypeScript's parser (`ImportDeclaration`, `ExportDeclaration`, `import()`),
 *    not a regex over source text.
 *
 * `.ts`/`.tsx` are NOT loadable: the shared ESLint config already bans them, and they would be equally
 * unresolvable after emit. `noEmit` projects (`@commise/web`, `@commise/mobile`) are outside the claim by
 * construction — Next and Metro resolve their extensionless imports, and they carry 250+ of them
 * legitimately. NodeNext projects are INSIDE it even though `tsc` already polices them: the predicate is
 * about what Node will load, and a resolution-mode carve-out is exactly the seam a package falls through
 * when it flips to `Bundler` later.
 *
 * ## Non-vacuity
 *
 * Discovery must find the population TypeScript does not protect (the Bundler-resolution NestJS services)
 * and a non-trivial file count. The extractor is asserted against the exact shape that fooled a first draft
 * of this guard: `./currentUser.decorator` has a dot in its last segment, so `path.extname` reports the
 * extension `.decorator` and an "any extension" check waves it through.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** What Node's ESM loader (and the JSON/JSX paths TypeScript rewrites to) can actually open after emit. */
export const LOADABLE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.json'] as const;

/** An emitting ESM workspace and the files its build project compiles. */
interface EmittingEsmProject {
    /** Repo-relative workspace directory. */
    readonly dir: string;
    readonly name: string;
    /** Repo-relative path of the build project used. */
    readonly project: string;
    readonly moduleResolution: string;
    /** Absolute paths of the files the project compiles, declaration files excluded. */
    readonly fileNames: readonly string[];
}

/** One relative specifier without a loadable extension. */
interface Violation {
    /** Repo-relative file. */
    readonly file: string;
    readonly specifier: string;
}

/**
 * Whether a relative specifier would fail Node's ESM resolution after emit. Pure.
 *
 * Deliberately NOT `path.extname(specifier) === ''`: `./currentUser.decorator` has the "extension"
 * `.decorator` under that reading, and Node would still look for a file literally named
 * `currentUser.decorator`.
 *
 * @param specifier - A module specifier starting with `./` or `../`.
 * @returns `true` when no loadable extension terminates it.
 */
export function lacksLoadableExtension(specifier: string): boolean {
    return !LOADABLE_EXTENSIONS.some((extension) => specifier.endsWith(extension));
}

/**
 * Every relative module specifier in a source text, via TypeScript's parser. Pure.
 *
 * Covers static `import … from`, `export … from`, and `import('…')` with a string-literal argument. A
 * template or computed `import()` argument is not a specifier this guard can judge and is left alone.
 *
 * @param fileName - Used only to pick the script kind (`.tsx` vs `.ts`).
 * @param sourceText - The file's contents.
 * @returns The relative specifiers, in source order, duplicates kept.
 */
export function relativeSpecifiers(fileName: string, sourceText: string): readonly string[] {
    const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false);
    const found: string[] = [];

    const record = (expression: ts.Expression | undefined): void => {
        if (expression !== undefined && ts.isStringLiteral(expression) && expression.text.startsWith('.')) {
            found.push(expression.text);
        }
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            record(node.moduleSpecifier);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            record(node.arguments[0]);
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
}

/**
 * Every workspace whose emitted output is ESM: `"type": "module"` in its manifest and a build project that
 * does not set `noEmit`.
 *
 * Workspaces are the root manifest's own `workspaces` globs, so a package cannot be in the tree and outside
 * this discovery. The build project is `tsconfig.build.json` when the package has one (that is what
 * `nest build` and `tsc -p tsconfig.build.json` compile), else `tsconfig.json`.
 *
 * @returns One entry per emitting ESM workspace, in path order.
 * @sideEffect Shells out to git and reads every workspace manifest and tsconfig.
 */
function discoverEmittingEsmProjects(): readonly EmittingEsmProject[] {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        readonly workspaces?: readonly string[];
    };
    const globs = rootManifest.workspaces ?? [];

    return presentFiles(['packages/*/package.json'])
        .map((manifestPath) => ({ manifestPath, dir: path.posix.dirname(manifestPath) }))
        .filter(({ dir }) => globs.some((glob) => minimatch(dir, glob)))
        .flatMap(({ manifestPath, dir }) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as {
                readonly name?: string;
                readonly type?: string;
            };

            if (manifest.type !== 'module') {
                return [];
            }

            const project = ['tsconfig.build.json', 'tsconfig.json']
                .map((candidate) => path.posix.join(dir, candidate))
                .find((candidate) => existsSync(path.join(repoRoot, candidate)));

            if (project === undefined) {
                return [];
            }

            const absolute = path.join(repoRoot, project);
            const read = ts.readConfigFile(absolute, ts.sys.readFile);

            if (read.error !== undefined) {
                throw new Error(
                    `unreadable tsconfig ${project}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
                );
            }

            const parsed = ts.parseJsonConfigFileContent(
                read.config,
                ts.sys,
                path.dirname(absolute),
                undefined,
                absolute,
            );

            if (parsed.options.noEmit === true) {
                return [];
            }

            return [
                {
                    dir,
                    name: manifest.name ?? dir,
                    project,
                    moduleResolution: ts.ModuleResolutionKind[parsed.options.moduleResolution ?? 0] ?? 'unset',
                    fileNames: parsed.fileNames.filter((file) => !file.endsWith('.d.ts')),
                },
            ];
        })
        .sort((left, right) => left.dir.localeCompare(right.dir));
}

/**
 * Every extensionless relative specifier a project would emit.
 *
 * @param project - The project to scan.
 * @returns The violations, in file then source order.
 * @sideEffect Reads every file the project compiles.
 */
function violationsIn(project: EmittingEsmProject): readonly Violation[] {
    return project.fileNames.flatMap((file) =>
        relativeSpecifiers(file, readFileSync(file, 'utf8'))
            .filter(lacksLoadableExtension)
            .map((specifier) => ({ file: path.relative(repoRoot, file).split(path.sep).join('/'), specifier })),
    );
}

const projects = discoverEmittingEsmProjects();

describe('emitted ESM relative specifiers carry a loadable extension', () => {
    describe('non-vacuity', () => {
        it('discovers the Bundler-resolution NestJS services — the population TypeScript does not police', () => {
            const bundlerServices = projects
                .filter((project) => project.moduleResolution === 'Bundler')
                .map((project) => project.name);

            expect(bundlerServices).toEqual(
                expect.arrayContaining([
                    '@kitchensink/identity-service',
                    '@kitchensink/recipe-service',
                    '@kitchensink/food-service',
                ]),
            );
        });

        it('parses a non-trivial file set through the compiler, not a glob', () => {
            const total = projects.reduce((sum, project) => sum + project.fileNames.length, 0);

            expect(projects.length).toBeGreaterThanOrEqual(20);
            expect(total).toBeGreaterThan(500);
        });

        it('the extractor sees every specifier form and the extension check is not `path.extname`', () => {
            const fixture = [
                "export { CurrentAuthorizerContext } from './currentUser.decorator';",
                "export type { AuthorizerContext } from './currentUser.decorator';",
                "import { ok } from './fine.js';",
                "import type { T } from '../types/index.js';",
                "import data from './data.json';",
                "const lazy = () => import('./lazy');",
                "import { pkg } from '@kitchensink/identity-core';",
            ].join('\n');

            expect(relativeSpecifiers('fixture.ts', fixture)).toEqual([
                './currentUser.decorator',
                './currentUser.decorator',
                './fine.js',
                '../types/index.js',
                './data.json',
                './lazy',
            ]);

            expect(path.extname('./currentUser.decorator')).toBe('.decorator');
            expect(lacksLoadableExtension('./currentUser.decorator')).toBe(true);
            expect(lacksLoadableExtension('./lazy')).toBe(true);
            expect(lacksLoadableExtension('./fine.js')).toBe(false);
            expect(lacksLoadableExtension('./data.json')).toBe(false);
            expect(lacksLoadableExtension('./bad.ts')).toBe(true);
        });
    });

    it.each(projects.map((project) => [project.name, project] as const))(
        '%s: every relative specifier it emits is resolvable by Node',
        (_name, project) => {
            const violations = violationsIn(project);

            expect(
                violations,
                `${project.project} emits ESM (moduleResolution: ${project.moduleResolution}); after ` +
                    `build these specifiers are ERR_MODULE_NOT_FOUND under Node. Add the .js extension:\n` +
                    violations.map((violation) => `  ${violation.file} -> '${violation.specifier}'`).join('\n'),
            ).toEqual([]);
        },
    );
});
