// @vitest-environment node
/**
 * Repo-wide guard: the deployed authorization-boundary tier runs automatically in the PR pipeline and
 * otherwise only from ONE manual entrypoint, an absent environment SKIPS rather than fails, prod is reachable
 * only by hand, and the sandbox deploy jobs report "nothing to do" as
 * SKIPPED rather than as a green run that deployed nothing (owner rulings 2026-09-04 — "Absent is fatal
 * because a PR with no deployed target cannot be validated", "All the end to end tests should be skipped
 * if nothing sandbox is running and I should have a single e2e job that I can manually run that will run
 * all end to end tests", "End to end tests should always run against production").
 *
 * ## The failures this catches
 *
 * | # | The failure | Why nothing else sees it |
 * |---|---|---|
 * | 1 | a SECOND caller drives the deployed suite on the same commit | measured: `bbf7ea7c` ran `e2e-web` from two callers at once, two Playwright suites against ONE shared sandbox Clerk instance, each tearing down the other's sign-in fixture — `heavy-e2e.yml`'s header records it, and nothing structural prevents a repeat |
 * | 2 | a red run for "there is nothing deployed to talk to" | `deployGateStepGuards.test.ts` records the repair: red-over-nothing is the mirror of green-over-nothing, and `Sandbox Deploy` was permanently red on PR #91 for exactly this |
 * | 3 | `deployGate.sh`'s `live` output emitted and consumed by nothing at the JOB level | the gate has published the answer since 2026-09-02; a tier that re-derives "is anything deployed" grows a second, drifting definition of it |
 * | 4 | an automatic trigger pointed at PRODUCTION | a deployed suite against prod is a deliberate act; a schedule or a PR event reaching it is a decision nobody made |
 * | 5 | a host literal typed into YAML instead of resolved from the origin authority | `food-loadtest.yml` shipped `https://food-pr-59.commise.app` as a dispatch DEFAULT for months after PR 59 closed; a stale literal answers `000`, which reads as an outage |
 * | 6 | a deploy job that reports GREEN having deployed nothing | green and green-having-done-nothing are the same colour; only a SKIP is visually distinct, and only the intent term is knowable before a job starts |
 * | 7 | the food-before-recipe edge silently restored, or the join that replaced it hollowed out | ADR-0036 moved the ordering guarantee from a linear `needs` edge to a JOIN (`ecosystem-smoke` needs both deploys); re-adding the edge costs ~13 min a run, and a join that probes nothing is a job-shaped no-op that still reports green |
 *
 * ## Why the subject sets are DISCOVERED, not enumerated
 *
 * Analyzer 1 finds every workflow that runs the deployed tier by looking for the tier's own npm script, so a
 * second caller added tomorrow is caught the day it lands. Analyzer 2 finds every step after the liveness
 * probe and every job downstream of it, so a step appended to the entrypoint inherits the guard with no edit
 * here. A hand-maintained list of step names is a second copy of the workflow, and copies rot — that is how
 * `ingredientCatalogBlend.yaml` sat unexecuted for months behind a `FLOWS` array nobody updated.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. Written BEFORE `deployedE2e.yml` existed: every analyzer below failed, on an absent workflow.
 *   2. (rewritten 2026-09-13) Before `_ci.yml` ran the suite, analyzer 1's automatic-tier case failed with
 *      "the PR pipeline never runs the deployed authorization-boundary suite"; a second `test:deployed` job in
 *      `_ci.yml`, or a third workflow running it, fails the caller-set case.
 *   3. The e2e job's `if:` changed to `always()` → analyzer 2 reports it as red-over-nothing.
 *   4. The `if:` dropped from a post-probe step in `resolve` → analyzer 2 reports the unguarded step.
 *   5. The liveness step re-implemented as a bare `curl` loop → analyzer 3 finds no `deployGate.sh evaluate`.
 *   6. `schedule:` added to `deployedE2e.yml` → analyzer 4 fails.
 *   7. The prod refusal step deleted → analyzer 4's refusal assertion fails.
 *   8. `https://recipe-pr-91.commise.app` typed into the workflow → analyzer 5 reports the literal.
 *   9. The intent term left behind on a deploy job after the caller took it over → analyzer 6.
 *  10. `needs: deploy-food` re-added to `deploy-recipe`, `deploy-food.result == 'success'` dropped from
 *      `ecosystem-smoke`'s `if:`, `--configured-food-origin` deleted from its run body, or
 *      `kitchensink-food-schema-` removed from `deploy-food`'s gate → analyzer 7 fails.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');

/** The single manual entrypoint for the deployed e2e tier. */
const ENTRYPOINT = 'deployedE2e.yml';

