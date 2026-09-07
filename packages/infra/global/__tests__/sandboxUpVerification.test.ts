// @vitest-environment node
/**
 * Repo-wide guard: **the button that starts a sandbox must verify what it stood up, and reachability must
 * be what decides its colour.**
 *
 * ## The failure this pins
 *
 * `sandbox-up.yml` is the ONE deliberate door into a preview environment (ADR-0028). Until 2026-09-05 its
 * `start` job dispatched `sandbox-deploy.yml` twice — `gh workflow run`, which returns the moment the
 * dispatch is ACCEPTED — and then wrote a summary. The job therefore went GREEN roughly ninety seconds
 * after being pressed, before a single stack had been touched, and stayed green if every one of those
 * deploys failed. The one step in the file matching verify/smoke/assert was "Check the PR is open".
 *
 * That is the exact green-over-nothing class this repository keeps finding: `deployVerificationCoverage`
 * (a stack converged, its handlers never arrived), ADR-0025 §3 (a copy of a list cannot detect that the
 * list is incomplete), ADR-0010 §4 (a `/health` 200 says nothing about the ecosystem). The button was
 * worse than any of them, because it reported on work that had not started.
 *
 * ⚠️ Its MIRROR is a defect too, and `deployGateStepGuards.test.ts` records it: red-over-nothing costs the
 * same thing. So nothing here asks the job to fail when there is nothing to do — a manual press always has
 * something to do — it asks that the job not SUCCEED without having looked.
 *
 * ## The four properties, and why each is derived rather than listed
 *
 * 1. **Every workflow the button dispatches is WAITED on, with `--exit-status`.** The subject is derived
 *    from the job's own `gh workflow run <file>` occurrences, so a third dispatch added tomorrow is covered
 *    the day it lands. Without the wait the dispatch is the whole verdict.
 * 2. **Every CDK app those dispatched workflows deploy is named in the button's own verification step.**
 *    The required set comes from `deployedApps()` — the `cdk deploy --app` lines in the dispatched
 *    workflows themselves — so "everything the CDK declares" is read out of the pipeline rather than
 *    transcribed into this file. A service added to `sandbox-deploy.yml` tomorrow reds this guard until the
 *    button verifies it too.
 * 3. **The stacks are DERIVED from the manifest and verified by the ONE verifier.** The step must reach
 *    them through `deploy-gate.sh stacks-for` (which answers from `docs/generated/infrastructure/manifest.json`,
 *    itself AST-read from the CDK source under a staleness gate) and hand them to
 *    `verify-deployment.sh verify-stacks`. A second verification authority beside that script is the thing
 *    this repository refuses; a hand-written stack list is the thing ADR-0025 §3 refuses.
 * 4. **Reachability is the verdict.** The job must probe the deployed origins through the shared
 *    `deployedSmoke.ts` classifiers — not a bespoke status table — and no step in the job may carry
 *    `continue-on-error`, because a reachability check that cannot fail the job is decoration.
 *
 * ## Mutation evidence
 *
 * Written before the workflow changed and watched fail against the real tree on all four counts: the job
 * dispatched `sandbox-deploy.yml` without watching it, named no CDK app, called neither `stacks-for` nor
 * `verify-stacks`, and probed no origin. Re-deleting any one of those four reds exactly the assertion that
 * covers it, and dropping `--exit-status` from either watch reds assertion 1 alone.
 *
 * DESIGN PATTERN: Specification module over two derivations of the same workflow tree — what the button
 * dispatches, and what the dispatched workflows deploy — compared for coverage, exactly as
 * `deployVerificationCoverage.test.ts` does one level down.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { deployedApps, foldContinuations, withoutComments } from './cdkApps.js';
import { repoRoot } from './serviceSources.js';

/** The button. */
const WORKFLOW = 'sandbox-up.yml';

/** The job that does the work. Anchored by key, so a rename is a loud failure rather than a silent skip. */
const JOB = 'start';

