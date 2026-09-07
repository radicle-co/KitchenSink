// @vitest-environment node
/**
 * Repo-wide guard: every CDK app a deploy JOB deploys must be VERIFIED by that same job.
 *
 * ## The failure this pins — one level below `cdkAppDeployCoverage.test.ts`
 *
 * That guard asks whether an app has a deployer at all, and it exists because
 * `packages/services/ingredient-parser` had none while `RecipeWorkersStack` shipped `parseLine` into every
 * stage carrying `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}`. Wiring the parser into both
 * workflows closed THAT hole. It did not close the class: **a stack can converge while a handler or a
 * resource inside it is absent, stale, or pointed at something that does not exist.** `cdk deploy` exits 0
 * for all three, and every existing post-deploy check in this repository looks at an ORIGIN — which says
 * nothing about a Lambda, a queue, or a cross-stack reference.
 *
 * Three concrete instances, all of which shipped green here:
 *
 *   - the CRF invoke edge itself: no CloudFormation dependency exists between the two apps (ADR-0025), so
 *     `parseLine` went live pointed at a function no account contained.
 *   - a resource at `UPDATE_ROLLBACK_COMPLETE` inside a stack ADR-0010's gate correctly calls USABLE: the
 *     deploy did not land on that resource, and nothing looked.
 *   - a Lambda whose code package cannot load — ADR-0025's own recorded residual for the parser's arm64 /
 *     CPython 3.13 wheels, which deploys clean and dies on its first cold start.
 *
 * So the requirement is not "the pipeline has a verification step somewhere". It is: **whatever this job
 * deployed, this job then verified** — and the subject of that sentence is derived from the job's own
 * `cdk deploy` lines, so a service added tomorrow is covered the day its deploy step lands.
 *
 * ## Why the match is on the `--app` STRING and not on stack names
 *
 * `verify-deployment.sh` discovers the stacks to verify by synthesising the app it is handed, because a
 * hand-written stack list could only be right by being edited — `GlobalStack` alone owns seven child stacks,
 * two of which exist on exactly one stage. That makes the app string the contract between the two steps, and
 * comparing it EXACTLY is what stops a verification step from silently addressing a different app (a copied
 * step whose `--app` was never updated verifies the wrong thing and stays green, which is this repository's
 * most-repeated defect shape).
 *
 * ⚠️ A job whose only deploy is the `npm run infra:deploy --workspace=…` spelling carries its app string in a
 * package manifest rather than in the workflow, so the exact-string rule cannot reach it; those jobs are
 * required to invoke the verifier, and the app they verify is compared through the manifest instead. That is
 * a weaker check, honestly, and it is why the assertion reports which rule it applied.
 *
 * ## Mutation evidence
 *
 * Written before the verification steps existed and watched fail against the real tree — it named every
 * deploying job in `prod-deploy.yml`, `sandbox-deploy.yml`, `sandbox-identity-deploy.yml` and
 * `sandbox-router-deploy.yml`. Deleting any single verify step reds it again, and so does changing one
 * verify step's `--app` to a different app.
 *
 * DESIGN PATTERN: Specification module over two derivations of the same workflow text — what a job deploys,
 * and what it verifies — compared for coverage, exactly as `cdkAppDeployCoverage.test.ts` does one level up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    APP_ARGUMENT,
    WORKSPACE_DEPLOY,
    type WorkflowJob,
    entrypointForWorkspace,
    entrypointOf,
    foldContinuations,
    toSourceEntrypoint,
    workflowJobs,
} from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** The verifier every deploy job must run. Named once; the assertions below derive everything else. */
const VERIFIER = 'verify-deployment.sh';

/** A `verify-deployment.sh verify <region> "<app>"` invocation, in either quote style. */
const VERIFY_INVOCATION = /verify-deployment\.sh\s+verify\s+\S+\s+(?:"([^"]+)"|'([^']+)')/gu;

/** Every job in every workflow — the shared reader in `cdkApps.ts`, so no second copy of the splitter. */
const jobs = workflowJobs;

/** What one job deploys and what it verifies, both derived from the job's own text. */
interface Coverage {
    readonly job: WorkflowJob;
    /** `--app` arguments passed to `cdk deploy`, verbatim. */
    readonly deploys: readonly string[];
    /** `--app` arguments passed to the verifier, verbatim. */
    readonly verifies: readonly string[];
    /**
     * Every CDK entrypoint this job deploys, repo-relative — the DIRECT `--app` paths plus the ones its
     * `npm run infra:deploy --workspace=…` calls resolve to through their own manifests.
     *
     * The two spellings must meet in ONE comparison space or the indirect one is silently exempt, and the
     * only spelling both can be reduced to is the entrypoint path.
     */
    readonly deployedEntrypoints: readonly string[];
    /** Every CDK entrypoint this job verifies, repo-relative. */
    readonly verifiedEntrypoints: readonly string[];
    /** Whether the job mentions the verifier at all, in any spelling. */
    readonly runsVerifier: boolean;
}