/** The workflow whose deploy jobs must render "nothing to do" as a SKIP. */
// ⚠️ `sandboxPreview.yml`: the deploy jobs moved to a REUSABLE workflow so `_ci.yml` can run
// them as one branch of its own graph — GitHub Actions has no cross-workflow `needs`.
// ⚠️ `deployInfra.yml`, not `sandboxPreview.yml`. Every `cdk deploy` moved there — one job per `infra/`
// folder — so one workflow owns each stack; the preview workflow now only DECIDES and delegates. The job
// names moved with them: `deploy-food` → `food-service`, `deploy-recipe` → `recipe-service`.
const SANDBOX_DEPLOY = 'deployInfra.yml';

/** Where the ensure-exists gate lives now that the deploy jobs are elsewhere. */
const PREVIEW = 'sandboxPreview.yml';

/** The npm script that RUNS the deployed tier — the marker analyzer 1 discovers callers by. */
const DEPLOYED_TIER_SCRIPT = /npm run test:deployed/;

/** An origin typed into YAML rather than resolved from `publicServiceOriginForStage`. */
const HOST_LITERAL = /https?:\/\/[a-z0-9-]*\.?commise\.app/i;

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly run?: string;
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly name?: string;
    readonly if?: string;
    readonly needs?: string | readonly string[];
    readonly outputs?: Readonly<Record<string, string>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly on?: unknown;
    readonly concurrency?: { readonly group?: string; readonly 'cancel-in-progress'?: boolean };
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface Workflow {
    readonly file: string;
    readonly text: string;
    readonly doc: WorkflowDocument;
}

/** Every workflow in `.github/workflows`, parsed once. */
function workflows(): readonly Workflow[] {
    return readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => {
            const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');

            return { file, text, doc: parse(text) as WorkflowDocument };
        });
}

/** One workflow by name, or `undefined` when it does not exist yet. */
function workflow(file: string): Workflow | undefined {
    const path = join(WORKFLOW_DIR, file);

    if (!existsSync(path)) {
        return undefined;
    }

    const text = readFileSync(path, 'utf8');

    return { file, text, doc: parse(text) as WorkflowDocument };
}

/** `needs:` normalised to a list. */
function needsOf(job: WorkflowJob): readonly string[] {
    if (job.needs === undefined) {
        return [];
    }

    return typeof job.needs === 'string' ? [job.needs] : [...job.needs];
}

/** The entrypoint's jobs, or an empty record when the workflow is absent. */
function entrypointJobs(): Readonly<Record<string, WorkflowJob>> {
    return workflow(ENTRYPOINT)?.doc.jobs ?? {};
}

/**
 * ⚠️ REWRITTEN, not relaxed: analyzer 1 used to assert the entrypoint was the ONLY workflow that runs
 * `test:deployed`. That made the authorization-boundary suite — the one tier that sends a FORGED bearer to the
 * deployed recipe and food services, and so the only proof the deployed build verifies signatures — reachable
 * only by a `deployed-e2e` label or a hand dispatch. It never ran on its own: on PR #91, with the sandbox up and
 * every other e2e tier green in `CI — PR`, `Deployed E2E` reported SKIPPED on every push (runs 34776377438,
 * 34782454125, 34785019792), because the label was absent. Owner ruling 2026-09-05: every end-to-end tier runs
 * when the PR's sandbox is running.
 *
 * The collision the old assertion guarded is still guarded, by a narrower and truer rule: the callers are
 * exactly (a) ONE tier in the PR pipeline's e2e branch, which `e2eBranchGraph.test.ts` discovers and holds to
 * waiting for the preview deploy, and (b) the manual door, which analyzer 4 now keeps off every automatic event.
 * The suite is unauthenticated GETs only — it creates no Clerk fixture a concurrent run could tear down — so a
 * human dispatch overlapping a PR run shares nothing but the target.
 *
 * Mutation evidence: written against the tree where `_ci.yml` ran no `test:deployed`; the automatic-tier case
 * failed with "the PR pipeline never runs the deployed authorization-boundary suite".
 *
 * ⚠️ REWRITTEN AGAIN when every deployed tier moved into `deployedE2eTiers.yml`: the suite is now DEFINED in
 * exactly one job there, and both doors CALL that workflow instead of running the script themselves. The two
 * facts are unchanged — it runs automatically behind the preview deploy, and nothing else races it — but they
 * are now one definition plus two callers. Each caller's gate is asserted in `deployedE2eTiers.test.ts` §2.
 */
