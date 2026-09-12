// @vitest-environment node
/**
 * Repo-wide guard: every deployed end-to-end tier is DEFINED ONCE, in `deployedE2eTiers.yml`, and the two
 * doors into it — the pull-request pipeline and the manual button — CALL that one definition.
 *
 * ## The defect this pins
 *
 * Owner ruling 2026-09-05: "There should also be a manual job that I can trigger that will run the end to
 * end tests" — all of them. The tiers lived as jobs inside `_ci.yml`, a workflow only `ci-pr.yml` and
 * `ci-main.yml` call, so the manual door (`deployedE2e.yml`) could reach none of the deployed Playwright
 * shards, the per-service tiers or the linkage suite. It held its own COPY of two of them (the recipe and
 * food smokes) instead, which is the "a copy of a list cannot detect that the list is incomplete" shape
 * `_ci-heavy.yml`'s header records the repository paying for three times. A manual run of a PR's preview
 * therefore ran three tiers of nine and reported green.
 *
 * ## What is asserted, and why each is derived rather than listed
 *
 *   1. ONE DEFINITION — every job, in every workflow, whose displayed name claims the e2e tier and which
 *      runs steps lives in the tiers file. Discovered by name (the same `E2E_CLAIM` shape
 *      `workflowInvariants` invariant 7 uses), so a tier added to either caller tomorrow fails here.
 *   2. BOTH DOORS CALL IT — `_ci.yml` behind the preview deploy it tests, `deployedE2e.yml` behind a human
 *      dispatch AND its liveness probe; neither reaches `_ci-heavy.yml` any other way.
 *   3. THE CALL IS COMPLETE — every required input is passed and nothing undeclared is. A mismatch is not a
 *      test failure on GitHub; it is a `startup_failure` with no log, the class
 *      `reusableWorkflowPermissions.test.ts` records.
 *   4. THE MANUAL DOOR RUNS EVERYTHING — no tier in the tiers file is gated on anything but the two
 *      heavy-tier switches (which the door turns on by default) and the production subset below.
 *   5. PRODUCTION GETS THE NON-DESTRUCTIVE SUBSET ONLY — every tier that loads Clerk secrets, provisions a
 *      fixture or calls the emulator skips a prod target at job level AND refuses one in its own first step,
 *      executed here under bash; every other tier still runs on prod, so the subset cannot silently empty.
 *   6. THE WEB VERDICT CROSSES THE BOUNDARY — `_ci.yml`'s merged Playwright report re-asserts the shards'
 *      result through an output of the tiers file, because GitHub has no cross-workflow `needs`.
 *
 * Mutation evidence is recorded in the commit that introduced this file.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { runWorkflowStep } from './workflowStepRunner.js';
import { scalarText } from './workflowScalar.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');
const TIERS = 'deployedE2eTiers.yml';
const TIERS_USES = `./.github/workflows/${TIERS}`;
const PR_PIPELINE = '_ci.yml';
const DOOR = 'deployedE2e.yml';
const HEAVY_USES = './.github/workflows/_ci-heavy.yml';

/** Same shape as `workflowInvariants` invariant 7's claim detector. */
const E2E_CLAIM = /\be2e\b|\bend[\s-]?to[\s-]?end\b/i;

/**
 * Jobs that carry the e2e word without being a tier, each with the reason.
 *
 * ⛔ A stale entry fails, so this cannot rot into fiction.
 */
const NOT_A_TIER: ReadonlyMap<string, string> = new Map([
    [
        `${PR_PIPELINE}::e2e-web-report`,
        'Merges the deployed shards’ blobs WITH the stubbed Integration tier’s blobs into one report and issues no ' +
            'request of its own. It needs `integration-web-playwright`, which is not a deployed tier and cannot be a ' +
            '`needs` of anything inside a called workflow, so the report is the PR pipeline’s own job.',
    ],
]);

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly name?: string;
    readonly if?: string;
    readonly needs?: string | readonly string[];
    readonly uses?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly outputs?: Readonly<Record<string, string>>;
    readonly steps?: readonly Step[];
}

interface Input {
    readonly required?: boolean;
    readonly type?: string;
    readonly default?: unknown;
}

interface Workflow {
    readonly on?: {
        readonly workflow_call?: {
            readonly inputs?: Readonly<Record<string, Input>>;
            readonly outputs?: Readonly<Record<string, { readonly value?: string }>>;
        };
        readonly workflow_dispatch?: { readonly inputs?: Readonly<Record<string, Input>> };
    };
    readonly jobs?: Readonly<Record<string, Job>>;
}

