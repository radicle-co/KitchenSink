// @vitest-environment node
/**
 * Repo-wide guard (ADR-0060): the workflows drive the sandbox scheduler in exactly the places they must, and nowhere
 * else.
 *
 * ## 1. Every non-prod deploy of an app owning a scheduled rule is followed by a `sync`
 *
 * Outside prod a scheduled rule synthesizes DISABLED, and CloudFormation re-applies a rule's `State` on every update —
 * so every such deploy switches its stage's jobs OFF, including on a stage that is up. `sync`, the only writer of rule
 * state, is what puts them back. A deploy site without one leaves the queue checks and sweepers off behind a green
 * deploy, until the next unrelated sync happens to fix it. The apps are discovered (`scheduledRuleOwners.ts`), the
 * deploy sites are discovered (`workflowJobs()`, composite actions inlined), and a workflow is prod-only when it says
 * `STAGE: prod` itself.
 *
 * ## 2. One invoker, and no stop but the schedule's
 *
 * Every invoke goes through `.github/scripts/sandboxScheduler.sh`, the one place that knows `aws lambda invoke` exits 0
 * when the function threw, and no workflow issues a `stop`: the midnight schedule is the only stop (owner ruling
 * 2026-10-12). That only Sandbox Up asks for a `start`, and that the start payload lives in the invoker alone, is
 * asserted once, in `sandboxWakeWiring.test.ts`.
 *
 * DESIGN PATTERN: Specification module over two derived sets — what the workflows deploy, and what they invoke.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
    ACTIONS_DIR,
    APP_ARGUMENT,
    entrypointForWorkspace,
    entrypointOf,
    foldContinuations,
    toSourceEntrypoint,
    WORKFLOWS_DIR,
    WORKSPACE_DEPLOY,
    withoutComments,
    workflowJobs,
} from './cdkApps.js';
import { scheduledRuleOwners } from './scheduledRuleOwners.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** The ONE invoker of the scheduler from CI. */
const INVOKER = '.github/scripts/sandboxScheduler.sh';

/** A `sync` issued through the invoker. */
const SYNC = /sandboxScheduler\.sh\s+sync\b/u;

/** One deploy of one app, at a position in its job's text. */
interface DeploySite {
    readonly entrypoint: string;
    readonly at: number;
}

/**
 * Every app a job body deploys, with where. Only a `cdk deploy … --app` or an `npm run deploy --prefix` counts —
 * a `cdk synth --app` or `cdk ls --app` changes no rule.
 *
 * @param body - A job's text, comments stripped and continuations folded.
 * @returns The deploy sites, in order. Pure apart from resolving a package manifest.
 */
function deploySites(body: string): readonly DeploySite[] {
    const direct = [...body.matchAll(APP_ARGUMENT)].flatMap((match) => {
        const lineStart = body.lastIndexOf('\n', match.index) + 1;
        const line = body.slice(
            lineStart,
            body.indexOf('\n', match.index) === -1 ? undefined : body.indexOf('\n', match.index),
        );

        return /\bcdk\s+deploy\b/u.test(line)
            ? [{ entrypoint: toSourceEntrypoint(entrypointOf((match[1] ?? match[2] ?? '').trim())), at: match.index }]
            : [];
    });
    const indirect = [...body.matchAll(WORKSPACE_DEPLOY)].flatMap((match) => {
        const entrypoint = entrypointForWorkspace(match[1] ?? match[2] ?? '');

        return entrypoint === undefined ? [] : [{ entrypoint, at: match.index }];
    });

    return [...direct, ...indirect];
}

/**
 * The deploys in a job body that are NOT followed by a `sync`.
 *
 * @param body - A job's text, comments stripped and continuations folded.
 * @param owners - Entrypoints of the apps that own a scheduled rule.
 * @returns The offending entrypoints. Pure.
 */
function unsyncedDeploys(body: string, owners: ReadonlySet<string>): readonly string[] {
    const syncs = [...body.matchAll(new RegExp(SYNC.source, 'gu'))].map((match) => match.index);

    return deploySites(body)
        .filter((site) => owners.has(site.entrypoint) && !syncs.some((at) => at > site.at))
        .map((site) => site.entrypoint);
}

/**
 * Whether workflow text declares itself production-only: a workflow-level `STAGE: prod`. Read from the parsed YAML,
 * not with a regex: the pattern this replaced backtracked exponentially on an `env:` followed by many indented blank
 * lines (CodeQL `js/redos`, alert 502). Text that does not parse as YAML declares nothing. Pure.
 */
function declaresProdStage(text: string): boolean {
    let workflow: unknown;

    try {
        workflow = parse(text);
    } catch {
        return false;
    }

    if (typeof workflow !== 'object' || workflow === null || !('env' in workflow)) {
        return false;
    }

    const { env } = workflow;

    return typeof env === 'object' && env !== null && 'STAGE' in env && env.STAGE === 'prod';
}

/** Whether a workflow file declares itself production-only (see {@link declaresProdStage}). */
function isProdWorkflow(workflow: string): boolean {
    return declaresProdStage(readFileSync(path.join(repoRoot, WORKFLOWS_DIR, workflow), 'utf8'));
}