describe('analyzer 1 — the deployed authorization-boundary tier runs automatically, and from nowhere else', () => {
    const CI = '_ci.yml';
    const TIERS = 'deployedE2eTiers.yml';

    const callsOf = (file: string): readonly [string, WorkflowJob][] =>
        Object.entries(workflow(file)?.doc.jobs ?? {}).filter(
            ([, job]) => (job as { uses?: string }).uses === `./.github/workflows/${TIERS}`,
        );

    const callerJobs = (file: string): readonly [string, WorkflowJob][] =>
        Object.entries(workflow(file)?.doc.jobs ?? {}).filter(([, job]) =>
            (job.steps ?? []).some((step) => DEPLOYED_TIER_SCRIPT.test(step.run ?? '')),
        );

    it('is not vacuous: the deployed tier has an npm script something can run', () => {
        const manifest = JSON.parse(
            readFileSync(join(repoRoot, 'packages/tools/cross-service-e2e/package.json'), 'utf8'),
        ) as { scripts?: Record<string, string> };

        expect(Object.keys(manifest.scripts ?? {})).toContain('test:deployed');
    });

    it('⛔ it is DEFINED once, in the tiers workflow, against the origins its caller resolved', () => {
        const jobs = callerJobs(TIERS);

        expect(
            jobs.map(([id]) => id),
            'the tiers workflow never runs the deployed authorization-boundary suite, so neither door does',
        ).toHaveLength(1);

        const [id, job] = jobs[0] ?? ['', {}];

        expect(id).toMatch(/^e2e-/);
        // Not gated on anything of its own: the non-destructive suite runs on every target, prod included.
        expect(job.if).toBeUndefined();

        const suite = (job.steps ?? []).find((step) => DEPLOYED_TIER_SCRIPT.test(step.run ?? ''));
        const env = { ...(job as { env?: Record<string, unknown> }).env, ...suite?.env };

        // Its targets are the caller's resolved origins — never the shared tier, never a literal.
        expect(scalarText(env['DEPLOYED_RECIPE_URL'])).toBe('${{ inputs.recipe_origin }}');
        expect(scalarText(env['DEPLOYED_FOOD_URL'])).toBe('${{ inputs.food_origin }}');
    });

    it('⛔ the PR pipeline reaches it behind the preview deploy it tests', () => {
        const calls = callsOf(CI);

        expect(calls, 'the PR pipeline never calls the tiers workflow').toHaveLength(1);

        const [, call] = calls[0] ?? ['', {}];

        expect(needsOf(call)).toEqual(expect.arrayContaining(['deploy-preview', 'resolve-sandbox', 'sandbox-status']));
        expect(call.if ?? '').toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(call.if ?? '').toContain("needs.deploy-preview.result == 'success'");
        expect(call.if ?? '').not.toMatch(/always\(\)|!cancelled\(\)/);
    });

    it('⛔ its runners are exactly those two doors — no third workflow runs or calls it', () => {
        const runners = workflows()
            .filter(({ file }) => callerJobs(file).length > 0)
            .map(({ file }) => file);
        const callers = workflows()
            .filter(({ file }) => callsOf(file).length > 0)
            .map(({ file }) => file)
            .sort();

        expect(runners).toEqual([TIERS]);
        expect(callers).toEqual([CI, ENTRYPOINT].sort());
        expect(callsOf(ENTRYPOINT)).toHaveLength(1);
    });

    it('serialises runs against one environment rather than cancelling them', () => {
        const concurrency = workflow(ENTRYPOINT)?.doc.concurrency;

        // Keyed on the resolved TARGET, not on `github.ref`: two dispatches at different refs against the
        // SAME stage are precisely the collision, and a ref-keyed group would let them both through.
        expect(concurrency?.group ?? '').toMatch(/inputs\.target|event_name|pull_request\.number/);
        expect(concurrency?.['cancel-in-progress']).toBe(false);
    });
});

