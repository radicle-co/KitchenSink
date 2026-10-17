// @vitest-environment node
/**
 * Repo-wide guard: the Maestro tier re-proves the sandbox is up INSIDE the job it is about to drive.
 *
 * ## The defect this pins
 *
 * `needs.resolve-mobile-target.outputs.live` is decided when THAT job completes, and a GitHub re-run
 * (`gh run rerun --failed`, or one failed job) re-runs only the failed jobs, reading the completed needs'
 * RECORDED outputs. A shard re-run after the sandbox was torn down — the Sandbox Down dispatch, the nightly
 * reaper, a PR close — therefore reads a frozen `live=true` for a sandbox that no longer exists: the tier
 * would boot an emulator, lease pool slots and drive ~50 minutes of flows at an origin that no longer
 * answers, reporting absence-shaped reds that read like app defects. Owner ruling, 2026-10-06:
 * "Maestro should not run if the sandbox is not up."
 *
 * ## How the workflow answers it
 *
 * The Maestro job carries its own `liveness` step, run before any stage secret is loaded: it re-asks the
 * SAME question through the SAME `deployGate.sh evaluate` — the same per-service stack lists and the same
 * `live && !deploy` composition — against the world as it is now, and gates the SECRETS step on its own
 * output. The downstream cascade already keys on `steps.secrets.outcome == 'success'`, so one valve closes
 * the whole tier, and a closed valve reads as a SKIP with a `::notice::`, never a red.
 *
 * ## How it is asserted
 *
 * The jobs are DISCOVERED — every Maestro job (Android and iOS) by content (its steps run `e2e-seed`
 * provision, the same signature `maestroStageGuard.test.ts` uses), the resolver as the one job that publishes
 * a `live` output.
 * Nothing here re-implements the liveness decision; it proves the WIRING and the DUPLICATION:
 *
 *   1. POSITION — the `liveness` step sits BEFORE the `load-secrets` step, so a closed gate never holds a
 *      stage credential at all.
 *   2. THE VALVE — the secrets step is gated on the probe's own output
 *      (`steps.liveness.outputs.live == 'true'`), not on anything recorded before this job started.
 *   3. DEFENCE IN DEPTH — the job-level `if` STILL carries the fresh-run gate on
 *      `needs.resolve-mobile-target.outputs.live`; the in-job probe is ADDITIVE, not a replacement.
 *   4. PARITY — the probe asks the resolver's question: the whole span from the first `ask` invocation to
 *      the `live=` composition, whitespace collapsed, is IDENTICAL to the resolver's own liveness step —
 *      SAME stage spelling included (`${STAGE}`, the one `deployGateSeedRef.test.ts`'s seed-reference pin
 *      demands of every gate caller; the job-level `STAGE` binding below is why it resolves). The
 *      duplication is deliberate (extracting it would rewrite a load-bearing step and the three tests that
 *      execute it); THIS test is what keeps the two copies from drifting one side at a time.
 *   6. A SECRETS FAILURE IS RED (2026-10-13) — the secrets step is not `continue-on-error`: a skip may only happen
 *      because the sandbox is down, and a swallowed failure on a live one was a green no-op shard.
 *   5. ABSENCE SKIPS, AND ONLY A REAL ABSENCE — the job signs in through `awsAuth` (ADR-0063) BEFORE the probe, with
 *      no `if:`, and the probe reads that step's `authenticated` output: `false` (a fork or Dependabot run, the only
 *      runs that cannot sign in) is `live=false` + `exit 0`, so it can never red the tier — red-over-nothing is the
 *      mirror of green-over-nothing. Every other run that cannot sign in is red inside `awsAuth`, which the
 *      access-key version could not do: it read an empty secret, so a job that forgot to pass the key looked exactly
 *      like a fork and skipped green. The probe holds no key of its own.
 *
 * Mutation evidence: written together with the step it pins, and one red was found in review — an earlier
 * draft bound the stage as a private `PROBE_STAGE`, and the full suite red `deployGateSeedRef.test.ts`
 * ("'ask food' does not pass the food seed function as its seed reference"), which pins the
 * `${STAGE}` spelling for every caller: the guard found the change before the author did. Other reds:
 * deleting the step reds (1); re-pointing the secrets `if` at `needs.*.outputs.live` reds (2); moving the
 * probe below the secrets step reds (1); binding the stage at STEP level reds `stackProbeCoverage.test.ts`
 * (file/job-level resolution) and `maestroStageGuard.test.ts` (a second candidate in its refusal
 * discovery); dropping the credentials branch reds (5). Since (5) moved to `awsAuth` it runs the probe's own bash unsigned
 * instead of matching its text, so a branch that stops writing `live=false`, or reaches the gate script, reds
 * however it is spelled.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { runWorkflowStep } from './workflowStepRunner.js';

interface WorkflowStep {
    readonly id?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Record<string, string>;
    readonly run?: string;
    readonly 'continue-on-error'?: boolean;
    readonly env?: Record<string, string>;
}

interface WorkflowJob {
    readonly if?: string;
    readonly env?: Record<string, string>;
    readonly outputs?: Record<string, unknown>;
    readonly steps?: readonly WorkflowStep[];
}

type Workflow = { readonly jobs: Record<string, WorkflowJob> };

const WORKFLOW_PATH = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));

/** The parsed reusable heavy workflow — the file both the resolver and the Maestro tier live in. */
const workflow = parse(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;

/**
 * The Maestro jobs, discovered by content: each provisions `e2e-seed`'s test users — the Android emulator job
 * and the iOS Simulator job. ⛔ EVERY one, not the first: a `.find` here would leave a second Maestro job
 * free to drive a torn-down sandbox, which is the whole defect this file pins.
 */
function maestroJobs(): readonly (readonly [string, WorkflowJob])[] {
    return Object.entries(workflow.jobs).filter(([, job]) =>
        (job.steps ?? []).some((step) => /e2e-seed\/src\/provision/u.test(step.run ?? '')),
    );
}

/** The resolver, discovered by content: it is the one job that publishes a `live` output. */
function resolverJob(): WorkflowJob | undefined {
    return Object.values(workflow.jobs).find((job) => job.outputs !== undefined && 'live' in job.outputs);
}

const LIVENESS_SCRIPT_PATH = fileURLToPath(
    new URL('../../../../.github/scripts/deployedSandboxLiveness.sh', import.meta.url),
);

/** A Maestro job's START probe: the step with id `liveness`, which calls the shared liveness script. */
function startProbeSteps(job: WorkflowJob): readonly WorkflowStep[] {
    return (job.steps ?? []).filter((step) => step.id === 'liveness');
}

/** The steps of a job that run the deploy gate's `evaluate` door — the liveness question itself. */
function livenessSteps(job: WorkflowJob): readonly WorkflowStep[] {
    return (job.steps ?? []).filter((step) => /deployGate\.sh\s+evaluate/u.test(step.run ?? ''));
}

/**
 * The liveness QUESTION: the span from the first `ask` invocation to the `live=` composition, whitespace
 * collapsed. Everything the answer could depend on — the stage spelling, the stack lists, the health
 * origins' shape, the `live && !deploy` terms — sits inside it; everything that may legitimately differ
 * (notices) sits outside it. No variable-name normalisation: a probe that spells its stage differently
 * from the resolver IS drift, and `deployGateSeedRef.test.ts` already proved that red is wanted.
 */
function questionOf(run: string): string {
    const normalised = run.replace(/\s+/gu, ' ').trim();
    const start = normalised.indexOf('recipe_verdict=');
    const end = normalised.indexOf('echo "live=${live}"');

    expect(start, 'the liveness step no longer asks the recipe service').toBeGreaterThanOrEqual(0);
    expect(end, 'the liveness step no longer writes its live= output').toBeGreaterThan(start);

    return normalised.slice(start, end);
}

describe('the Maestro jobs this guard covers', () => {
    it('finds one per platform the tier drives (a job it cannot see is a job it cannot guard)', () => {
        expect(maestroJobs().map(([id]) => id)).toEqual(['e2e-mobile-maestro', 'e2e-mobile-maestro-ios']);
    });
});

describe.each(maestroJobs())('%s re-proves liveness inside its own job', (_, job) => {
    const maestroJob = (): WorkflowJob | undefined => job;

    it('is not vacuous: the Maestro job, its re-probe and the secrets step all exist', () => {
        const maestro = maestroJob();

        expect(maestro, 'the Maestro job lost its provisioning signature').toBeDefined();
        expect(startProbeSteps(maestro as WorkflowJob)).toHaveLength(1);
        expect(
            (maestro as WorkflowJob).steps?.some((step) => /load-secrets/u.test(step.uses ?? '')),
            'the Maestro job lost its load-secrets step',
        ).toBe(true);
    });

    it('asks before it holds: the re-probe sits ahead of the secrets load and never suppresses its own exit', () => {
        const steps = maestroJob()?.steps ?? [];
        const probeIndex = steps.findIndex((step) => step.id === 'liveness');
        const secretsIndex = steps.findIndex((step) => /load-secrets/u.test(step.uses ?? ''));

        expect(probeIndex, 'the liveness step lost its id').toBeGreaterThanOrEqual(0);
        expect(secretsIndex, 'the load-secrets step lost its uses reference').toBeGreaterThan(probeIndex);
        expect(
            steps[probeIndex]?.['continue-on-error'],
            'the liveness probe must not be continue-on-error',
        ).toBeUndefined();
        expect(
            steps[probeIndex]?.if,
            'the liveness probe runs unconditionally inside the job; gate on its output instead',
        ).toBeUndefined();
    });

    it('gates the secrets load on the re-probe’s own output — the single valve for the whole tier', () => {
        const secrets = maestroJob()?.steps?.find((step) => /load-secrets/u.test(step.uses ?? ''));

        expect(secrets?.if, 'the secrets step must key on the re-probe, not the frozen resolver answer').toBe(
            "steps.liveness.outputs.live == 'true'",
        );
    });

    /**
     * ADDED 2026-10-13 (owner rule: "a skip may only happen because the sandbox is down; a skip is never a pass").
     * The secrets step used to be `continue-on-error`, so a FAILED load on a LIVE sandbox turned into `outcome ==
     * 'failure'`, every stateful step below skipped on `outcome == 'success'`, and the shard went green having driven
     * nothing. The only legitimate reason for the tier to have no secrets is that the re-probe above said the sandbox is
     * not up — which already includes "this run holds no AWS credentials" (the next test) — and that case skips the step
     * through its `if`, not through a swallowed failure. So the step must be allowed to fail the job.
     */
    it('⛔ lets a secrets-load failure on a LIVE sandbox be RED — the step is not continue-on-error', () => {
        const secrets = maestroJob()?.steps?.find((step) => /load-secrets/u.test(step.uses ?? ''));

        expect(secrets, 'no load-secrets step').toBeDefined();
        expect(
            secrets?.['continue-on-error'],
            'a failed secrets load on a live sandbox would skip every stateful step and report green',
        ).toBeUndefined();
    });

    it('⛔ leaves no other way for the secrets outcome to be non-success while the sandbox is live', () => {
        const steps = maestroJob()?.steps ?? [];
        const secretsIndex = steps.findIndex((step) => /load-secrets/u.test(step.uses ?? ''));

        // Every step between the probe and the secrets load that could fail the job must fail it, not be tolerated:
        // nothing between them may swallow a failure, or a skipped valve could be read as an absent sandbox.
        for (const [index, step] of steps.slice(0, secretsIndex).entries()) {
            expect(step['continue-on-error'], `step ${index} swallows its own failure`).toBeUndefined();
        }
    });

    it('keeps the fresh-run gate at job level — the re-probe is defence in depth, not a replacement', () => {
        const jobIf = maestroJob()?.if ?? '';

        expect(jobIf).toContain('inputs.run_mobile_maestro');
        expect(jobIf).toContain("needs.resolve-mobile-target.outputs.live == 'true'");
    });

    it('binds the probe’s stage at JOB level, from the resolver’s recorded output', () => {
        const maestro = maestroJob() as WorkflowJob;
        const probe = startProbeSteps(maestro)[0] as WorkflowStep;

        expect(maestro.env?.['STAGE']).toBe('${{ needs.resolve-mobile-target.outputs.stage }}');
        // ⛔ STEP level would break two guards: `stackProbeCoverage.test.ts` resolves the stage inside a
        // probed stack name from `env:` at file and job level ONLY (the probe would read as a name whose
        // stage the guard cannot attribute), and a step-level `STAGE: ${{ inputs.stage }}` would become a
        // SECOND candidate in `maestroStageGuard.test.ts`'s refusal discovery. The `${STAGE}` spelling
        // itself is load-bearing too: `deployGateSeedRef.test.ts` pins
        // `kitchensink-food-schema-${STAGE}:FoodSeedFunctionName` for every gate caller.
        expect(probe.env?.['STAGE'], 'the probe’s stage must bind at job level, not step level').toBeUndefined();
        // The origins are the run's OWN recorded ones — on a re-run they are precisely the premise being
        // re-verified, so the probe must not re-derive them from anything else.
        expect(probe.env?.['RECIPE_ORIGIN']).toBe('${{ needs.resolve-mobile-target.outputs.recipe_origin }}');
        expect(probe.env?.['FOOD_ORIGIN']).toBe('${{ needs.resolve-mobile-target.outputs.food_origin }}');
    });

    it('asks the SAME question the resolver asked — same stacks, same composition', () => {
        const resolver = resolverJob();

        expect(resolver, 'the job publishing the live output was not found').toBeDefined();

        const resolverSteps = livenessSteps(resolver as WorkflowJob);

        expect(resolverSteps, 'the resolver lost its own deploy-gate liveness step').toHaveLength(1);

        // CHANGED 2026-10-17 (mid-shard liveness): the Maestro probes no longer inline the question, they call
        // `deployedSandboxLiveness.sh check`, the one authority the flow loop also re-asks after a failed flow.
        // So the compared text is the SCRIPT's, not the step's, and the step is pinned to CALL it with the job's own
        // stage and recorded origins. The comparison itself is unchanged and not weakened: same span, same
        // whitespace-collapsed equality, against the same resolver.
        const probeRun = (startProbeSteps(maestroJob() as WorkflowJob)[0] as WorkflowStep).run ?? '';
        const resolverRun = (resolverSteps[0] as WorkflowStep).run ?? '';

        // A shell line continuation (backslash, newline) collapses with the rest of the whitespace.
        const collapsed = probeRun.replace(/\\\s+/gu, ' ').replace(/\s+/gu, ' ');

        expect(collapsed, 'the start probe must call the shared liveness script').toContain(
            'bash .github/scripts/deployedSandboxLiveness.sh check "${STAGE}" "${DEFAULT_AWS_REGION}" "${RECIPE_ORIGIN}" "${FOOD_ORIGIN}"',
        );
        expect(
            questionOf(readFileSync(LIVENESS_SCRIPT_PATH, 'utf8')),
            'the shared liveness script drifted from the resolver’s liveness question',
        ).toBe(questionOf(resolverRun));
    });

    it('re-asks the same script mid-shard: the flow loop is handed the SAME command, stage and origins', () => {
        const runStep = maestroJob()?.steps?.find((step) =>
            /runMaestroFlows\.sh/u.test(step.run ?? step.with?.['script'] ?? ''),
        );
        const env = runStep?.env ?? {};

        expect(runStep, 'the step that runs the flow loop was not found').toBeDefined();
        expect(env['MAESTRO_SANDBOX_LIVENESS']).toBe(
            'bash .github/scripts/deployedSandboxLiveness.sh check "${STAGE}" "${DEFAULT_AWS_REGION}" "${MAESTRO_LIVENESS_RECIPE_ORIGIN}" "${MAESTRO_LIVENESS_FOOD_ORIGIN}"',
        );
        // The origins are the run's OWN recorded ones, exactly as the start probe reads them.
        expect(env['MAESTRO_LIVENESS_RECIPE_ORIGIN']).toBe('${{ needs.resolve-mobile-target.outputs.recipe_origin }}');
        expect(env['MAESTRO_LIVENESS_FOOD_ORIGIN']).toBe('${{ needs.resolve-mobile-target.outputs.food_origin }}');
    });

    it('signs in through awsAuth, unconditionally, before it asks — and the probe holds no key of its own', () => {
        const steps = maestroJob()?.steps ?? [];
        const signIn = steps.findIndex((step) => step.uses === './.github/actions/awsAuth');
        const probe = startProbeSteps(maestroJob() as WorkflowJob)[0] as WorkflowStep;

        expect(signIn, 'the Maestro job does not sign in through awsAuth').toBeGreaterThanOrEqual(0);
        expect(signIn, 'awsAuth must run before the liveness probe').toBeLessThan(steps.indexOf(probe));
        expect(steps[signIn]?.if, 'a gated sign-in would let a missing id-token grant skip, not red').toBeUndefined();
        expect(steps[signIn]?.with?.['tier']).toBe('nonprod');
        expect(probe.env?.['AUTHENTICATED']).toBe(
            `\${{ steps.${steps[signIn]?.id ?? '(no id)'}.outputs.authenticated }}`,
        );
        expect(JSON.stringify(probe.env), 'the probe must not read an access key').not.toMatch(
            /AWS_ACCESS|AWS_SECRET/u,
        );
    });

    for (const authenticated of ['false', '']) {
        it(`treats an unsigned run (authenticated='${authenticated}') as a skip, never a red, and asks nothing`, () => {
            const probe = startProbeSteps(maestroJob() as WorkflowJob)[0] as WorkflowStep;
            // The step runner's directory holds no `deployGate.sh`, so a probe that reached the gate would fail.
            const outcome = runWorkflowStep(probe.run ?? '', { AUTHENTICATED: authenticated, STAGE: 'pr-91' });

            expect(outcome.status, outcome.log).toBe(0);
            expect(outcome.outputs['live']).toBe('false');
            expect(outcome.log).toMatch(/::notice::/u);
        });
    }
});