describe('every non-prod deploy of an app owning a scheduled rule is followed by a sync (ADR-0060)', () => {
    const owners = new Set(scheduledRuleOwners().map((owner) => owner.entrypoint));
    const subjects = workflowJobs()
        .filter((job) => !isProdWorkflow(job.workflow))
        .map((job) => ({ ...job, body: foldContinuations(job.body) }))
        .filter((job) => deploySites(job.body).some((site) => owners.has(site.entrypoint)));

    it('is not vacuous — rule-owning apps and their non-prod deploy sites are both discovered', () => {
        expect(owners.size).toBeGreaterThan(0);
        expect(subjects.map((job) => job.workflow)).toEqual(
            expect.arrayContaining(['deployInfra.yml', 'sandbox-identity-deploy.yml']),
        );
    });

    it('⛔ no such deploy leaves the rules off', () => {
        const offenders = subjects.flatMap((job) =>
            unsyncedDeploys(job.body, owners).map((entrypoint) => `${job.workflow}:${job.name} deploys ${entrypoint}`),
        );

        expect(
            offenders,
            'each of these deploys resets its stage’s scheduled rules to DISABLED and never runs ' +
                '`bash .github/scripts/sandboxScheduler.sh sync` after it — the jobs stay off while the stage is up.',
        ).toEqual([]);
    });

    it('a production workflow is recognised by its own STAGE, and is the only kind exempted', () => {
        expect(isProdWorkflow('prod-deploy.yml')).toBe(true);
        expect(isProdWorkflow('sandbox-identity-deploy.yml')).toBe(false);
        expect(isProdWorkflow('deployInfra.yml')).toBe(false);
    });

    describe('declaresProdStage, on workflow text', () => {
        it.each([
            ['a workflow-level STAGE: prod', 'name: x\nenv:\n    STAGE: prod\njobs: {}\n', true],
            ['STAGE among other workflow-level variables', 'env:\n    A: 1\n    STAGE: prod\n', true],
            ['a job-level STAGE only', 'jobs:\n    a:\n        env:\n            STAGE: prod\n', false],
            ['a sandbox STAGE', 'env:\n    STAGE: sandbox\n', false],
            ['no env block', 'name: x\n', false],
        ])('%s', (_name, text, expected) => {
            expect(declaresProdStage(text)).toBe(expected);
        });

        it('reads a hostile env block in linear time (CodeQL js/redos, alert 502)', () => {
            // The regex this replaced backtracked exponentially on `env:` followed by many indented blank lines.
            const text = `env:\n${'\t\t\n'.repeat(30)}x`;
            const started = performance.now();

            expect(declaresProdStage(text)).toBe(false);
            expect(performance.now() - started).toBeLessThan(250);
        });
    });

    describe('the predicate, on shapes the tree does not hold', () => {
        const owner = 'packages/services/recipe-workers/infra/bin/app.ts';
        const deploy = `cdk deploy --app "npx tsx ${owner}" --all`;
        const owned = new Set([owner]);

        it.each([
            ['a deploy with no sync', `${deploy}\n`, [owner]],
            ['a sync BEFORE the deploy', `bash .github/scripts/sandboxScheduler.sh sync r\n${deploy}\n`, [owner]],
            ['a sync after the deploy', `${deploy}\nbash .github/scripts/sandboxScheduler.sh sync r\n`, []],
            ['a synth, which changes no rule', `cdk synth --app "npx tsx ${owner}"\n`, []],
            ['an app that owns no rule', 'cdk deploy --app "npx tsx packages/apps/commise/web/infra/bin/app.ts"\n', []],
        ])('%s', (_shape, body, expected) => {
            expect(unsyncedDeploys(body, owned)).toEqual(expected);
        });
    });
});

describe('the scheduler is driven through ONE invoker, and only the schedule stops it (ADR-0060)', () => {
    /** Every workflow, composite action and script, comments stripped, by repo path. */
    const sources = [
        ...trackedFiles(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/u.test(file)),
        ...trackedFiles(ACTIONS_DIR).filter((file) => /action\.ya?ml$/u.test(file)),
        ...readdirSync(path.join(repoRoot, '.github/scripts'))
            .filter((file) => file.endsWith('.sh'))
            .map((file) => `.github/scripts/${file}`),
    ].map((file) => ({ file, code: withoutComments(readFileSync(path.join(repoRoot, file), 'utf8')) }));

    it('⛔ only the invoker resolves the scheduler function — no second, hand-rolled invoke', () => {
        expect(sources.filter(({ code }) => code.includes('SchedulerFunctionName')).map(({ file }) => file)).toEqual([
            INVOKER,
        ]);
    });

    it('no workflow or script issues a `stop` — the midnight schedule is the only stop', () => {
        const stop = /sandboxScheduler\.sh\s+stop\b|action\\?["']?\s*:\s*\\?["']stop\\?["']/u;

        expect(sources.filter(({ code }) => stop.test(code)).map(({ file }) => file)).toEqual([]);
    });
});