describe('analyzer 2 — an absent environment SKIPS, it never fails', () => {
    it('is not vacuous: the entrypoint has a liveness probe and at least one job downstream of it', () => {
        const jobs = entrypointJobs();
        const probes = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((step) => step.id === 'live'));

        expect(probes.length).toBe(1);
        expect(Object.values(jobs).some((job) => needsOf(job).length > 0)).toBe(true);
    });

    it('guards every step after the liveness probe on that probe’s own output', () => {
        const unguarded: string[] = [];

        for (const [name, job] of Object.entries(entrypointJobs())) {
            const steps = job.steps ?? [];
            const probeAt = steps.findIndex((step) => step.id === 'live');

            if (probeAt === -1) {
                continue;
            }

            unguarded.push(
                ...steps
                    .slice(probeAt + 1)
                    .filter((step) => !/steps\.live\.outputs/.test(step.if ?? ''))
                    .map((step) => `${name}: ${step.name ?? '(unnamed)'}`),
            );
        }

        expect(unguarded).toEqual([]);
    });

    it('gates every downstream job on the liveness output, and never on always()', () => {
        const offenders: string[] = [];

        for (const [name, job] of Object.entries(entrypointJobs())) {
            if (needsOf(job).length === 0) {
                continue;
            }

            const guard = job.if ?? '';

            if (!/needs\.[a-z0-9-]+\.outputs\.live\s*==\s*'true'/.test(guard)) {
                offenders.push(`${name}: if: ${guard || '(absent)'} — does not require a live environment`);
            }

            if (/always\(\)/.test(guard)) {
                offenders.push(`${name}: if: ${guard} — always() turns "nothing deployed" into a RED run`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('publishes the liveness answer as a job output so a dependent can read it', () => {
        const publishers = Object.values(entrypointJobs()).filter((job) =>
            /steps\.live\.outputs\.live/.test(job.outputs?.['live'] ?? ''),
        );

        expect(publishers.length).toBe(1);
    });
});

describe('analyzer 3 — liveness comes from the gate that already answers it', () => {
    it('reads `deployGate.sh evaluate`, and combines BOTH of its answers', () => {
        const step = Object.values(entrypointJobs())
            .flatMap((job) => job.steps ?? [])
            .find((candidate) => candidate.id === 'live');
        const run = step?.run ?? '';

        expect(run).toMatch(/deployGate\.sh\s+evaluate/);
        // `live=true` alone is not "there is something to test": the gate also reports `live=true` when it
        // is about to CREATE the environment (an ABSENT stack under intent). Only `deploy=false` means
        // "unchanged and already deployed and serving", which is the state this tier can run in.
        expect(run).toMatch(/\bdeploy\b/);
        expect(run).toMatch(/\blive\b/);
    });
});

describe('analyzer 4 — the manual door opens ONLY by hand, and production with it', () => {
    /**
     * ⚠️ TIGHTENED: this used to admit `pull_request` beside `workflow_dispatch`, for the `deployed-e2e` label
     * path. That path is gone, for three reasons measured on PR #91: its run rendered SKIPPED on every push
     * and read as "the e2e tests did not run" while `CI — PR` had run them; its tier now runs automatically
     * in the PR pipeline (analyzer 1); and, labelled, it would have probed the preview WHILE `CI — PR` was
     * deploying it — `deployGate.sh` is asked with `changed=false`, so a rolling deploy reads as serving.
     *
     * `push` is admitted ONLY as the registration trigger `workflowRegistration.test.ts` requires of a
     * dispatch-only file that is not yet on the default branch: scoped to this file, every job guarded on
     * `workflow_dispatch`, so the push runs nothing.
     */
    it('triggers on nothing automatic — no pull request, no schedule', () => {
        const on = workflow(ENTRYPOINT)?.doc.on;
        const triggers = typeof on === 'object' && on !== null ? Object.keys(on) : [];

        expect(triggers).toContain('workflow_dispatch');
        expect(triggers.filter((trigger) => trigger !== 'workflow_dispatch' && trigger !== 'push')).toEqual([]);
    });

    it('a registration push is inert: scoped to this file, and every job requires a dispatch', () => {
        const on = (workflow(ENTRYPOINT)?.doc.on ?? {}) as Record<string, { paths?: readonly string[] } | null>;

        if (!('push' in on)) {
            return;
        }

        expect(on['push']?.paths ?? []).toEqual([`.github/workflows/${ENTRYPOINT}`]);

        const unguarded = Object.entries(entrypointJobs())
            .filter(([, job]) => !/github\.event_name\s*==\s*'workflow_dispatch'/.test(job.if ?? ''))
            .map(([name]) => name);

        expect(unguarded).toEqual([]);
    });

    it('refuses a prod target on anything but a manual dispatch, as a STEP that cannot skip silently', () => {
        const text = workflow(ENTRYPOINT)?.text ?? '';

        expect(/Refuse a prod target[\s\S]{0,2000}?workflow_dispatch/.test(text)).toBe(true);
        expect(/Refuse a prod target[\s\S]{0,2000}?exit 1/.test(text)).toBe(true);
    });
});

describe('analyzer 5 — origins come from the authority, never from YAML', () => {
    it('resolves every service origin through printPublicOrigin', () => {
        const resolves = Object.values(entrypointJobs())
            .flatMap((job) => job.steps ?? [])
            .some((step) => /printPublicOrigin/.test(step.run ?? ''));

        expect(resolves).toBe(true);
    });

    it('types no *.commise.app host literal into the entrypoint', () => {
        const offenders = (workflow(ENTRYPOINT)?.text ?? '')
            .split('\n')
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => !line.trimStart().startsWith('#') && HOST_LITERAL.test(line))
            .map(({ line, index }) => `${ENTRYPOINT}:${index + 1} — ${line.trim()}`);

        expect(offenders).toEqual([]);
    });
});

describe('analyzer 6 — a deploy with nothing to do reports SKIPPED, not green', () => {
    it('is not vacuous: both sandbox deploy jobs exist', () => {
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};

        expect(Object.keys(jobs)).toEqual(expect.arrayContaining(['food-service', 'recipe-service']));
    });

    it('⛔ the INTENT term is the CALLER’s now — these jobs carry no label of their own', () => {
        // ⚠️ THE ANALYZER INVERTED, and the property it protects did not.
        //
        // It used to require `sandbox-up` on each job's `if:`, because without an intent term the job ran on
        // every PR event, skipped every step and reported GREEN having deployed nothing — and green and
        // green-having-done-nothing are the same colour.
        //
        // Intent still exists; it moved up. `_ci.yml` PROBES whether the shared sandbox tier is up and calls
        // this workflow only when it is, so being called IS the intent. A label term left here would be a
        // second, weaker copy of a decision now made against the environment rather than against somebody's
        // memory — and the two could disagree.
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};
        const stale = (['food-service', 'recipe-service'] as const)
            .filter((name) => /sandbox-up/.test(jobs[name]?.if ?? ''))
            .map((name) => `${name}: still gated on the sandbox-up label, which the caller replaced`);

        expect(stale).toEqual([]);
    });

    it('leaves `changed`, stack status and health in the STEP-level gate, where a job-level if cannot see them', () => {
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};
        const leaked = (['food-service', 'recipe-service'] as const)
            .filter((name) => /steps\.changes|steps\.gate/.test(jobs[name]?.if ?? ''))
            .map((name) => `${name}: reads a STEP output from its job-level if:, which is always empty there`);

        expect(leaked).toEqual([]);
    });
});

