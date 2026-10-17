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
 *     sandbox-status ── deploy-preview ── deployed-tiers ─┬─ e2e tiers
 *      (probe+verdict)  (deploy+migrate)  (deployedE2eTiers) ├─ Maestro   (label `mobile-e2e`)
 *                                                          └─ k6       (manual door only)
 *
 * The tiers are DEFINED in `deployedE2eTiers.yml`, which the manual door `deployedE2e.yml` calls too, so the
 * branch gate lives on the ONE `_ci.yml` job that calls it: every tier inside inherits it, because a skipped
 * `uses:` job runs none of the called workflow's jobs. (REWRITTEN from per-tier gates when the tiers moved;
 * `deployedE2eTiers.test.ts` holds that nothing else defines a tier.)
 *
 * ⛔ EVERY ASSERTION HERE IS DERIVED FROM THE WORKFLOW. The tier list is discovered, not written down, so a
 * seventh tier added tomorrow is covered the day it lands and cannot quietly sit outside the branch.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

import { scalarText } from './workflowScalar.js';

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
const PREVIEW = '.github/workflows/sandboxPreview.yml';
const TIERS = '.github/workflows/deployedE2eTiers.yml';

/** Every deployed tier — DISCOVERED from the tiers workflow, never listed. */
function deployedTiers(): readonly string[] {
    return Object.keys(jobsOf(TIERS))
        .filter((id) => id.startsWith('e2e-'))
        .sort();
}

