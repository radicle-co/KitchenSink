// @vitest-environment node
/**
 * Repo-wide guard: the PR pipeline's e2e branch is ONE graph — probe, deploy, migrate, then test.
 *
 * ## What this shape replaced, and the constraint that forced it
 *
 * The deployed tiers used to be spread over three workflows that all fired on `pull_request` and could not
 * see each other: `sandbox-deploy.yml` deployed the preview, `_ci.yml` ran the e2e tiers, `heavy-e2e.yml`
 * ran Maestro and k6. ⛔ GitHub Actions has NO cross-workflow `needs` — two workflows on one event run
 * independently — so "deploy, then test what was deployed" was not expressible, and the tiers were instead
 * gated on a liveness probe taken BEFORE anything was deployed. On the first push of a PR that probe is
 * false, so the run that created a preview never tested it.
 *
 * Whether any of it ran at all came down to a `sandbox-up` label a human had to remember, whose failure
 * mode is silence: forget it, everything skips, every check is green, and a skip is indistinguishable from
 * a pass.
 *
 * The deploy is now a REUSABLE workflow this pipeline calls, so all of it is one job graph:
 *
 *     sandbox-status ── deploy-preview ─┬─ e2e tiers
 *      (probe+verdict)  (deploy+migrate)├─ Maestro   (label `mobile-e2e`)
 *                                       └─ k6       (label `k6`)
 *
 * ⛔ EVERY ASSERTION HERE IS DERIVED FROM THE WORKFLOW. The tier list is discovered, not written down, so a
 * seventh tier added tomorrow is covered the day it lands and cannot quietly sit outside the branch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** One workflow's jobs, as this guard reads them. */
interface Job {
    readonly needs?: string | string[];
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Record<string, unknown>;
}

/**
 * Parse a workflow's jobs.
 *
 * @param file - Repo-relative workflow path.
 * @returns Its job map. Impure.
 * @sideEffect Reads the working tree.
 */
function jobsOf(file: string): Record<string, Job> {
    const parsed = yaml.parse(readFileSync(`${REPO_ROOT}/${file}`, 'utf8')) as {
        jobs?: Record<string, Job>;
        on?: unknown;
        true?: unknown;
    };

    return parsed.jobs ?? {};
}

/** A workflow's trigger names. YAML parses a bare `on:` key as the boolean `true`. */
function triggersOf(file: string): readonly string[] {
    const parsed = yaml.parse(readFileSync(`${REPO_ROOT}/${file}`, 'utf8')) as Record<string, unknown>;
    const on = (parsed['on'] ?? parsed['true']) as Record<string, unknown> | undefined;

    return Object.keys(on ?? {});
}

const needsOf = (job: Job): readonly string[] => (typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []));

const CI = '.github/workflows/_ci.yml';
const PREVIEW = '.github/workflows/_sandbox-preview.yml';

/** Every deployed tier — DISCOVERED as the jobs gated on the branch verdict, never listed. */
function deployedTiers(): readonly string[] {
    return Object.entries(jobsOf(CI))
        .filter(
            ([id, job]) => id.startsWith('e2e-') && (job.if ?? '').includes("sandbox-status.outputs.branch == 'run'"),
        )
        .map(([id]) => id)
        .sort();
}

