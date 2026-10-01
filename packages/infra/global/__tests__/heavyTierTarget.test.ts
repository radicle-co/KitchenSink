// @vitest-environment node
/**
 * Repo-wide guard: the heavy tiers (Maestro, deployed k6) take WHAT THEY DRIVE from an explicit
 * `target_stage` input, separate from the `stage` input that names the Clerk tenant.
 *
 * ## The defect this pins
 *
 * `_ci-heavy.yml` had ONE `stage` input carrying two facts. It named the Clerk TENANT — the secret path
 * `load-secrets` reads and the tenant `e2e-seed provision` writes into, and only `sandbox` exists — and, when
 * there was no pull request in context, it also named the TARGET whose origins the tiers drive. On a PR the
 * target came from the PR number instead, so the conflation was invisible there. It surfaced on the manual
 * door: `deployedE2e.yml` dispatched with `stage=pr-91` had no PR number, had to pass the tenant (`sandbox`,
 * because a `pr-91` tenant does not exist and the Maestro tier refuses it), and so both tiers resolved the
 * SHARED `sandbox` origins — where nothing is deployed — and skipped. A manual e2e run of a PR's preview ran no
 * Maestro and no k6, green.
 *
 * `target_stage` makes the two facts two inputs. It WINS over the PR number when set: an explicit statement
 * of what to drive is a better authority than the event that happened to start the run, and on every caller
 * that sets it the two agree anyway.
 *
 * ## How it is proved
 *
 * By running each tier's own resolution step under bash with the input bound, the posture
 * `maestroStageGuard.test.ts` established. `node` is stubbed on `PATH` so the origin resolver needs no built
 * workspace. The job-level Maestro `STAGE` expression cannot be executed, so its precedence is checked as
 * text; everything downstream of it is executed.
 *
 * Mutation evidence is recorded in the commit that introduced this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { runWorkflowStep } from './workflowStepRunner.js';
import { scalarText } from './workflowScalar.js';

const HEAVY = join(repoRoot, '.github', 'workflows', '_ci-heavy.yml');

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface HeavyDocument {
    readonly on: { readonly workflow_call: { readonly inputs: Readonly<Record<string, Record<string, unknown>>> } };
    readonly jobs: Readonly<Record<string, Job>>;
}

const heavy = (): HeavyDocument => parse(readFileSync(HEAVY, 'utf8')) as HeavyDocument;

/** The `run:` body of one step, found by id. */
function stepBody(job: string, id: string): string {
    const step = (heavy().jobs[job]?.steps ?? []).find((candidate) => candidate.id === id);

    if (step?.run === undefined) {
        throw new Error(`_ci-heavy.yml::${job} has no step with id \`${id}\` — this guard lost its subject`);
    }

    return step.run;
}

describe('_ci-heavy.yml declares a target separate from its tenant', () => {
    it('takes an optional `target_stage` string whose default changes nothing for existing callers', () => {
        const input = heavy().on.workflow_call.inputs['target_stage'];

        expect(input, '_ci-heavy.yml has no target_stage input').toBeDefined();
        expect(input?.['type']).toBe('string');
        expect(input?.['required']).toBe(false);
        expect(input?.['default']).toBe('');
    });
});

describe('the Maestro tier drives the stated target', () => {
    const target = (env: Readonly<Record<string, string>>) =>
        runWorkflowStep(stepBody('resolve-mobile-target', 'target'), { DOMAIN_NAME: 'example.test', ...env });

    it('⛔ its job-level STAGE takes `inputs.target_stage` FIRST, then the PR number, then the tenant', () => {
        const stage = scalarText(heavy().jobs['resolve-mobile-target']?.env?.['STAGE']).replace(/\s+/g, ' ');

        expect(stage).toMatch(
            /^\$\{\{ inputs\.target_stage \|\| github\.event\.pull_request\.number && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| inputs\.stage \}\}$/,
        );
    });

    it('resolves a PR preview’s own origins while the tenant stays sandbox', () => {
        const outcome = target({ STAGE: 'pr-91', CLERK_STAGE: 'sandbox' });

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.outputs['eligible']).toBe('true');
        expect(outcome.outputs['stage']).toBe('pr-91');
        expect(outcome.outputs['web_origin']).toBe('https://pr-91.sandbox.example.test');
        expect(outcome.outputs['identity_origin']).toBe('https://identity.sandbox.example.test');
    });

    it('⛔ never points the emulator at production origins — a prod target SKIPS, and says so', () => {
        const outcome = target({ STAGE: 'prod', CLERK_STAGE: 'sandbox' });

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.outputs['eligible']).toBe('false');
        expect(outcome.log).toMatch(/::notice::/);
    });

    it('⛔ refuses a target it does not recognise, loudly', () => {
        const outcome = target({ STAGE: 'pr-91; curl evil', CLERK_STAGE: 'sandbox' });

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::/);
    });
});