const load = (file: string): Workflow => parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as Workflow;

const allWorkflows = (): readonly [string, Workflow][] =>
    readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml'))
        .map((file) => [file, load(file)]);

const tiers = (): Workflow => (existsSync(join(WORKFLOW_DIR, TIERS)) ? load(TIERS) : {});

/** The ONE job in `file` that calls the tiers file, or a failure naming the file. */
function callOf(file: string): Job {
    const calls = Object.values(load(file).jobs ?? {}).filter((job) => job.uses === TIERS_USES);

    if (calls.length !== 1) {
        throw new Error(`${file} calls ${TIERS} ${calls.length} time(s); expected exactly once`);
    }

    return calls[0] as Job;
}

const needsOf = (job: Job): readonly string[] =>
    job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : [...job.needs];

/** A job loads a Clerk tenant's secrets, provisions a fixture into it, or drives the emulator. */
function touchesATenant(job: Job): boolean {
    if (job.uses === HEAVY_USES) {
        return scalarText(job.with?.['run_mobile_maestro']) !== 'false';
    }

    return (job.steps ?? []).some(
        (step) => (step.uses ?? '').includes('load-secrets') || /e2e-seed/.test(step.run ?? ''),
    );
}

describe('1 — every deployed e2e tier is defined once, in the tiers file', () => {
    it('the tiers file exists and is callable only', () => {
        expect(existsSync(join(WORKFLOW_DIR, TIERS)), `${TIERS} does not exist`).toBe(true);
        expect(Object.keys(tiers().on ?? {})).toEqual(['workflow_call']);
    });

    it('is not vacuous: the tiers file defines the web, service, linkage and authorization tiers', () => {
        const runs = Object.values(tiers().jobs ?? {})
            .flatMap((job) => job.steps ?? [])
            .map((step) => step.run ?? '')
            .join('\n');

        expect(runs).toContain('test:e2e --workspace=@commise/web');
        expect(runs).toContain('test:e2e --workspace=@kitchensink/cross-service-e2e');
        expect(runs).toContain('test:deployed --workspace=@kitchensink/cross-service-e2e');
        expect(runs).toContain('deployedSmoke.ts');
    });

    it('⛔ no other workflow defines a job that claims the e2e tier', () => {
        const elsewhere = allWorkflows()
            .filter(([file]) => file !== TIERS && file !== '_ci-heavy.yml')
            .flatMap(([file, doc]) =>
                Object.entries(doc.jobs ?? {})
                    .filter(([key, job]) => job.uses === undefined && E2E_CLAIM.test(job.name ?? key))
                    .map(([key]) => `${file}::${key}`),
            )
            .filter((id) => !NOT_A_TIER.has(id));

        expect(elsewhere, 'a tier defined outside the tiers file is a second copy the other door cannot reach').toEqual(
            [],
        );
    });

    it('every NOT_A_TIER exemption still names a job that exists', () => {
        const stale = [...NOT_A_TIER.keys()].filter((id) => {
            const [file, key] = id.split('::') as [string, string];

            return load(file).jobs?.[key] === undefined;
        });

        expect(stale).toEqual([]);
    });
});

describe('2 — both doors call the one definition, each behind its own evidence of a target', () => {
    it('the pull-request pipeline calls it behind the preview deploy it tests', () => {
        const call = callOf(PR_PIPELINE);

        expect(needsOf(call)).toEqual(expect.arrayContaining(['deploy-preview', 'resolve-sandbox', 'sandbox-status']));
        expect(call.if ?? '').toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(call.if ?? '').toContain("needs.deploy-preview.result == 'success'");
        expect(call.if ?? '').not.toMatch(/always\(\)|!cancelled\(\)/);
    });

    it('the manual door calls it only on a dispatch, and only when its probe found the stage serving', () => {
        const call = callOf(DOOR);

        expect(needsOf(call)).toContain('resolve');
        expect(call.if ?? '').toMatch(/github\.event_name\s*==\s*'workflow_dispatch'/);
        expect(call.if ?? '').toMatch(/needs\.resolve\.outputs\.live\s*==\s*'true'/);
    });

    it('⛔ both pass the origins their OWN resolver produced — never a literal, never a re-derivation', () => {
        for (const [file, resolver] of [
            [PR_PIPELINE, 'resolve-sandbox'],
            [DOOR, 'resolve'],
        ] as const) {
            const call = callOf(file);

            expect(scalarText(call.with?.['target_stage'])).toBe(`\${{ needs.${resolver}.outputs.stage }}`);

            for (const origin of ['identity_origin', 'recipe_origin', 'food_origin', 'web_origin']) {
                expect(scalarText(call.with?.[origin]), `${file} ${origin}`).toBe(
                    `\${{ needs.${resolver}.outputs.${origin} }}`,
                );
            }
        }
    });

    it('⛔ neither door reaches the heavy tiers except through the tiers file', () => {
        for (const file of [PR_PIPELINE, DOOR]) {
            const direct = Object.entries(load(file).jobs ?? {})
                .filter(([, job]) => job.uses === HEAVY_USES)
                .map(([key]) => `${file}::${key}`);

            expect(direct).toEqual([]);
        }
    });
});

