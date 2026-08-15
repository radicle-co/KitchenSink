// @vitest-environment node
/**
 * Repo-wide guard: the RECLAMATION jobs must never be bound to a GitHub Environment.
 *
 * ## The failure this pins
 *
 * `sandbox-deploy.yml` reclaims per-PR infrastructure in two places — `cleanup` (on PR close) and
 * `reap-abandoned` (the daily sweep, which is the ONLY retry a stack that failed to delete on close ever
 * gets). Both were briefly bound to the `Sandbox` GitHub Environment while wiring the `secrets-outside-env`
 * remediation, on the reasoning that every secret-reading job should name an Environment.
 *
 * That reasoning is right for deploys and wrong for reclamation, because an Environment binding is a place a
 * run can be made to WAIT — a required reviewer, a wait timer, or a branch policy all suspend the job — and
 * the two failure modes are not symmetric:
 *
 *   - A stalled DEPLOY is loud and free. The preview simply does not appear, someone notices immediately, and
 *     nothing accrues while it waits.
 *   - A stalled CLEANUP is silent and expensive. The PR closes green, CloudFormation stacks / ECS services /
 *     Route 53 records / Vercel claims all survive, and the bill runs until a human happens to look. It is
 *     precisely the leak class the teardown script exists to prevent, reintroduced through the front door.
 *
 * So `Sandbox` is documented as MUST-KEEP-ZERO-PROTECTION-RULES — but that document lives in GitHub repo
 * settings, which no test can see and any admin can change in two clicks, from a UI that gives no hint that
 * a scheduled reaper depends on the box staying unchecked. Convention is the wrong enforcement mechanism for
 * a constraint whose violation is invisible and whose blast radius is monetary.
 *
 * ## Why it is asserted this way
 *
 * The assertion is inverted relative to the hazard: rather than trying to prove the remote Environment has no
 * protection rules (unknowable at test time, and mutable after the test passes), it proves the reclamation
 * jobs never DEPEND on an Environment at all. An unbound job cannot be gated by any rule added later, so the
 * invariant holds no matter what happens in repo settings — the test closes the hole rather than watching it.
 *
 * Read from the YAML rather than a grep so that a binding added via an anchor, an alias, or a differently
 * indented block is still caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

/**
 * Jobs whose purpose is to DELETE per-PR infrastructure. Adding one here is the cheap half of the contract;
 * the expensive half is remembering that anything which can suspend them turns a PR close into a bill.
 */
const RECLAMATION_JOBS: readonly { readonly workflow: string; readonly job: string }[] = [
    { workflow: 'sandbox-deploy.yml', job: 'cleanup' },
    { workflow: 'sandbox-deploy.yml', job: 'reap-abandoned' },
];

/** Parses a workflow under `.github/workflows/`. */
const readWorkflow = (name: string): Record<string, unknown> =>
    parse(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8')) as Record<string, unknown>;

describe('reclamation jobs are never gated behind a GitHub Environment', () => {
    for (const { workflow, job } of RECLAMATION_JOBS) {
        it(`${workflow} → ${job} declares no environment:`, () => {
            const jobs = readWorkflow(workflow)['jobs'] as Record<string, Record<string, unknown>>;

            // Guards the guard: a renamed or deleted job must fail loudly rather than vacuously pass by
            // looking up `undefined` and finding no `environment` key on it.
            expect(jobs, `${job} no longer exists in ${workflow} — update RECLAMATION_JOBS`).toHaveProperty(job);

            expect(
                jobs[job]?.['environment'],
                `${job} is bound to a GitHub Environment. Reclamation must never be gated: any protection ` +
                    `rule on that environment (reviewer, wait timer, branch policy) suspends the job, and a ` +
                    `suspended cleanup leaks AWS spend silently instead of failing loudly.`,
            ).toBeUndefined();
        });
    }

    it('the deploying jobs ARE bound, so this guard is not just asserting the absence of all bindings', () => {
        const jobs = readWorkflow('sandbox-deploy.yml')['jobs'] as Record<string, Record<string, unknown>>;

        // Without this, deleting every `environment:` key in the file would leave the suite green and the
        // deploy-side scoping silently undone.
        expect(jobs['deploy-food']?.['environment']).toBe('Sandbox');
        expect(jobs['deploy-recipe']?.['environment']).toBe('Sandbox');
    });
});
