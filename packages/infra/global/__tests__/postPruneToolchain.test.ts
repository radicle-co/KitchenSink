// @vitest-environment node
/**
 * Repo-wide guard: after `npm prune --omit=dev`, a job may not need anything the prune removed — and no
 * workflow may execute a tool the lockfile does not pin.
 *
 * ## The defect this pins (measured, not inferred)
 *
 * `prod-deploy.yml` prunes dev dependencies mid-job so the service images, which `COPY node_modules`, ship
 * production dependencies only. Every step after that line runs against the pruned tree. Two facts about
 * that tree, read from `package-lock.json` (the artefact `npm ci` builds the runner's tree from) and
 * confirmed with `npm prune --omit=dev --dry-run` on 2026-09-03:
 *
 *   - `aws-cdk`, the CDK CLI, is `dev: true` at its root location — no workspace declares it under
 *     `dependencies`. The prune REMOVES it. Every `npx cdk` after the prune (eight of them, the identity
 *     leg included) therefore falls through to the registry, which installs the current `cdk` alias
 *     package and executes it — unpinned, unrecorded, inside the production deploy.
 *   - `tsx` is `devOptional: true`: it survives the prune ONLY because `vite` lists it as an optional
 *     peer. Nothing declares it. Eleven post-prune `npx tsx` invocations — two of them as the CDK app
 *     runner itself (`--app "npx tsx …/app.ts"`) — rested on that accident; the day the peer edge moves
 *     they become registry fetches with no diff in this repository.
 *
 * `typescript` and `esbuild`, by contrast, survive because `packages/tools/contract-gen` and
 * `packages/tools/esbuild` DECLARE them as runtime dependencies — which is why `infra:build` and
 * `bundle:lambda` after the prune did not exit 127 in production run 30764536782, and why
 * `workflowInvariants.test.ts` invariant 3 carried them as a ratchet ("survives on a transitive edge that
 * nothing asserts") rather than as a defect. This guard replaces that ratchet with the assertion it asked
 * for.
 *
 * ## What is derived, and from where — nothing is enumerated
 *
 * A tool package is classified from two committed artefacts:
 *
 *   - the MANIFESTS (root + every workspace): a package named under any `dependencies` is DECLARED
 *     runtime and survives; a workspace package is linked and survives;
 *   - the LOCKFILE: a package whose root entry carries `dev: true` is REMOVED by the prune; one that is
 *     neither declared nor removed is an UNDECLARED SURVIVOR — kept by an edge nobody owns.
 *
 * A step's tools are read from what it actually runs: every `npx <target>` in the body (nested ones such
 * as `--app "npx tsx …"` included), every `npm run <script> --workspace=<ws>` resolved through that
 * workspace's manifest to the command it executes, and any command-position token that the lockfile
 * knows as a bin (`tsc`, `cdk`, `nest`, …), mapped to its package through the lockfile's own `bin`
 * entries. So `npx cdk` → bin `cdk` → `aws-cdk` → removed; `npm run infra:build` → `tsc -p …` → bin
 * `tsc` → `typescript` → declared. Adding a tool, a script or a workspace changes nothing here.
 *
 * Both non-surviving classes are violations after a prune. "Removed" is a registry fallback today;
 * "undeclared survivor" is the same fallback deferred to whichever dependency bump moves the edge.
 *
 * The second analyzer is the same property one level up, for EVERY job: an `npx <target>` whose package
 * the lockfile does not provide, or that carries a floating version (`@latest`, `@6`), resolves through the
 * registry at run time — code the lockfile never pinned, executed with the job's credentials in scope.
 * An exact `x.y.z` pin is accepted (a published version is immutable); a `${VAR}` spec is resolved
 * through the workflow's literal `env:` before being judged.
 *
 * ## How it is asserted
 *
 * Each analyzer is PURE over parsed workflows plus a `Catalog` (the classification + script-resolution
 * facts). Fixtures supply a hand-built catalog so the analyzers' logic is exercised independently of the
 * tree; the real-tree assertions use the catalog DERIVED from the manifests and lockfile on disk.
 * Violations carry the workflow LINE of the step, read from the YAML parser's own offsets, so the red run
 * names every offending line.
 *
 * ## Mutation evidence (every assertion has been watched fail)
 *
 * Written against the pre-fix tree; the first real-tree run reported 23 post-prune sites — in
 * `prod-deploy.yml` ten steps running `npx tsx` (two as `--app` runners) and eight running `npx cdk`,
 * every line the review threads named plus the identity leg's `npx cdk` that no thread had — and, in
 * `sandbox-identity-deploy.yml`, which ALSO prunes and which no thread mentioned, four `npx cdk` steps and
 * one `npx tsx` smoke. The post-prune `infra:build` / `bundle:lambda` bodies were NOT reported, which is the
 * derivation working: `tsc` and `esbuild` resolve to declared runtime dependencies. The registry analyzer's
 * first run reported `npx @sentry/cli@latest` (prod-deploy) and `npx @argos-ci/cli@6` (`_ci.yml`).
 * Fixture mutations: forcing `classify` to `declared-runtime` for everything blanks the post-prune
 * findings; dropping the nested-`npx` scan loses the `--app` runner case; dropping script resolution
 * loses the `npm run` case; accepting any version spec as pinned loses the `@latest` case.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LineCounter, isMap, isSeq, parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');

// ---------------------------------------------------------------------------------------------------------
// Workflow reading — steps with their line numbers
// ---------------------------------------------------------------------------------------------------------

interface Step {
    readonly name: string;
    readonly line: number;
    readonly run: string | undefined;
    readonly env: Readonly<Record<string, string>>;
}

interface Job {
    readonly id: string;
    readonly env: Readonly<Record<string, string>>;
    readonly steps: readonly Step[];
}

interface Workflow {
    readonly file: string;
    readonly env: Readonly<Record<string, string>>;
    readonly jobs: readonly Job[];
}

/** A YAML map's plain-object view, or `{}` for anything else. */
function plain(node: unknown): Readonly<Record<string, unknown>> {
    return isMap(node) ? (node.toJSON() as Readonly<Record<string, unknown>>) : {};
}

