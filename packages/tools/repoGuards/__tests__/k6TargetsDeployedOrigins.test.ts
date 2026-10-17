// @vitest-environment node
/**
 * Repo-wide guard: the k6 tier measures a DEPLOYED environment, the prod target is manual-only, and an
 * absent preview SKIPS rather than fails (owner ruling 2026-09-04 — "k6 should test the sandbox for the
 * PR. We should still be able to run k6 in the prod pipeline by triggering the job manually").
 *
 * ## The failures this catches
 *
 * | # | The failure | Why nothing else sees it |
 * |---|---|---|
 * | 1 | a k6 job that reports a performance number for a runner-local container and is READ as a statement about the service | `RECIPE_API_BASE_URL: http://localhost:3000` is valid YAML, a green run, and a real measurement — of the wrong thing |
 * | 2 | a host literal typed into YAML instead of resolved from the origin authority | `food-loadtest.yml` shipped `https://food-pr-59.commise.app` as a dispatch DEFAULT for months after PR 59 closed; a stale literal answers `000`, which reads as an outage |
 * | 3 | production driven by a schedule or a PR event | a load run against prod is a deliberate act; nothing automatic may reach it |
 * | 4 | a red run for "there is nothing to talk to" | `deployGateStepGuards.test.ts` records this exact repair: red-over-nothing is the mirror of green-over-nothing, and costs the same thing |
 *
 * ## Why the isolated-substrate set is PINNED rather than discovered
 *
 * Three k6 jobs deliberately measure a runner-local substrate, and re-pointing them would DELETE what they
 * assert rather than move it: their subjects are the substrate (a seeded corpus, a throwaway EdDSA/RS256
 * keypair the deployed service does not trust, an SQS queue nothing drains so its depth IS the fan-out
 * evidence, a food stub whose chunk counters are the proof the fan-out happened, an UNREACHABLE food origin
 * whose unreachability is the assertion, and a drain probe that speaks SQL to a database no runner can
 * reach). So they stay, named for what they measure.
 *
 * The set is pinned in the SAFE polarity: a job on the list is exempt, and every job NOT on it must target a
 * resolved deployed origin. A new k6 job therefore inherits the requirement the day it lands — the opposite
 * polarity (an allowlist of deployed jobs) is the "copy of a list cannot detect that the list is incomplete"
 * shape this repo has already paid for twice.
 *
 * Each pinned job must also SAY so in its own YAML (`k6-target: isolated substrate`), because the reader who
 * needs that fact is reading the workflow, not this file.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. Written BEFORE the sandbox job existed: "some k6 job measures a deployed origin" failed on the whole
 *      tier, and "the sandbox tier resolves its origins through the authority module" found no resolver.
 *   2. `load-test-sandbox` given `RECIPE_API_BASE_URL: http://localhost:3000` → analyzer 1 reports it
 *      (the job is not on the pinned list).
 *   3. A pinned job's `k6-target:` declaration deleted → analyzer 1's declaration assertion fails.
 *   4. `food-loadtest.yml`'s dispatch default restored to `https://food-pr-59.commise.app` → analyzer 2
 *      reports the host literal.
 *   5. The prod refusal step deleted from `_ci-heavy.yml` → analyzer 3 fails.
 *   6. `schedule:` (or `on: push`, in any YAML spelling) added to a workflow that can start k6 → the
 *      dispatch-only assertion in analyzer 3 fails.
 *   7. The `if:` dropped from a post-probe step in `load-test-sandbox` → analyzer 4 reports it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');

/**
 * The k6 jobs that deliberately measure a runner-local substrate, each with the reason re-pointing them
 * would DESTROY the assertion rather than relocate it. Pinned in the safe polarity — see the docblock.
 */
