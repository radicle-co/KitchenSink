/**
 * Repo-wide guard: every TypeScript source a workspace owns is inside that workspace's TYPECHECK project
 * AND inside its LINT subject.
 *
 * ## The defect this exists to prevent
 *
 * Static analysis in a monorepo is opt-in twice over — once by a `tsconfig` `include`, once by whatever the
 * `lint` script happens to glob — and a file that misses either is checked by nothing while every gate stays
 * green. Measured on this branch before the sweep that landed with this guard: of 1782 tracked `.ts`/`.tsx`
 * sources, **140 were in no typecheck project and 551 were linted by nothing**. The worst of it was this very
 * package: `tsconfig.json` included only `bin/**` and `lib/**` and `lint` globbed only `lib/**`, so all 62
 * files of the repo-wide conformance layer — the G1–G6 service-security invariants, the W1–W5 infra wiring
 * checks, the boundaries ratchet, the contract-drift gate, cdk-nag attachment — were neither typechecked nor
 * linted. The layer that guards the repository was the one thing nothing guarded. `src/` was worse than the
 * tests: three DEPLOYED Lambda handlers (the per-PR database bootstrap and the sandbox nightly scheduler)
 * were compiled by nothing but `esbuild`, which does not typecheck at all.
 *
 * ## Why this asserts MEMBERSHIP and never compares globs
 *
 * The intuitive spelling is to read `include` and the `lint` glob and check they look wide enough. That check
 * passes while being wrong, which is the worst property a gate can have: a glob is a claim about a file tree,
 * and only the tree can settle it. `lib/**\/*.ts` looks correct next to a `lib/` directory and says nothing
 * about the `__tests__/` beside it.
 *
 * So each half asks the tool itself:
 *
 *  - TYPECHECK — {@link projectSources} hands the config to TypeScript's own config parser and reads back
 *    `fileNames`, the exact set `tsc` would load. EXPLICIT membership is required, not transitive: a file
 *    that is only in the program because a listed file imports it loses its coverage the moment that import
 *    goes, and nothing would report it.
 *  - LINT — {@link isLinted} asks ESLint, through its Node API, whether it would ignore the path under the
 *    package's real flat config. The `lint` SCRIPT is then pinned to the single canonical spelling
 *    `eslint .`, which is what removes the glob from the picture entirely: `.` cannot be narrower than the
 *    directory, so there is no pattern left to drift out of step with the tree.
 *
 * ## Non-vacuity
 *
 * Every walk here could pass by iterating nothing — a renamed directory, an empty discovery, an
 * `isPathIgnored` that answered `false` unconditionally. Discovery, subject counts and the discriminating
 * power of BOTH membership oracles are therefore asserted BEFORE the invariants that depend on them.
 *
 * ## Scope, stated so the green tick cannot be over-read
 *
 * The unit of accountability is a WORKSPACE, so a source that belongs to no workspace is outside every claim
 * below. Eleven tracked `.ts` files are in that position today and all eleven are outside `packages/`: ten
 * `specs/*\/contracts/*.ts` design sketches and one script inside the vendored `.specify/extensions/` plugin.
 * They have no package, no build and no consumer, which is why they are not swept in rather than given a
 * synthetic owner. What IS asserted — because it is the premise everything else rests on — is that nothing
 * under `packages/` is ownerless: a new source directory that slipped outside every `workspaces` glob would
 * otherwise be invisible to this guard in exactly the way `__tests__/` was invisible to `tsc`.
 *
 * ## The three recorded exemptions
 *
 * Each is PINNED by a predicate rather than merely subtracted, so a future `ignores` entry that quietly drops
 * a whole directory fails this guard instead of joining the exemption.
 *
 *  1. `*.d.ts` ({@link EXEMPT_REASONS}) — an ambient declaration has no statements to check and no emit.
 *  2. A workspace-ROOT `*.config.ts` tool manifest (`vitest.config.ts`, `playwright.config.ts`, …). Measured
 *     reason, not preference: most packages emit with `"rootDir": "src"`, and a root-level file cannot join a
 *     project rooted at `src` — `tsc` rejects it with TS6059 — so covering them means moving the emit layout
 *     of every published package to fix files that already fail loudly. A broken manifest is EXECUTED by its
 *     tool on the next run; an unchecked test file is silent forever, which is why the two are not the same
 *     risk. The shared ESLint config has excluded them since before this guard (`packages/tools/eslint`).
 *     A NON-root `*.config.ts` is ordinary source and IS covered — `src/sentry.server.config.ts` was real
 *     application code hidden by a `**\/*.config.*` ignore.
 *  3. LINT ONLY ({@link LINT_EXEMPT_REASONS}), for `packages/schemas/*\/src` — the generated wire-contract
 *     packages. This one exists because the OTHER gate is right and this one would otherwise fight it:
 *     `generated-schema-packages.test.ts` requires these packages to declare no `lint`/`format` script at all.
 *     Verified rather than taken on trust — every file there is the authoring service's file VERBATIM plus a
 *     `GENERATED FILE — DO NOT EDIT` banner (`diff` of `schemas/food/src/schemas/health.schema.ts` against
 *     `services/food-service/src/health/health.schema.ts` is the banner and nothing else), and the authored
 *     original IS in its service's lint subject. So the content is already linted; running a FIXER over the
 *     copy would rewrite it away from the original and red the regenerate-and-diff gate. The banner is
 *     asserted below, which is what stops the exemption from swallowing a hand-written file dropped into that
 *     directory. TYPECHECK is NOT exempted — generated zod that no longer compiles is a generation bug.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { minimatch } from 'minimatch';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** This file sits at `packages/infra/global/__tests__`, so the repo root is four levels up. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The one spelling of `lint` this repo accepts. See the header: a glob is what drifts, `.` cannot. */
