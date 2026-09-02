// @vitest-environment node
/**
 * Repo-wide guard: every CDK app in this repository must be DEPLOYED by some workflow.
 *
 * ## The failure this pins, for the second time
 *
 * `prodDeployReachability.test.ts` exists because the food and recipe prod legs "carried a full prod leg —
 * image push, CDK deploy, DB migration, smoke test — and neither had ever run". It gates the legs that are
 * PRESENT in `prod-deploy.yml`, so it can only ever ask whether a leg that exists is reachable. It cannot
 * ask whether a leg exists at all, and that is the shape the defect took the second time.
 *
 * `packages/services/ingredient-parser` (ADR-0025's Python CRF Lambda) shipped a stack, an asset builder, a
 * packaging guard, unit and integration tiers, and an `infra:deploy` script — and no workflow anywhere named
 * its app. Meanwhile `RecipeWorkersStack` deployed `RecipeParseLineFunction` into every stage carrying
 * `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}` and an IAM grant to that ARN. Both halves were
 * green: the parser's own tests passed, the workers' stack tests passed, and the function the workers
 * invoked did not exist in any account. `crfInvoke.ts` maps a failed invoke to `unavailable` per line, and
 * the pipeline reads that as `single-engine llm` — so the two-engine parse degraded to one engine, silently,
 * behind green checks, which is ADR-0010's failure verbatim one service over.
 *
 * ## Why it is asserted this way
 *
 * The subject is DISCOVERED on both sides and enumerated on neither, because "a copy of a list cannot detect
 * that the list is incomplete" (ADR-0025 §3, on the `handle-sync-worker` outage) — and a hand-listed set of
 * apps is exactly the artefact that let this one be absent.
 *
 * - The apps come from `git ls-files`, filtered by CONTENT (the file constructs a CDK `App`), so a CDK app
 *   that lands tomorrow is covered the day it is committed and cannot opt out by not being mentioned here.
 *   ⚠️ Construction is the marker, NOT an explicit `app.synth()`: CDK synthesises implicitly at exit and
 *   `@commise/web`'s router app relies on that, so requiring the call would have silently dropped a real app
 *   from the discovered set — a vacuity this file caught on its own first run.
 * - The deployers come from parsing the workflows for the two spellings this repo actually uses: a literal
 *   `cdk deploy --app "<runner> <path>"`, and `npm run infra:deploy --workspace=<pkg>`, which is RESOLVED
 *   through that package's own manifest rather than assumed. A guard that understood only the first spelling
 *   would report `@commise/web` as undeployed and be edited into a hand-written exemption — turning a real
 *   invariant into the list it was written to avoid.
 *
 * ⚠️ A compiled entrypoint (`infra/dist/bin/app.js`) is normalised back to its SOURCE (`infra/bin/app.ts`).
 * The two spellings are one app; treating them as different would let a service be "deployed" by a path that
 * no longer builds.
 *
 * The reverse direction is gated too: a `--app` path that resolves to no discovered entrypoint is a typo or
 * a deleted app that a workflow still tries to deploy, and it fails the run rather than the deploy.
 *
 * ⛔ This guard deliberately does NOT assert WHICH workflow deploys an app, or that prod and sandbox agree.
 * Deployment topology is an ADR-0005/ADR-0010 decision — `@commise/web`'s router is sandbox-only on purpose,
 * and per-PR feature stages are not prod stages. What is not a decision is an app with no deployer at all.
 *
 * DESIGN PATTERN: Specification module over two derivations — {@link cdkApps} and {@link deployedApps} are
 * independent readings of the same fact, compared for coverage. Neither side is the authority alone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';

/** Where the workflows live, relative to {@link repoRoot}. */
const WORKFLOWS_DIR = '.github/workflows';

/**
 * A `cdk deploy --app "<runner> <path>"` argument, in either quote style.
 *
 * The runner (`node`, `npx tsx`, …) is discarded: what identifies the app is the entrypoint path, which is
 * always the argument's LAST whitespace-separated token.
 */
const APP_ARGUMENT = /--app\s+(?:"([^"]+)"|'([^']+)')/gu;

/** `npm run infra:deploy --workspace=<pkg>`, the indirect spelling. */
const WORKSPACE_DEPLOY = /npm\s+run\s+infra:deploy\s+--workspace=(\S+)/gu;

/**
 * Normalise a CDK entrypoint path to the SOURCE file that defines it.
 *
 * `node …/infra/dist/bin/app.js` and `npx tsx …/infra/bin/app.ts` name the same app; a guard that saw two
 * would pass while a service was deployed from a stale build path.
 *
 * @param entrypoint - The `--app` argument's path token, repo-relative.
 * @returns The repo-relative source path. Pure.
 */
function toSourceEntrypoint(entrypoint: string): string {
    return entrypoint.replace(/(^|\/)dist\/bin\/app\.js$/u, '$1bin/app.ts');
}

/**
 * The path token of a `--app` argument.
 *
 * @param argument - The whole quoted argument, runner included.
 * @returns The last token, which is the entrypoint. Pure.
 */
function entrypointOf(argument: string): string {
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
function withoutComments(yaml: string): string {
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
function cdkApps(): readonly string[] {
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
function entrypointForWorkspace(workspace: string): string | undefined {
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

/** One app a workflow deploys, with the place that deploys it — so a failure names a file to open. */
interface Deployment {
    /** Repo-relative source entrypoint. */
    readonly entrypoint: string;
    /** The workflow that deploys it. */
    readonly workflow: string;
}

/**
 * Every CDK app any workflow deploys, in either spelling.
 *
 * @returns One entry per deployment site. Impure.
 * @sideEffect Reads the workflow directory and every workspace manifest.
 */
function deployedApps(): readonly Deployment[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const yaml = withoutComments(readFileSync(path.join(repoRoot, file), 'utf8'));
            const workflow = path.basename(file);

            const direct = [...yaml.matchAll(APP_ARGUMENT)].map((match) => ({
                entrypoint: toSourceEntrypoint(entrypointOf(match[1] ?? match[2] ?? '')),
                workflow,
            }));

            const indirect = [...yaml.matchAll(WORKSPACE_DEPLOY)].flatMap((match) => {
                const entrypoint = entrypointForWorkspace(match[1] ?? '');

                return entrypoint === undefined ? [] : [{ entrypoint, workflow }];
            });

            return [...direct, ...indirect];
        });
}

describe('CDK app deploy coverage', () => {
    it('discovers the repository’s CDK apps — the gate has not stopped seeing them', () => {
        // Vacuity guard: a discovery that silently finds nothing would make every assertion below pass.
        expect(cdkApps().length).toBeGreaterThan(1);
    });

    it('deploys every CDK app from some workflow', () => {
        const deployed = new Set(deployedApps().map(({ entrypoint }) => entrypoint));
        const undeployed = cdkApps().filter((app) => !deployed.has(app));

        expect(
            undeployed,
            'Every CDK app must be deployed by a workflow. An app with a stack, tests and an `infra:deploy` ' +
                'script that no pipeline ever runs is not "not yet wired" — it is a resource other stacks ' +
                'already reference by name and no account contains. See ADR-0025 and ADR-0010.',
        ).toEqual([]);
    });

    it('deploys only CDK apps that exist', () => {
        const apps = new Set(cdkApps());
        const dangling = deployedApps().filter(({ entrypoint }) => !apps.has(entrypoint));

        expect(
            dangling,
            'A workflow names a CDK entrypoint this repository does not define — a typo, or an app that ' +
                'was deleted while its deploy step stayed behind. Either way the deploy fails at run time.',
        ).toEqual([]);
    });
});
