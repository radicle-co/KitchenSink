// @vitest-environment node
/**
 * Repo-wide guard for ADR-0087: CI end-to-end runs select by impact, and the manual door keeps the whole suite.
 *
 * What it proves, by reading the workflows:
 * 1. `select-e2e` needs no sandbox job, so a down sandbox cannot stop the selection from being made.
 * 2. The job `detect-mobile-flows` and its hand-typed path lists are gone, and `select-e2e` replaced it in the
 *    `deployed-tiers` call and in the verdict.
 * 3. The deployed tiers get the web matrix, the test count, the list and the Maestro selector from `select-e2e`
 *    and from nowhere else.
 * 4. The web matrix is `fromJSON(inputs.web_shards)`, and the default of that input, which the manual door gets, is
 *    exactly one shard per lane of `POOL_ROSTER.web`. A pool that grows without this default growing fails here.
 * 5. `deployedE2e.yml` (the manual door, ADR-0032 section 4) passes none of the narrowing inputs, so it runs everything.
 * 6. No workflow step runs a test runner by hand: Playwright and Maestro runs go through `npm run`.
 *
 * What it does not prove: that the selector picks the right tests (that is `@kitchensink/e2e-plan`'s own suites), or
 * that a pull request run behaves, which only real CI shows.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { POOL_ROSTER } from '@kitchensink/e2e-fixtures/testPool';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
    readonly run?: string;
    readonly uses?: string;
    readonly with?: Record<string, unknown>;
    readonly script?: string;
}

interface Job {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Record<string, string>;
    readonly steps?: readonly Step[];
    readonly strategy?: { readonly matrix?: Record<string, unknown> };
}

interface Workflow {
    readonly on?: Record<string, { readonly inputs?: Record<string, { readonly default?: unknown }> }>;
    readonly jobs: Record<string, Job>;
}

const load = (file: string): Workflow =>
    yaml.parse(readFileSync(`${REPO_ROOT}/.github/workflows/${file}`, 'utf8')) as Workflow;

const needsOf = (job: Job): readonly string[] =>
    job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;

const CI = load('_ci.yml');
const TIERS = load('deployedE2eTiers.yml');
const MANUAL = load('deployedE2e.yml');
const SANDBOX_JOBS = ['sandbox-status', 'resolve-sandbox', 'deploy-preview', 'preview-address', 'wait-identity-deploy'];
const NARROWING_INPUTS = ['web_shards', 'web_tests', 'web_specs', 'maestro_flow_selector'] as const;

describe('select-e2e', () => {
    const job = CI.jobs['select-e2e'];

    it('exists', () => {
        expect(job).toBeDefined();
    });

    it('needs no sandbox job and has no sandbox condition', () => {
        const needs = needsOf(job as Job);

        expect(needs.filter((name) => SANDBOX_JOBS.includes(name) || name === 'mobile-app-build')).toEqual([]);
        expect(JSON.stringify((job as Job).if ?? '')).not.toMatch(/sandbox/u);
    });

    it('asks the selector through npm scripts', () => {
        const runs = ((job as Job).steps ?? []).map((step) => step.run ?? '').join('\n');

        expect(runs).toContain('npm run e2e:select --workspace=@commise/web');
        expect(runs).toContain('npm run ci:mobile --workspace=@kitchensink/e2e-plan');
    });
});

describe('detect-mobile-flows', () => {
    it('is gone from the CI workflow, its needs and its verdict', () => {
        expect(CI.jobs['detect-mobile-flows']).toBeUndefined();
        expect(readFileSync(`${REPO_ROOT}/.github/workflows/_ci.yml`, 'utf8')).not.toMatch(
            /detect-mobile-flows|flows_auth/u,
        );
    });
});

describe('the deployed-tiers call', () => {
    const call = CI.jobs['deployed-tiers'] as Job;

    it('waits for select-e2e and requires it to have succeeded', () => {
        expect(needsOf(call)).toContain('select-e2e');
        expect(call.if).toContain("needs.select-e2e.result == 'success'");
    });

    it.each(NARROWING_INPUTS)('takes %s from select-e2e', (input) => {
        expect(call.with?.[input]).toMatch(/needs\.select-e2e\.outputs\./u);
    });

    it('only switches Maestro on when the selection holds a flow', () => {
        expect(call.with?.['run_mobile_maestro']).toContain("needs.select-e2e.outputs.maestro_run == 'true'");
    });
});

describe('the web matrix', () => {
    const web = TIERS.jobs['e2e-web'] as Job;
    const input = TIERS.on?.['workflow_call']?.inputs?.['web_shards'];

    it('is read from the web_shards input', () => {
        expect(web.strategy?.matrix?.['shard']).toBe('${{ fromJSON(inputs.web_shards) }}');
    });

    it('does not start when there are no shards, because a matrix cannot be empty', () => {
        expect(web.if).toContain("inputs.web_shards != '[]'");
    });

    it('defaults to one shard for every lane of the web pool', () => {
        const lanes = POOL_ROSTER.web.length;

        expect(input?.default).toBe(JSON.stringify(Array.from({ length: lanes }, (_, index) => index + 1)));
    });
});

describe('the manual door', () => {
    const call = Object.values(MANUAL.jobs).find((job) => job.uses?.endsWith('deployedE2eTiers.yml'));

    it('calls the tiers', () => {
        expect(call).toBeDefined();
    });

    it.each(NARROWING_INPUTS)('does not narrow with %s, so it runs the whole suite', (input) => {
        expect(call?.with?.[input]).toBeUndefined();
    });

    it('does not call the selection', () => {
        expect(JSON.stringify(MANUAL)).not.toContain('select-e2e');
    });
});

describe('every test run is an npm script', () => {
    const runs = ['_ci.yml', 'deployedE2eTiers.yml', 'deployedE2e.yml', '_ci-heavy.yml', 'ci-pr.yml'].flatMap((file) =>
        Object.entries(load(file).jobs).flatMap(([name, job]) =>
            (job.steps ?? []).map((step) => ({ where: `${file}:${name}`, text: step.run ?? step.script ?? '' })),
        ),
    );

    it.each([
        ['playwright test', /\bplaywright test\b/u],
        ['the Maestro runner', /runMaestroFlows\.sh/u],
        ['maestro test', /\bmaestro test\b/u],
    ])('no step runs %s by hand', (_name, pattern) => {
        const offenders = runs.filter((run) => pattern.test(run.text)).map((run) => run.where);

        expect(offenders).toEqual([]);
    });
});