/** One step, reduced to what these assertions ask about. */
interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly 'continue-on-error'?: unknown;
}

/** The workflow text, comments stripped — a `--app` inside prose must never count as a deployment. */
function text(): string {
    return withoutComments(readFileSync(join(repoRoot, '.github/workflows', WORKFLOW), 'utf8'));
}

/** Every step of the `start` job, in file order. */
function steps(): readonly Step[] {
    const doc = parse(readFileSync(join(repoRoot, '.github/workflows', WORKFLOW), 'utf8')) as {
        jobs?: Record<string, { steps?: Step[] }>;
    };
    const job = doc.jobs?.[JOB];

    if (job === undefined) {
        throw new Error(`${WORKFLOW} has no \`${JOB}\` job — this guard is anchored on it.`);
    }

    return job.steps ?? [];
}

/**
 * One step's shell, reduced to the COMMANDS it runs: comment lines removed, line-continuations folded.
 *
 * ⛔ THE COMMENT STRIP IS LOAD-BEARING, and its absence made this guard's first green run a lie. The
 * dispatch step explains itself in shell comments — "`--exit-status` is what makes a failed preview deploy
 * fail THIS job" — so deleting the real flag left the STRING in the body and every assertion below stayed
 * green over a fire-and-forget dispatch. Measured, not reasoned: the mutation was applied and this file
 * passed. A guard satisfied by prose about the thing is the guard this whole suite exists to replace.
 *
 * @param step - The step to read.
 * @returns Its executable text. Pure apart from the caller's file read.
 */
function commands(step: Step): string {
    return foldContinuations(withoutComments(step.run ?? ''));
}

/** Every shell COMMAND in the job, comments already removed. */
function shell(): string {
    return steps().map(commands).join('\n');
}

/** `gh workflow run <file>` targets, in order of appearance. */
function dispatchedWorkflows(): readonly string[] {
    return [...new Set([...shell().matchAll(/gh\s+workflow\s+run\s+(\S+\.ya?ml)/gu)].map((match) => match[1] ?? ''))];
}

/** The steps whose body dispatches at least one workflow. */
function dispatchingSteps(): readonly Step[] {
    return steps().filter((step) => /gh\s+workflow\s+run\s/u.test(commands(step)));
}

/**
 * Every CDK app entrypoint the workflows this button dispatches actually deploy.
 *
 * This is the honest reading of "everything the CDK declares for this sandbox": it is not a list, it is the
 * `cdk deploy --app` sites of the very workflows the button hands the work to.
 */
function appsTheSandboxStandsUp(): readonly string[] {
    const dispatched = new Set(dispatchedWorkflows());

    // ⛔ FOLLOWS `uses:` ONE LEVEL. A dispatched workflow may hand its real work to a REUSABLE one —
    // `sandbox-deploy.yml` does exactly that now, because the per-PR deploy jobs had to become callable so
    // `_ci.yml` could run them as a branch of its own graph (GitHub Actions has no cross-workflow `needs`).
    // Reading only the dispatched file made this derivation report THREE apps where the button stands up
    // seven, and every assertion below would then have been checked against a set missing the four that
    // matter most.
    for (const workflow of [...dispatched]) {
        const text = readFileSync(join(repoRoot, '.github/workflows', workflow), 'utf8');

        for (const [, called] of text.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/gu)) {
            dispatched.add(called ?? '');
        }
    }

    return [
        ...new Set(deployedApps().flatMap((app) => (dispatched.has(app.workflow) ? [app.entrypoint] : []))),
    ].toSorted();
}

/** Every `packages/**\/bin/app.ts` entrypoint named anywhere in the button's own shell. */
function appsTheButtonVerifies(): readonly string[] {
    return [...new Set([...shell().matchAll(/packages\/[\w@./-]*bin\/app\.ts/gu)].map((match) => match[0]))].toSorted();
}