/**
 * ⚠️ REWRITTEN for ADR-0036, not relaxed — and the thing it proves is strictly harder than before.
 *
 * It used to assert ADR-0010 §5 belt 2: `deploy-recipe` carried `needs: deploy-food` plus
 * `!cancelled() && needs.deploy-food.result != 'failure'`, so a failed food deploy stopped recipe outright.
 * That edge cost ~13 minutes of every run — the two jobs ran back to back at 881s and 1113s steady-state on
 * run 34078228894 — for an ordering that was never a data dependency: recipe resolves food's origin through
 * the pure `foodServiceOriginForStage(stage, domain)`, which touches no network.
 *
 * ADR-0036 makes the two jobs peers and moves the guarantee from a linear edge to a JOIN. The property that
 * mattered — *a preview never claims a wired ecosystem behind a green check* — is now owned by
 * `ecosystem-smoke`, which needs BOTH deploys to have succeeded before it will make that claim at all.
 *
 * So this analyzer inverts. It used to require the edge; it now forbids it, and requires the join that
 * replaced it. Both halves are load-bearing: forbidding the edge alone would let someone delete the join and
 * ship a pipeline that asserts nothing about the ecosystem, and requiring the join alone would let someone
 * re-serialise the deploys while keeping a smoke job that can never observe a difference.
 *
 * ⛔ It also pins the derivation that let `deploy-recipe`'s blocking `describe-stacks` loop over food's two
 * stacks be DELETED rather than moved: `deploy-food.result == 'success'` entails both food stacks are
 * usable, because food's own ensure-exists gate enumerates both. That entailment lives in another job's
 * step, so nothing else in the tree would notice it rotting.
 */
