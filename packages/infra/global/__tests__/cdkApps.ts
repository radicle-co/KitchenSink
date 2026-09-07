/**
 * @module __tests__/cdkApps — the repository's CDK apps and their deploy sites, DISCOVERED on both sides.
 *
 * Two guards read this: `cdkAppDeployCoverage.test.ts` (does every app have a deployer at all?) and
 * `deployVerificationCoverage.test.ts` (is every deployed app then VERIFIED, in the same job?). They ask
 * different questions of the same two facts, so the facts live here once — a second copy of "which apps
 * exist" would be the very artefact ADR-0025 §3 warns about, one guard drifting from the other while both
 * stay green.
 *
 * Both sides are derived, neither is listed:
 *
 * - The apps come from `git ls-files`, filtered by CONTENT (the file constructs a CDK `App`), so an app that
 *   lands tomorrow is covered the day it is committed and cannot opt out by not being mentioned anywhere.
 *   ⚠️ Construction is the marker, NOT an explicit `app.synth()`: CDK synthesises implicitly at exit and
 *   `@commise/web`'s router app relies on that, so requiring the call would silently drop a real app from the
 *   discovered set — a vacuity `cdkAppDeployCoverage.test.ts` caught on its own first run.
 * - The deploy sites come from parsing the workflows for the two spellings this repo actually uses: a literal
 *   `cdk deploy --app "<runner> <path>"`, and `npm run infra:deploy --workspace=<pkg>`, which is RESOLVED
 *   through that package's own manifest rather than assumed. A reader that understood only the first spelling
 *   would report `@commise/web` as undeployed and be edited into a hand-written exemption — turning a real
 *   invariant into the list it exists to avoid.
 *
 * ⚠️ A compiled entrypoint (`infra/dist/bin/app.js`) is normalised back to its SOURCE (`infra/bin/app.ts`).
 * The two spellings are one app; treating them as different would let a service be "deployed" by a path that
 * no longer builds.
 *
 * DESIGN PATTERN: Repository — one read-only reading of the deployment topology, shared by the specifications
 * that judge it. Neither derivation is the authority alone; a guard compares two of them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot, trackedFiles } from './serviceSources.js';

/** Where the workflows live, relative to {@link repoRoot}. */
export const WORKFLOWS_DIR = '.github/workflows';

/**
 * A `cdk deploy --app "<runner> <path>"` argument, in either quote style.
 *
 * The runner (`node`, `npx tsx`, …) is discarded when identifying the APP: what identifies it is the
 * entrypoint path, which is always the argument's LAST whitespace-separated token.
 */
export const APP_ARGUMENT = /--app\s+(?:"([^"]+)"|'([^']+)')/gu;

/** `npm run infra:deploy --workspace=<pkg>`, the indirect spelling. */
export const WORKSPACE_DEPLOY = /npm\s+run\s+infra:deploy\s+--workspace=(\S+)/gu;

/**
 * Normalise a CDK entrypoint path to the SOURCE file that defines it.
 *
 * `node …/infra/dist/bin/app.js` and `npx tsx …/infra/bin/app.ts` name the same app; a guard that saw two
 * would pass while a service was deployed from a stale build path.
 *
 * @param entrypoint - The `--app` argument's path token, repo-relative.
 * @returns The repo-relative source path. Pure.
 */
export function toSourceEntrypoint(entrypoint: string): string {
    return entrypoint.replace(/(^|\/)dist\/bin\/app\.js$/u, '$1bin/app.ts');
}

/**
 * The path token of a `--app` argument.
 *
 * @param argument - The whole quoted argument, runner included.
 * @returns The last token, which is the entrypoint. Pure.
 */
export function entrypointOf(argument: string): string {
    return argument.trim().split(/\s+/u).at(-1) ?? '';
}

/**
 * Strip comment lines so a `--app` inside a worked example is not read as a deployment.
 *
 * `sandbox-deploy.yml` documents the generic deploy shape in a comment; counting it would let a service be
 * "covered" by prose.
 *
 * @param yaml - One workflow's text.
 * @returns The same text with whole-line comments removed. Pure.
 */
export function withoutComments(yaml: string): string {
    return yaml
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
}

/**
 * Every CDK app entrypoint tracked in the repository.
 *
 * Discovered by CONTENT rather than by path convention: `packages/infra/global` puts its app at `bin/app.ts`
 * while every service uses `infra/bin/app.ts`, and a path rule that encoded either would miss the other.
 *
 * @returns Repo-relative source paths, sorted. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
export function cdkApps(): readonly string[] {
    return trackedFiles('packages')
        .filter((file) => file.endsWith('/bin/app.ts'))
        .filter((file) => readFileSync(path.join(repoRoot, file), 'utf8').includes('new App('))
        .toSorted();
}

/**
 * Resolve `npm run infra:deploy --workspace=<pkg>` to the entrypoint that package's script deploys.
 *
 * The manifest is the authority: reading it means a package that renames its entrypoint stays covered, and a
 * workspace whose `infra:deploy` does not actually run `cdk deploy` contributes nothing rather than counting
 * as a deployer.
 *
 * @param workspace - The `--workspace=` value: a manifest name or a directory path.
 * @returns The repo-relative source entrypoint, or `undefined` when the script deploys no app. Impure.
 * @sideEffect Reads every workspace manifest.
 */