describe('the e2e branch is one graph', () => {
    it('discovers the tiers at all — a vacuous pass here would assert nothing below', () => {
        expect(deployedTiers().length).toBeGreaterThanOrEqual(6);
    });

    it('⛔ the verdict job is a ROOT — nothing it depends on can make it skip', () => {
        // A gate whose own job can be skipped is not a gate: `deploy-preview` would then see an empty
        // output and its `== 'run'` comparison would be false, so a dependency failure upstream would read
        // as "the sandbox is down" and skip the whole branch silently.
        expect(needsOf(jobsOf(CI)['sandbox-status'] ?? {})).toStrictEqual([]);
    });

    it('⛔ the deploy runs only on a `run` verdict, and calls the reusable preview workflow', () => {
        const deploy = jobsOf(CI)['deploy-preview'];

        expect(deploy?.uses).toBe('./.github/workflows/_sandbox-preview.yml');
        expect(deploy?.if).toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(needsOf(deploy ?? {})).toContain('sandbox-status');
    });

    it('⛔ every tier waits for the DEPLOY, not for a probe taken before it', () => {
        // The defect this replaces: gated on `resolve-sandbox.outputs.live`, computed before anything was
        // deployed, so the very run that created a preview never tested it.
        const jobs = jobsOf(CI);
        const wrong = deployedTiers().filter((tier) => {
            const job = jobs[tier] ?? {};

            return (
                !needsOf(job).includes('deploy-preview') ||
                !(job.if ?? '').includes("needs.deploy-preview.result == 'success'")
            );
        });

        expect(wrong, 'these tiers do not wait for the preview they test').toStrictEqual([]);
    });

    it('⛔ no tier is still gated on the pre-deploy liveness probe', () => {
        const jobs = jobsOf(CI);
        const stale = Object.entries(jobs)
            .filter(([, job]) => (job.if ?? '').includes('resolve-sandbox.outputs.live'))
            .map(([id]) => id);

        expect(stale, 'a pre-deploy probe cannot answer "is the thing I just deployed there"').toStrictEqual([]);
    });

    it('⛔ Maestro and k6 are their OWN jobs, each carrying its own label on top of the branch', () => {
        const jobs = jobsOf(CI);

        for (const [id, label] of [
            ['e2e-mobile-maestro', 'mobile-e2e'],
            ['e2e-load-test', 'k6'],
        ] as const) {
            const job = jobs[id];

            expect(job, `${id} must exist`).toBeDefined();
            expect(job?.uses, `${id} must call the heavy suite, not restate it`).toBe(
                './.github/workflows/_ci-heavy.yml',
            );
            expect(job?.if, `${id} must require the ${label} label`).toContain(label);
            expect(job?.if).toContain("needs.sandbox-status.outputs.branch == 'run'");
        }
    });

    it('⛔ Maestro and k6 run in PARALLEL with the tiers — neither waits for the other or for a tier', () => {
        // Chaining them behind the e2e tiers would serialise ~20 minutes of independent work for an
        // ordering nothing needs.
        const jobs = jobsOf(CI);
        const tiers = new Set(deployedTiers());

        for (const id of ['e2e-mobile-maestro', 'e2e-load-test']) {
            const blocked = needsOf(jobs[id] ?? {}).filter((need) => tiers.has(need) || need === 'e2e-load-test');

            expect(blocked, `${id} waits on ${blocked.join(', ')}`).toStrictEqual([]);
        }
    });

    it('⛔ passes the PR’s own stage to the heavy suites, never a literal', () => {
        // `_ci-heavy.yml` requires a stage. A literal `sandbox` here would point Maestro and k6 at the
        // SHARED tier instead of this PR's preview — a suite that writes recipes and drives GDPR erasure.
        const jobs = jobsOf(CI);

        for (const id of ['e2e-mobile-maestro', 'e2e-load-test']) {
            expect(String(jobs[id]?.with?.['stage'])).toContain('resolve-sandbox.outputs.stage');
        }
    });
});

describe('the preview workflow is reusable, and nothing else races it', () => {
    it('⛔ is callable ONLY — a `pull_request` trigger here would double-deploy every PR', () => {
        expect(triggersOf(PREVIEW)).toStrictEqual(['workflow_call']);
    });

    it('⛔ takes its intent from the CALLER, not from a label', () => {
        // The whole point: `sandbox-up` was a single point of failure whose failure mode was silence.
        const source = readFileSync(`${REPO_ROOT}/${PREVIEW}`, 'utf8');
        const code = source
            .split('\n')
            .filter((line) => !/^\s*#/.test(line))
            .join('\n');

        expect(code).not.toContain('sandbox-up');
        expect(code).toContain("INTENT: 'true'");
    });

    it('⛔ no other workflow deploys a preview on a pull request', () => {
        // Two deployers on one event is the race this refactor removed. `sandbox-deploy.yml` keeps the
        // hand-dispatch door and the teardown jobs; it must not deploy from a PR any more.
        const sandboxDeploy = jobsOf('.github/workflows/sandbox-deploy.yml');
        const deployers = Object.entries(sandboxDeploy).filter(([, job]) => job.uses?.includes('_sandbox-preview'));

        expect(deployers.length, 'expected exactly the dispatch door').toBe(1);
        expect(deployers[0]?.[1].if).toContain("github.event_name == 'workflow_dispatch'");
    });

    it('⛔ the heavy suites have no second PR entry point', () => {
        // `heavy-e2e.yml` used to run Maestro and k6 from its own `pull_request` trigger on a third label.
        // Two paths to one suite is how a PR gets a green Maestro it never asked for, and an ambiguous
        // answer to "did the mobile flows run".
        expect(triggersOf('.github/workflows/heavy-e2e.yml')).not.toContain('pull_request');
    });
});