const CANONICAL_LINT_SCRIPT = 'eslint .';

/** Extensions the guard holds to account. `.d.ts` is filtered separately (see {@link EXEMPT_REASONS}). */
const SOURCE_PATTERN = /\.tsx?$/;

/** Why a tracked TypeScript file may sit outside BOTH projects. Keys are the only admissible reasons. */
const EXEMPT_REASONS = {
    ambientDeclaration: (relativePath: string): boolean => relativePath.endsWith('.d.ts'),
    rootToolManifest: (relativePath: string): boolean => /^[^/]+\.config\.tsx?$/.test(relativePath),
} as const;

/**
 * Why a tracked TypeScript file may sit outside the LINT subject while still being typechecked. Takes the
 * REPO-relative path, because the only member is defined by where the package sits in the tree.
 */
const LINT_EXEMPT_REASONS = {
    generatedContractPackage: (repoRelativePath: string): boolean =>
        /^packages\/schemas\/[^/]+\/src\//.test(repoRelativePath),
} as const;

/** The banner every generated contract source carries — the proof that exemption 3 is not a hiding place. */
const GENERATED_BANNER = 'GENERATED FILE — DO NOT EDIT';

interface Workspace {
    /** Repo-relative package directory, POSIX separators. */
    readonly dir: string;
    /** The `name` field of its manifest. */
    readonly name: string;
    /** Its `scripts`, as written. */
    readonly scripts: Readonly<Record<string, string>>;
}

/**
 * Every tracked path matching the given git pathspecs that is ALSO present in the working tree.
 *
 * `git ls-files` reports the INDEX, which disagrees with the working tree during an unstaged deletion or a
 * half-finished rebase; a guard that throws in those states fails for reasons unrelated to what it checks.
 *
 * @param pathspecs - Git pathspecs to list.
 * @returns Repo-relative paths, `node_modules` excluded.
 * @sideEffect Shells out to git and stats the working tree.
 */
function trackedFiles(pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--', ...pathspecs], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
    })
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules/') && existsSync(path.join(repoRoot, file)));
}

/**
 * Every workspace, DISCOVERED by expanding the root manifest's own `workspaces` globs.
 *
 * The globs — not a hardcoded list and not a fixed `packages/*\/*` depth — because they are npm's definition
 * of what a package IS, so a package cannot exist without matching one, and the depths genuinely differ
 * (`packages/tools/vitest` is two deep, `packages/apps/commise/features/recipes` is four).
 *
 * @returns One entry per workspace that has a readable manifest, in path order.
 * @sideEffect Shells out to git and reads every workspace manifest.
 */
function discoverWorkspaces(): readonly Workspace[] {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        readonly workspaces?: readonly string[];
    };
    const globs = rootManifest.workspaces ?? [];

    return trackedFiles(['*/package.json'])
        .map((manifestPath) => ({ manifestPath, dir: path.posix.dirname(manifestPath) }))
        .filter(({ dir }) => globs.some((glob) => minimatch(dir, glob)))
        .map(({ manifestPath, dir }) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as {
                readonly name?: string;
                readonly scripts?: Record<string, string>;
            };

            return { dir, name: manifest.name ?? dir, scripts: manifest.scripts ?? {} };
        })
        .sort((left, right) => left.dir.localeCompare(right.dir));
}