const ISOLATED_SUBSTRATE_JOBS: Readonly<Record<string, string>> = Object.freeze({
    // ⛔ EMPTY BY OWNER RULING (2026-09-05): "K6 should also be hitting sandbox or production …
    // It follows the same pattern as the end to end tests". The three isolated-substrate jobs were
    // deleted, not re-pointed — what remained of them once the substrate went was one script against
    // one origin, which is data rather than three jobs. Kept as an empty map rather than removed so
    // the guard below still REFUSES a newly-added local-substrate k6 job.
});

/** The job that carries the owner ruling: k6 against this PR's deployed preview. */
const SANDBOX_JOB = 'load-test-deployed';

/** Host shapes that mean "a runner-local container", not a deployed environment. */
const LOOPBACK = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/;

/** An origin typed into YAML rather than resolved from `publicServiceOriginForStage`. */
const HOST_LITERAL = /https?:\/\/[a-z0-9-]*\.?commise\.app/i;

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly run?: string;
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly 'working-directory'?: string;
}

interface WorkflowJob {
    readonly name?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly on?: unknown;
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

/**
 * Does this step drive k6 — directly, or through the `@kitchensink/loadtest` harness that wraps it?
 *
 * The harness form matters: `food-loadtest.yml` never types `k6 run`, it runs `run.mjs`, which is exactly
 * how its stale `food-pr-59` host literal stayed invisible to a `k6 run`-shaped search.
 */
function runsK6(step: WorkflowStep): boolean {
    const run = step.run ?? '';

    return /(^|\s|\/)k6\s+run\s/.test(run) || /--workspace=@kitchensink\/loadtest/.test(run);
}

interface K6Job {
    readonly workflow: string;
    readonly job: string;
    readonly steps: readonly WorkflowStep[];
}

/**
 * The reusable workflow that owns the k6 jobs. A CALLER of it drives k6 without typing `k6 run`, and the
 * analyzers below have to see callers too — `recipe-loadtest.yml` is where a schedule meets a prod-capable
 * input, and that is precisely the pairing analyzer 3 exists to refuse.
 */
const HEAVY_WORKFLOW = './.github/workflows/_ci-heavy.yml';

/** Does this workflow drive k6 — by running it, or by calling the reusable workflow that does? */
function drivesK6(workflow: Workflow): boolean {
    if (workflow.text.includes(HEAVY_WORKFLOW)) {
        return true;
    }

    return Object.values(workflow.doc.jobs ?? {}).some((job) => (job.steps ?? []).some(runsK6));
}

/** A workflow's triggers as a map, whichever of the three YAML spellings `on:` uses. Pure. */
function triggerMap(on: unknown): Readonly<Record<string, unknown>> {
    if (typeof on === 'string') {
        return { [on]: null };
    }

    if (Array.isArray(on)) {
        return Object.fromEntries(on.map((name) => [String(name), null]));
    }

    return typeof on === 'object' && on !== null ? (on as Record<string, unknown>) : {};
}

const K6_REACHING_WORKFLOWS = new Set([HEAVY_WORKFLOW, './.github/workflows/deployedE2eTiers.yml']);

/**
 * Whether a job condition can only be true on a manual dispatch: the dispatch check itself, optionally narrowed by
 * `&&` clauses. Any `||` could widen it past a dispatch (`… || true`), so it is refused rather than parsed. Pure.
 */
function isDispatchGated(condition: string | undefined): boolean {
    const expression = (condition ?? '').replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();

    return !expression.includes('||') && /^github\.event_name\s*==\s*'workflow_dispatch'(\s*&&.+)?$/s.test(expression);
}

/**
 * The automatic triggers through which a workflow could start k6, as `file: trigger` strings. Pure.
 *
 * A job starts k6 when it runs k6 itself or calls a workflow that does without switching `run_load_test` off. A
 * `workflow_call`-only file is judged at its callers. A push scoped to the file's own path is a registration, and
 * is admitted only when every k6-starting job is gated on `workflow_dispatch`.
 */
function automaticK6Triggers(workflow: Workflow): readonly string[] {
    const triggers = triggerMap(workflow.doc.on);
    const names = Object.keys(triggers);

    if (names.length === 1 && names[0] === 'workflow_call') {
        return [];
    }

    const starters = Object.values(workflow.doc.jobs ?? {}).filter(
        (job) =>
            (job.steps ?? []).some(runsK6) ||
            (K6_REACHING_WORKFLOWS.has(job.uses ?? '') && job.with?.['run_load_test'] !== false),
    );

    if (starters.length === 0) {
        return [];
    }

    const everyStarterDispatchGated = starters.every((job) => isDispatchGated(job.if));
    const isRegistration = (trigger: string): boolean =>
        trigger === 'push' &&
        everyStarterDispatchGated &&
        JSON.stringify((triggers[trigger] as { paths?: unknown } | null)?.paths) ===
            JSON.stringify([`.github/workflows/${workflow.file}`]);

    return names
        .filter((trigger) => trigger !== 'workflow_dispatch' && !isRegistration(trigger))
        .map((trigger) => `${workflow.file}: ${trigger}`);
}

/** Every job, in any workflow, that runs k6 at least once. */
function k6Jobs(): readonly K6Job[] {
    const found: K6Job[] = [];

    for (const workflow of workflows()) {
        for (const [job, definition] of Object.entries(workflow.doc.jobs ?? {})) {
            const steps = definition.steps ?? [];

            if (steps.some(runsK6)) {
                found.push({ workflow: workflow.file, job, steps });
            }
        }
    }

    return found;
}

/** The base-URL environment values a job hands to k6 (any `*BASE_URL` on any of its steps). */
function baseUrlValues(job: K6Job): readonly { readonly key: string; readonly value: string }[] {
    const values: { key: string; value: string }[] = [];

    for (const step of job.steps) {
        for (const [key, value] of Object.entries(step.env ?? {})) {
            if (key.endsWith('BASE_URL')) {
                values.push({ key, value: String(value) });
            }
        }
    }

    return values;
}

describe('k6 measures a deployed environment', () => {
    it('finds the k6 tier at all (the analyzers below are vacuous otherwise)', () => {
        expect(k6Jobs().length).toBeGreaterThan(0);
    });

    // ── 1 — no k6 job silently measures a runner-local container ────────────────────────────────────
    it('points every k6 job at a deployed origin, except the pinned isolated-substrate jobs', () => {
        const offenders = k6Jobs()
            .filter((job) => !(job.job in ISOLATED_SUBSTRATE_JOBS))
            .flatMap((job) =>
                baseUrlValues(job)
                    .filter((entry) => LOOPBACK.test(entry.value))
                    .map((entry) => `${job.workflow}:${job.job} — ${entry.key}=${entry.value}`),
            );

        expect(offenders).toEqual([]);
    });

    it('makes every isolated-substrate job DECLARE that it is one, in its own YAML', () => {
        const text = readFileSync(join(WORKFLOW_DIR, '_ci-heavy.yml'), 'utf8');
        const undeclared = Object.keys(ISOLATED_SUBSTRATE_JOBS).filter((job) => {
            const start = text.indexOf(`\n    ${job}:\n`);
            const rest = start === -1 ? '' : text.slice(start, text.indexOf('\n        steps:', start));

            return !/k6-target:\s*isolated substrate/i.test(rest);
        });

        expect(undeclared).toEqual([]);
    });

    it('keeps the pinned exemptions real — every pinned job still exists', () => {
        const present = new Set(k6Jobs().map((job) => job.job));
        const stale = Object.keys(ISOLATED_SUBSTRATE_JOBS).filter((job) => !present.has(job));

        expect(stale).toEqual([]);
    });

    // ── 2 — the deployed tier resolves its origins from the authority module ────────────────────────
    it('runs a k6 job against this PR’s deployed preview', () => {
        expect(k6Jobs().map((job) => job.job)).toContain(SANDBOX_JOB);
    });

    it('resolves the sandbox tier’s origins through the origin authority, never a host literal', () => {
        const job = k6Jobs().find((candidate) => candidate.job === SANDBOX_JOB);
        const steps = job?.steps ?? [];
        const resolves = steps.some((step) => /printPublicOrigin\.mjs/.test(step.run ?? ''));

        expect(resolves).toBe(true);
    });

    it('types no *.commise.app host literal into any workflow that runs k6', () => {
        const offenders: string[] = [];

        for (const workflow of workflows()) {
            if (!drivesK6(workflow)) {
                continue;
            }

            for (const [index, line] of workflow.text.split('\n').entries()) {
                if (line.trimStart().startsWith('#')) {
                    continue;
                }

                if (HOST_LITERAL.test(line)) {
                    offenders.push(`${workflow.file}:${index + 1} — ${line.trim()}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    // ── 3 — prod is reachable ONLY by hand ──────────────────────────────────────────────────────────
    /**
     * REWRITTEN (owner ruling 2026-09-13, amended the same day: "let's ammend the policy to not run k6 automatically,
     * but let it remain a job I can manually trigger"). A manual dispatch is the ONLY event that may reach
     * production. The step's own bash is RUN, not pattern-matched: a regex that finds `workflow_dispatch` in the text
     * still passes a step that also admits a push to main, which is exactly the allowance this ruling withdrew.
     */
    it.each([
        ['workflow_dispatch', 'refs/heads/main', 0],
        ['push', 'refs/heads/main', 1],
        ['push', 'refs/heads/chore/branch', 1],
        ['pull_request', 'refs/pull/91/merge', 1],
        ['schedule', 'refs/heads/main', 1],
    ] as const)('refuses a prod k6 target unless a person dispatched it — %s on %s exits %i', (event, ref, status) => {
        const job = k6Jobs().find((candidate) => candidate.job === SANDBOX_JOB);
        const refusal = (job?.steps ?? []).find((step) => /Refuse a prod target/.test(step.name ?? ''));
        const outcome = spawnSync('bash', ['--noprofile', '--norc', '-c', refusal?.run ?? 'exit 99'], {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', LOAD_TEST_TARGET: 'prod', EVENT_NAME: event, GIT_REF: ref },
        });

        expect(outcome.status, `${outcome.stdout}${outcome.stderr}`).toBe(status);
    });

    it('lets a sandbox target through on any event — the refusal is about prod only', () => {
        const job = k6Jobs().find((candidate) => candidate.job === SANDBOX_JOB);
        const refusal = (job?.steps ?? []).find((step) => /Refuse a prod target/.test(step.name ?? ''));
        const outcome = spawnSync('bash', ['--noprofile', '--norc', '-c', refusal?.run ?? 'exit 99'], {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', LOAD_TEST_TARGET: 'sandbox', EVENT_NAME: 'push', GIT_REF: 'x' },
        });

        expect(outcome.status, `${outcome.stdout}${outcome.stderr}`).toBe(0);
    });

    it('leaves that refusal UNCONDITIONAL — an `if:` on it would skip instead of going red', () => {
        const job = k6Jobs().find((candidate) => candidate.job === SANDBOX_JOB);
        const refusal = (job?.steps ?? []).find((step) => /Refuse a prod target/.test(step.name ?? ''));

        expect(refusal).toBeDefined();
        expect(refusal?.if).toBeUndefined();
    });

    /**
     * Owner ruling 2026-09-13: "not run k6 automatically, but let it remain a job I can manually trigger". A job that
     * can start k6 — one running it directly, or calling the heavy or deployed-tiers workflow without switching
     * `run_load_test` off — may sit only in a workflow a person dispatches. The one automatic trigger admitted is a
     * REGISTRATION push scoped to the workflow's own file, and only when every such job is itself gated on a
     * dispatch; a `workflow_call` file is judged at its callers, which `e2eBranchGraph.test.ts` holds to
     * `run_load_test: false`.
     */
    it('runs k6 only from a workflow a person dispatches — no schedule, PR or branch push reaches it', () => {
        const offenders = workflows().flatMap((workflow) => automaticK6Triggers(workflow));

        expect(offenders, 'k6 is a job the owner triggers by hand').toEqual([]);
    });

    it.each([
        ['a bare string', 'push', ['push']],
        ['a list', ['push', 'schedule'], ['push', 'schedule']],
        ['a map', { workflow_dispatch: null, schedule: [] }, ['workflow_dispatch', 'schedule']],
        ['nothing', undefined, []],
    ] as const)('reads every YAML spelling of `on:` — %s', (_, on, names) => {
        expect(Object.keys(triggerMap(on))).toEqual(names);
    });

    it.each([
        ["github.event_name == 'workflow_dispatch'", true],
        ["${{ github.event_name == 'workflow_dispatch' && needs.resolve.outputs.live == 'true' }}", true],
        ["github.event_name == 'workflow_dispatch' || true", false],
        ["github.event_name == 'workflow_dispatch' && needs.resolve.outputs.live == 'true' || true", false],
        ["needs.resolve.outputs.live == 'true' && github.event_name == 'workflow_dispatch'", false],
        ['always()', false],
        [undefined, false],
    ] as const)('treats `if: %s` as dispatch-gated: %s', (condition, gated) => {
        expect(isDispatchGated(condition)).toBe(gated);
    });

    it('does not admit a self-path push whose k6 job would run on that push', () => {
        const workflow: Workflow = {
            file: 'door.yml',
            text: '',
            doc: {
                on: { push: { paths: ['.github/workflows/door.yml'] }, workflow_dispatch: null },
                jobs: { tiers: { uses: './.github/workflows/deployedE2eTiers.yml', with: { run_load_test: true } } },
            },
        };

        expect(automaticK6Triggers(workflow)).toEqual(['door.yml: push']);
    });

    it('never lets an automatically-triggered k6 workflow DEFAULT to a prod target', () => {
        const offenders: string[] = [];

        for (const workflow of workflows()) {
            if (!drivesK6(workflow)) {
                continue;
            }

            const on = workflow.doc.on;
            const triggers = typeof on === 'object' && on !== null ? Object.keys(on) : [];
            const automatic = triggers.filter((trigger) => trigger !== 'workflow_dispatch');

            if (automatic.length === 0) {
                continue;
            }

            // A scheduled or event-driven run takes the DEFAULTS, so a prod default is a prod run nobody
            // asked for. (`_ci-heavy.yml` itself is `workflow_call`-only and is covered by the two
            // assertions above, which hold whichever caller and whichever trigger reaches it.)
            for (const [index, line] of workflow.text.split('\n').entries()) {
                if (/^\s*(default|load_test_target|target_stage|base_stage):\s*'?prod'?\s*$/.test(line)) {
                    offenders.push(
                        `${workflow.file}:${index + 1} — ${line.trim()} (triggers: ${automatic.join(', ')})`,
                    );
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    // ── 4 — an absent preview SKIPS, it never fails ─────────────────────────────────────────────────
    it('guards every step after the liveness probe on that probe’s own output', () => {
        const job = k6Jobs().find((candidate) => candidate.job === SANDBOX_JOB);
        const steps = job?.steps ?? [];
        const probeAt = steps.findIndex((step) => step.id === 'live');

        expect(probeAt).toBeGreaterThan(-1);

        const unguarded = steps
            .slice(probeAt + 1)
            .filter((step) => !/steps\.live\.outputs/.test(step.if ?? '') && !/always\(\)/.test(step.if ?? ''))
            .map((step) => step.name ?? '(unnamed)');

        expect(unguarded).toEqual([]);
    });
});