/** The string-valued entries of an `env:` map — a `${{ … }}` value is kept verbatim, a literal as-is. */
function envOf(node: unknown): Readonly<Record<string, string>> {
    return Object.fromEntries(
        Object.entries(plain(node)).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
    );
}

/** Parse one workflow, keeping each step's source line. Pure over its input text. */
function readWorkflow(file: string, text: string): Workflow {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter });
    const jobsNode = doc.get('jobs', true);
    const jobs: Job[] = [];

    if (isMap(jobsNode)) {
        for (const pair of jobsNode.items) {
            const id = String((pair.key as { value?: unknown })?.value ?? pair.key);
            const jobNode = pair.value;

            if (!isMap(jobNode)) {
                continue;
            }

            const stepsNode = jobNode.get('steps', true);
            const steps: Step[] = [];

            if (isSeq(stepsNode)) {
                for (const stepNode of stepsNode.items) {
                    const step = plain(stepNode);
                    const offset = isMap(stepNode) ? (stepNode.range?.[0] ?? 0) : 0;
                    const run = step['run'];

                    steps.push({
                        name: String(
                            step['name'] ?? step['uses'] ?? (typeof run === 'string' ? run.split('\n')[0] : ''),
                        ),
                        line: lineCounter.linePos(offset).line,
                        run: typeof run === 'string' ? run : undefined,
                        env: envOf(isMap(stepNode) ? stepNode.get('env', true) : undefined),
                    });
                }
            }

            jobs.push({ id, env: envOf(jobNode.get('env', true)), steps });
        }
    }

    return { file, env: envOf(doc.get('env', true)), jobs };
}

/** Parse every workflow in a directory, in filename order. */
function load(directory: string): readonly Workflow[] {
    return readdirSync(directory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => readWorkflow(file, readFileSync(path.join(directory, file), 'utf8')));
}

/** The real `.github/workflows/` tree. */
function realWorkflows(): readonly Workflow[] {
    return load(WORKFLOW_DIR);
}

/**
 * Write the given YAML bodies into a throwaway directory and parse them as a workflow tree.
 *
 * @sideEffect Creates a temp directory. Real workflow files are never touched.
 */
function fixture(files: Readonly<Record<string, string>>): readonly Workflow[] {
    const directory = mkdtempSync(path.join(tmpdir(), 'post-prune-toolchain-'));

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(path.join(directory, name), body);
    }

    return load(directory);
}

