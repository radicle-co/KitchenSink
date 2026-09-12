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
 *     `generatedSchemaPackages.test.ts` requires these packages to declare no `lint`/`format` script at all.
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

/**
 * Packages that carry a manifest but are DELIBERATELY outside the root `workspaces` globs — every CDK app,
 * plus the shared constructs they install.
 *
 * ⛔ They are not an exemption. Infra installs on its own precisely so 149 MB of `aws-cdk-lib` stops being
 * hoisted into the root tree and shipped inside every service image; the cost is that `turbo run lint` and
 * `turbo run typecheck` cannot see them, because turbo walks the workspace. `cdk-checks` in `_ci.yml` is what
 * checks them instead, and {@link infraCheckSubjects} asserts it actually reaches each one — so a source here
 * is still owned and still checked, just by a different job.
 */
function discoverStandalonePackages(): readonly string[] {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        readonly workspaces?: readonly string[];
    };
    const globs = rootManifest.workspaces ?? [];

    return (
        trackedFiles(['*/package.json'])
            .map((manifestPath) => path.posix.dirname(manifestPath))
            // ⚠️ Fixture manifests are not packages. `__tests__/__fixtures__/devRunnerProbe` exists to be READ by a
            // guard, never installed — counting it would demand `cdk-checks` install a fixture.
            .filter((dir) => !/(^|\/)(__tests__|__fixtures__|fixtures)(\/|$)/.test(dir))
            .filter((dir) => dir !== '.' && !globs.some((glob) => minimatch(dir, glob)))
            .sort()
    );
}

const standaloneDirs = discoverStandalonePackages();

/** TypeScript sources owned by a standalone package — checked by `deploy-infra.yml`, not by a turbo task. */
function standaloneSources(): readonly string[] {
    return allSources.filter((file) => standaloneDirs.some((dir) => file.startsWith(`${dir}/`)));
}

/**
 * The infra directories `deploy-infra.yml` covers — read from its JOB LIST, not restated here.
 *
 * ⚠️ REWRITTEN. This used to read a `globs=` assignment out of `cdk-checks`, a single job that installed
 * every CDK package in a loop. That job is gone: each `infra/` folder now has its own explicit job, which
 * installs its own dependencies in the directory that owns them, and synths as well as typechecks.
 *
 * ⛔ A HAND-WRITTEN LIST IS THE POINT, and it is safe only because of the case below. The old comment here
 * warned that "a hand-listed set goes stale silently" — correct, and the answer is not to go back to a glob
 * but to make staleness LOUD: the case below enumerates the standalone packages on disk and fails if any
 * of them has no job — and fails the other way too, if a job names a directory that is not one. Explicit and
 * complete beats implicit and unverifiable.
 */
