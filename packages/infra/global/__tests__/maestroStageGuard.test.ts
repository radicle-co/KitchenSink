// @vitest-environment node
/**
 * Repo-wide guard: the Maestro tier REFUSES every stage but `sandbox`, loudly, before it loads a stage secret.
 *
 * ## The defect this pins
 *
 * `_ci-heavy.yml`'s `e2e-mobile-maestro` job is parameterised by `inputs.stage`, and it USES that stage for
 * a write: it loads the stage's Clerk keys and runs `ensure-signin-user.mjs`, which provisions the shared
 * `+clerk_test` sign-in user into THAT tenant. Everything the job then measures is stage-independent — the
 * recipe service it drives is a runner-local Docker container under the dev-auth bypass. So on `prod` the
 * job mutates the production Clerk instance in exchange for a result that says nothing about production.
 * And `ci-full.yml`'s dispatcher offers `prod` as a stage and forwards it straight through (review of
 * PR #91).
 *
 * ## Why a failing STEP and not a job-level `if:`
 *
 * A job-level `if: inputs.stage == 'sandbox'` skips silently — a green heavy run in which the mobile tier
 * ran nothing, which is the class of outcome this repo's guards exist to make impossible. A first step that
 * exits 1 with the reason keeps the mistake visible and costs one runner boot. It sits BEFORE the secret
 * load so a refused run never holds a production credential at all.
 *
 * ## How it is asserted
 *
 * The provisioning job is DISCOVERED (the job whose steps run `ensure-signin-user`). The refusal is the step
 * that binds `STAGE: ${{ inputs.stage }}` — the only spelling through which a step can read the reusable
 * workflow's input — and its decision is proved by BEHAVIOUR: that step's `run:` body, and only that body,
 * is executed under real `bash` with `STAGE=prod` (must exit non-zero, with a `::error::` annotation) and
 * with `STAGE=sandbox` (must exit 0). Its position is then checked against the first step that loads a
 * stage secret. Nothing here re-implements the decision; the workflow's own bash is what runs, the same
 * posture as `deployGate.test.ts` and `prScope.test.ts`.
 *
 * ⚠️ Only the candidate step is executed, on purpose. A first draft ran EVERY step body looking for "the
 * first one that fails under prod" — and found the provisioning step itself (it fails for want of a Clerk
 * key), while the steps after it include `rm -rf "$HOME/.maestro"` and a conditional `npm ci`. A guard must
 * not run a workflow's side effects on the machine that runs the guard.
 *
 * Mutation evidence: written before the step existed, and its first run reported "no step binds STAGE to
 * inputs.stage" against the real `_ci-heavy.yml`. Inverting the comparison in the step (`= 'sandbox'`)
 * reds the `prod` case; moving the step below the secret load reds the position case.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

/** The step that writes into the stage's Clerk tenant. */
const PROVISIONS_TEST_USER = /ensure-signin-user/u;

/** The step that reads the stage's secrets — nothing privileged may run before the refusal. */
const LOADS_STAGE_SECRETS = /load-secrets/u;

/** The stage input, as a step must spell it to read the reusable workflow's input. */
const STAGE_INPUT = '${{ inputs.stage }}';

/** The job that provisions a Clerk test user, discovered rather than named. */
function provisioningJob(): { readonly id: string; readonly steps: readonly WorkflowStep[] } {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as WorkflowDocument;
    const found = Object.entries(doc.jobs ?? {}).find(([, job]) =>
        (job.steps ?? []).some((step) => PROVISIONS_TEST_USER.test(step.run ?? '')),
    );

    if (found === undefined) {
        throw new Error('no job in _ci-heavy.yml provisions the Clerk sign-in test user — the guard has no subject');
    }

    return { id: found[0], steps: found[1].steps ?? [] };
}

/**
 * Execute a step's `run:` body the way the runner does (`bash -e -o pipefail`), with `STAGE` bound.
 *
 * @sideEffect Writes the body to a temp file and spawns bash.
 */
function runStep(
    body: string,
    stage: string,
): { readonly status: number; readonly stderr: string; readonly stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-stage-guard-'));
    const script = join(dir, 'step.sh');

    writeFileSync(script, body);

    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', STAGE: stage },
    });

    return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout };
}

describe('_ci-heavy.yml — the Maestro tier is sandbox-only, and says so before loading a stage secret', () => {
    const { id, steps } = provisioningJob();
    const secretLoad = steps.findIndex((step) => LOADS_STAGE_SECRETS.test(step.uses ?? ''));
    const provisioning = steps.findIndex((step) => PROVISIONS_TEST_USER.test(step.run ?? ''));
    // The only steps whose body is ever executed here: those that read the stage input into `STAGE`.
    const candidates = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run !== undefined && step.env?.['STAGE'] === STAGE_INPUT);

    it('finds its subject: the provisioning job loads stage secrets before it provisions', () => {
        expect(secretLoad, `${id} has no load-secrets step`).toBeGreaterThan(-1);
        expect(provisioning, `${id} has no provisioning step`).toBeGreaterThan(secretLoad);
    });

    it('has a step that reads inputs.stage and refuses prod with a GitHub error annotation', () => {
        expect(
            candidates.map(({ step }) => step.name),
            `${id} has no step binding STAGE to inputs.stage — a dispatch of ci-full.yml with stage=prod ` +
                'and run_mobile_maestro=true provisions a Clerk test user into the PRODUCTION tenant',
        ).not.toEqual([]);

        const refusing = candidates.filter(({ step }) => runStep(step.run ?? '', 'prod').status !== 0);

        expect(
            refusing.map(({ step }) => step.name),
            'a step reads inputs.stage but exits 0 under STAGE=prod — nothing refuses the production tenant',
        ).toHaveLength(1);

        const outcome = runStep(refusing[0]?.step.run ?? '', 'prod');

        expect(outcome.stdout + outcome.stderr, 'the refusal must say why, as an annotation').toMatch(/::error::/u);
    });

    it('lets stage=sandbox through the same step', () => {
        const refusing = candidates.filter(({ step }) => runStep(step.run ?? '', 'prod').status !== 0);

        expect(refusing).toHaveLength(1);

        const outcome = runStep(refusing[0]?.step.run ?? '', 'sandbox');

        expect(outcome.status, `sandbox refused: ${outcome.stderr}${outcome.stdout}`).toBe(0);
    });

    it('refuses BEFORE any stage secret is loaded, so a refused run never holds a production credential', () => {
        const refusing = candidates.filter(({ step }) => runStep(step.run ?? '', 'prod').status !== 0);

        expect(refusing).toHaveLength(1);
        expect(refusing[0]?.index, 'the refusal sits after the load-secrets step').toBeLessThan(secretLoad);
    });
});
