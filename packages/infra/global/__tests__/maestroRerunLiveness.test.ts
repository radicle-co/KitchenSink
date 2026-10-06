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
 * Both jobs are DISCOVERED — the Maestro job by content (its steps run `e2e-seed` provision, the same
 * signature `maestroStageGuard.test.ts` uses), the resolver as the one job that publishes a `live` output.
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
 *   5. ABSENCE SKIPS — the probe treats missing AWS credentials (withheld from fork/Dependabot PRs) as
 *      `live=false` + `exit 0`, so a withheld secret can never red the tier: red-over-nothing is the mirror
 *      of green-over-nothing.
 *
 * Mutation evidence: written together with the step it pins, and one red was found in review — an earlier
 * draft bound the stage as a private `PROBE_STAGE`, and the full suite red `deployGateSeedRef.test.ts`
 * ("'ask food' does not pass the food seed function as its seed reference"), which pins the
 * `${STAGE}` spelling for every caller: the guard found the change before the author did. Other reds:
 * deleting the step reds (1); re-pointing the secrets `if` at `needs.*.outputs.live` reds (2); moving the
 * probe below the secrets step reds (1); binding the stage at STEP level reds `stackProbeCoverage.test.ts`
 * (file/job-level resolution) and `maestroStageGuard.test.ts` (a second candidate in its refusal
 * discovery); dropping the credentials branch reds (5).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
    readonly id?: string;
    readonly if?: string;
    readonly uses?: string;
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

/** The Maestro job, discovered by content: it is the one that provisions `e2e-seed`'s test users. */
function maestroJob(): WorkflowJob | undefined {
    return Object.values(workflow.jobs).find((job) =>
        (job.steps ?? []).some((step) => /e2e-seed\/src\/provision/u.test(step.run ?? '')),
    );
}

/** The resolver, discovered by content: it is the one job that publishes a `live` output. */
function resolverJob(): WorkflowJob | undefined {
    return Object.values(workflow.jobs).find((job) => job.outputs !== undefined && 'live' in job.outputs);
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

describe('the mobile Maestro tier re-proves liveness inside its own job', () => {
    it('is not vacuous: the Maestro job, its re-probe and the secrets step all exist', () => {
        const maestro = maestroJob();

        expect(maestro, 'the Maestro job lost its provisioning signature').toBeDefined();
        expect(livenessSteps(maestro as WorkflowJob)).toHaveLength(1);
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

    it('keeps the fresh-run gate at job level — the re-probe is defence in depth, not a replacement', () => {
        const jobIf = maestroJob()?.if ?? '';

        expect(jobIf).toContain('inputs.run_mobile_maestro');
        expect(jobIf).toContain("needs.resolve-mobile-target.outputs.live == 'true'");
    });

    it('binds the probe’s stage at JOB level, from the resolver’s recorded output', () => {
        const maestro = maestroJob() as WorkflowJob;
        const probe = livenessSteps(maestro)[0] as WorkflowStep;

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

        const probeRun = (livenessSteps(maestroJob() as WorkflowJob)[0] as WorkflowStep).run ?? '';
        const resolverRun = (resolverSteps[0] as WorkflowStep).run ?? '';

        expect(questionOf(probeRun), 'the re-probe drifted from the resolver’s liveness question').toBe(
            questionOf(resolverRun),
        );
    });

    it('treats absent AWS credentials as a skip, never a red', () => {
        const probeRun = (livenessSteps(maestroJob() as WorkflowJob)[0] as WorkflowStep).run ?? '';

        expect(probeRun, 'the credentials-withheld branch must write live=false and exit 0 before any ask').toMatch(
            /if \[ -z "\$\{AWS_ACCESS_KEY_ID\}" \]; then\n\s*echo "::notice::[^\n]*\n\s*echo 'live=false' >>"\$GITHUB_OUTPUT"\n\s*exit 0\n\s*fi/u,
        );
    });
});