describe('sandbox-up.yml verifies what it stood up (owner directive, 2026-09-05)', () => {
    it('is not vacuous — the real start job, its dispatches and the apps behind them are all discovered', () => {
        // Anchors every derivation below. A reader that silently found nothing would make all four
        // assertions pass by finding nothing, which is the failure mode this whole file is about.
        expect(steps().length).toBeGreaterThanOrEqual(8);
        expect(dispatchedWorkflows().length).toBeGreaterThanOrEqual(2);
        expect(dispatchedWorkflows()).toContain('sandbox-deploy.yml');
        expect(dispatchedWorkflows()).toContain('sandbox-identity-deploy.yml');
        expect(appsTheSandboxStandsUp().length).toBeGreaterThanOrEqual(7);
    });

    it('⛔ waits for EVERY workflow it dispatches, with --exit-status', () => {
        const firedAndForgotten = dispatchingSteps()
            .filter((step) => {
                const body = commands(step);

                return !(body.includes('gh run watch') && body.includes('--exit-status'));
            })
            .map(
                (step) =>
                    `${WORKFLOW}:${step.name ?? '(unnamed)'} dispatches a workflow and never waits for it — ` +
                    '`gh workflow run` returns when the dispatch is ACCEPTED, so the button reports the ' +
                    'outcome of nothing. Capture the run id and `gh run watch "$id" --exit-status`.',
            );

        expect(firedAndForgotten).toEqual([]);
    });

    it('⛔ names every CDK app the workflows it dispatches deploy', () => {
        const verified = new Set(appsTheButtonVerifies());
        const missing = appsTheSandboxStandsUp().filter((entrypoint) => !verified.has(entrypoint));

        expect(
            missing,
            'the button stands these CDK apps up and never verifies them. "All services, lambdas, ' +
                'resources according to all the CDK" means every app the dispatched workflows deploy.',
        ).toEqual([]);
    });

    it('⛔ derives its stacks from the manifest and verifies them with the ONE verifier', () => {
        const body = shell();

        expect(body, 'the stack set must come from `deploy-gate.sh stacks-for`, never from a list in YAML').toContain(
            'deploy-gate.sh stacks-for',
        );
        expect(
            body,
            'resources, handlers and cross-stack references are verified by verify-deployment.sh — a second ' +
                'authority beside it is what this repository refuses',
        ).toContain('verify-deployment.sh verify-stacks');
    });

    it('⛔ probes the deployed origins through the shared smoke classifiers', () => {
        expect(
            shell(),
            'reachability is the verdict (owner directive). Probe the origins with ' +
                'recipe-service/infra/smoke/deployedSmoke.ts rather than a bespoke status table — ADR-0010 ' +
                'makes 401/403 the PASS and the shared ALB default 404 the FAIL, and that rule lives there.',
        ).toContain('smoke/deployedSmoke.ts');
    });

    it('⛔ no step in the start job may swallow its own failure', () => {
        const swallowed = steps()
            .filter((step) => step['continue-on-error'] !== undefined)
            .map((step) => `${WORKFLOW}:${step.name ?? '(unnamed)'} carries continue-on-error`);

        expect(
            swallowed,
            'a verification or reachability check that cannot fail the job is decoration — the button would ' +
                'be green over a sandbox that does not answer',
        ).toEqual([]);
    });

    it('⛔ the verification and reachability steps do not discard a non-zero status', () => {
        const offenders = steps()
            .filter((step) => /verify-deployment\.sh|deployedSmoke\.ts/u.test(commands(step)))
            .filter((step) => /\|\|\s*true\b/u.test(commands(step)))
            .map((step) => `${WORKFLOW}:${step.name ?? '(unnamed)'} pipes a check into \`|| true\``);

        expect(offenders).toEqual([]);
    });

    it('is not vacuous — the workflow text is really being read', () => {
        expect(text()).toContain('name: Sandbox Up');
        expect(steps().some((step) => step.run !== undefined)).toBe(true);
    });
});