function infraCheckSubjects(): readonly string[] {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows/deploy-infra.yml'), 'utf8');

    return [...workflow.matchAll(/^\s*directory:\s*(\S+)\s*$/gmu)].map((match) => match[1] ?? '');
}

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
    // ⚠️ A nested STANDALONE package is excluded for the same reason a nested workspace is: it owns its own
    // sources. Every service's `infra/` is one now — it installs outside the npm workspace so `aws-cdk-lib`
    // never reaches the root tree — and its files are typechecked and linted by that package's own config in
    // `cdk-checks`, never by the service's. Counting them here reported a service as hiding 12 sources it
    // does not own.
    const nested = [...workspaceDirs, ...standaloneDirs].filter(
        (dir) => dir !== workspace.dir && dir.startsWith(`${workspace.dir}/`),
    );

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
        // ⚠️ `packages/infra/global` used to anchor this list. It is STANDALONE now — infra installs on its
        // own so aws-cdk-lib stops reaching the service images — so it anchors the standalone set instead,
        // and the nesting claim moves to a workspace that is still nested three deep.
        expect(standaloneDirs).toContain('packages/infra/global');
        expect(standaloneDirs).toContain('shared/infra');
        expect(workspaceDirs).toContain('packages/schemas/recipe');
        expect(workspaceDirs).toContain('packages/apps/commise/web');
        expect(workspaceDirs).toContain('packages/apps/commise/features/recipes');
        expect(typedWorkspaces.length).toBeGreaterThanOrEqual(29);
    });

    it('collects a plausible subject set, including this guard itself', () => {
        const subjects = typedWorkspaces.flatMap((workspace) =>
            ownedSources(workspace).filter((file) => !isExempt(workspace, file)),
        );

        // ⚠️ Lowered from 1700 with the reason stated: `packages/infra/global` left the workspace, taking its
        // ~150 sources out of TURBO's subject set. They are not unchecked — `cdk-checks` runs eslint there,
        // asserted above — but they are no longer counted here, and a floor that still claimed 1700 would be
        // asserting against a tree that no longer exists.
        expect(subjects.length).toBeGreaterThanOrEqual(1500);
        // This guard's own file now lives in a standalone package, so it anchors that set instead.
        expect(standaloneSources()).toContain('packages/infra/global/__tests__/staticAnalysisCoverage.test.ts');
        expect(subjects).toContain('packages/services/recipe-service/src/main.ts');
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
    it('leaves no source under packages/ without an owning package', () => {
        const owned = new Set(typedWorkspaces.flatMap((workspace) => ownedSources(workspace)));
        // ⚠️ A standalone package owns its sources too. It is checked by `cdk-checks` rather than by a turbo
        // task, which the next case asserts — so "ownerless" still means "checked by nothing", not merely
        // "outside the workspace".
        const inStandalone = (file: string): boolean => standaloneDirs.some((dir) => file.startsWith(`${dir}/`));

        expect(
            allSources.filter(
                (file) =>
                    file.startsWith('packages/') && !file.endsWith('.d.ts') && !owned.has(file) && !inStandalone(file),
            ),
            'This file is under packages/ but inside no package, so nothing reaches it. Move it into a ' +
                'workspace, add the directory to the root `workspaces` globs, or give it its own manifest ' +
                'and make sure `cdk-checks` discovers it.',
        ).toEqual([]);
    });

    it('gives every standalone package its OWN job, since turbo cannot see them', () => {
        const subjects = infraCheckSubjects();

        // Non-vacuity: infra really did leave the workspace, and the workflow really does name directories.
        expect(standaloneDirs.length).toBeGreaterThan(0);
        expect(subjects.length).toBeGreaterThan(0);

        const unreached = standaloneDirs.filter((dir) => !subjects.includes(dir));

        expect(
            unreached,
            'This package is outside the workspace AND has no job in `deploy-infra.yml`, so nothing ' +
                'installs, typechecks, tests or synths it — the silent-green this file exists to prevent. ' +
                'Add a job for it; the list is deliberately explicit, and this case is what keeps it honest.',
        ).toEqual([]);

        // ⛔ AND THE OTHER DIRECTION. A job naming a directory that no longer exists is a job that installs
        // nothing and passes, which reads exactly like coverage. The old glob could not express this.
        expect(
            subjects.filter((dir) => !standaloneDirs.includes(dir)),
            'This job names a directory that is not a standalone package — it would pass having checked nothing.',
        ).toEqual([]);
    });

    /**
     * ⛔ THE TWO HOLES THE PREVIOUS CASE CANNOT SEE. It proves `cdk-checks` REACHES each standalone package;
     * it says nothing about whether reaching it accomplishes anything. Both failures below shipped, and both
     * were found by hand rather than by this file:
     *
     * - `ingredient-parser/infra/tsconfig.json` listed `smoke/**` and `__tests__/**` in `include` AND listed
     *   `smoke` and `__tests__/deployedSmoke.test.ts` in `exclude`. Exclude wins, so two files sat in no
     *   project — unchecked by `tsc`, and rejected by eslint's typed rules as "not found in any of the
     *   provided project(s)".
     * - Six of the eight standalone packages carried NO eslint config at all. `cdk-checks` runs
     *   `npx eslint . || echo "::warning::"`, so "couldn't find a configuration file" exits non-zero into a
     *   warning nobody reads, and every source in those directories was silently unlinted while this file
     *   still counted them as covered.
     *
     * Both are the same shape: the job runs, the job is green, and the check did not happen. Asserting
     * discovery without asserting capability is how a coverage guard reports coverage that does not exist.
     */
    it.each(standaloneDirs.map((dir) => [dir] as const))(
        '%s — a standalone package actually checks its OWN sources, not merely gets visited',
        (dir) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
                readonly name?: string;
                readonly scripts?: Readonly<Record<string, string>>;
            };
            const covered = typecheckedSources({
                dir,
                name: manifest.name ?? dir,
                scripts: manifest.scripts ?? {},
            });
            const owned = allSources.filter(
                (file) =>
                    file.startsWith(`${dir}/`) &&
                    !standaloneDirs.some(
                        (other) => other !== dir && other.startsWith(`${dir}/`) && file.startsWith(`${other}/`),
                    ),
            );

            // Non-vacuity: a package with no sources would satisfy every assertion below by having nothing
            // to violate them, which is the failure mode this whole file exists to refuse.
            expect(owned.length, `${dir} has no TypeScript sources — this case would prove nothing`).toBeGreaterThan(0);

            expect(
                owned.filter((file) => !covered.has(file)),
                `These sources are in no typecheck project. \`cdk-checks\` runs \`tsc -p tsconfig.json\` in ` +
                    `${dir}, so a file its \`include\`/\`exclude\` does not admit is checked by nothing — and ` +
                    `an \`exclude\` entry silently beats an \`include\` glob that matches the same path.`,
            ).toEqual([]);

            expect(
                existsSync(path.join(repoRoot, dir, 'eslint.config.js')) ||
                    existsSync(path.join(repoRoot, dir, 'eslint.config.mjs')),
                `${dir} has no eslint config, so \`npx eslint .\` there fails to find one. \`cdk-checks\` ` +
                    `swallows that into a \`::warning::\`, so the package reads as linted and is not.`,
            ).toBe(true);
        },
    );

    /**
     * ⛔ THE THIRD SURFACE OF ONE DEFECT, and the reason it is asserted rather than just fixed. Moving CDK
     * out of the npm workspace silently detached it from all three static checks in turn — typecheck, lint,
     * and now test EXECUTION. Each looked fine locally, because a developer's `infra/node_modules` already
     * holds `aws-cdk-lib`; each failed in CI, where the root install does not reach a non-workspace package.
     *
     * The test half is the dangerous one: the service's vitest still collected `infra/__tests__/**`, so 426
     * CDK assertions ran against a dependency the workspace no longer supplies. Deleting the include would
     * have "fixed" CI by silently deleting all 426 — passing loudly is recoverable, vanishing is not.
     *
     * So both halves are asserted: a standalone package that owns unit tests must declare the `test` script
     * `cdk-checks` invokes, and the workspace beside it must not reach in and collect them with dependencies
     * it cannot resolve.
     */
    it.each(standaloneDirs.map((dir) => [dir] as const))(
        '%s — owns its unit tests, and the workspace beside it does not collect them',
        (dir) => {
            const units = trackedFiles(['*.test.ts']).filter(
                (file) => file.startsWith(`${dir}/`) && file.includes('__tests__/'),
            );

            if (units.length === 0) {
                return;
            }

            const manifest = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
                readonly scripts?: Readonly<Record<string, string>>;
            };

            expect(
                manifest.scripts?.['test'],
                `${dir} has ${units.length} unit suites and no \`test\` script. \`cdk-checks\` runs \`npm test\` ` +
                    `only where one is declared, so these suites would execute NOWHERE — and a suite that ` +
                    `never runs is indistinguishable from a suite that passes.`,
            ).toBeDefined();

            // The owning workspace must not reach across the boundary. `aws-cdk-lib` installs in the
            // standalone package, so a config that collects these files resolves nothing in CI.
            const ownerConfig = path.join(repoRoot, path.posix.dirname(dir), 'vitest.config.ts');

            if (existsSync(ownerConfig)) {
                // ⚠️ Comments are stripped first. Four of these configs discuss `infra/__tests__` in prose
                // explaining a synth timeout, and a comment collects no tests — matching raw text reported
                // all four as defects and would have taught the next reader to delete the explanation.
                const configuration = readFileSync(ownerConfig, 'utf8')
                    .replace(/\/\*[\s\S]*?\*\//gu, '')
                    .replace(/\/\/[^\n]*/gu, '');

                expect(
                    configuration,
                    `${path.posix.dirname(dir)}/vitest.config.ts still names ${path.posix.basename(dir)}/__tests__. ` +
                        `Those suites import dependencies that install in ${dir}, not in the workspace, so the ` +
                        `run fails with \`Cannot find package 'aws-cdk-lib'\` on CI and passes on a developer ` +
                        `machine where that directory happens to be installed.`,
                ).not.toMatch(new RegExp(`${path.posix.basename(dir)}/__tests__`, 'u'));
            }
        },
    );

    it('the typecheck oracle discriminates: it reports real members and rejects a fabrication', () => {
        const members = typecheckedSources({
            dir: 'packages/infra/global',
            name: '@kitchensink/infra-global',
            scripts: { typecheck: 'tsc --noEmit' },
        });

        expect(members.has('packages/infra/global/lib/platform/NetworkStack.ts')).toBe(true);
        expect(members.has('packages/infra/global/no-such-file.ts')).toBe(false);
    });

    it('the lint oracle discriminates: build output is ignored, real source is not', async () => {
        const self = { dir: 'packages/infra/global', name: '@kitchensink/infra-global', scripts: {} };

        expect(await isLinted(self, 'packages/infra/global/lib/platform/NetworkStack.ts')).toBe(true);
        expect(await isLinted(self, 'packages/infra/global/dist/platform/NetworkStack.ts')).toBe(false);
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
        // in `generatedSchemaPackages.test.ts`. Every other workspace that owns a lint SUBJECT must have one.
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