/** The ONE `_ci.yml` job that calls the tiers workflow, or a failure naming the count. */
function tiersCall(): Job {
    const calls = Object.values(jobsOf(CI)).filter((job) => job.uses === './.github/workflows/deployedE2eTiers.yml');

    if (calls.length !== 1) {
        throw new Error(`_ci.yml calls the tiers workflow ${calls.length} time(s); expected exactly once`);
    }

    return calls[0] as Job;
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

        expect(deploy?.uses).toBe('./.github/workflows/sandboxPreview.yml');
        expect(deploy?.if).toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(needsOf(deploy ?? {})).toContain('sandbox-status');
    });

    it('⛔ every tier waits for the DEPLOY, not for a probe taken before it', () => {
        // The defect this replaces: gated on `resolve-sandbox.outputs.live`, computed before anything was
        // deployed, so the very run that created a preview never tested it. The gate sits on the call, so
        // every tier inside inherits it.
        const call = tiersCall();

        expect(needsOf(call)).toContain('deploy-preview');
        expect(needsOf(call)).toContain('sandbox-status');
        expect(call.if ?? '').toContain("needs.deploy-preview.result == 'success'");
        expect(call.if ?? '').toContain("needs.sandbox-status.outputs.branch == 'run'");
    });

    it('⛔ no tier inside the tiers workflow can escape the call’s gate by naming a job of its own caller', () => {
        const tiers = jobsOf(TIERS);
        const local = new Set(Object.keys(tiers));
        const foreign = Object.entries(tiers).flatMap(([id, job]) =>
            needsOf(job)
                .filter((need) => !local.has(need))
                .map((need) => `${id} → ${need}`),
        );

        expect(foreign).toStrictEqual([]);
    });

    it('⛔ no tier is still gated on the pre-deploy liveness probe', () => {
        const jobs = { ...jobsOf(CI), ...jobsOf(TIERS) };
        const stale = Object.entries(jobs)
            .filter(([, job]) => (job.if ?? '').includes('resolve-sandbox.outputs.live'))
            .map(([id]) => id);

        expect(stale, 'a pre-deploy probe cannot answer "is the thing I just deployed there"').toStrictEqual([]);
    });

    it('⛔ Maestro is its OWN job, carrying its own label on top of the branch', () => {
        const job = jobsOf(TIERS)['e2e-mobile-maestro'];

        expect(job, 'e2e-mobile-maestro must exist').toBeDefined();
        expect(job?.uses, 'e2e-mobile-maestro must call the heavy suite, not restate it').toBe(
            './.github/workflows/_ci-heavy.yml',
        );
        expect(job?.if, 'e2e-mobile-maestro must be switched by run_mobile_maestro').toContain(
            'inputs.run_mobile_maestro',
        );
        expect(
            scalarText(tiersCall().with?.['run_mobile_maestro']),
            'the PR pipeline must switch Maestro by the mobile-e2e label',
        ).toContain("'mobile-e2e'");
    });

    /**
     * REWRITTEN twice. First (owner ruling 2026-09-13, "not run k6 automatically, but let it remain a job I can
     * manually trigger"): k6 left the pull-request pipeline for the manual door. Then the tiers moved into `deployedE2eTiers.yml`, whose
     * `e2e-load-test` the manual door still needs — so the PR graph reaches k6 through a CALL, and "no direct
     * `_ci-heavy.yml` caller" alone would pass while that call switched k6 on. Every `_ci.yml` job that can reach
     * the heavy suite, directly or through the tiers, must hand it a literal `false`.
     */
    it('⛔ runs no k6 job on a pull request, directly or through the tiers workflow', () => {
        const reachesK6 = new Set(['./.github/workflows/_ci-heavy.yml', './.github/workflows/deployedE2eTiers.yml']);
        const k6Jobs = Object.entries(jobsOf(CI))
            .filter(([, job]) => reachesK6.has(job.uses ?? '') && job.with?.['run_load_test'] !== false)
            .map(([id]) => id);

        expect(tiersCall().with, 'the tiers call must state the k6 switch, not inherit a default').toHaveProperty(
            'run_load_test',
        );
        expect(k6Jobs, 'k6 runs only from the manual door').toStrictEqual([]);
        expect(jobsOf(TIERS)['e2e-load-test']?.if, 'the tiers k6 job must obey its switch').toContain(
            'inputs.run_load_test',
        );
    });

    /**
     * REWRITTEN (owner ruling 2026-09-13, amended the same day: "let's ammend the policy to not run k6 automatically,
     * but let it remain a job I can manually trigger"). Main's pipeline carries no k6 job, and the manual door is
     * still wired to the k6 tier.
     */
    it('⛔ runs no k6 job on a push to main — k6 is a job the owner triggers by hand', () => {
        const main = jobsOf('.github/workflows/ci-main.yml');
        const k6 = Object.entries(main)
            .filter(([, job]) => job.with?.['run_load_test'] !== undefined && job.with?.['run_load_test'] !== false)
            .map(([id]) => id);

        expect(k6, 'k6 must not run automatically on main').toStrictEqual([]);

        const door = Object.values(jobsOf('.github/workflows/deployedE2e.yml')).find(
            (job) => job.uses === './.github/workflows/deployedE2eTiers.yml',
        );

        expect(scalarText(door?.with?.['run_load_test']), 'the manual door must still switch k6').toBe(
            '${{ inputs.run_load_test }}',
        );
    });

    it('⛔ Maestro and k6 run in PARALLEL with the tiers — neither waits for the other or for a tier', () => {
        // Chaining them behind the e2e tiers would serialise ~20 minutes of independent work for an
        // ordering nothing needs.
        const jobs = jobsOf(TIERS);
        const tiers = new Set(deployedTiers());

        for (const id of ['e2e-mobile-maestro', 'e2e-load-test']) {
            const blocked = needsOf(jobs[id] ?? {}).filter((need) => tiers.has(need));

            expect(blocked, `${id} waits on ${blocked.join(', ')}`).toStrictEqual([]);
        }
    });

    /**
     * REWRITTEN: the heavy tiers used to receive the PR stage as `stage`, its no-PR fallback. They now receive it
     * as `target_stage`, the input that names what they drive (`heavyTierTarget.test.ts`), so the manual door's
     * dispatch — which has no PR number — drives the same preview. The hop from `_ci.yml` is asserted too.
     */
    it('⛔ k6 and Maestro receive the PR’s own stage as their TARGET, from the stage `_ci.yml` resolved', () => {
        expect(scalarText(tiersCall().with?.['target_stage'])).toBe('${{ needs.resolve-sandbox.outputs.stage }}');

        for (const id of ['e2e-mobile-maestro', 'e2e-load-test']) {
            expect(scalarText(jobsOf(TIERS)[id]?.with?.['target_stage']), id).toBe('${{ inputs.target_stage }}');
        }
    });
});

