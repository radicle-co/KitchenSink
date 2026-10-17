// @vitest-environment node
/**
 * Repo-wide guard: **the button that starts a sandbox must verify what it stood up, and reachability must
 * be what decides its colour.**
 *
 * ## The failure this pins
 *
 * `sandboxUp.yml` is the ONE deliberate door into a preview environment (ADR-0028, ADR-0060). Until 2026-09-05 its
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
 * 1. **The button CALLS every workflow it relies on, and dispatches none** (ADR-0060). A called workflow is
 *    waited on by construction and its failure is the run's failure; a dispatched one had to be polled for a run
 *    id, which reported on whichever run appeared next. The callees are derived from the jobs' own `uses:`.
 *    REWRITTEN from "every dispatch is watched with `--exit-status`" when the button became a job graph — the
 *    property that protects is unchanged (no verdict without waiting), the mechanism that gives it is stronger.
 * 2. **Every CDK app those called workflows deploy is named in the button's own verification job.**
 *    The required set comes from `deployedApps()` — the `cdk deploy --app` lines in the called workflows
 *    themselves, followed through `uses:` to a fixpoint — so "everything the CDK declares" is read out of the
 *    pipeline rather than transcribed into this file.
 * 3. **The stacks are DERIVED from the manifest and verified by the ONE verifier.** The step must reach
 *    them through `deployGate.sh stacks-for` (which answers from `docs/generated/infrastructure/manifest.json`,
 *    itself AST-read from the CDK source under a staleness gate) and hand them to
 *    `verifyDeployment.sh verify-stacks`. A second verification authority beside that script is the thing
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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { deployedApps, foldContinuations, withoutComments } from './cdkApps.js';
import { repoRoot } from './serviceSources.js';

/** The button. */
const WORKFLOW = 'sandboxUp.yml';

/** The job that verifies the assembled sandbox. Anchored by key, so a rename is a loud failure, not a skip. */
const VERIFY_JOB = 'verify';

/** One step, reduced to what these assertions ask about. */
interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly 'continue-on-error'?: unknown;
}

/** One job, reduced to what these assertions ask about. */
interface Job {
    readonly uses?: string;
    readonly needs?: string | readonly string[];
    readonly steps?: readonly Step[];
}

/** Every job of the button, by key. */
function jobs(): Readonly<Record<string, Job>> {
    const doc = parse(readFileSync(join(repoRoot, '.github/workflows', WORKFLOW), 'utf8')) as {
        jobs?: Record<string, Job>;
    };

    return doc.jobs ?? {};
}

/** Every step of the verify job, in file order. */
function verifySteps(): readonly Step[] {
    const job = jobs()[VERIFY_JOB];

    if (job === undefined) {
        throw new Error(`${WORKFLOW} has no \`${VERIFY_JOB}\` job — this guard is anchored on it.`);
    }

    return job.steps ?? [];
}

/**
 * One step's shell, reduced to the COMMANDS it runs: comment lines removed, line-continuations folded.
 *
 * ⛔ THE COMMENT STRIP IS LOAD-BEARING: a step that explains itself in shell comments would otherwise satisfy
 * an assertion with prose about the thing. Measured on this file's first version, not reasoned.
 *
 * @param step - The step to read.
 * @returns Its executable text. Pure apart from the caller's file read.
 */
function commands(step: Step): string {
    return foldContinuations(withoutComments(step.run ?? ''));
}

/** Every shell COMMAND in the verify job, comments already removed. */
function shell(): string {
    return verifySteps().map(commands).join('\n');
}

/** Every shell command in EVERY job of the button. */
function allShell(): string {
    return Object.values(jobs())
        .flatMap((job) => job.steps ?? [])
        .map(commands)
        .join('\n');
}

/** The local reusable workflows the button's jobs call directly. */
function calledWorkflows(): readonly string[] {
    return Object.values(jobs()).flatMap((job) => {
        const match = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/u.exec(job.uses ?? '');

        return match?.[1] === undefined ? [] : [match[1]];
    });
}

/**
 * Every CDK app entrypoint the workflows this button calls actually deploy.
 *
 * ⛔ FOLLOWS `uses:` TRANSITIVELY, to a fixpoint: `sandboxPreview.yml` hands its work to `deployInfra.yml`, and
 * depth is a fact about today's call graph that has gone stale within one refactor every time it was written down.
 */
function appsTheSandboxStandsUp(): readonly string[] {
    const called = new Set(calledWorkflows());
    const queue = [...called];

    while (queue.length > 0) {
        const workflow = queue.pop() ?? '';
        const path = join(repoRoot, '.github/workflows', workflow);

        if (!existsSync(path)) {
            continue;
        }

        for (const [, callee] of readFileSync(path, 'utf8').matchAll(
            /uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/gu,
        )) {
            if (callee !== undefined && !called.has(callee)) {
                called.add(callee);
                queue.push(callee);
            }
        }
    }

    return [...new Set(deployedApps().flatMap((app) => (called.has(app.workflow) ? [app.entrypoint] : [])))].toSorted();
}