const workspaces = discoverWorkspaces();
const workspaceDirs = workspaces.map((workspace) => workspace.dir);
const allSources = trackedFiles(['*.ts', '*.tsx']).filter((file) => SOURCE_PATTERN.test(file));

/**
 * The TypeScript files a workspace OWNS: under its directory, but not under a nested workspace's.
 *
 * The nesting filter is load-bearing — `packages/apps/commise` holds `web`, `mobile`, `ui`, `i18n` and the
 * `features/*` packages, each with its own projects, so without it every app's sources would be demanded of
 * its neighbours.
 *
 * @param workspace - The owning workspace.
 * @returns Repo-relative paths, in path order.
 */
function ownedSources(workspace: Workspace): readonly string[] {
    const nested = workspaceDirs.filter((dir) => dir !== workspace.dir && dir.startsWith(`${workspace.dir}/`));

    return allSources.filter(
        (file) => file.startsWith(`${workspace.dir}/`) && !nested.some((dir) => file.startsWith(`${dir}/`)),
    );
}

/** A subject is an owned source that no recorded exemption covers. */
function isExempt(workspace: Workspace, file: string): boolean {
    const relativePath = file.slice(workspace.dir.length + 1);

    return Object.values(EXEMPT_REASONS).some((applies) => applies(relativePath));
}

/** Exempt from the LINT half only — see exemption 3 in the header. */
function isLintExempt(workspace: Workspace, file: string): boolean {
    return isExempt(workspace, file) || Object.values(LINT_EXEMPT_REASONS).some((applies) => applies(file));
}

/**
 * The tsconfig projects a workspace's `typecheck` script actually compiles.
 *
 * Read off the SCRIPT rather than off the directory listing, because a `tsconfig.json` that no script names
 * checks nothing — several packages carry an `infra/tsconfig.json` that only a second `tsc` invocation
 * reaches, and one (`tsconfig.build.json`) exists precisely so the emit can be NARROWER than the check.
 *
 * @param workspace - The workspace whose script to read.
 * @returns Package-relative project paths, in invocation order.
 */
function typecheckProjects(workspace: Workspace): readonly string[] {
    const script = workspace.scripts['typecheck'];

    if (script === undefined) {
        return [];
    }

    return script
        .split(/&&|;/)
        .map((segment) => segment.trim())
        .filter((segment) => /^(?:npx\s+)?tsc\b/.test(segment))
        .map((segment) => /(?:-p|--project)\s+(\S+)/.exec(segment)?.[1] ?? 'tsconfig.json');
}

/** Memoised: `parseJsonConfigFileContent` walks the include globs across the whole package. */
const PROJECT_SOURCES = new Map<string, readonly string[]>();

/**
 * The files a tsconfig EXPLICITLY puts in its program, via TypeScript's own config parser.
 *
 * `fileNames` is what `tsc` itself resolves `files`/`include`/`exclude` to, so this cannot disagree with the
 * compiler the way a re-implemented glob match would. Transitive imports are deliberately NOT counted; see
 * the header.
 *
 * @param projectPath - Repo-relative path of the tsconfig.
 * @returns Repo-relative paths of its program's root files.
 * @sideEffect Reads the tsconfig and walks its include globs.
 */