/**
 * ⛔ THE MAESTRO TIER RECEIVES THE CLERK TENANT, AND THE TENANT IT RECEIVES IS ONE THE TIER ADMITS.
 *
 * ## The defect, measured
 *
 * This block REPLACES an assertion that required BOTH heavy callers to pass
 * `needs.resolve-sandbox.outputs.stage`, on the stated premise that a literal `sandbox` "would point Maestro
 * and k6 at the SHARED tier instead of this PR's preview". That premise is false for Maestro, and the callee
 * says so: `_ci-heavy.yml`'s `resolve-mobile-target` derives its TARGET as
 * `github.event.pull_request.number && format('pr-{0}', …) || inputs.stage`, so on a pull request the target is
 * the PR's own preview whatever `stage` says. What `inputs.stage` DOES select there is the Clerk TENANT — the
 * secret path `load-secrets` reads and the tenant `e2e-seed provision` writes into — and the tier admits only
 * `sandbox`, because no `pr-{N}` tenant exists.
 *
 * So the old assertion ENFORCED the bug. On runs 34776377951 (60fb10aa) and 34782454327 (ef05812b) — sandbox
 * up, `mobile-e2e` labelled, the preview deployed and every other e2e tier green — the tier logged
 * `the mobile Maestro tier is sandbox-only — … 'pr-91' is not sandbox. SKIPPING the tier (this is not a
 * failure …)`, and skipped. By construction, on every pull request, with a notice saying all was well.
 *
 * k6 keeps the PR stage (above) because its `load-test-deployed` job reads `stage` only as the no-PR
 * fallback; its tenant is derived separately (`identity_stage`).
 *
 * ## How it is proved
 *
 * Not by string-matching `with.stage`: a literal check is satisfiable while the tier stays unreachable. The
 * value `_ci.yml` passes is RESOLVED (through `ci-pr.yml` if it forwards `inputs.stage`), then the callee's OWN
 * bash runs with it — the eligibility step that skipped the tier, and the refusal step that would fail it —
 * the posture `maestroStageGuard.test.ts` established. `node` is stubbed on `PATH` so the step's origin
 * resolver needs no built workspace; the stub is not the property, the stage comparison is.
 *
 * Mutation evidence: written against the tree that passed `needs.resolve-sandbox.outputs.stage`, where the
 * eligibility case reported `eligible=false`; reverting the fix reproduces it.
 */