describe('3 — every call is complete, because a mismatch is a startup_failure with no log', () => {
    it('passes every required input and nothing the tiers file does not declare', () => {
        const declared = tiers().on?.workflow_call?.inputs ?? {};
        const required = Object.entries(declared)
            .filter(([, input]) => input.required === true)
            .map(([name]) => name);

        expect(required.length).toBeGreaterThan(0);

        for (const file of [PR_PIPELINE, DOOR]) {
            const passed = Object.keys(callOf(file).with ?? {});

            expect(
                required.filter((name) => !passed.includes(name)),
                `${file} omits a required input`,
            ).toEqual([]);
            expect(
                passed.filter((name) => !(name in declared)),
                `${file} passes an undeclared input`,
            ).toEqual([]);
        }
    });

    it('grants the id-token the web tier’s Argos exchange needs, on both calls', () => {
        for (const file of [PR_PIPELINE, DOOR]) {
            const permissions = (callOf(file) as { permissions?: Record<string, string> }).permissions ?? {};

            expect(permissions['id-token'], `${file} does not grant id-token: write`).toBe('write');
            expect(permissions['contents']).toBe('read');
        }
    });
});

describe('4 — the manual door runs the whole suite', () => {
    /** The only conditions a tier in the tiers file may carry. */
    const ALLOWED_TERMS = [
        /inputs\.target_stage\s*!=\s*'prod'/g,
        /inputs\.run_mobile_maestro/g,
        /inputs\.run_load_test/g,
        /!cancelled\(\)/g,
    ];

    it('⛔ no tier is switched off by anything but the two heavy switches and the production subset', () => {
        const offenders = Object.entries(tiers().jobs ?? {}).flatMap(([key, job]) => {
            const residue = ALLOWED_TERMS.reduce(
                (text, term) => text.replace(term, ''),
                (job.if ?? '').replace(/\$\{\{|\}\}/g, ''),
            ).replace(/[\s()&|]/g, '');

            return residue === '' ? [] : [`${key}: if: ${job.if}`];
        });

        expect(offenders).toEqual([]);
    });

    it('the door forwards both heavy switches, and both default ON', () => {
        const call = callOf(DOOR);
        const dispatch = load(DOOR).on?.workflow_dispatch?.inputs ?? {};

        expect(scalarText(call.with?.['run_mobile_maestro'])).toBe('${{ inputs.run_mobile_maestro }}');
        expect(scalarText(call.with?.['run_load_test'])).toBe('${{ inputs.run_load_test }}');
        expect(dispatch['run_mobile_maestro']?.default).toBe(true);
        expect(dispatch['run_load_test']?.default).toBe(true);
    });

    /**
     * REWRITTEN (owner ruling 2026-09-13, "not run k6 automatically, but let it remain a job I can manually
     * trigger"): Maestro stays behind its label, and k6 is switched OFF on the pull-request pipeline outright — `e2eBranchGraph.test.ts` owns
     * the whole-graph form of that rule.
     */
    it('the pull-request pipeline keeps Maestro behind its label and never switches k6 on', () => {
        const call = callOf(PR_PIPELINE);

        expect(scalarText(call.with?.['run_mobile_maestro'])).toContain("'mobile-e2e'");
        expect(call.with?.['run_load_test']).toBe(false);
    });
});

