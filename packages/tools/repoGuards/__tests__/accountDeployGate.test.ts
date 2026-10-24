/**
 * The account deploy's ORDER is kept by a person, so the person's gate must not be removable by accident.
 *
 * ADR-0065 (Decision 11): the CI-role stack is first deployed under `ksaccount` by the owner, and a later run of
 * `accountDeploy.yml` is safe only after the production stacks have moved onto `ksprod`, because the `ksaccount`
 * boundary denies the default bootstrap roles. Nothing in the workflow can check that order; the `Production`
 * environment's required reviewer is the only control. That makes three properties of the workflow load-bearing, and
 * this guard holds them:
 *
 * - the deploy job is bound to the `Production` environment (the reviewer);
 * - it signs in as the `prod` tier (the one principal the `ksaccount` bootstrap roles trust);
 * - it runs only on a push to `main` or a manual dispatch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly uses?: string;
    readonly with?: Readonly<Record<string, string>>;
}

interface Job {
    readonly environment?: string;
    readonly if?: string;
    readonly steps?: readonly Step[];
}

const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/accountDeploy.yml'), 'utf8')) as {
    readonly jobs: Readonly<Record<string, Job>>;
};

describe('accountDeploy.yml keeps the only control over the account deploy order', () => {
    const jobs = Object.values(workflow.jobs);

    it('has exactly one job, so there is one gate to hold', () => {
        expect(jobs).toHaveLength(1);
    });

    it('binds the deploy job to the Production environment (its required reviewer is the ordering control)', () => {
        expect(jobs[0]?.environment).toBe('Production');
    });

    it('signs in as the prod tier, the only principal the ksaccount bootstrap roles trust', () => {
        const auth = (jobs[0]?.steps ?? []).filter((step) => step.uses?.endsWith('/awsAuth') === true);

        expect(auth.map((step) => step.with?.['tier'])).toEqual(['prod']);
    });

    it('deploys only from main or by hand', () => {
        const condition = (jobs[0]?.if ?? '').replaceAll(/\s+/gu, ' ');

        expect(condition).toContain("github.event_name == 'workflow_dispatch'");
        expect(condition).toContain("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    });
});
