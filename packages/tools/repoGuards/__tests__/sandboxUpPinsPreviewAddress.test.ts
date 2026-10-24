/**
 * Sandbox Up's `domain` job calls `previewDomain.yml`. With no `commit_sha` the callee chooses "the latest Vercel build
 * of the branch", which in the window after a push names the PREVIOUS build, so a press could move the address back to
 * an older commit (and `previewCurrency` would go red). Every other caller (`_ci.yml`'s push path) pins the PR head, so
 * Sandbox Up must too, and it must read that commit from the PR rather than from the dispatch ref.
 *
 * DESIGN PATTERN: Specification over a parsed workflow, with a vacuity check on both ends of the wire.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';

interface Job {
    readonly uses?: string;
    readonly with?: Record<string, string>;
    readonly outputs?: Record<string, string>;
    readonly steps?: readonly { readonly id?: string; readonly run?: string }[];
}

const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/sandboxUp.yml'), 'utf8')) as {
    jobs: Record<string, Job>;
};

describe('Sandbox Up pins the preview address to the PR head commit', () => {
    const domain = Object.values(workflow.jobs).find((job) => job.uses?.endsWith('/previewDomain.yml'));
    const start = workflow.jobs['start'];

    it('is not vacuous: the address job and the start job exist', () => {
        expect(domain, 'no job calls previewDomain.yml').toBeDefined();
        expect(start, 'the start job is gone').toBeDefined();
    });

    it('hands previewDomain.yml the head commit the start job read', () => {
        expect(domain?.with?.['commit_sha']).toBe('${{ needs.start.outputs.head_sha }}');
        expect(start?.outputs?.['head_sha']).toBe('${{ steps.pr.outputs.head_sha }}');
    });

    it('reads that commit from the PR (headRefOid) and refuses a malformed one', () => {
        const run = start?.steps?.find((step) => step.id === 'pr')?.run ?? '';

        expect(run).toContain('headRefOid');
        expect(run).toContain('^[0-9a-f]{40}$');
        expect(run).toContain('head_sha=');
    });
});
