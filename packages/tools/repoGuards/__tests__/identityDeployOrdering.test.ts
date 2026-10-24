/**
 * Repo-wide guard: the deployed tiers cannot start before the identity deploy of the SAME commit has finished.
 *
 * A push starts `sandbox-identity-deploy.yml` and `_ci.yml` together, and a workflow cannot `needs:` another
 * workflow, so the ordering is the `wait-identity-deploy` job (`waitForIdentityDeployOfCommit.sh`). The job protects
 * nothing unless `deployed-tiers` needs it AND requires its success: a `needs` edge alone lets a FAILED wait through
 * the tiers' `!cancelled()`, and a success term alone is an unknown job name. This guard holds the whole chain:
 *
 *   1. the job runs only when the tiers could (deploy gate, pull request, resolved stage);
 *   2. it holds `actions: read` (to list runs) and `contents: read` (the checkout) and nothing else;
 *   3. it passes the PR HEAD sha, not `github.sha` (the merge commit, which no workflow run is filed under);
 *   4. `deployed-tiers` needs it and requires its `success`;
 *   5. `ci-verdict` may read its skip as the sandbox's (its `if` is the sandbox gate, `ciSkipsOnlySandbox`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

const JOB = 'wait-identity-deploy';
const TIERS = 'deployed-tiers';

interface Step {
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}
interface Job {
    readonly needs?: string | readonly string[];
    readonly if?: unknown;
    readonly permissions?: Readonly<Record<string, string>>;
    readonly steps?: readonly Step[];
    readonly env?: Readonly<Record<string, unknown>>;
}

const text = readFileSync(join(repoRoot, '.github', 'workflows', '_ci.yml'), 'utf8');
const jobs = (parse(text) as { jobs: Record<string, Job> }).jobs;
const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const needs = (job: Job | undefined): readonly string[] =>
    job?.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;
const condition = (job: Job | undefined): string => (job?.if === undefined ? '' : squash(scalarText(job.if)));

describe('deployed tiers wait for the identity deploy of the same commit', () => {
    it('the wait job exists and runs only when the tiers could', () => {
        const flat = condition(jobs[JOB]);

        expect(jobs[JOB]).toBeDefined();
        expect(flat).toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(flat).toContain("github.event_name == 'pull_request'");
        expect(flat).toContain("needs.resolve-sandbox.outputs.stage != ''");
    });

    it('holds actions: read and contents: read and nothing more', () => {
        expect(jobs[JOB]?.permissions).toEqual({ contents: 'read', actions: 'read' });
    });

    it('asks about the PR head commit through the script, and gives gh a token', () => {
        const step = jobs[JOB]?.steps?.find((s) => s.run?.includes('waitForIdentityDeployOfCommit.sh') === true);

        expect(step?.run).toContain('evaluate "$HEAD_SHA"');
        expect(step?.env?.['HEAD_SHA']).toBe('${{ github.event.pull_request.head.sha }}');
        expect(step?.env?.['GH_TOKEN']).toBeDefined();
    });

    it('deployed-tiers needs it and requires its success', () => {
        expect(needs(jobs[TIERS])).toContain(JOB);
        expect(condition(jobs[TIERS])).toContain(`needs.${JOB}.result == 'success'`);
    });

    it('ci-verdict lists it among the jobs it reads', () => {
        expect(needs(jobs['ci-verdict'])).toContain(JOB);
    });
});
