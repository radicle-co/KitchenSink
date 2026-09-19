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
    readonly if?: string;
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
    /** Job-level environment — where a tier is handed its resolved origins. */
    readonly env?: Readonly<Record<string, unknown>>;
    readonly outputs?: Readonly<Record<string, string>>;
    /** What a CALLING job forwards to the workflow it `uses`. */
    readonly secrets?: Readonly<Record<string, string>>;
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
            readonly secrets?: Readonly<Record<string, { readonly required?: boolean }>>;
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

/**
 * ⛔ A PROOF THAT CANNOT RUN MUST SAY SO — it may not report green under a name that claims it ran.
 *
 * The owner's ruling is verbatim: *"NEVER report a skip as a pass — a skip claims nothing, a green over a
 * suite that never ran claims something false."* The queue-guarantee tier broke it twice at once. Its two
 * steps were gated `if: ${{ env.<SECRET> != '' }}`, and a GitHub `if:` skip emits NOTHING at all — so a run
 * without the credential produced a green check named "the deployed backstop is armed and running" having
 * read nothing. And `_ci.yml` forwarded only the two AWS secrets, so the half that proves the backstop is
 * RUNNING — the one claim nothing else in the repository can make, because a check that never executes
 * produces the same silence as a healthy one — never ran on the pull-request path at all.
 *
 * Two rules, because either alone leaves the other failure live: every secret a step's shell tests must be
 * declared by EVERY caller, and no step may be gated on a secret's presence by `if:`.
 */
describe('5 — a proof that cannot run says so', () => {
    /** The secrets the tiers file declares as `workflow_call` inputs. */
    const declaredSecrets = (): readonly string[] => Object.keys(tiers().on?.workflow_call?.secrets ?? {});

    /** Every declared secret the tiers file's steps read as a presence test in their own shell. */
    function secretsTestedInShell(): readonly string[] {
        const found = new Set<string>();

        for (const job of Object.values(tiers().jobs ?? {})) {
            for (const step of job.steps ?? []) {
                for (const match of (step.run ?? '').matchAll(/if \[ -z "\$\{([A-Z0-9_]+)\}" \]/gu)) {
                    const name = match[1] as string;

                    if (declaredSecrets().includes(name)) {
                        found.add(name);
                    }
                }
            }
        }

        return [...found].sort();
    }

    it('discovers the presence tests — an empty scan would pass everything below', () => {
        expect(secretsTestedInShell().length).toBeGreaterThan(0);
    });

    it('⛔ every secret a step tests for is declared by EVERY caller of the tiers file', () => {
        const tested = secretsTestedInShell();
        const missing: string[] = [];

        for (const file of [PR_PIPELINE, DOOR]) {
            const passed = Object.keys(callOf(file).secrets ?? {});

            for (const secret of tested) {
                if (!passed.includes(secret)) {
                    missing.push(`${file} does not forward ${secret}`);
                }
            }
        }

        expect(missing).toEqual([]);
    });

    /**
     * ⛔ THE STEP RUNS AND ANNOUNCES ITS OWN ABSENCE. An `if:` on a secret is invisible: the log is empty, the
     * job is green, and the only record that a proof did not happen is a reader diffing the step list against
     * the workflow. A `::notice::` inside the step is in the log and in the job summary.
     */
    it('⛔ no step is gated on a secret’s presence by `if:` — the skip would be silent', () => {
        const gated: string[] = [];

        for (const [name, job] of Object.entries(tiers().jobs ?? {})) {
            for (const step of job.steps ?? []) {
                const condition = step.if ?? '';

                for (const secret of declaredSecrets()) {
                    // `configure-aws-credentials` is exempt and named: an action cannot emit a notice, and it
                    // is not a proof — the steps that make the claims each announce their own absence.
                    if (condition.includes(secret) && !(step.uses ?? '').includes('configure-aws-credentials')) {
                        gated.push(`${name}: "${step.name ?? step.uses ?? '?'}" is gated on ${secret}`);
                    }
                }
            }
        }

        expect(gated).toEqual([]);
    });
});

/**
 * ⛔ EVERY ORIGIN A JOB IS HANDED IS AN ORIGIN IT MUST CHECK.
 *
 * This is the class, not the instance. When ten inline copies of the domain guard were collapsed into
 * `.github/scripts/targetScope.sh`, the extraction read each job's targets by NAME SHAPE — `*_ORIGIN` and
 * `*_URL` — and one job's third target is called `LINKAGE_AZP`. It vanished from the assert while the step
 * kept its name, "Confirm EVERY resolved target is under this repository's own domain", and
 * `mintLinkageCredentials.ts` went on reading it as required and minting Clerk credentials against it.
 *
 * ⛔ AND THE FIRST VERSION OF THIS GUARD WAS GREEN OVER FOUR MORE OF THEM. It read `job.env` only, matched
 * only values shaped `inputs.*origin`, and read only `deployedE2eTiers.yml` — so it could not see `e2e-web`'s
 * seeder origins (STEP-level), could not see Maestro's (`needs.*.outputs.*`), and could not see
 * `_ci-heavy.yml` at all. Its docstring's own sentence was where it went wrong: *"a naming convention is not
 * a derivation; the job's own env is"* — the job's env is not where all of a job's origins live. Each of the
 * three widenings below exists because one real unguarded origin hid behind it.
 *
 * ⛔ WHY THE CONSUMING JOB IS THE BOUNDARY, checked rather than assumed: no producer validates its own
 * outputs. `_ci.yml`'s `resolve-sandbox`, `_ci-heavy.yml`'s `resolve-mobile-target` and `deployedE2e.yml`
 * (which calls the predicate nowhere at all) each compose origins and hand them on. So the assert in the job
 * that USES an origin is the only thing standing between a re-pointed `DOMAIN_NAME` and this repository's
 * Clerk tenant.
 */
