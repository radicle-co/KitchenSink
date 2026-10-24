/**
 * TWO CI RUNS OF ONE PULL REQUEST NEVER RUN THEIR DEPLOYED TIERS AT THE SAME TIME.
 *
 * Every deployed tier drives the PR's ONE sandbox: one food catalog, one Clerk test-user pool, one set of services.
 * Two runs that overlap share all of it. Run 39688656484 (60fd4f5c9) failed an Android shard before any flow ran
 * because the run of the previous push was still going: that run's `ingredientCandidates` adopted "halloumi" into the
 * catalog at 23:25, and the newer shard's provision probed the same word at 23:27:53, before the older shard's next
 * purge took it back. The probe was right to refuse the word; the overlap was the fault.
 *
 * So `_ci.yml`'s `deployed-tiers` job takes a concurrency group of its own pull request, and a newer run's tiers WAIT
 * for the older run's to finish. ⛔ They are never cancelled in progress: the tiers include the job that downgrades the
 * owner's Clerk roles and restores them (`test-pool-sandbox-roles-downgraded-owner`), and cancelling it between the two
 * would leave the owner downgraded. That is the same rule every lease in the tiers keeps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

interface Job {
    readonly uses?: string;
    readonly concurrency?: { readonly group?: unknown; readonly 'cancel-in-progress'?: unknown };
}

const ci = parse(readFileSync(join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
    readonly jobs?: Record<string, Job>;
};
const tiers = ci.jobs?.['deployed-tiers'];

describe('_ci.yml::deployed-tiers runs one pull request at a time against its sandbox', () => {
    it('is the job that calls the deployed tiers', () => {
        expect(tiers?.uses).toBe('./.github/workflows/deployedE2eTiers.yml');
    });

    it('takes a concurrency group keyed by the pull request', () => {
        expect(scalarText(tiers?.concurrency?.group)).toBe(
            'deployed-tiers-${{ github.event.pull_request.number || github.ref }}',
        );
    });

    it('waits for the older run instead of cancelling it', () => {
        expect(tiers?.concurrency?.['cancel-in-progress']).toBe(false);
    });
});
