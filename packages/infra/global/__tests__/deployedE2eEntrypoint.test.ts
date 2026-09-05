// @vitest-environment node
/**
 * Repo-wide guard: ONE manual entrypoint runs the DEPLOYED e2e tier, an absent environment SKIPS rather
 * than fails, prod is reachable only by hand, and the sandbox deploy jobs report "nothing to do" as
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
 * | 3 | `deploy-gate.sh`'s `live` output emitted and consumed by nothing at the JOB level | the gate has published the answer since 2026-09-02; a tier that re-derives "is anything deployed" grows a second, drifting definition of it |
 * | 4 | an automatic trigger pointed at PRODUCTION | a deployed suite against prod is a deliberate act; a schedule or a PR event reaching it is a decision nobody made |
 * | 5 | a host literal typed into YAML instead of resolved from the origin authority | `food-loadtest.yml` shipped `https://food-pr-59.commise.app` as a dispatch DEFAULT for months after PR 59 closed; a stale literal answers `000`, which reads as an outage |
 * | 6 | a deploy job that reports GREEN having deployed nothing | green and green-having-done-nothing are the same colour; only a SKIP is visually distinct, and only the intent term is knowable before a job starts |
 * | 7 | ADR-0010 §5 belt 2 quietly dropped while belt 1 is being changed | belt 1 (`deploy-food` runs on every non-closed PR event) is exactly what the intent term relaxes, so belt 2 is the ONLY thing left ordering food before recipe |
 *
 * ## Why the subject sets are DISCOVERED, not enumerated
 *
 * Analyzer 1 finds every workflow that runs the deployed tier by looking for the tier's own npm script, so a
 * second caller added tomorrow is caught the day it lands. Analyzer 2 finds every step after the liveness
 * probe and every job downstream of it, so a step appended to the entrypoint inherits the guard with no edit
 * here. A hand-maintained list of step names is a second copy of the workflow, and copies rot — that is how
 * `ingredient-catalog-blend.yaml` sat unexecuted for months behind a `FLOWS` array nobody updated.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. Written BEFORE `deployed-e2e.yml` existed: every analyzer below failed, on an absent workflow.
 *   2. A second `npm run test:deployed` step added to `_ci.yml` → analyzer 1 reports two callers.
 *   3. The e2e job's `if:` changed to `always()` → analyzer 2 reports it as red-over-nothing.
 *   4. The `if:` dropped from a post-probe step in `resolve` → analyzer 2 reports the unguarded step.
 *   5. The liveness step re-implemented as a bare `curl` loop → analyzer 3 finds no `deploy-gate.sh evaluate`.
 *   6. `schedule:` added to `deployed-e2e.yml` → analyzer 4 fails.
 *   7. The prod refusal step deleted → analyzer 4's refusal assertion fails.
 *   8. `https://recipe-pr-91.commise.app` typed into the workflow → analyzer 5 reports the literal.
 *   9. The intent term removed from `deploy-food`'s job-level `if:` → analyzer 6 reports it.
 *  10. `!cancelled()` removed from `deploy-recipe`'s `if:` → analyzer 7 fails.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');

/** The single manual entrypoint for the deployed e2e tier. */
const ENTRYPOINT = 'deployed-e2e.yml';

/** The workflow whose deploy jobs must render "nothing to do" as a SKIP. */
const SANDBOX_DEPLOY = 'sandbox-deploy.yml';

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

describe('analyzer 1 — exactly ONE workflow drives the deployed e2e tier', () => {
    it('is not vacuous: the deployed tier has an npm script something can run', () => {
        const manifest = JSON.parse(
            readFileSync(join(repoRoot, 'packages/tools/cross-service-e2e/package.json'), 'utf8'),
        ) as { scripts?: Record<string, string> };

        expect(Object.keys(manifest.scripts ?? {})).toContain('test:deployed');
    });

    it('⛔ no second caller can race the first against one shared environment', () => {
        const callers = workflows()
            .filter(({ doc }) =>
                Object.values(doc.jobs ?? {}).some((job) =>
                    (job.steps ?? []).some((step) => DEPLOYED_TIER_SCRIPT.test(step.run ?? '')),
                ),
            )
            .map(({ file }) => file);

        expect(callers).toEqual([ENTRYPOINT]);
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
    it('reads `deploy-gate.sh evaluate`, and combines BOTH of its answers', () => {
        const step = Object.values(entrypointJobs())
            .flatMap((job) => job.steps ?? [])
            .find((candidate) => candidate.id === 'live');
        const run = step?.run ?? '';

        expect(run).toMatch(/deploy-gate\.sh\s+evaluate/);
        // `live=true` alone is not "there is something to test": the gate also reports `live=true` when it
        // is about to CREATE the environment (an ABSENT stack under intent). Only `deploy=false` means
        // "unchanged and already deployed and serving", which is the state this tier can run in.
        expect(run).toMatch(/\bdeploy\b/);
        expect(run).toMatch(/\blive\b/);
    });
});

describe('analyzer 4 — production is reachable ONLY by hand', () => {
    it('triggers on nothing automatic', () => {
        const on = workflow(ENTRYPOINT)?.doc.on;
        const triggers = typeof on === 'object' && on !== null ? Object.keys(on) : [];

        expect(triggers.length).toBeGreaterThan(0);
        expect(triggers.filter((trigger) => trigger !== 'workflow_dispatch' && trigger !== 'pull_request')).toEqual([]);
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
    it('is not vacuous: both sandbox deploy jobs exist and carry a job-level if', () => {
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};

        expect(Object.keys(jobs)).toEqual(expect.arrayContaining(['deploy-food', 'deploy-recipe']));
        expect(jobs['deploy-food']?.if ?? '').not.toBe('');
        expect(jobs['deploy-recipe']?.if ?? '').not.toBe('');
    });

    it('⛔ carries the INTENT term on the job-level if, the only gate condition knowable before a job starts', () => {
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};
        const missing = (['deploy-food', 'deploy-recipe'] as const)
            .filter((name) => !/sandbox-up/.test(jobs[name]?.if ?? ''))
            .map(
                (name) =>
                    `${name}: if: ${jobs[name]?.if ?? '(absent)'} — no intent term, so it runs and reports GREEN having deployed nothing`,
            );

        expect(missing).toEqual([]);
    });

    it('leaves `changed`, stack status and health in the STEP-level gate, where a job-level if cannot see them', () => {
        const jobs = workflow(SANDBOX_DEPLOY)?.doc.jobs ?? {};
        const leaked = (['deploy-food', 'deploy-recipe'] as const)
            .filter((name) => /steps\.changes|steps\.gate/.test(jobs[name]?.if ?? ''))
            .map((name) => `${name}: reads a STEP output from its job-level if:, which is always empty there`);

        expect(leaked).toEqual([]);
    });
});

describe('analyzer 7 — ADR-0010 §5 belt 2 still orders food before recipe', () => {
    it('keeps deploy-recipe skip-tolerant of a SKIPPED deploy-food, and intolerant of a FAILED one', () => {
        const guard = workflow(SANDBOX_DEPLOY)?.doc.jobs?.['deploy-recipe']?.if ?? '';

        expect(guard).toMatch(/!cancelled\(\)/);
        expect(guard).toMatch(/needs\.deploy-food\.result\s*!=\s*'failure'/);
    });
});