/** Every `packages/**\/bin/app.ts` entrypoint named anywhere in the verify job's shell. */
function appsTheButtonVerifies(): readonly string[] {
    return [...new Set([...shell().matchAll(/packages\/[\w@./-]*bin\/app\.ts/gu)].map((match) => match[0]))].toSorted();
}

/** A job's `needs:`, as a list. */
const needsOf = (job: Job | undefined): readonly string[] =>
    job?.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;

describe('sandboxUp.yml verifies what it stood up (owner directive, 2026-09-05)', () => {
    it('is not vacuous — the real jobs, their callees and the apps behind them are all discovered', () => {
        expect(verifySteps().length).toBeGreaterThanOrEqual(5);
        expect(calledWorkflows()).toEqual(
            expect.arrayContaining(['sandbox-identity-deploy.yml', 'sandboxPreview.yml', 'previewDomain.yml']),
        );
        expect(appsTheSandboxStandsUp().length).toBeGreaterThanOrEqual(7);
    });

    it("⛔ dispatches NO workflow — it calls them, so every one is waited on and its failure is this run's", () => {
        expect(
            allShell(),
            '`gh workflow run` returns when the dispatch is ACCEPTED; a button built on it reports the outcome of ' +
                'nothing, and the run id it polls for is whichever run appears next. Call the workflow instead.',
        ).not.toMatch(/gh\s+workflow\s+run\s/u);
    });

    it('⛔ never relies on sandbox-deploy.yml, which the owner disabled (ADR-0060)', () => {
        expect(
            readFileSync(join(repoRoot, '.github/workflows', WORKFLOW), 'utf8').replace(/^\s*#.*$/gmu, ''),
        ).not.toContain('sandbox-deploy.yml');
    });

    it('verifies only after every job that stands something up', () => {
        const deploying = Object.entries(jobs())
            .filter(([, job]) => job.uses !== undefined)
            .map(([name]) => name);

        expect(deploying.length).toBeGreaterThan(0);
        expect(needsOf(jobs()[VERIFY_JOB])).toEqual(expect.arrayContaining(deploying));
    });

    it('⛔ names every CDK app the workflows it calls deploy', () => {
        const verified = new Set(appsTheButtonVerifies());
        const missing = appsTheSandboxStandsUp().filter((entrypoint) => !verified.has(entrypoint));

        expect(
            missing,
            'the button stands these CDK apps up and never verifies them. "All services, lambdas, ' +
                'resources according to all the CDK" means every app the called workflows deploy.',
        ).toEqual([]);
    });

    it('⛔ derives its stacks from the manifest and verifies them with the ONE verifier', () => {
        const body = shell();

        expect(body, 'the stack set must come from `deployGate.sh stacks-for`, never from a list in YAML').toContain(
            'deployGate.sh stacks-for',
        );
        expect(
            body,
            'resources, handlers and cross-stack references are verified by verifyDeployment.sh — a second ' +
                'authority beside it is what this repository refuses',
        ).toContain('verifyDeployment.sh verify-stacks');
    });

    it('⛔ probes the deployed origins through the shared smoke classifiers', () => {
        expect(
            shell(),
            'reachability is the verdict (owner directive). Probe the origins with ' +
                'recipe-service/infra/smoke/deployedSmoke.ts rather than a bespoke status table — ADR-0010 ' +
                'makes 401/403 the PASS and the shared ALB default 404 the FAIL, and that rule lives there.',
        ).toContain('smoke/deployedSmoke.ts');
    });

    it('⛔ no step in any job may swallow its own failure', () => {
        const swallowed = Object.entries(jobs()).flatMap(([name, job]) =>
            (job.steps ?? [])
                .filter((step) => step['continue-on-error'] !== undefined)
                .map((step) => `${WORKFLOW}:${name}:${step.name ?? '(unnamed)'} carries continue-on-error`),
        );

        expect(
            swallowed,
            'a verification or reachability check that cannot fail the job is decoration — the button would ' +
                'be green over a sandbox that does not answer',
        ).toEqual([]);
    });

    it('⛔ the verification and reachability steps do not discard a non-zero status', () => {
        const offenders = verifySteps()
            .filter((step) => /verifyDeployment\.sh|deployedSmoke\.ts/u.test(commands(step)))
            .filter((step) => /\|\|\s*true\b/u.test(commands(step)))
            .map((step) => `${WORKFLOW}:${step.name ?? '(unnamed)'} pipes a check into \`|| true\``);

        expect(offenders).toEqual([]);
    });
});
