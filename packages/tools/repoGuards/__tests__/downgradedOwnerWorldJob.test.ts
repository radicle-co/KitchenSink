// @vitest-environment node
/**
 * Repo-wide guard: the downgraded owner's world is ENSURED by one job of the deployed tiers, and that job runs before
 * either consumer signs in as the owner (owner ruling 2026-10-18).
 *
 * ## The defect this pins
 *
 * The world (a private recipe and a private collection owned by a cook who holds no entitled role) lives in the per-PR
 * recipe database, which Sandbox Down and the midnight reclaim DROP every cycle. It was written by hand, so after every
 * reclaim the Maestro `makePublicConfirm` flow and the web `paidFeatureGate` specs read a world that was not there and
 * failed as if the app were broken.
 *
 * ## What is asserted, and why
 *
 *   1. THE JOB EXISTS and runs `ensureDowngradedWorld` — the only writer of that world in CI.
 *   2. BOTH CONSUMERS `needs:` IT. This is the race guard: the owner is raised while the world is rebuilt, and a consumer
 *      that signed in as it meanwhile would see a premium cook. `needs:` is the only ordering GitHub gives.
 *   3. IT IS GATED WITH THE DEPLOYED TIERS — the same prod-skip as the web tier, never a switch of its own, so a check
 *      skips only when the sandbox tier it serves does (and a `run_mobile_maestro` term would strip web of its
 *      prerequisite).
 *   4. IT SIGNS IN THROUGH `awsAuth` and loads the sandbox Clerk keys through `load-secrets`, with only the OIDC
 *      permission — no new secret, nothing written to the repository.
 *   5. IT SERIALISES with itself: two runs that both reseed would settle the owner under each other.
 *
 * Mutation evidence: dropping a `needs`, widening a permission, or removing the concurrency group each fails exactly
 * one case below.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

const TIERS_FILE = path.join(repoRoot, '.github', 'workflows', 'deployedE2eTiers.yml');
const JOB = 'downgraded-owner-world';
const CONSUMERS = ['e2e-web', 'e2e-mobile-maestro'] as const;

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly name?: string;
    readonly if?: unknown;
    readonly needs?: string | readonly string[];
    readonly permissions?: Readonly<Record<string, string>>;
    readonly concurrency?: { readonly group?: string; readonly 'cancel-in-progress'?: unknown };
    readonly 'timeout-minutes'?: number;
    readonly steps?: readonly Step[];
}

const jobs = (): Readonly<Record<string, Job>> =>
    (parse(readFileSync(TIERS_FILE, 'utf8')) as { readonly jobs: Readonly<Record<string, Job>> }).jobs;

const needsOf = (job: Job): readonly string[] =>
    job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : [...job.needs];

const world = (): Job => {
    const job = jobs()[JOB];

    if (job === undefined) {
        throw new Error(`deployedE2eTiers.yml has no job '${JOB}'`);
    }

    return job;
};

const runs = (job: Job): string => (job.steps ?? []).map((step) => scalarText(step.run)).join('\n');

describe('the downgraded owner’s world is ensured in CI', () => {
    it('has a job that runs the ensure entrypoint', () => {
        expect(runs(world())).toMatch(/ensureDowngradedWorld\.ts|ensure-downgraded/u);
    });

    it.each(CONSUMERS)('⛔ %s needs it, so no consumer signs in as the owner while it is raised', (consumer) => {
        const job = jobs()[consumer];

        expect(job, `${consumer} must exist`).toBeDefined();
        expect(needsOf(job as Job)).toContain(JOB);
    });

    it('⛔ is gated with the deployed tiers: exactly the web tier’s production skip, and nothing of its own', () => {
        const web = jobs()['e2e-web'];

        expect(scalarText(world().if).replace(/\s+/gu, ' ').trim()).toBe(
            scalarText(web?.if).replace(/\s+/gu, ' ').trim(),
        );
        expect(scalarText(world().if)).toContain("inputs.target_stage != 'prod'");
        expect(scalarText(world().if)).not.toMatch(/run_mobile_maestro|run_load_test/u);
    });

    it('refuses a production target in its own first step, which reads TARGET_STAGE', () => {
        const first = world().steps?.[0];

        expect(first?.env?.['TARGET_STAGE']).toBe('${{ inputs.target_stage }}');
        expect(scalarText(first?.run)).toMatch(/::error::/u);
    });

    it('⛔ signs in through awsAuth, then loads the SANDBOX Clerk keys, with the OIDC permission and no more', () => {
        const job = world();
        const steps = job.steps ?? [];
        const auth = steps.findIndex((step) => (step.uses ?? '').includes('actions/awsAuth'));
        const load = steps.findIndex((step) => (step.uses ?? '').includes('actions/load-secrets'));

        expect(auth).toBeGreaterThanOrEqual(0);
        expect(load).toBeGreaterThan(auth);
        expect(steps[load]?.with?.['stage']).toBe('sandbox');
        expect(scalarText(steps[load]?.if)).toContain('authenticated');
        expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    });

    it('hands the entrypoint the origins this run resolved, and no secret', () => {
        const step = (world().steps ?? []).find((candidate) =>
            /ensureDowngradedWorld|ensure-downgraded/u.test(scalarText(candidate.run)),
        );

        expect(step?.env?.['E2E_SEED_RECIPE_URL']).toBe('${{ inputs.recipe_origin }}');
        expect(step?.env?.['E2E_SEED_WEB_ORIGIN']).toBe('${{ inputs.web_origin }}');
        expect(step?.env?.['E2E_SEED_IDENTITY_URL']).toBe('${{ inputs.identity_origin }}');
        expect(JSON.stringify(step?.env)).not.toMatch(/secrets\./u);
    });

    it('⛔ holds a lease of its own and never cancels a run that is mid-reseed', () => {
        const { concurrency } = world();

        expect(concurrency?.group).toMatch(/^test-pool-sandbox-/u);
        expect(concurrency?.['cancel-in-progress']).toBe(false);
    });

    it('is bounded', () => {
        expect(world()['timeout-minutes']).toBeGreaterThan(0);
        expect(world()['timeout-minutes']).toBeLessThanOrEqual(15);
    });
});
