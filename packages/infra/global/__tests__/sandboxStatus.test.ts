// @vitest-environment node
/**
 * Repo-wide guard: the pipeline ASKS whether the sandbox is up, and refuses to call a silent skip a pass.
 *
 * ## What this replaces
 *
 * ADR-0028 made previews on-demand and the switch was a `sandbox-up` label. A label a human must remember
 * is a single point of failure whose failure mode is silence: forget it, every deployed tier skips, every
 * check is green, and the skip is indistinguishable from a pass. The pipeline can simply ask, so it does.
 *
 * ADR-0032's ruling is untouched and must stay untouched by anything here: a deployed TIER skips when the
 * sandbox is not running, and that is correct. What the ADR left open — and names itself — is the PR-level
 * question: "a PR merged without ever raising a sandbox has had no end-to-end test of any kind … and
 * neither is enforced by a check". This is that check.
 *
 * ⛔ The predicate is executed as real `bash`, never re-implemented here: a TypeScript copy is a second
 * decision free to drift from the one CI runs. Same reason as `deployGate.test.ts` and `prScope.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-status.sh', import.meta.url));

/** One verdict, as the script prints it. */
function verdict(tierUp: string, skipLabel: string): { readonly branch: string; readonly reason: string } {
    const run = spawnSync('bash', [SCRIPT, 'verdict', tierUp, skipLabel], { encoding: 'utf8' });
    const read = (key: string): string =>
        (run.stdout ?? '')
            .split('\n')
            .find((line) => line.startsWith(`${key}=`))
            ?.slice(key.length + 1) ?? '';

    return { branch: read('branch'), reason: read('reason') };
}

describe('the e2e branch verdict', () => {
    it('RUNS when the shared tier is up', () => {
        expect(verdict('true', 'false').branch).toBe('run');
    });

    it('⛔ FAILS when the tier is down and nobody said that was intended', () => {
        // THE CASE THIS EXISTS FOR. Today it is green and says nothing.
        const result = verdict('false', 'false');

        expect(result.branch).toBe('fail');
        expect(result.reason).toContain('DOWN');
    });

    it('SKIPS on the explicit label', () => {
        expect(verdict('false', 'true').branch).toBe('skip');
    });

    it('⛔ honours the label even when the tier IS up', () => {
        // `skip-e2e` is a statement about the CHANGE, not about the environment. Honouring it only when the
        // sandbox happens to be down would make its meaning depend on infrastructure state — so a PR that
        // opted out would silently start running e2e the day somebody else raised a sandbox.
        expect(verdict('true', 'true').branch).toBe('skip');
    });

    it('is MISUSE — never a branch — to call it with missing arguments', () => {
        // ⛔ A gate invoked with nothing to judge must not answer `run` or `skip`. Both would let a pipeline
        // proceed on a verdict nobody reached.
        expect(spawnSync('bash', [SCRIPT, 'verdict'], { encoding: 'utf8' }).status).toBe(2);
        expect(spawnSync('bash', [SCRIPT, 'verdict', 'true'], { encoding: 'utf8' }).status).toBe(2);
    });

    it('is MISUSE to invoke the script with no subcommand, or probe with no stage', () => {
        expect(spawnSync('bash', [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
        expect(spawnSync('bash', [SCRIPT, 'probe', 'us-east-1'], { encoding: 'utf8' }).status).toBe(2);
    });
});

describe('the probe reads the tier from the ONE place that defines it', () => {
    it('⛔ derives the stacks from the reclaim allowlist rather than restating them', () => {
        // The thing that RAISES the tier, the thing that DELETES it and the thing that DETECTS it must
        // agree about what it is. `sandbox-shared-tier.sh`'s allowlist is the security boundary for the
        // delete, so it is the authority; a second list here would be free to drift from it, and the
        // drift's failure mode is a pipeline that reads a half-reclaimed tier as up.
        const source = readFileSync(SCRIPT, 'utf8');

        expect(source).toContain('sandbox-shared-tier.sh');
        expect(source).toMatch(/sandbox-shared-tier\.sh"? order/u);
    });

    it('⛔ treats a wedged stack as NOT up, not merely an absent one', () => {
        // `describe-stacks` answers happily for `UPDATE_ROLLBACK_FAILED`, so a bare existence check reads a
        // wedged tier as healthy. That is the shape ADR-0010's ensure-exists gate was written after, and
        // `kitchensink-recipe-service-pr-91` reached exactly that state in practice.
        const source = readFileSync(SCRIPT, 'utf8');

        expect(source).toContain('StackStatus');
        expect(source).not.toMatch(/describe-stacks[^\n]*>\/dev\/null 2>&1[^\n]*\n\s*then/u);
    });
});