describe('5 — production gets the non-destructive subset, and the subset is not empty', () => {
    const jobs = () => Object.entries(tiers().jobs ?? {});

    it('is not vacuous: tiers that touch a Clerk tenant exist, and so do tiers that do not', () => {
        expect(jobs().filter(([, job]) => touchesATenant(job)).length).toBeGreaterThanOrEqual(3);
        expect(
            jobs().filter(([, job]) => !touchesATenant(job) && job.uses === undefined && job.steps !== undefined)
                .length,
        ).toBeGreaterThanOrEqual(4);
    });

    it('⛔ every tier that touches a tenant skips a prod target at job level', () => {
        const unguarded = jobs()
            .filter(([, job]) => touchesATenant(job))
            .filter(([, job]) => !/inputs\.target_stage\s*!=\s*'prod'/.test(job.if ?? ''))
            .map(([key]) => key);

        expect(unguarded).toEqual([]);
    });

    it('⛔ …and refuses one in its own FIRST step, so an `if:` edit cannot be the only thing in the way', () => {
        for (const [key, job] of jobs().filter(([, candidate]) => touchesATenant(candidate) && !candidate.uses)) {
            const first = job.steps?.[0];

            expect(first?.env?.['TARGET_STAGE'], `${key}'s first step does not read the target`).toBe(
                '${{ inputs.target_stage }}',
            );

            const refused = runWorkflowStep(first?.run ?? '', { TARGET_STAGE: 'prod' });

            expect(refused.status, `${key} does not refuse prod`).not.toBe(0);
            expect(refused.log).toMatch(/::error::/);
            expect(runWorkflowStep(first?.run ?? '', { TARGET_STAGE: 'pr-91' }).status, `${key} refuses a PR`).toBe(0);
            expect(runWorkflowStep(first?.run ?? '', { TARGET_STAGE: 'pr-91 x' }).status).not.toBe(0);
        }
    });

    it('⛔ the tiers that do NOT touch a tenant carry no prod term — prod really runs them', () => {
        const hidden = jobs()
            .filter(([, job]) => !touchesATenant(job) && job.uses === undefined)
            .filter(([, job]) => /target_stage/.test(job.if ?? ''))
            .map(([key]) => key);

        expect(hidden).toEqual([]);
    });

    it('⛔ the heavy tiers get the target as `target_stage` and the tenant as a literal sandbox', () => {
        const heavyCalls = jobs().filter(([, job]) => job.uses === HEAVY_USES);

        expect(heavyCalls).toHaveLength(2);

        for (const [key, job] of heavyCalls) {
            expect(scalarText(job.with?.['target_stage']), key).toBe('${{ inputs.target_stage }}');
            expect(scalarText(job.with?.['stage']), key).toBe('sandbox');
        }

        const k6 = heavyCalls.find(([, job]) => scalarText(job.with?.['run_load_test']) === 'true')?.[1];

        expect(scalarText(k6?.with?.['load_test_target']).replace(/\s+/g, ' ')).toBe(
            "${{ inputs.target_stage == 'prod' && 'prod' || 'sandbox' }}",
        );
    });
});

describe('6 — the merged web report re-asserts the shards through an output of the tiers file', () => {
    it('the tiers file publishes the web matrix result from a job that runs even when a shard failed', () => {
        const output = tiers().on?.workflow_call?.outputs?.['web_result']?.value ?? '';
        const match = /jobs\.([a-z0-9-]+)\.outputs\.result/.exec(output);

        expect(match, 'no web_result output').not.toBeNull();

        const verdict = tiers().jobs?.[match?.[1] ?? ''];

        expect(needsOf(verdict ?? {})).toContain('e2e-web');
        expect(verdict?.if ?? '').toContain('!cancelled()');
        expect(JSON.stringify(verdict?.steps ?? [])).toContain('needs.e2e-web.result');
    });

    it('`_ci.yml`’s report reads that output, and needs the call that produces it', () => {
        const jobs = load(PR_PIPELINE).jobs ?? {};
        const callKey = Object.entries(jobs).find(([, job]) => job.uses === TIERS_USES)?.[0] ?? '(none)';
        const report = jobs['e2e-web-report'];
        const gate = (report?.steps ?? []).find(
            (step) => /\bexit 1\b/.test(step.run ?? '') && /result/.test(step.run ?? ''),
        );

        expect(needsOf(report ?? {})).toContain(callKey);
        expect(JSON.stringify(gate?.env ?? {})).toContain(`needs.${callKey}.outputs.web_result`);
    });
});