/**
 * Read one job's deploy and verify sites.
 *
 * @param job - The job's text.
 * @returns Both sets, verbatim. Pure apart from the caller's file reads.
 */
function coverage(job: WorkflowJob): Coverage {
    const folded = foldContinuations(job.body);
    // A `cdk deploy --app "X"` and a `verify-deployment.sh verify <region> "X"` both carry an `--app`-shaped
    // argument, so the deploy side is narrowed to commands that actually run `cdk deploy`.
    const deploys = [
        ...new Set(
            folded
                .split('\n')
                .flatMap((line) => (/cdk\s+deploy/u.test(line) ? [line] : []))
                .flatMap((line) =>
                    [...line.matchAll(APP_ARGUMENT)].map((match) => (match[1] ?? match[2] ?? '').trim()),
                ),
        ),
    ];
    const verifies = [...new Set([...folded.matchAll(VERIFY_INVOCATION)].map((m) => (m[1] ?? m[2] ?? '').trim()))];
    const indirect = [...folded.matchAll(WORKSPACE_DEPLOY)].flatMap((match) => {
        const entrypoint = entrypointForWorkspace(match[1] ?? '');

        return entrypoint === undefined ? [] : [entrypoint];
    });

    return {
        job,
        deploys,
        verifies,
        deployedEntrypoints: [...new Set([...deploys.map(entrypointFor), ...indirect])],
        verifiedEntrypoints: [...new Set(verifies.map(entrypointFor))],
        runsVerifier: folded.includes(VERIFIER),
    };
}

/**
 * The repo-relative source entrypoint an `--app` argument names.
 *
 * @param appArgument - The whole quoted argument, runner included.
 * @returns The normalised entrypoint path. Pure.
 */
function entrypointFor(appArgument: string): string {
    return toSourceEntrypoint(entrypointOf(appArgument));
}

/** Every job that deploys a CDK app, in either spelling. */
function deployingJobs(): readonly Coverage[] {
    return jobs()
        .map(coverage)
        .filter((entry) => entry.deployedEntrypoints.length > 0);
}