describe('the manual door hands the heavy tiers the stage it resolved', () => {
    const WORKFLOWS = join(repoRoot, '.github', 'workflows');

    interface Call {
        readonly uses?: string;
        readonly with?: Readonly<Record<string, unknown>>;
    }

    const jobsOf = (file: string): Readonly<Record<string, Call>> =>
        (parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as { jobs: Record<string, Call> }).jobs;

    /**
     * REWRITTEN when the door stopped calling `_ci-heavy.yml` itself: it now calls `deployedE2eTiers.yml`, which
     * calls the heavy tiers. The property is unchanged — the stage the door RESOLVED reaches `target_stage`, and
     * the tenant never carries it — so the chain is followed hop by hop rather than asserted at one end.
     */
    it('⛔ its resolved target reaches both heavy calls as `target_stage`, and never as the tenant', () => {
        const doorCalls = Object.values(jobsOf('deployedE2e.yml')).filter((job) =>
            (job.uses ?? '').endsWith('/deployedE2eTiers.yml'),
        );

        expect(doorCalls, 'the manual door no longer reaches the tiers workflow').toHaveLength(1);
        expect(scalarText(doorCalls[0]?.with?.['target_stage'])).toBe('${{ needs.resolve.outputs.stage }}');

        const heavyCalls = Object.values(jobsOf('deployedE2eTiers.yml')).filter((job) =>
            (job.uses ?? '').endsWith('/_ci-heavy.yml'),
        );

        expect(heavyCalls.length, 'the tiers workflow no longer reaches the heavy tiers').toBeGreaterThan(0);

        for (const call of heavyCalls) {
            expect(scalarText(call.with?.['target_stage'])).toBe('${{ inputs.target_stage }}');
            expect(scalarText(call.with?.['stage'])).not.toContain('target_stage');
        }
    });
});

describe('the deployed k6 tier drives the stated target', () => {
    const k6 = () => heavy().jobs['load-test-deployed'];
    const target = (env: Readonly<Record<string, string>>) =>
        runWorkflowStep(stepBody('load-test-deployed', 'target'), {
            DOMAIN_NAME: 'example.test',
            LOAD_TEST_TARGET: 'sandbox',
            PR_NUMBER: '',
            FALLBACK_STAGE: 'sandbox',
            TARGET_STAGE: '',
            ...env,
        });

    it('binds `inputs.target_stage` into its resolution step', () => {
        const step = (k6()?.steps ?? []).find((candidate) => candidate.id === 'target');

        expect(step?.env?.['TARGET_STAGE']).toBe('${{ inputs.target_stage }}');
    });

    it('⛔ a manual run with a PR target and NO pull request measures that PR’s preview, not the shared tier', () => {
        const outcome = target({ TARGET_STAGE: 'pr-91' });

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.outputs['stage']).toBe('pr-91');
        expect(outcome.outputs['recipe']).toBe('https://recipe.origin.example.test');
        expect(outcome.outputs['identity_stage']).toBe('sandbox');
        expect(outcome.outputs['web_origin']).toBe('https://pr-91.sandbox.example.test');
    });

    it('keeps today’s behaviour for a caller that states no target', () => {
        expect(target({ PR_NUMBER: '7' }).outputs['stage']).toBe('pr-7');
        expect(target({}).outputs['stage']).toBe('sandbox');
        expect(target({ LOAD_TEST_TARGET: 'prod', TARGET_STAGE: 'pr-91' }).outputs['stage']).toBe('prod');
    });

    it('⛔ refuses `target_stage=prod` unless `load_test_target` says prod — the input with the dispatch refusal', () => {
        const outcome = target({ TARGET_STAGE: 'prod' });

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::/);
    });

    it('⛔ refuses a target it does not recognise, loudly', () => {
        const outcome = target({ TARGET_STAGE: 'staging' });

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::/);
    });
});