describe('6 — a job checks every origin it is given', () => {
    /** Every workflow that drives a deployed target, not just the tiers file. */
    const TARGET_DRIVING = [TIERS, PR_PIPELINE, '_ci-heavy.yml', DOOR] as const;

    /**
     * A value that IS a resolved origin — from this workflow's inputs or from another job's outputs.
     *
     * ⚠️ Matched on where it COMES FROM, not on what the JOB called it — which is the reading that catches
     * `LINKAGE_AZP`, an origin bound under a name resembling nothing.
     *
     * ⛔ BUT IT STILL KEYS ON A NAME ONE LEVEL UP: the workflow INPUT or job OUTPUT must be called
     * `*origin`. All four inputs are today, so this is complete as written — but an input named, say,
     * `admin_base_url` would be invisible here, which is `LINKAGE_AZP` relocated by one hop. Stated rather
     * than widened, because widening it to every `inputs.*` would sweep in stages, flags and selectors and
     * make the guard fire on values that are not targets at all.
     */
    const isOriginValue = (value: unknown): boolean =>
        /(?:inputs\.\w*origin\b|needs\.[\w-]+\.outputs\.\w*origin\b)/u.test(String(value));

    /**
     * The origin VALUES a job is handed, at JOB level or in any of its STEPS.
     *
     * ⛔ VALUES, NOT NAMES, and that distinction is the whole guard. One origin is bound under several names
     * in one job — `e2e-web` reads `${{ inputs.food_origin }}` as `SEED_FOOD_ORIGIN` in its guard step and as
     * `E2E_SEED_FOOD_URL` in each seeding step. Comparing names reports the SAME origin as unguarded because
     * the guard spelled it differently, which is a guard that cannot be satisfied except by renaming, and
     * renaming is not checking. The expression is what identifies the target.
     */
    function originValuesGivenTo(job: Job): readonly string[] {
        const fromJob = Object.values(job.env ?? {});
        const fromSteps = (job.steps ?? []).flatMap((step) => Object.values(step.env ?? {}));

        return [...new Set([...fromJob, ...fromSteps].map(String).filter(isOriginValue))].sort();
    }

    /** The origin VALUES a job passes to the shared predicate, resolved through the env each name is bound to. */
    function originValuesCheckedBy(job: Job): readonly string[] {
        const values = new Set<string>();

        for (const step of job.steps ?? []) {
            const scope = { ...(job.env ?? {}), ...(step.env ?? {}) } as Record<string, unknown>;

            for (const call of (step.run ?? '').matchAll(/target_scope_(?:assert|under_domain)[^\n]*/gu)) {
                for (const reference of (call[0] ?? '').matchAll(/\$\{([A-Z0-9_]+)\}/gu)) {
                    const bound = scope[reference[1] ?? ''];

                    // ⚠️ Narrowed to a string rather than stringified: a YAML env value can be a mapping,
                    // and `String({})` is `[object Object]` — which would enter the checked set as a value
                    // no origin can ever equal, quietly satisfying the comparison below.
                    if (typeof bound === 'string' && isOriginValue(bound)) {
                        values.add(bound);
                    }
                }
            }
        }

        return [...values].sort();
    }

    /** Every job in every target-driving workflow, labelled by file. */
    function jobsInScope(): readonly (readonly [string, Job])[] {
        return TARGET_DRIVING.filter((file) => existsSync(join(WORKFLOW_DIR, file))).flatMap((file) =>
            Object.entries(load(file).jobs ?? {}).map(([name, job]) => [`${file}::${name}`, job] as const),
        );
    }

    it('discovers the jobs that are handed origins — an empty scan would pass everything below', () => {
        const given = jobsInScope().filter(([, job]) => originValuesGivenTo(job).length > 0);

        // Pinned, not a floor. A job dropping out of discovery is how this guard goes quiet, and a `>=`
        // would hide three of them — which is what the first version's `toBeGreaterThanOrEqual(5)` did.
        expect(given.map(([label]) => label).sort()).toMatchSnapshot();
        expect(given.length).toBeGreaterThan(5);
    });

    it('⛔ passes every origin it was handed to the domain guard', () => {
        const unchecked: string[] = [];

        for (const [label, job] of jobsInScope()) {
            const given = originValuesGivenTo(job);
            const checked = originValuesCheckedBy(job);

            // ⚠️ A job that calls the guard NOWHERE is out of scope HERE, and — stated rather than deferred
            // to a guard that does not hold it — NOTHING asserts it today. `workflowInvariants.test.ts` has
            // no target-guard assertion at all; an earlier version of this comment said it owned the
            // question, which is the same defect this block exists for: a guarantee attributed to a guard
            // nobody holds. What this block asserts is narrower and true: a job WITH a guard checks
            // everything it was handed. Presence is an open gap, recorded here.
            if (given.length === 0 || checked.length === 0) {
                continue;
            }

            for (const origin of given) {
                if (!checked.includes(origin)) {
                    unchecked.push(`${label}: ${origin} is a resolved origin but is never passed to the guard`);
                }
            }
        }

        expect(unchecked).toEqual([]);
    });
});