describe('deploy verification coverage', () => {
    it('is not vacuous: real deploying jobs are discovered across the real workflows', () => {
        // Anchors the discovery half. A splitter that silently found nothing would make every assertion
        // below pass — the exact vacuity `cdkAppDeployCoverage.test.ts` caught in itself on its first run.
        const found = deployingJobs();
        const workflows = new Set(found.map((entry) => entry.job.workflow));

        expect(found.length).toBeGreaterThan(3);
        expect(workflows).toContain('prod-deploy.yml');
        expect(workflows).toContain('_sandbox-preview.yml');
        expect(workflows).toContain('sandbox-identity-deploy.yml');
        expect(workflows).toContain('sandbox-router-deploy.yml');
    });

    it('⛔ every job that deploys a CDK app also runs the post-deploy verifier', () => {
        const missing = deployingJobs()
            .filter((entry) => !entry.runsVerifier)
            .map(
                (entry) =>
                    `${entry.job.workflow}:${entry.job.name} deploys ${entry.deployedEntrypoints.length} ` +
                    `CDK app(s) and never runs ${VERIFIER} — \`cdk deploy\` exiting 0 proves the stack ` +
                    'converged, not that the handlers and cross-stack references inside it arrived',
            );

        expect(missing).toEqual([]);
    });

    it('⛔ every app a job DEPLOYS is an app that job VERIFIES', () => {
        const unverified = deployingJobs().flatMap((entry) =>
            entry.deployedEntrypoints
                .filter((entrypoint) => !entry.verifiedEntrypoints.includes(entrypoint))
                .map(
                    (entrypoint) =>
                        `${entry.job.workflow}:${entry.job.name} deploys ${entrypoint} but never verifies it. ` +
                        `Add \`${VERIFIER} verify "$REGION" "<the same --app string>"\` to that job, with the ` +
                        'same env, so the stacks it verifies are the stacks it created.',
                ),
        );

        expect(unverified).toEqual([]);
    });

    it('⛔ a DIRECT deploy and its verification pass the byte-identical `--app` string', () => {
        // Stricter than the entrypoint rule above, and it is the one with teeth: `verify-deployment.sh`
        // derives its stack list by SYNTHESISING the app it is handed, so a verification whose runner or
        // path differs from the deploy's synthesises something else and reports on stacks this job did not
        // create — green, and about the wrong thing. The entrypoint rule cannot see that; only equality can.
        //
        // Applies to direct `--app` sites only. An `npm run infra:deploy --workspace=…` job carries its app
        // string in a package manifest, so there is no string in the workflow to compare — those are held to
        // the entrypoint rule alone, which is weaker, and saying so is better than pretending otherwise.
        const mismatched = deployingJobs().flatMap((entry) =>
            entry.deploys
                .filter((app) => !entry.verifies.includes(app))
                .map(
                    (app) =>
                        `${entry.job.workflow}:${entry.job.name} deploys \`--app "${app}"\` and verifies a ` +
                        `DIFFERENT string (${entry.verifies.join(' | ') || 'none'})`,
                ),
        );

        expect(mismatched).toEqual([]);
    });

    it('⛔ every app a job VERIFIES is an app that job actually deployed', () => {
        // The reverse direction, and not pedantry: a verify step left behind after its deploy moved (or
        // never updated after a copy) synthesises an app this job did not build, and fails for a reason that
        // has nothing to do with the deploy — after which the fix people reach for is deleting the check.
        const dangling = deployingJobs().flatMap((entry) =>
            entry.verifiedEntrypoints
                .filter((entrypoint) => !entry.deployedEntrypoints.includes(entrypoint))
                .map(
                    (entrypoint) =>
                        `${entry.job.workflow}:${entry.job.name} verifies ${entrypoint}, which it does not deploy`,
                ),
        );

        expect(dangling).toEqual([]);
    });

    it('⛔ every job that PUSHES an image also proves, in that job, what is RUNNING', () => {
        // The origin-level companion to the resource rules above, and the second half of "every service gets
        // a live check after deploy". `verify-deployment.sh` asks whether the resources arrived;
        // `/health` → 200 asks whether SOMETHING answers. Neither can tell a fresh task from one running a
        // build from weeks ago — the shape that let a stale recipe build serve pr-73 for fifteen days behind
        // a green `/health` — and the only thing that can is reading the RUNNING task definition's image.
        //
        // ⚠️ Deliberately job-scoped and gate-AGNOSTIC, which is where this differs from
        // `prodDeploySmokeDepth.test.ts`. That guard requires the currency smoke to be gated on the SAME
        // flag as the push, which is right for `prod-deploy.yml`'s single job. It is WRONG for
        // `sandbox-deploy.yml`, whose recipe smoke is gated on `live` rather than `deploy` on purpose — so
        // that a preview left half-wired is reported "even by a push that deployed nothing" — and passes
        // `--expected-image-tag` only when this run actually deployed. Generalising that guard to both
        // workflows would have meant weakening it for prod to accommodate a sandbox design that is strictly
        // better, so the two rules stay separate: prod keeps the stricter per-flag one, and this weaker
        // per-job one covers every workflow including the ones that guard never looked at.
        const readsRunningTask = /describe-task-definition[\s\S]*containerDefinitions\[0\]\.image/u;
        const pushesImage = /docker buildx build[\s\S]*--push/u;

        const blind = jobs()
            .map((job) => ({ job, folded: foldContinuations(job.body) }))
            .filter((entry) => pushesImage.test(entry.folded))
            .filter((entry) => !readsRunningTask.test(entry.folded))
            .map(
                (entry) =>
                    `${entry.job.workflow}:${entry.job.name} builds and pushes a Docker image but never reads ` +
                    "the running task definition's image, so a task running a build from weeks ago passes " +
                    'every check it has',
            );

        expect(blind).toEqual([]);
    });

    it('⛔ every `aws lambda invoke` in a workflow READS the answer, not the exit status', () => {
        // `aws lambda invoke` exits 0 when the FUNCTION threw: the failure is in the response, never in the
        // status. Four call sites had four different amounts of rigour about that — `sandbox-deploy.yml`'s
        // recipe leg grepped the payload for `errorType`, the identity legs read `FunctionError`,
        // `sandbox-up.yml` and `sandbox-reconcile.yml` grepped for one specific phrase each, and the FOOD
        // leg inspected NOTHING, so a migration runner that threw left the step green and the deploy
        // continued onto a schema that had not moved.
        //
        // Derived rather than listed: the subject is every step that invokes a Lambda, so a new invoke owes
        // the check the day it lands. A step that delegates to `run-migrations.sh` satisfies it by
        // construction — that script IS the one definition of "did the runner succeed".
        const invokes = /aws lambda invoke/u;
        const inspects = /FunctionError|errorType|run-migrations\.sh/u;

        const blind = jobs()
            .flatMap((job) =>
                foldContinuations(job.body)
                    // One step per `- name:` block, so an inspection in a NEIGHBOURING step cannot satisfy
                    // an invoke that ignores its own answer.
                    .split(/^ {12}- name: /mu)
                    .map((step) => ({ job, step })),
            )
            .filter((entry) => invokes.test(entry.step))
            .filter((entry) => !inspects.test(entry.step))
            .map(
                (entry) =>
                    `${entry.job.workflow}:${entry.job.name} invokes a Lambda without reading FunctionError ` +
                    'or the payload — the CLI exits 0 when the function threw, so the step is green and the ' +
                    'work did not happen',
            );

        expect(blind).toEqual([]);
    });

    it('⛔ a preflight runs BEFORE THE DEPLOY OF THE STACK IT GUARDS, never after', () => {
        // ⛔ Ordering IS the guarantee, and it is the OPPOSITE of every other rule in this file. `verify`
        // asks "did what shipped work" and must come AFTER. `preflight` asks "does the account still hold
        // what CloudFormation believes it already owns", and is worthless after — a deploy that fails on a
        // resource deleted out of band ROLLS BACK, so nothing downstream ever runs.
        //
        // The failure: a bulk `aws logs delete-log-group` sweep on 2026-08-27 removed nine
        // CloudFormation-managed log groups across both stages. CloudFormation keeps the physical id in its
        // model, so the next UPDATE fails `NotFound` and rolls the stack back. Sandbox demonstrated exactly
        // that on 2026-09-03; prod still carries the same damage, unfound because it has not deployed since
        // 2026-08-17.
        //
        // ⚠️ "Before the FIRST `cdk deploy` in the job" is the intuitive rule and it is WRONG — it was the
        // first spelling of this guard and it failed on a correct workflow. `prod-deploy.yml`'s `deploy` job
        // runs many `cdk deploy` steps, the earliest being the GLOBAL app; a preflight guarding the identity
        // stack legitimately sits after it. The rule has to relate the preflight's STACK to the app that
        // DECLARES that stack, which is what the committed infrastructure manifest already records.
        const manifest = JSON.parse(
            readFileSync(join(repoRoot, 'docs/generated/infrastructure/manifest.json'), 'utf8'),
        ) as {
            readonly apps: readonly {
                readonly entrypoint: string;
                readonly stacks: readonly { readonly stackNameTemplate: string }[];
            }[];
        };

        /** The entrypoints whose app declares a stack matching this preflight's stack argument. */
        const entrypointsDeclaring = (stackArgument: string): readonly string[] =>
            manifest.apps
                .filter((app) =>
                    app.stacks.some(
                        (stack) => stack.stackNameTemplate === stackArgument.replace(/\$\{STAGE\}/u, '{stage}'),
                    ),
                )
                .map((app) => app.entrypoint);

        // ⛔ FOLDED first, and the offsets below are all taken from the folded text. The workflows write
        // these invocations across a `\\` line continuation, so an unfolded scan finds the subcommand and
        // then fails to reach its arguments on the next line — which is the exact defect `foldContinuations`
        // was written for, one guard over.
        const preflights = jobs().flatMap((job) => {
            const body = foldContinuations(job.body);
            const match = /verify-deployment\.sh\s+preflight\s+\S+\s+"([^"]+)"/u.exec(body);

            return match === null ? [] : [{ job, body, at: match.index, stack: match[1] ?? '' }];
        });

        expect(
            preflights.length,
            'no preflight step was discovered in any workflow, so this guard would pass vacuously. If the ' +
                'step was renamed or removed, that is the thing to look at — not this number.',
        ).toBeGreaterThan(0);

        let comparisons = 0;

        for (const { job, body, at, stack } of preflights) {
            const entrypoints = entrypointsDeclaring(stack);

            expect(
                entrypoints,
                `${job.workflow}:${job.name} preflights "${stack}", which no CDK app in the manifest ` +
                    'declares. Either the stack name is wrong or the manifest is stale.',
            ).not.toEqual([]);

            for (const entrypoint of entrypoints) {
                // ⚠️ Match on the app's INFRA DIRECTORY, not its entrypoint. The manifest records the
                // SOURCE path (`…/infra/bin/app.ts`) while the workflows deploy the BUILT one
                // (`…/infra/dist/bin/app.js`), so the two never share a suffix — only the directory.
                //
                // ⛔ And the directory is derived BEFORE regex-escaping. The first spelling escaped first
                // and then tried to strip `/bin/app.ts$`, which by then read `/bin/app\.ts$` and matched
                // nothing — so every deploy lookup returned -1, every iteration hit the `continue` below,
                // and the ordering assertion NEVER RAN. Measured: moving the preflight after the identity
                // deploy left this test green. That is why `comparisons` is asserted at the end.
                const directory = entrypoint.replace(/\/bin\/app\.ts$/u, '');
                const deployAt = body.search(new RegExp(`cdk deploy[^\\n]*${RegExp.escape(directory)}`, 'u'));

                if (deployAt < 0) {
                    // This job preflights a stack it does not itself deploy. Legitimate, and not this
                    // rule's business — `every app a job VERIFIES is an app that job actually deployed`
                    // above owns the coverage question.
                    continue;
                }

                comparisons += 1;
                expect(
                    at,
                    `${job.workflow}:${job.name} runs its preflight for "${stack}" AFTER deploying ` +
                        `${entrypoint}. A deploy that fails on a resource deleted out of band rolls back, ` +
                        'so the check can never fire.',
                ).toBeLessThan(deployAt);
            }
        }

        expect(
            comparisons,
            'every preflight was skipped because its deploy step could not be located, so the ordering rule ' +
                'above asserted NOTHING. A guard that cannot find its subject is not a passing guard.',
        ).toBeGreaterThan(0);
    });

    it('⛔ the migration safety net is never gated on a PATH DIFF', () => {
        // ADR-0022 §4 keeps the pipeline's invoke as a SAFETY NET for "a stage whose schema is behind for a
        // reason no code change explains: a restore, a stage created later". Gating it on the same path-diff
        // flag as the deploy it follows means that in the ONE case it exists for, the flag is false and the
        // net is skipped — so it covered exactly the runs that did not need it. PROD had that hole and
        // sandbox did not, which made production the weaker stage.
        //
        // ⚠️ An ADR-0010 ensure-exists gate (`steps.gate.outputs.*`) is a PERMITTED guard and a path-diff
        // flag (`steps.flags.outputs.deploy_*`, `steps.changes.outputs.*`) is not, and the difference is the
        // whole point: ensure-exists is TRUE precisely when the stack is absent or the origin is not
        // serving, so it cannot skip the case the net exists for. It also keeps the sandbox legs ordered
        // behind their "Wake the shared sandbox database" step — the shared RDS is stopped nightly
        // 00:00–09:00 ET (ADR-0007), and an ungated invoke there would red on a stopped instance.
        //
        // Running unconditionally is safe on prod because of a property of the runner, not optimism:
        // `schema_migrations` is keyed by FILENAME with no checksum and the runner skips on a name match, so
        // a run against an up-to-date database applies nothing. It is NOT a licence to hoist the step above
        // the `cdk deploy` that ships its bundle — position is still load-bearing (ADR-0022), only the GATE
        // changed.
        const pathDiffGate = /^ {14}if: .*steps\.(?:flags|changes)\.outputs\./mu;
        const gated = jobs()
            .flatMap((job) =>
                foldContinuations(job.body)
                    .split(/^ {12}- name: /mu)
                    .map((step) => ({ job, step })),
            )
            .filter((entry) => /run-migrations\.sh\s+run/u.test(entry.step))
            .filter((entry) => pathDiffGate.test(entry.step))
            .map(
                (entry) =>
                    `${entry.job.workflow}:${entry.job.name} gates a run-migrations.sh step on a path-diff ` +
                    'flag, which skips the net in exactly the case ADR-0022 §4 keeps it for',
            );

        expect(gated).toEqual([]);
    });

    it('is not vacuous: the workflows really do invoke migration runners', () => {
        // Both rules above are "no violations" shapes, so a discovery that stopped seeing invokes would make
        // them pass on an empty set.
        const invoking = jobs().filter((job) => /run-migrations\.sh\s+run/u.test(foldContinuations(job.body)));

        expect(invoking.length).toBeGreaterThan(2);
    });

    it('every verified app string names a CDK entrypoint this repository defines', () => {
        // Catches the typo the equality rule cannot: both steps can agree on an app that does not exist.
        const apps = new Set(
            trackedFiles('packages')
                .filter((file) => file.endsWith('/bin/app.ts'))
                .map(toSourceEntrypoint),
        );
        const bogus = deployingJobs().flatMap((entry) =>
            entry.verifiedEntrypoints
                .filter((entrypoint) => !apps.has(entrypoint))
                .map((entrypoint) => `${entry.job.workflow}:${entry.job.name} verifies unknown app ${entrypoint}`),
        );

        expect(bogus).toEqual([]);
    });
});