function projectSources(projectPath: string): readonly string[] {
    const cached = PROJECT_SOURCES.get(projectPath);

    if (cached !== undefined) {
        return cached;
    }

    const absolute = path.join(repoRoot, projectPath);
    const read = ts.readConfigFile(absolute, ts.sys.readFile);

    if (read.error !== undefined) {
        throw new Error(
            `unreadable tsconfig ${projectPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
        );
    }

    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute), undefined, absolute);
    const files = parsed.fileNames.map((file) => path.relative(repoRoot, file).split(path.sep).join('/'));

    PROJECT_SOURCES.set(projectPath, files);

    return files;
}

/** Every file any of a workspace's typecheck projects loads. */
function typecheckedSources(workspace: Workspace): ReadonlySet<string> {
    return new Set(
        typecheckProjects(workspace).flatMap((project) => projectSources(path.posix.join(workspace.dir, project))),
    );
}

/** One `ESLint` instance per workspace; constructing it loads and builds that package's flat config. */
const LINTERS = new Map<string, ESLint>();

/**
 * Whether ESLint, under the workspace's real flat config, would lint the file rather than ignore it.
 *
 * ESLint's own API is the oracle on purpose: `ignores` composes across every config block a package spreads
 * in, and re-deriving that composition here would be a second implementation to keep in step.
 *
 * A package with NO `eslint.config.js` reports `false` for every file rather than throwing. That state is the
 * finding, not an error: the three `packages/schemas/*` contract packages had neither a config nor a `lint`
 * script, so 32 files of published wire contract were linted by nothing — and a guard that crashes on the
 * worst case reports the worst case least clearly.
 *
 * @param workspace - The owning workspace.
 * @param file - Repo-relative path.
 * @returns True when the file is in ESLint's subject set.
 * @sideEffect Loads the workspace's ESLint configuration on first use.
 */
async function isLinted(workspace: Workspace, file: string): Promise<boolean> {
    const cwd = path.join(repoRoot, workspace.dir);
    let linter = LINTERS.get(workspace.dir);

    if (linter === undefined) {
        linter = new ESLint({ cwd });
        LINTERS.set(workspace.dir, linter);
    }

    try {
        return !(await linter.isPathIgnored(path.join(repoRoot, file)));
    } catch {
        return false;
    }
}

/** Workspaces that own at least one TypeScript subject — the ones both invariants apply to. */
const typedWorkspaces = workspaces.filter((workspace) =>
    ownedSources(workspace).some((file) => !isExempt(workspace, file)),
);

describe('static-analysis coverage', () => {
    // ---------------------------------------------------------------- non-vacuity

    it('discovers the workspaces from the root manifest globs, at every nesting depth', () => {
        expect(workspaces.length).toBeGreaterThanOrEqual(36);
        expect(workspaceDirs).toContain('packages/infra/global');
        expect(workspaceDirs).toContain('packages/schemas/recipe');
        expect(workspaceDirs).toContain('packages/apps/commise/web');
        expect(workspaceDirs).toContain('packages/apps/commise/features/recipes');
        expect(typedWorkspaces.length).toBeGreaterThanOrEqual(29);
    });

    it('collects a plausible subject set, including this guard itself', () => {
        const subjects = typedWorkspaces.flatMap((workspace) =>
            ownedSources(workspace).filter((file) => !isExempt(workspace, file)),
        );

        expect(subjects.length).toBeGreaterThanOrEqual(1700);
        expect(subjects).toContain('packages/infra/global/__tests__/static-analysis-coverage.test.ts');
        expect(subjects).toContain('packages/infra/global/src/sandbox-scheduler/handler.ts');
        // Every subject belongs to exactly one workspace, so no file can be double-counted into coverage.
        expect(new Set(subjects).size).toBe(subjects.length);
    });

    it('exempts only ambient declarations and workspace-root tool manifests', () => {
        const exempted = workspaces.flatMap((workspace) =>
            ownedSources(workspace)
                .filter((file) => isExempt(workspace, file))
                .map((file) => file.slice(workspace.dir.length + 1)),
        );

        // Discriminating in both directions: the two recorded shapes qualify, ordinary source never does.
        expect(EXEMPT_REASONS.rootToolManifest('vitest.config.ts')).toBe(true);
        expect(EXEMPT_REASONS.rootToolManifest('src/sentry.server.config.ts')).toBe(false);
        expect(EXEMPT_REASONS.ambientDeclaration('src/env.d.ts')).toBe(true);
        expect(EXEMPT_REASONS.ambientDeclaration('src/env.ts')).toBe(false);
        expect(exempted.filter((file) => !/(\.d\.ts|^[^/]+\.config\.tsx?)$/.test(file))).toEqual([]);
    });

    /**
     * Exemption 3 is the only one that excuses a whole DIRECTORY, so it is the only one that could hide a
     * hand-written file. It cannot: the excuse is "this is a verbatim copy of a source that is linted where it
     * was authored", and the banner is what makes a file a copy. A file dropped in there without one fails here.
     */
    it('lint-exempts the generated contract sources only while every one of them is generated', () => {
        const generated = workspaces.flatMap((workspace) =>
            ownedSources(workspace).filter((file) => LINT_EXEMPT_REASONS.generatedContractPackage(file)),
        );

        expect(LINT_EXEMPT_REASONS.generatedContractPackage('packages/schemas/food/src/index.ts')).toBe(true);
        expect(LINT_EXEMPT_REASONS.generatedContractPackage('packages/clients/food-service/src/index.ts')).toBe(false);
        // Non-vacuity: three contract packages, none of them empty.
        expect(generated.length).toBeGreaterThanOrEqual(30);
        expect(
            generated.filter((file) => !readFileSync(path.join(repoRoot, file), 'utf8').includes(GENERATED_BANNER)),
            'This file is in a generated contract package but is not generated, so nothing lints it. Author it ' +
                'in the owning service instead.',
        ).toEqual([]);
    });

    /**
     * The premise every assertion below rests on: accountability is per-workspace, so a source under
     * `packages/` that matches no `workspaces` glob is answerable to nothing. This is the walk that would
     * otherwise iterate zero times over a whole directory without anyone noticing.
     */
    it('leaves no source under packages/ without an owning workspace', () => {
        const owned = new Set(typedWorkspaces.flatMap((workspace) => ownedSources(workspace)));

        expect(
            allSources.filter((file) => file.startsWith('packages/') && !file.endsWith('.d.ts') && !owned.has(file)),
            'This file is under packages/ but inside no workspace, so no package.json script reaches it. Move ' +
                'it into a workspace, or add the directory to the root manifest `workspaces` globs.',
        ).toEqual([]);
    });

    it('the typecheck oracle discriminates: it reports real members and rejects a fabrication', () => {
        const members = typecheckedSources({
            dir: 'packages/infra/global',
            name: '@kitchensink/infra-global',
            scripts: { typecheck: 'tsc --noEmit' },
        });

        expect(members.has('packages/infra/global/lib/platform/network-stack.ts')).toBe(true);
        expect(members.has('packages/infra/global/no-such-file.ts')).toBe(false);
    });

    it('the lint oracle discriminates: build output is ignored, real source is not', async () => {
        const self = { dir: 'packages/infra/global', name: '@kitchensink/infra-global', scripts: {} };

        expect(await isLinted(self, 'packages/infra/global/lib/platform/network-stack.ts')).toBe(true);
        expect(await isLinted(self, 'packages/infra/global/dist/platform/network-stack.ts')).toBe(false);
    });

    // ---------------------------------------------------------------- the invariants

    it('every workspace that owns TypeScript declares a typecheck script', () => {
        expect(
            typedWorkspaces
                .filter((workspace) => workspace.scripts['typecheck'] === undefined)
                .map((workspace) => workspace.name),
        ).toEqual([]);
    });

    it('spells every lint script the one canonical way, so no glob can narrow it', () => {
        // The generated contract packages declare no `lint` at all, by exemption 3 and by the standing decision
        // in `generated-schema-packages.test.ts`. Every other workspace that owns a lint SUBJECT must have one.
        expect(
            typedWorkspaces
                .filter((workspace) => ownedSources(workspace).some((file) => !isLintExempt(workspace, file)))
                .filter((workspace) => workspace.scripts['lint'] !== CANONICAL_LINT_SCRIPT)
                .map((workspace) => `${workspace.name}: ${workspace.scripts['lint']}`),
        ).toEqual([]);
    });

    it('puts every TypeScript source in a typecheck project', () => {
        const uncovered: string[] = [];

        for (const workspace of typedWorkspaces) {
            const covered = typecheckedSources(workspace);

            for (const file of ownedSources(workspace)) {
                if (!isExempt(workspace, file) && !covered.has(file)) {
                    uncovered.push(file);
                }
            }
        }

        expect(
            uncovered,
            "Add the file's directory to the package's typecheck tsconfig `include` — a source in no project " +
                'is checked by nothing, and ESLint cannot run a type-aware rule on it either.',
        ).toEqual([]);
    });

    it('puts every TypeScript source in the lint subject', async () => {
        const uncovered: string[] = [];

        for (const workspace of typedWorkspaces) {
            for (const file of ownedSources(workspace)) {
                if (!isLintExempt(workspace, file) && !(await isLinted(workspace, file))) {
                    uncovered.push(file);
                }
            }
        }

        expect(
            uncovered,
            'An `ignores` entry in the package ESLint config is hiding these. Narrow it, or record the reason ' +
                'in EXEMPT_REASONS above — silently ignored source is the defect this guard exists for.',
        ).toEqual([]);
    }, 120_000);
});