describe('the Maestro tier is reachable from a pull request', () => {
    const HEAVY = '.github/workflows/_ci-heavy.yml';
    const PR = 91;

    interface Step {
        readonly id?: string;
        readonly name?: string;
        readonly run?: string;
        readonly env?: Record<string, string>;
    }

    const stepsOf = (file: string, job: string): readonly Step[] =>
        ((yaml.parse(readFileSync(`${REPO_ROOT}/${file}`, 'utf8')) as { jobs: Record<string, { steps?: Step[] }> })
            .jobs[job]?.steps ?? []) as readonly Step[];

    /**
     * What the `stage` input `_ci.yml` hands the Maestro tier evaluates to on a pull request.
     *
     * Models exactly the spellings that can appear, and THROWS on any other, so a new expression cannot pass
     * by being unmodelled.
     */
    function resolvedTenant(): string {
        const raw = scalarText(jobsOf(TIERS)['e2e-mobile-maestro']?.with?.['stage']).trim();

        if (!raw.includes('${{')) {
            return raw;
        }

        const expression = raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '');

        if (expression === 'inputs.stage') {
            const caller = Object.values(jobsOf('.github/workflows/ci-pr.yml')).find((job) =>
                (job.uses ?? '').endsWith('/_ci.yml'),
            );

            return scalarText(caller?.with?.['stage']);
        }

        if (expression === 'needs.resolve-sandbox.outputs.stage') {
            // `resolve-sandbox` publishes the PR's ORIGIN stage.
            return `pr-${PR}`;
        }

        throw new Error(`unmodelled stage expression passed to the Maestro tier: ${raw}`);
    }

    /**
     * Run one step body under real bash with `node` stubbed.
     *
     * @sideEffect Creates a temp directory, writes a script and a `node` stub, spawns bash.
     */
    function runStep(body: string, env: Record<string, string>): { status: number; output: string; log: string } {
        const dir = mkdtempSync(join(tmpdir(), 'e2e-branch-maestro-'));

        try {
            const bin = join(dir, 'bin');
            const outputFile = join(dir, 'github_output');

            mkdirSync(bin);
            writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\necho "https://stub.example.test"\n', {
                mode: 0o755,
            });
            writeFileSync(outputFile, '');
            writeFileSync(join(dir, 'step.sh'), body);

            const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
                cwd: dir,
                encoding: 'utf8',
                env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, GITHUB_OUTPUT: outputFile, ...env },
            });

            return {
                status: result.status ?? -1,
                output: readFileSync(outputFile, 'utf8'),
                log: `${result.stdout}${result.stderr}`,
            };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('⛔ the tier’s eligibility step, fed the stage `_ci.yml` passes, admits the PR’s preview', () => {
        const target = stepsOf(HEAVY, 'resolve-mobile-target').find((step) => step.id === 'target');

        expect(target?.env?.['CLERK_STAGE'], 'the eligibility step no longer reads inputs.stage').toBe(
            '${{ inputs.stage }}',
        );

        const tenant = resolvedTenant();
        const outcome = runStep(target?.run ?? '', {
            STAGE: `pr-${PR}`,
            CLERK_STAGE: tenant,
            DOMAIN_NAME: 'example.test',
        });

        expect(outcome.status, outcome.log).toBe(0);
        expect(
            outcome.output,
            `the Maestro tier resolves '${tenant}' as its Clerk tenant and SKIPS itself on every pull request`,
        ).toMatch(/^eligible=true$/m);
        expect(outcome.output).toMatch(new RegExp(`^web_origin=https://pr-${PR}\\.sandbox\\.example\\.test$`, 'm'));
    });

    it('⛔ …and the tier’s own refusal step lets that tenant through rather than failing the job', () => {
        const refusal = stepsOf(HEAVY, 'e2e-mobile-maestro').find(
            (step) => step.env?.['STAGE'] === '${{ inputs.stage }}' && step.run !== undefined,
        );

        expect(refusal, 'the Maestro refusal step lost its subject').toBeDefined();

        const outcome = runStep(refusal?.run ?? '', { STAGE: resolvedTenant() });

        expect(outcome.status, outcome.log).toBe(0);
    });

    it('⛔ the TARGET still comes from the PR number, so the tenant fix cannot collapse it onto the shared tier', () => {
        const job = (
            yaml.parse(readFileSync(`${REPO_ROOT}/${HEAVY}`, 'utf8')) as {
                jobs: Record<string, { env?: Record<string, string> }>;
            }
        ).jobs['resolve-mobile-target'];

        expect(scalarText(job?.env?.['STAGE'])).toMatch(
            /github\.event\.pull_request\.number\s*&&\s*format\('pr-\{0\}',\s*github\.event\.pull_request\.number\)/,
        );
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
        const deployers = Object.entries(sandboxDeploy).filter(([, job]) => job.uses?.includes('sandboxPreview'));

        expect(deployers.length, 'expected exactly the dispatch door').toBe(1);
        expect(deployers[0]?.[1].if).toContain("github.event_name == 'workflow_dispatch'");
    });

    it('⛔ the heavy suites have no second entry point AT ALL — `heavy-e2e.yml` is deleted', () => {
        // ⚠️ STRENGTHENED from "carries no `pull_request` trigger". The file is gone, and three things had
        // to be true before it could be:
        //
        //  1. ADR-0032 §3 names `deployedE2e.yml` as the ONE manual door. A second `workflow_dispatch`
        //     entry point into the same reusable contradicts that as plainly as it can be contradicted.
        //  2. Its 07:00 UTC nightly was justified in its own header on the grounds that the heavy jobs are
        //     "entirely self-contained on the runner… so the nightly sandbox shutdown does not affect
        //     them". Both halves went false: `_ci-heavy.yml` now holds `load-test-deployed` and a Maestro
        //     job that resolves a DEPLOYED sandbox, and declares no service containers at all. Under
        //     ADR-0028 that stage does not exist at 03:00 ET, so the nightly drove a torn-down target.
        //  3. Its ONE surviving asset — the Maestro flow selector — was MIGRATED to `_ci.yml` rather than
        //     discarded. It was inert where it lived (`dorny/paths-filter` self-skips off `pull_request`,
        //     and this file's PR trigger had already been removed), and it is live there.
        //
        // The suites are untouched: they live in `_ci-heavy.yml`, which four callers still use.
        expect(existsSync(`${REPO_ROOT}/.github/workflows/heavy-e2e.yml`)).toBe(false);
    });
});