describe('analyzer 7 — ADR-0036: the deploys are peers, and the join owns the ecosystem claim', () => {
    it('leaves deploy-recipe with no ordering edge to deploy-food', () => {
        const recipe = workflow(SANDBOX_DEPLOY)?.doc.jobs?.['recipe-service'];
        const needs = recipe?.needs === undefined ? [] : [recipe.needs].flat();

        // ⚠️ `recipe-workers` IS allowed — and required — because it is a REAL data dependency: recipe-service
        // reads the account-erasure queue from an SSM parameter the workers stack publishes, and refuses to
        // boot without it. ADR-0036 removed the edge to FOOD, which never was one.
        expect(needs).not.toContain('food-service');
        expect(recipe?.if ?? '').not.toMatch(/needs\.food-service/);
    });

    it('joins both deploys in ecosystem-smoke, and makes the claim only when both SUCCEEDED', () => {
        const smoke = workflow(SANDBOX_DEPLOY)?.doc.jobs?.['ecosystem-smoke'];
        const needs = smoke?.needs === undefined ? [] : [smoke.needs].flat();

        expect(needs).toEqual(expect.arrayContaining(['food-service', 'recipe-service']));
        expect(smoke?.if ?? '').toMatch(/needs\.food-service\.result\s*==\s*'success'/);
        expect(smoke?.if ?? '').toMatch(/needs\.recipe-service\.result\s*==\s*'success'/);
    });

    it('actually asserts the wiring — a join that probes nothing is a job-shaped no-op', () => {
        const body = (workflow(SANDBOX_DEPLOY)?.doc.jobs?.['ecosystem-smoke']?.steps ?? [])
            .map((step) => step.run ?? '')
            .join('\n');

        expect(body).toMatch(/--food-origin/);
        expect(body).toMatch(/--configured-food-origin/);
    });

    it('keeps ONE bearer of the ecosystem claim — deploy-recipe no longer probes food', () => {
        const body = (workflow(SANDBOX_DEPLOY)?.doc.jobs?.['recipe-service']?.steps ?? [])
            .map((step) => step.run ?? '')
            .join('\n');

        expect(body).not.toMatch(/--food-origin/);
        expect(body).not.toMatch(/--configured-food-origin/);
    });

    it("pins the derivation that replaced recipe's describe-stacks loop: food's gate enumerates both stacks", () => {
        // ⚠️ The gate stayed in `sandboxPreview.yml` when the deploys left: whether this PR's tier should
        // exist is a question about the PREVIEW, not about a package. Its id gained a prefix when one job
        // began evaluating both tiers.
        const body = (workflow(PREVIEW)?.doc.jobs?.['gate']?.steps ?? [])
            .filter((step) => step.id === 'food-gate')
            .map((step) => step.run ?? '')
            .join('\n');

        expect(body).toMatch(/kitchensink-food-schema-/);
        expect(body).toMatch(/kitchensink-food-service-/);
    });
});