/** Strip whole-line shell comments — prose is not code. */
function shellCode(run: string): string {
    return run
        .split('\n')
        .filter((line) => !/^\s*#/u.test(line))
        .join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// The catalog — what survives the prune, and what a script resolves to
// ---------------------------------------------------------------------------------------------------------

/** How a package fares under `npm prune --omit=dev`. */
type Survival = 'workspace' | 'declared-runtime' | 'removed' | 'undeclared-survivor' | 'not-in-lockfile';

interface Catalog {
    /** Classify a package by name. */
    readonly classify: (packageName: string) => Survival;
    /** The package that owns a lockfile bin, if any. */
    readonly packageForBin: (bin: string) => string | undefined;
    /** The command text of `npm run <script>` in a workspace (a directory or manifest name) or the root. */
    readonly script: (workspace: string | undefined, script: string) => string | undefined;
}

interface Manifest {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly scripts?: Readonly<Record<string, string>>;
}

interface Lockfile {
    readonly packages: Readonly<
        Record<
            string,
            { readonly name?: string; readonly dev?: boolean; readonly bin?: Readonly<Record<string, string>> }
        >
    >;
}

/** Every tracked `package.json` that is a workspace manifest, keyed by its directory. Impure. */
function workspaceManifests(): ReadonlyMap<string, Manifest> {
    const files = execFileSync(
        'git',
        ['ls-files', 'packages/*/package.json', 'packages/*/*/package.json', 'packages/*/*/*/package.json'],
        {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        },
    )
        .trim()
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules'));

    return new Map(
        files.map((file) => [
            path.posix.dirname(file),
            JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as Manifest,
        ]),
    );
}

/**
 * Every tracked TypeScript source under a deployable service's `src/`.
 *
 * @returns Repo-relative paths. Impure.
 * @sideEffect Shells out to git.
 */
function trackedServiceSources(): readonly string[] {
    return execFileSync('git', ['ls-files', 'packages/services/*/src'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((file) => file.endsWith('.ts'));
}

/**
 * The catalog DERIVED from the tree: manifests decide "declared", the lockfile decides "removed".
 *
 * @sideEffect Reads the root and workspace manifests and `package-lock.json`.
 */
function realCatalog(): Catalog {
    const root = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;
    const workspaces = workspaceManifests();
    const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8')) as Lockfile;

    const declared = new Set<string>(Object.keys(root.dependencies ?? {}));
    const workspaceNames = new Set<string>();

    for (const manifest of workspaces.values()) {
        if (manifest.name !== undefined) {
            workspaceNames.add(manifest.name);
        }

        for (const name of Object.keys(manifest.dependencies ?? {})) {
            declared.add(name);
        }
    }

    const bins = new Map<string, string>();

    for (const [location, entry] of Object.entries(lock.packages)) {
        if (location === '' || entry.bin === undefined) {
            continue;
        }

        const name = entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);

        for (const bin of Object.keys(entry.bin)) {
            // The hoisted (root) copy wins: that is the one `node_modules/.bin` resolves for the job.
            if (!bins.has(bin) || location === `node_modules/${name}`) {
                bins.set(bin, name);
            }
        }
    }

    const classify = (packageName: string): Survival => {
        if (workspaceNames.has(packageName)) {
            return 'workspace';
        }

        if (declared.has(packageName)) {
            return 'declared-runtime';
        }

        const entry = lock.packages[`node_modules/${packageName}`];

        if (entry === undefined) {
            return 'not-in-lockfile';
        }

        return entry.dev === true ? 'removed' : 'undeclared-survivor';
    };

    const script = (workspace: string | undefined, name: string): string | undefined => {
        if (workspace === undefined) {
            return root.scripts?.[name];
        }

        const directory = workspace.replace(/^\.\//u, '').replace(/\/$/u, '');
        const manifest =
            workspaces.get(directory) ?? [...workspaces.values()].find((candidate) => candidate.name === workspace);

        return manifest?.scripts?.[name];
    };

    return { classify, packageForBin: (bin) => bins.get(bin), script };
}

// ---------------------------------------------------------------------------------------------------------
// Tool extraction — what a `run:` body actually executes
// ---------------------------------------------------------------------------------------------------------

/** One tool invocation found in a step, resolved as far as the catalog allows. */
interface ToolUse {
    /** How it was spelled: `npx tsx`, `npm run infra:build`, `tsc`. */
    readonly spelling: string;
    /** The package the tool resolves to, or `undefined` when the lockfile does not know it. */
    readonly packageName: string | undefined;
    /** The version spec an `npx` target carried, `undefined` for none. */
    readonly versionSpec: string | undefined;
}

/** Shell separators after which a new command starts. */
const COMMAND_BOUNDARY = /\n|&&|\|\||;|\||\$\(|\(/u;

/** `npx [--flags…] <target>` — the target is the first token that is not a flag. Quotes are stripped. */
const NPX_CALL = /\bnpx\s+((?:--?[\w-]+(?:=\S+)?\s+)*)(["']?)([^\s"']+)\2/gu;

/** `npm run <script> [--workspace=<ws> | --workspace <ws> | -w <ws>]`. */
const NPM_RUN = /\bnpm\s+run\s+([\w:@/.-]+)(?:\s+(?:--workspace[= ]|-w\s+)(\S+))?/gu;

/** Split `name@spec` (scoped names included) into its package name and version spec. */
function splitSpec(target: string): { readonly name: string; readonly spec: string | undefined } {
    const at = target.lastIndexOf('@');

    if (at <= 0) {
        return { name: target, spec: undefined };
    }

    return { name: target.slice(0, at), spec: target.slice(at + 1) };
}

/**
 * Every tool a shell body executes, resolved through the catalog. Pure.
 *
 * `npm run` is followed one level into the script it names, so a workflow step's `npm run infra:build`
 * is judged by the `tsc` that script runs. A script may itself chain `npm run …`, which is followed too.
 */
function toolsIn(body: string, catalog: Catalog, workspace: string | undefined, depth = 0): readonly ToolUse[] {
    const code = shellCode(body);
    const found: ToolUse[] = [];

    for (const match of code.matchAll(NPX_CALL)) {
        const { name, spec } = splitSpec(match[3] ?? '');
        const packageName = catalog.classify(name) === 'not-in-lockfile' ? catalog.packageForBin(name) : name;

        found.push({ spelling: `npx ${match[3] ?? ''}`, packageName, versionSpec: spec });
    }

    for (const match of code.matchAll(NPM_RUN)) {
        const script = catalog.script(match[2] ?? workspace, match[1] ?? '');

        if (script !== undefined && depth < 3) {
            for (const tool of toolsIn(script, catalog, match[2] ?? workspace, depth + 1)) {
                found.push({ ...tool, spelling: `npm run ${match[1] ?? ''} → ${tool.spelling}` });
            }
        }
    }

    // Bare bins at command position: `tsc -p …`, `cdk deploy …`, `nest build`.
    for (const segment of code.split(COMMAND_BOUNDARY)) {
        const tokens = segment.trim().split(/\s+/u);
        const command = tokens.find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token));

        if (command === undefined || command === 'npx' || command === 'npm') {
            continue;
        }

        const packageName = catalog.packageForBin(command);

        if (packageName !== undefined) {
            found.push({ spelling: command, packageName, versionSpec: undefined });
        }
    }

    return found;
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — after the prune, nothing the prune removed (or nothing that survives by accident)
// ---------------------------------------------------------------------------------------------------------

/** `npm prune --omit=dev` and its equivalents: the one-way door. */
const PRUNE = /npm prune|--omit=dev/u;

/** What each non-surviving class means, for the reader of a failure. */
const VERDICT: Readonly<Record<Exclude<Survival, 'workspace' | 'declared-runtime'>, string>> = {
    removed: 'REMOVED by the prune — resolves through the registry, unpinned',
    'undeclared-survivor': 'survives the prune only through an edge nobody declares',
    'not-in-lockfile': 'not in the lockfile at all — resolves through the registry, unpinned',
};

/**
 * Steps after a prune, in the same job, that invoke a tool the pruned tree does not reliably provide.
 *
 * @returns Sorted violation ids: `<file>:<line> <job>::<step> → <spelling> (<package>: <verdict>)`.
 */
function findToolsAfterPrune(workflows: readonly Workflow[], catalog: Catalog): readonly string[] {
    const violations: string[] = [];

    for (const { file, jobs } of workflows) {
        for (const job of jobs) {
            const pruneIndex = job.steps.findIndex((step) => PRUNE.test(shellCode(step.run ?? '')));

            if (pruneIndex === -1) {
                continue;
            }

            for (const step of job.steps.slice(pruneIndex + 1)) {
                const seen = new Set<string>();

                for (const tool of toolsIn(step.run ?? '', catalog, undefined)) {
                    const survival =
                        tool.packageName === undefined ? 'not-in-lockfile' : catalog.classify(tool.packageName);

                    if (survival === 'workspace' || survival === 'declared-runtime') {
                        continue;
                    }

                    const id =
                        `${file}:${step.line} ${job.id}::${step.name} → ${tool.spelling} ` +
                        `(${tool.packageName ?? 'unknown package'}: ${VERDICT[survival]})`;

                    if (!seen.has(id)) {
                        seen.add(id);
                        violations.push(id);
                    }
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — every `npx` names a lockfile-provided tool, or an exact version
// ---------------------------------------------------------------------------------------------------------

/** An exact, immutable version. Ranges, tags and majors are not. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** Resolve `${VAR}` / `$VAR` / `${{ env.VAR }}` through the literal `env:` blocks in scope. */
function resolveEnv(spec: string, scopes: readonly Readonly<Record<string, string>>[]): string {
    return spec.replace(
        /\$\{\{\s*env\.(\w+)\s*\}\}|\$\{(\w+)\}|\$(\w+)/gu,
        (whole, a: string | undefined, b: string | undefined, c: string | undefined) => {
            const name = a ?? b ?? c ?? '';

            for (const scope of [...scopes].reverse()) {
                const value = scope[name];

                if (value !== undefined && !value.includes('${{')) {
                    return value;
                }
            }

            return whole;
        },
    );
}

/**
 * Every `npx` whose target the lockfile does not provide, or that floats a version, in any job.
 *
 * @returns Sorted violation ids: `<file>:<line> <job>::<step> → npx <target> (<reason>)`.
 */
function findRegistryResolvedNpx(workflows: readonly Workflow[], catalog: Catalog): readonly string[] {
    const violations: string[] = [];

    for (const { file, env, jobs } of workflows) {
        for (const job of jobs) {
            for (const step of job.steps) {
                // One finding per distinct target per step: a step that calls the same floating tool twice
                // has one thing to fix.
                const seen = new Set<string>();

                for (const match of shellCode(step.run ?? '').matchAll(NPX_CALL)) {
                    if (seen.has(match[3] ?? '')) {
                        continue;
                    }

                    seen.add(match[3] ?? '');

                    const target = match[3] ?? '';
                    const { name, spec } = splitSpec(target);
                    const known =
                        catalog.classify(name) !== 'not-in-lockfile' || catalog.packageForBin(name) !== undefined;
                    const resolvedSpec = spec === undefined ? undefined : resolveEnv(spec, [env, job.env, step.env]);
                    const pinned = resolvedSpec !== undefined && EXACT_VERSION.test(resolvedSpec);

                    if (known && spec === undefined) {
                        continue;
                    }

                    if (pinned) {
                        continue;
                    }

                    const reason =
                        spec === undefined
                            ? 'not in the lockfile — npx installs whatever the registry serves'
                            : `version "${resolvedSpec ?? spec}" is not an exact pin — the registry decides what runs`;

                    violations.push(`${file}:${step.line} ${job.id}::${step.name} → npx ${target} (${reason})`);
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Fixture catalog — hand-built, so the analyzers are exercised independently of the tree
// ---------------------------------------------------------------------------------------------------------

const FIXTURE_CATALOG: Catalog = {
    classify: (name) => {
        switch (name) {
            case '@fixture/service':
                return 'workspace';
            case 'aws-cdk-lib':
            case 'typescript':
                return 'declared-runtime';
            case 'aws-cdk':
            case 'turbo':
            case '@nestjs/cli':
                return 'removed';
            case 'tsx':
                return 'undeclared-survivor';
            default:
                return 'not-in-lockfile';
        }
    },
    packageForBin: (bin) =>
        ({ cdk: 'aws-cdk', tsc: 'typescript', tsx: 'tsx', nest: '@nestjs/cli', turbo: 'turbo' })[bin],
    script: (workspace, name) => {
        if (workspace !== 'packages/services/fixture' && workspace !== '@fixture/service') {
            return undefined;
        }

        return {
            'infra:build': 'tsc -p infra/tsconfig.json',
            build: 'nest build',
            'bundle:lambda': 'node esbuild.mjs',
            'docker:prepare': 'node ../../../scripts/prepareProdManifest.mjs',
            'infra:deploy': 'npm run bundle:lambda && cdk deploy --app "npx tsx infra/bin/app.ts"',
        }[name];
    },
};

const PRUNING_JOB = (afterPrune: readonly string[]): string =>
    [
        'name: fixture',
        'on:',
        '    push:',
        '        branches: [main]',
        'env:',
        "    PINNED: '1.2.3'",
        'jobs:',
        '    deploy:',
        '        runs-on: ubuntu-latest',
        '        steps:',
        '            - name: Build',
        '              run: npx turbo run build --filter=@fixture/service',
        '            - name: Prune dev dependencies',
        '              run: npm prune --omit=dev',
        ...afterPrune.flatMap((run, index) => [`            - name: Step ${index + 1}`, `              run: ${run}`]),
        '',
    ].join('\n');

// ---------------------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------------------

describe('after `npm prune --omit=dev`, a job needs nothing the prune removed', () => {
    describe('the analyzer actually fires (fixtures)', () => {
        it('flags `npx tsx` as a runner nested inside a `cdk deploy --app` string', () => {
            const violations = findToolsAfterPrune(
                fixture({
                    'nested.yml': PRUNING_JOB(['npx cdk deploy --app "npx tsx packages/x/infra/bin/app.ts" --all']),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([
                'nested.yml:15 deploy::Step 1 → npx cdk (aws-cdk: REMOVED by the prune — resolves through the registry, unpinned)',
                'nested.yml:15 deploy::Step 1 → npx tsx (tsx: survives the prune only through an edge nobody declares)',
            ]);
        });

        it('follows `npm run <script> --workspace=…` to the bin the script runs', () => {
            const violations = findToolsAfterPrune(
                fixture({
                    'script.yml': PRUNING_JOB([
                        'npm run build --workspace=packages/services/fixture',
                        'npm run infra:build --workspace=packages/services/fixture',
                    ]),
                }),
                FIXTURE_CATALOG,
            );

            // `build` → `nest build` → @nestjs/cli (removed). `infra:build` → `tsc` → typescript (declared).
            expect(violations).toEqual([
                'script.yml:15 deploy::Step 1 → npm run build → nest (@nestjs/cli: REMOVED by the prune — resolves through the registry, unpinned)',
            ]);
        });

        it('follows a script that chains `npm run` into another script', () => {
            const violations = findToolsAfterPrune(
                fixture({ 'chain.yml': PRUNING_JOB(['npm run infra:deploy --workspace=@fixture/service']) }),
                FIXTURE_CATALOG,
            );

            expect(violations.map((violation) => violation.replace(/^chain\.yml:\d+ deploy::Step 1 → /u, ''))).toEqual([
                'npm run infra:deploy → cdk (aws-cdk: REMOVED by the prune — resolves through the registry, unpinned)',
                'npm run infra:deploy → npx tsx (tsx: survives the prune only through an edge nobody declares)',
            ]);
        });

        it('flags a bare bin at command position, and a tool the lockfile does not know', () => {
            const violations = findToolsAfterPrune(
                fixture({
                    'bare.yml': PRUNING_JOB(['tsc -p infra/tsconfig.json && cdk synth', 'npx some-random-cli --flag']),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([
                'bare.yml:15 deploy::Step 1 → cdk (aws-cdk: REMOVED by the prune — resolves through the registry, unpinned)',
                'bare.yml:17 deploy::Step 2 → npx some-random-cli (unknown package: not in the lockfile at all — resolves through the registry, unpinned)',
            ]);
        });

        it('does NOT flag declared-runtime tools, workspace links, plain node, docker, or the pre-prune build', () => {
            const violations = findToolsAfterPrune(
                fixture({
                    'clean.yml': PRUNING_JOB([
                        'node packages/services/fixture/infra/dist/bin/app.js',
                        'npm run docker:prepare --workspace=packages/services/fixture',
                        'npm run bundle:lambda --workspace=packages/services/fixture',
                        'docker buildx build -t image --push .',
                        'node -e "require(\'aws-cdk-lib\')"',
                    ]),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([]);
        });

        it('does NOT flag a job that never prunes, nor a different job from the one that does', () => {
            const violations = findToolsAfterPrune(
                fixture({
                    'other.yml': [
                        'name: other',
                        'on:',
                        '    push:',
                        '        branches: [main]',
                        'jobs:',
                        '    deploy:',
                        '        runs-on: ubuntu-latest',
                        '        steps:',
                        '            - run: npm prune --omit=dev',
                        '    build:',
                        '        runs-on: ubuntu-latest',
                        '        steps:',
                        '            - run: npx tsx scripts/x.ts',
                        '',
                    ].join('\n'),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([]);
        });

        it('ignores a prune, or a tool, that only appears in a shell comment', () => {
            const violations = findToolsAfterPrune(
                fixture({ 'prose.yml': PRUNING_JOB(['# after the prune, npx tsx would be wrong here\necho ok']) }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([]);
        });
    });

    it('holds for every job in .github/workflows/ that prunes', () => {
        expect(
            findToolsAfterPrune(realWorkflows(), realCatalog()),
            'a step after `npm prune --omit=dev` invokes a tool the pruned tree does not reliably provide. ' +
                'Either the tool is REMOVED by the prune (so `npx` falls through to the registry and executes ' +
                'whatever it serves, unpinned, inside the deploy), or it survives only through a transitive/' +
                'optional edge nobody declares. Compile the entrypoint above the prune and run it with plain ' +
                '`node`, hoist the build, or declare the tool as a runtime dependency of the job (root ' +
                '`dependencies`) — never rely on `npx` after the prune.',
        ).toEqual([]);
    });

    it('is NOT vacuous: the real tree prunes somewhere, and the catalog classifies the known tools', () => {
        const catalog = realCatalog();
        const pruningJobs = realWorkflows().flatMap(({ file, jobs }) =>
            jobs
                .filter((job) => job.steps.some((step) => PRUNE.test(shellCode(step.run ?? ''))))
                .map((job) => `${file}::${job.id}`),
        );

        expect(pruningJobs).toContain('prod-deploy.yml::deploy');
        // Anchors for the derivation: the lockfile's own facts, as measured. If either flips, the analyzer's
        // premises changed and the docblock above owes an update.
        expect(catalog.packageForBin('cdk')).toBe('aws-cdk');
        expect(catalog.packageForBin('tsc')).toBe('typescript');
        expect(catalog.classify('typescript')).toBe('declared-runtime');
        expect(catalog.classify('@kitchensink/infra-security')).toBe('workspace');
        expect(catalog.classify('turbo')).toBe('removed');
    });
});

describe('every `npx` in .github/workflows/ names a lockfile-provided tool or an exact version', () => {
    describe('the analyzer actually fires (fixtures)', () => {
        it('flags `@latest`, a major-only range, and a package the lockfile does not have', () => {
            const violations = findRegistryResolvedNpx(
                fixture({
                    'floating.yml': PRUNING_JOB([
                        'npx @sentry/cli@latest sourcemaps inject dist',
                        'npx --yes @argos-ci/cli@6 upload screenshots',
                        'npx some-random-cli --flag',
                    ]),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([
                'floating.yml:15 deploy::Step 1 → npx @sentry/cli@latest (version "latest" is not an exact pin — the registry decides what runs)',
                'floating.yml:17 deploy::Step 2 → npx @argos-ci/cli@6 (version "6" is not an exact pin — the registry decides what runs)',
                'floating.yml:19 deploy::Step 3 → npx some-random-cli (not in the lockfile — npx installs whatever the registry serves)',
            ]);
        });

        it('accepts a lockfile tool, and an exact pin — including one resolved through a literal env', () => {
            const violations = findRegistryResolvedNpx(
                fixture({
                    'pinned.yml': PRUNING_JOB([
                        'npx tsx scripts/x.ts',
                        'npx cdk deploy --all',
                        'npx --yes "vercel@${PINNED}" deploy',
                        'npx --yes some-cli@4.2.0 run',
                    ]),
                }),
                FIXTURE_CATALOG,
            );

            expect(violations).toEqual([]);
        });
    });

    it('holds for every workflow in .github/workflows/', () => {
        expect(
            findRegistryResolvedNpx(realWorkflows(), realCatalog()),
            'an `npx` here resolves its tool through the registry at run time — code the lockfile never ' +
                "pinned, executed with the job's credentials in scope. Add the tool to a workspace's " +
                'devDependencies (so the lockfile pins it) and invoke it with `npx --no-install`, or pin an ' +
                'exact `x.y.z` version.',
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — a compiled entrypoint must actually EXECUTE when a workflow runs it
// ---------------------------------------------------------------------------------------------------------

/**
 * `node <repo-relative path>.js` — how every post-prune entrypoint is now invoked.
 *
 * The leading class admits a QUOTE as well as whitespace: the CDK apps are invoked as
 * `cdk deploy --app "node …/app.js"`, and a whitespace-only boundary skipped every one of them — which is
 * to say it skipped the entrypoints whose runner this change moved.
 */
const NODE_INVOCATION = /(?:^|[\s"'])node\s+(packages\/[\w@./-]+\.js)\b/gu;

/**
 * The source file a compiled entrypoint was emitted from.
 *
 * Two layouts occur and both reduce the same way — drop the FIRST `dist/` segment and swap the extension:
 * `…/infra/dist/bin/app.js` → `…/infra/bin/app.ts` (the CDK apps, compiled by `infra/tsconfig.json`), and
 * `…/dist/infra/smoke/deployedSmoke.js` → `…/infra/smoke/deployedSmoke.ts` (the CRF smoke, compiled by the
 * package project instead because it imports that package's own zod from `src/`).
 */
function toSource(compiled: string): string {
    return compiled.replace(/(^|\/)dist\//u, '$1').replace(/\.js$/u, '.ts');
}

/**
 * Entrypoints a workflow runs under `node` whose module-main guard cannot fire, or whose source is absent.
 *
 * ## The defect this pins — which this very change introduced, and which only RUNNING the file caught
 *
 * `ingredient-parser`'s deploy smoke ended in
 *
 *     if (process.argv[1] !== undefined && process.argv[1].endsWith('deployedSmoke.ts')) { await main(); }
 *
 * — correct while the step ran it under `npx tsx`, and FALSE the moment the same file is run COMPILED. The
 * step then exits 0 having invoked nothing: the only check that proves the CRF Lambda's 90 MB of wheels
 * actually load reports success without loading them. That is a success-returning no-op, the shape
 * `globalBootstrapBundle.test.ts` exists for one directory over, and it is invisible to every other guard
 * here — the tool resolves, the file exists, the command exits 0.
 *
 * So the rule is derived from the INVOCATION: a file a workflow runs as `.js` may not gate its main on a
 * filename extension. `import.meta.url === pathToFileURL(process.argv[1]).href` holds under both runners.
 *
 * @param workflows - Parsed workflow tree.
 * @param root - The tree the entrypoint paths resolve against; the fixtures supply their own.
 * @sideEffect Reads each named source file.
 */
function findInertEntrypoints(workflows: readonly Workflow[], root: string): readonly string[] {
    const violations: string[] = [];

    for (const { file, jobs } of workflows) {
        for (const job of jobs) {
            for (const step of job.steps) {
                for (const match of shellCode(step.run ?? '').matchAll(NODE_INVOCATION)) {
                    const compiled = match[1] ?? '';
                    const source = toSource(compiled);
                    const where = `${file}:${step.line} ${job.id}::${step.name} → node ${compiled}`;

                    if (!existsSync(path.join(root, source))) {
                        violations.push(`${where} (no source at ${source} — nothing emits this path)`);
                        continue;
                    }

                    const extensionLocked = readFileSync(path.join(root, source), 'utf8')
                        .split('\n')
                        .filter((line) => line.includes('process.argv[1]') && /\.[jt]s['"]/u.test(line));

                    for (const line of extensionLocked) {
                        violations.push(
                            `${where} (module-main guard is extension-locked: \`${line.trim()}\` — run ` +
                                'compiled that is false, so main() never runs and the step exits 0 in silence)',
                        );
                    }
                }
            }
        }
    }

    return [...violations].sort();
}

/**
 * A throwaway tree holding one source file, for the entrypoint fixtures.
 *
 * @sideEffect Creates a temp directory and writes the file.
 */
function sourceTree(file: string, contents: string): string {
    const root = mkdtempSync(path.join(tmpdir(), 'inert-entrypoint-'));

    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);

    return root;
}

describe('every compiled entrypoint a workflow runs under `node` can actually execute', () => {
    const RUNS_COMPILED_SMOKE = PRUNING_JOB([
        'node packages/services/x/dist/infra/smoke/deployedSmoke.js --function-name f',
    ]);
    const SMOKE_SOURCE = 'packages/services/x/infra/smoke/deployedSmoke.ts';

    it('flags an entry guard that only fires under a .ts extension', () => {
        const root = sourceTree(
            SMOKE_SOURCE,
            "if (process.argv[1] !== undefined && process.argv[1].endsWith('deployedSmoke.ts')) {\n    await main();\n}\n",
        );

        expect(findInertEntrypoints(fixture({ 'inert.yml': RUNS_COMPILED_SMOKE }), root)).toEqual([
            'inert.yml:15 deploy::Step 1 → node packages/services/x/dist/infra/smoke/deployedSmoke.js ' +
                '(module-main guard is extension-locked: `if (process.argv[1] !== undefined && ' +
                "process.argv[1].endsWith('deployedSmoke.ts')) {` — run compiled that is false, so main() " +
                'never runs and the step exits 0 in silence)',
        ]);
    });

    it('does NOT flag the extension-agnostic guard', () => {
        const root = sourceTree(
            SMOKE_SOURCE,
            'if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {\n    await main();\n}\n',
        );

        expect(findInertEntrypoints(fixture({ 'fine.yml': RUNS_COMPILED_SMOKE }), root)).toEqual([]);
    });

    it('flags a `node` invocation whose source does not exist', () => {
        const root = sourceTree('placeholder.txt', '');

        expect(
            findInertEntrypoints(
                fixture({ 'missing.yml': PRUNING_JOB(['node packages/services/nowhere/infra/dist/bin/app.js --all']) }),
                root,
            ),
        ).toEqual([
            'missing.yml:15 deploy::Step 1 → node packages/services/nowhere/infra/dist/bin/app.js ' +
                '(no source at packages/services/nowhere/infra/bin/app.ts — nothing emits this path)',
        ]);
    });

    it('maps both compiled layouts back to their source', () => {
        expect(toSource('packages/services/recipe-service/infra/dist/bin/app.js')).toBe(
            'packages/services/recipe-service/infra/bin/app.ts',
        );
        expect(toSource('packages/services/ingredient-parser/dist/infra/smoke/deployedSmoke.js')).toBe(
            'packages/services/ingredient-parser/infra/smoke/deployedSmoke.ts',
        );
    });

    it('holds for every workflow in .github/workflows/', () => {
        expect(
            findInertEntrypoints(realWorkflows(), REPO_ROOT),
            'a workflow runs a compiled entrypoint that cannot run its own main, or that nothing emits. ' +
                'Gate main on `import.meta.url === pathToFileURL(process.argv[1]).href`, never on a filename ' +
                'extension, and make sure a build step above the prune emits the path the step names.',
        ).toEqual([]);
    });

    it('is NOT vacuous: the real tree runs compiled entrypoints under node', () => {
        const invocations = realWorkflows().flatMap(({ jobs }) =>
            jobs.flatMap(({ steps }) =>
                steps.flatMap((step) =>
                    [...shellCode(step.run ?? '').matchAll(NODE_INVOCATION)].map((match) => match[1]),
                ),
            ),
        );

        expect(invocations).toContain('packages/infra/global/dist/bin/app.js');
        expect(invocations).toContain('packages/services/ingredient-parser/dist/infra/smoke/deployedSmoke.js');
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 4 — a DEPLOY tool declared at the root stays out of the service images
// ---------------------------------------------------------------------------------------------------------

/**
 * Root `dependencies` entries that no service imports and that `.dockerignore` does not re-exclude.
 *
 * The root manifest declares `aws-cdk` so the CDK CLI survives the deploy workflows' prune (analyzer 1).
 * That has a consequence worth pinning: the service images `COPY node_modules` from the PRUNED tree, so a
 * root runtime dependency now ships inside every image — and the prune's whole stated purpose is that the
 * images carry production dependencies only. `.dockerignore` re-excludes it (last matching line wins), which
 * keeps the images byte-identical to before the declaration.
 *
 * Derived rather than enumerated: "does a service import it?" is answered by reading the services' own
 * sources, so a root dependency that IS imported at runtime needs no exclusion and is never reported.
 *
 * @sideEffect Reads the root manifest, `.dockerignore` and every service source.
 */
function findUnexcludedDeployTools(): readonly string[] {
    const root = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;
    const dockerignore = readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8')
        .split('\n')
        .map((line) => line.trim());
    const sources = trackedServiceSources();

    return Object.keys(root.dependencies ?? {})
        .filter((name) => {
            const specifier = new RegExp(`from\\s+['"]${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:/|['"])`, 'u');

            return !sources.some((file) => specifier.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')));
        })
        .filter((name) => !dockerignore.includes(`node_modules/${name}`))
        .map(
            (name) =>
                `${name} is a ROOT runtime dependency that no service imports, and .dockerignore does not ` +
                `re-exclude it — so it now ships inside every service image. Add \`node_modules/${name}\` ` +
                'to .dockerignore (below the `!node_modules` line), or move it out of root dependencies.',
        )
        .sort();
}

describe('a deploy-only tool declared at the root stays out of the service images', () => {
    it('the CDK CLI is declared at the root AND excluded from the images — both halves, or neither', () => {
        const root = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;
        const dockerignore = readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8');

        // Anchors the pair. The declaration is what makes `npx --no-install cdk` work after the prune; the
        // exclusion is what stops that declaration growing every image. Removing either alone is a defect.
        expect(root.dependencies?.['aws-cdk'], 'the CDK CLI must survive the prune').toBeDefined();
        expect(dockerignore, 'a deploy tool must not ship in the service images').toContain('node_modules/aws-cdk');
    });

    it('holds for every root runtime dependency', () => {
        expect(findUnexcludedDeployTools()).toEqual([]);
    });
});