export function entrypointForWorkspace(workspace: string): string | undefined {
    const manifest = trackedFiles('packages')
        .filter((file) => file.endsWith('/package.json'))
        .find((file) => {
            const directory = path.dirname(file);
            const { name } = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as { name?: string };

            return name === workspace || directory === workspace.replace(/^\.\//u, '');
        });

    if (manifest === undefined) {
        return undefined;
    }

    const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as {
        scripts?: Record<string, string>;
    };
    const script = scripts?.['infra:deploy'];
    const match = script === undefined ? null : new RegExp(APP_ARGUMENT.source, 'u').exec(script);

    if (match === null) {
        return undefined;
    }

    // The script's `--app` path is relative to its own package, never to the repo root.
    return toSourceEntrypoint(path.posix.join(path.dirname(manifest), entrypointOf(match[1] ?? match[2] ?? '')));
}

/** One workflow job, as a slab of text — enough to ask what it deploys, probes and verifies. */
export interface WorkflowJob {
    /** The workflow's basename. */
    readonly workflow: string;
    /** The job's key. */
    readonly name: string;
    /** Every line from the job header to the next one, comments already stripped. */
    readonly body: string;
}

/**
 * Fold shell line-continuations, so one command is one line.
 *
 * ⚠️ NOT cosmetic, and it is the first thing the coverage guard got wrong. `sandbox-deploy.yml` writes every
 * deploy as `npx cdk deploy \` with `--app "…"` on the NEXT line, while `prod-deploy.yml` and
 * `sandbox-identity-deploy.yml` write it on one. A per-line scan therefore saw the two single-line workflows
 * and reported the food and recipe jobs — the ones that whole change existed for — as deploying nothing at
 * all, which reads as full coverage. A guard that exempts its own subject is worse than no guard.
 *
 * @param body - A job's or a step's text.
 * @returns The same text with `\`-continued lines joined. Pure.
 */
export function foldContinuations(body: string): string {
    return body.replace(/\\\n\s*/gu, ' ');
}

/**
 * Split every workflow into its jobs.
 *
 * Textual rather than YAML-structural on purpose: a `run:` block is a shell script, so what matters is the
 * COMMANDS a job contains, and re-assembling them from parsed YAML adds a representation without adding an
 * assertion.
 *
 * ⚠️ Lives here rather than in the suites that read it. Two guards had already grown their own copy of this
 * splitter; a third would have been the artefact this whole module exists to avoid, one reader drifting from
 * another while both stay green.
 *
 * @returns Every job in every workflow, in file order. Impure.
 * @sideEffect Shells out to git and reads the workflow files.
 */
export function workflowJobs(): readonly WorkflowJob[] {
    const isJobHeader = (line: string): boolean => /^ {4}[a-z][a-z0-9-]*:\s*$/u.test(line);

    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const workflow = path.basename(file);
            const lines = withoutComments(readFileSync(path.join(repoRoot, file), 'utf8')).split('\n');
            const headers = lines.flatMap((line, index) => (isJobHeader(line) ? [index] : []));

            return headers.map((start, position) => ({
                workflow,
                name: (lines[start] ?? '').trim().replace(':', ''),
                body: lines.slice(start, headers[position + 1] ?? lines.length).join('\n'),
            }));
        });
}

/** One app a workflow deploys, with the place that deploys it — so a failure names a file to open. */
export interface Deployment {
    /** Repo-relative source entrypoint. */
    readonly entrypoint: string;
    /** The workflow that deploys it. */
    readonly workflow: string;
    /**
     * The `--app` argument VERBATIM, runner included, or `undefined` for the `infra:deploy` spelling (whose
     * app string lives in a package manifest, not in the workflow).
     *
     * The verification step has to be given the SAME string the deploy used — `verify-deployment.sh` derives
     * the stack list by synthesising it — so the raw argument, not just the entrypoint, is the fact
     * `deployVerificationCoverage.test.ts` compares.
     */
    readonly appArgument?: string;
}

/**
 * Every CDK app any workflow deploys, in either spelling.
 *
 * @returns One entry per deployment site. Impure.
 * @sideEffect Reads the workflow directory and every workspace manifest.
 */
export function deployedApps(): readonly Deployment[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const yaml = withoutComments(readFileSync(path.join(repoRoot, file), 'utf8'));
            const workflow = path.basename(file);

            const direct = [...yaml.matchAll(APP_ARGUMENT)].map((match) => {
                const appArgument = (match[1] ?? match[2] ?? '').trim();

                return { entrypoint: toSourceEntrypoint(entrypointOf(appArgument)), workflow, appArgument };
            });

            const indirect = [...yaml.matchAll(WORKSPACE_DEPLOY)].flatMap((match) => {
                const entrypoint = entrypointForWorkspace(match[1] ?? '');

                return entrypoint === undefined ? [] : [{ entrypoint, workflow }];
            });

            return [...direct, ...indirect];
        });
}
