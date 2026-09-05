/**
 * Repo-wide guard: the recipe ↔ food LIVE linkage proof exists, runs, and is not vacuous.
 *
 * ⛔ REWRITTEN 2026-09-05 for the owner's ruling of 2026-09-04 — *an end-to-end test drives the deployed
 * system, or it is skipped*. The proof's SUBJECT moved (two services booted on the runner → two deployed
 * per-PR origins); its PROPERTY did not, and the property is what this file has always been about. The
 * history below is kept because it is the reason the property exists.
 *
 * ## What was wrong before the job existed (EVIDENCE, KEPT)
 *
 * NO CI job anywhere ran recipe-service and food-service together. Every recipe tier points
 * `FOOD_SERVICE_URL` at a port nothing listens on — deliberately, so the absent-dependency degradation
 * (`catalogAvailability: 'unavailable'`, `state: 'unaccounted'`) is proven against a genuinely dead
 * origin rather than a stub. That is correct, and it is the whole coverage story: recipe detail
 * nutrition comes FROM the food service, so every nutrition figure a user sees was produced by a path no
 * test had ever exercised SUCCESSFULLY.
 *
 * `_ci.yml::e2e-cross-service-linkage` closes that. This suite is what stops it from being deleted,
 * narrowed, or quietly defanged — the three ways a proof like it usually dies:
 *
 *  1. the job is removed, or stops invoking the spec;
 *  2. the job stops actually reaching food-service, so recipe talks to nothing and the spec's own
 *     assertions are the only thing left standing;
 *  3. the job passes while its dependencies are absent.
 *
 * ## What the ruling changed, case by case
 *
 * | # | Case | Then | Now |
 * |---|------|------|-----|
 * | 1 | exactly one job runs the spec | unchanged | unchanged |
 * | 2 | BOTH services, not one | both entrypoints are launched on the runner | both ORIGINS are resolved, from the resolver job, and they differ |
 * | 3 | the liveness gate | — (the runner always had both services) | the job is gated on `resolve-sandbox`'s `live`, so an absent sandbox SKIPS instead of failing |
 * | 4 | nothing is booted here | each service got its own database on a real Postgres | the job stands NOTHING up: no service container, no entrypoint, no `*_DATABASE_URL` |
 * | 5 | the dev-auth bypass | the killer: recipe degrades WITHOUT calling food | kept as a rule, with reduced bite — see the case |
 * | 6 | the spec REQUIRES its targets | — | new: a missing origin THROWS rather than skipping |
 *
 * ⛔ Case 2 is the one to understand. "Both, not one" used to mean "two processes are running"; it now means
 * "two DISTINCT origins arrive from the one authority that computes them". Both halves matter: an origin
 * typed in as a literal rots the moment the PR number changes (`food-loadtest.yml` shipped `food-pr-59` as a
 * dispatch default for months after PR 59 closed), and pointing both variables at the SAME output is exactly
 * the one-service shape the original case existed to refuse, one layer up.
 *
 * ⛔ Case 4 replaces `the job gives each service its own database against a real Postgres`. The old case's
 * claim — that the two services do not share one schema — is not expressible against a deployment this job
 * does not own; the deployed stage's per-PR database is ADR-0006's business, asserted by `sandbox-deploy`.
 * What IS expressible, and is the same defence one level out, is that the job never re-acquires a local
 * pair: a `services: postgres` block or a `node dist/main.js` here means the proof quietly went back to
 * being about the code rather than about the deployment, with the deployed origins still set and unused.
 *
 * It also asserts the opposite direction: the pre-existing ABSENT-dependency proofs are still there.
 * "Make the live job pass by deleting the degraded assertions" is not an available move.
 *
 * ⚠️ RESIDUAL, stated rather than hidden: since the ruling, `npm run test:e2e --workspace=@kitchensink/
 * recipe-service` is invoked by NO job in `_ci.yml`, so the degraded-path specs pinned at the bottom of this
 * file still exist on disk but are no longer EXECUTED by CI. Those cases therefore now prove "the assertions
 * were not deleted", not "the assertions still run". Re-homing that suite belongs with whoever owns the
 * `Integration (…)` tier — the same open item `_ci.yml::e2e-backend`'s header records for identity-webhooks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, '.github/workflows');

/** The npm invocation that runs the linkage spec. Named once, asserted everywhere. */
const SPEC_INVOCATION = 'npm run test:e2e --workspace=@kitchensink/cross-service-e2e';

/** The linkage spec itself, relative to the repo root. */
const SPEC_PATH = 'packages/tools/cross-service-e2e/tests/e2e/recipeFoodLinkage.e2e.test.ts';

/** The job that resolves the deployed stage and its origins — the ONE authority for a target. */
const RESOLVER_JOB = 'resolve-sandbox';

/**
 * The food-service entrypoint the job must NOT launch any more.
 *
 * It was the evidence that food was really running; it is now the evidence that the job reverted to booting
 * the pair on the runner. Same string, opposite polarity — see case 4.
 */
const FOOD_ENTRYPOINT = 'packages/services/food-service';

/** The recipe-service entrypoint, with the same inverted meaning as {@link FOOD_ENTRYPOINT}. */
const RECIPE_ENTRYPOINT = 'packages/services/recipe-service';

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly needs?: string | readonly string[];
    readonly services?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface Doc {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** Parse a workflow document from text. */
const docOf = (yaml: string): Doc => parse(yaml) as Doc;

/** The real `_ci.yml`. */
const ciDoc = (): Doc => docOf(readFileSync(join(WORKFLOW_DIR, '_ci.yml'), 'utf-8'));

/**
 * Every job in a document that runs the linkage spec.
 *
 * @param doc - A parsed workflow.
 * @returns The matching `[jobId, job]` pairs.
 */
function linkageJobs(doc: Doc): readonly (readonly [string, Job])[] {
    return Object.entries(doc.jobs ?? {}).filter(([, job]) =>
        (job.steps ?? []).some((step) => (step.run ?? '').includes(SPEC_INVOCATION)),
    );
}

/** The one linkage job in the real `_ci.yml`, or a failure that says so rather than dereferencing undefined. */
function linkageJob(): Job {
    const [, found] = linkageJobs(ciDoc())[0] ?? [];

    if (found === undefined) {
        throw new Error('_ci.yml has no job running the linkage spec — this guard has no subject.');
    }

    return found;
}

/** Everything a job's steps could execute, as one blob. */
const runBodies = (job: Job): string => (job.steps ?? []).map((step) => step.run ?? '').join('\n');

/** Every env key a job sets, at job level or on any step. */
function envKeys(job: Job): ReadonlySet<string> {
    const keys = new Set(Object.keys(job.env ?? {}));

    for (const step of job.steps ?? []) {
        for (const key of Object.keys(step.env ?? {})) {
            keys.add(key);
        }
    }

    return keys;
}

/** The value a job states for `name`, preferring a step's own `env:` over the job's. */
function envValue(job: Job, name: string): unknown {
    const onStep = (job.steps ?? []).find((step) => step.env !== undefined && name in step.env);

    return onStep?.env?.[name] ?? job.env?.[name];
}

/** The jobs a job depends on, as a set — `needs:` is a scalar or a sequence. */
function needsOf(job: Job): ReadonlySet<string> {
    const declared = job.needs ?? [];

    return new Set(typeof declared === 'string' ? [declared] : declared);
}

/** Every way this job can go back to proving something about the runner instead of the deployment. */
type LocalBootFinding = 'stands-up-service-containers' | 'launches-a-service-entrypoint' | 'states-a-database-url';

/**
 * Audit one job for the locally-booted pair the 2026-09-04 ruling removed.
 *
 * ⛔ Returns EVERY finding rather than the first. A half-revert — a Postgres container with no service
 * booted against it, say — is not "nearly fine": it is a job that pays for a database nothing uses while
 * still claiming, by its shape, to be a local proof.
 *
 * @param job - The parsed job.
 * @returns The findings, sorted. Empty when the job stands nothing up. Pure.
 */
function auditLocalBoot(job: Job): readonly LocalBootFinding[] {
    const findings: LocalBootFinding[] = [];

    if (Object.keys(job.services ?? {}).length > 0) {
        findings.push('stands-up-service-containers');
    }

    const bodies = runBodies(job);

    if (bodies.includes(FOOD_ENTRYPOINT) || bodies.includes(RECIPE_ENTRYPOINT)) {
        findings.push('launches-a-service-entrypoint');
    }

    if ([...envKeys(job)].some((key) => key.endsWith('_DATABASE_URL'))) {
        findings.push('states-a-database-url');
    }

    return [...findings].sort();
}

describe('the live linkage proof is wired into CI', () => {
    it('_ci.yml has exactly one job that runs the cross-service linkage spec', () => {
        const jobs = linkageJobs(ciDoc());

        expect(
            jobs.map(([id]) => id),
            'no job runs the recipe↔food linkage spec — the success path of every nutrition figure a user ' +
                'sees would go back to being untested',
        ).toHaveLength(1);
    });

    /**
     * REWRITTEN 2026-09-05 (owner ruling 2026-09-04). WAS: `the job boots BOTH services, not just one` —
     * it asserted that both compiled entrypoints appear in the job's `run:` bodies. There are no entrypoints
     * here now, so the same property is asserted one layer up: two DISTINCT origins, both arriving from the
     * resolver job rather than typed in.
     *
     * Both halves catch a real mutation. Pointing `LINKAGE_FOOD_URL` at `recipe_origin` — a plausible
     * copy-paste, and invisible in review — restores the one-service shape exactly: recipe would answer both
     * calls, and the suite's food assertions would fail against a service that is up. Typing a literal makes
     * the job authoritative about a name it does not compute, which is how `food-loadtest.yml` came to ship
     * `food-pr-59` as a dispatch default for months after PR 59 closed.
     */
    it('targets BOTH deployed services, not just one, and resolves neither by hand', () => {
        const job = linkageJob();
        const recipe = envValue(job, 'LINKAGE_RECIPE_URL');
        const food = envValue(job, 'LINKAGE_FOOD_URL');

        expect(recipe, 'the job names no recipe origin').toBe(`\${{ needs.${RESOLVER_JOB}.outputs.recipe_origin }}`);
        expect(food, 'the job names no food origin').toBe(`\${{ needs.${RESOLVER_JOB}.outputs.food_origin }}`);
        expect(food, 'both variables resolve to the SAME service — the one-service shape, one layer up').not.toBe(
            recipe,
        );
        expect(needsOf(job), `the origins come from ${RESOLVER_JOB}, so it must be a dependency`).toContain(
            RESOLVER_JOB,
        );
    });

    /**
     * NEW 2026-09-05 — the second half of the ruling. A tier pointed at a deployment that does not exist
     * must SKIP, not fail: `pr-{N}` is torn down on PR close and is absent on any run before the first
     * deploy, and a red there says nothing about the commit.
     *
     * ⚠️ This is the gate the job's own header calls the thing NOT to loosen further: skipping when the
     * STAGE is absent is the ruling; making the SUITE skip-tolerant when its origins are absent is the
     * failure it was written to remove. Case 6 pins the other side of that line.
     */
    it('skips, rather than failing, when nothing is deployed at that stage', () => {
        expect(
            String(linkageJob().if ?? ''),
            'the linkage job is not gated on the resolver’s liveness verdict',
        ).toContain(`needs.${RESOLVER_JOB}.outputs.live == 'true'`);
    });

    /**
     * REWRITTEN 2026-09-05, replacing `the job gives each service its own database against a real Postgres`.
     *
     * That case proved the two locally-booted services did not share one schema. There is no local pair to
     * make that claim about, and the deployed stage's per-PR database is ADR-0006's property rather than
     * this job's. What survives — and is the same defence one level out — is that the job never re-acquires
     * one: a service container, a service entrypoint or a `*_DATABASE_URL` here means the proof went back to
     * being about the code, with the deployed origins still declared above it and reaching nothing.
     */
    it('stands nothing up on the runner — the subject is the deployment', () => {
        expect(
            auditLocalBoot(linkageJob()),
            'the locally-booted pair came back: this job proves the DEPLOYED services are linked, and a ' +
                'process started here is not the thing under test',
        ).toEqual([]);
    });

    /**
     * KEPT 2026-09-05, with its bite honestly reduced — and it is kept because the job's own header still
     * states the rule ("`RECIPE_DEV_AUTH_USER_ID` is deliberately NEVER set").
     *
     * ⚠️ WHAT IT USED TO PROVE: with the bypass on and recipe booted HERE, there is no bearer to forward, so
     * `FoodCatalogGateway` degrades to `'unavailable'` WITHOUT ISSUING A REQUEST — the job booted both
     * services and proved nothing. WHAT IT PROVES NOW: an env var on this runner reaches no service, so the
     * trap needs a locally booted recipe to spring, and case 4 is what makes that impossible. This case is
     * the second lock on the same door rather than the door — it survives so that a reader who re-adds a
     * local boot is caught by BOTH shapes, not just the first. The deployed service's own bypass is disabled
     * by `NODE_ENV=production` in `recipe-service/src/auth/auth.middleware.ts` and covered by that module's
     * unit tests; nothing here can assert it.
     */
    it('never enables recipe-service’s dev-auth bypass', () => {
        const job = linkageJob();

        expect(envKeys(job), 'RECIPE_DEV_AUTH_USER_ID makes a locally-booted linkage proof vacuous').not.toContain(
            'RECIPE_DEV_AUTH_USER_ID',
        );
        expect(runBodies(job)).not.toContain('RECIPE_DEV_AUTH_USER_ID=');
    });

    it('the spec and its package are present where the job invokes them', () => {
        expect(existsSync(join(REPO_ROOT, SPEC_PATH))).toBe(true);

        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'packages/tools/cross-service-e2e/package.json'), 'utf-8'),
        ) as { scripts?: Record<string, string> };

        expect(manifest.scripts?.['test:e2e'], 'the workspace has no test:e2e script for CI to call').toBeDefined();
    });

    /**
     * NEW 2026-09-05, and it is the successor to the old case-3 role: the way a DEPLOYED proof goes vacuous
     * is not a shared schema, it is silence.
     *
     * The job now hands the suite three values it computes elsewhere. If the spec responded to a missing one
     * by skipping, a `needs:` mistake, an empty `DOMAIN_NAME`, or a resolver that returned blanks would leave
     * this tier reporting green with nothing driven at all — and every liveness gate above it would look
     * like it had worked. So the spec must THROW, and the job must actually export the credential path it
     * mints. `required(…)` is that contract, read here from the spec's own source.
     */
    it('the spec REQUIRES its targets — an absent origin throws, and never skips', () => {
        const spec = readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf-8');

        for (const name of ['LINKAGE_RECIPE_URL', 'LINKAGE_FOOD_URL', 'LINKAGE_CREDENTIALS']) {
            expect(spec, `${name} is no longer read through required() — an absent value would pass quietly`).toContain(
                `required('${name}')`,
            );
        }

        expect(spec, 'the suite acquired a skip — a tier that goes quiet when its target is absent').not.toMatch(
            /\b(?:describe|it|test)\.(?:skip|skipIf)\b/u,
        );
        expect(
            runBodies(linkageJob()),
            'the job no longer exports LINKAGE_CREDENTIALS, so the spec it invokes would throw on every run',
        ).toContain('LINKAGE_CREDENTIALS=');
    });
});

describe('the ABSENT-dependency proofs were not weakened to make the live one pass', () => {
    // These specs assert the degraded reading against a genuinely dead origin. They are correct and
    // valuable; the live job is ADDITIONAL. Deleting them is the cheapest way to make a broken linkage
    // look fine, so they are pinned here.
    //
    // ⚠️ See the RESIDUAL note in this file's header: since 2026-09-04 no `_ci.yml` job invokes recipe's
    // e2e tier, so these two cases pin the assertions' EXISTENCE, not their execution.
    it("recipe's e2e suite still asserts catalogAvailability 'unavailable' when food is absent", () => {
        const spec = readFileSync(
            join(REPO_ROOT, 'packages/services/recipe-service/tests/e2e/ingredients.e2e.test.ts'),
            'utf-8',
        );

        expect(spec, 'the absent-dependency proof for the ingredient typeahead is gone').toContain(
            "catalogAvailability).toBe('unavailable')",
        );
    });

    it("recipe's e2e harness still points FOOD_SERVICE_URL at an origin nothing serves", () => {
        const harness = readFileSync(join(REPO_ROOT, 'packages/services/recipe-service/tests/e2e/harness.ts'), 'utf-8');

        expect(harness).toContain('FOOD_SERVICE_URL');
        expect(
            harness,
            'the harness no longer documents its dead food origin — the F2 absent-dependency proof may have ' +
                'been turned into a live one, which is NOT what the linkage job asked for',
        ).toMatch(/Nothing listens here/);
    });
});

describe('the guard itself can fail', () => {
    // Fired at deliberately-violating documents, so a passing suite is evidence the predicates work
    // rather than evidence that nothing was examined.
    it('reports a workflow with no linkage job', () => {
        expect(linkageJobs(docOf('jobs:\n  test:\n    steps:\n      - run: npm test\n'))).toHaveLength(0);
    });

    /**
     * REWRITTEN 2026-09-05. WAS: `detects a job that runs the spec but boots nothing`, whose fixture proved
     * the entrypoint search could come back empty. The polarity flipped with case 4 — booting is now the
     * violation — so the fixture is the shape that RE-ADDS the pair, and every finding is reported.
     */
    it('detects a job that re-boots the pair on the runner, and reports every limb', () => {
        const doc = docOf(
            `jobs:\n  linkage:\n    services:\n      postgres:\n        image: postgres:18\n` +
                `    env:\n      FOOD_DATABASE_URL: postgres://localhost/food\n` +
                `    steps:\n      - run: node ${FOOD_ENTRYPOINT}/dist/main.js &\n` +
                `      - run: ${SPEC_INVOCATION}\n`,
        );
        const [, job] = linkageJobs(doc)[0] ?? [];

        expect(auditLocalBoot(job as Job)).toEqual([
            'launches-a-service-entrypoint',
            'stands-up-service-containers',
            'states-a-database-url',
        ]);
    });

    it('says nothing about a job that only drives resolved origins', () => {
        const doc = docOf(
            `jobs:\n  linkage:\n    env:\n      LINKAGE_FOOD_URL: https://food-pr-1.example\n` +
                `    steps:\n      - run: ${SPEC_INVOCATION}\n`,
        );
        const [, job] = linkageJobs(doc)[0] ?? [];

        expect(auditLocalBoot(job as Job)).toEqual([]);
    });

    /**
     * NEW 2026-09-05 — the copy-paste that case 2's inequality exists for. Two variables, one output: the
     * job looks fully wired, and food is never reached.
     */
    it('detects both linkage origins pointed at the same resolved service', () => {
        const doc = docOf(
            `jobs:\n  linkage:\n    env:\n` +
                `      LINKAGE_RECIPE_URL: \${{ needs.${RESOLVER_JOB}.outputs.recipe_origin }}\n` +
                `      LINKAGE_FOOD_URL: \${{ needs.${RESOLVER_JOB}.outputs.recipe_origin }}\n` +
                `    steps:\n      - run: ${SPEC_INVOCATION}\n`,
        );
        const [, job] = linkageJobs(doc)[0] ?? [];

        expect(envValue(job as Job, 'LINKAGE_FOOD_URL')).toBe(envValue(job as Job, 'LINKAGE_RECIPE_URL'));
    });

    it('detects a job that enables the dev-auth bypass', () => {
        const doc = docOf(
            `jobs:\n  linkage:\n    steps:\n      - run: ${SPEC_INVOCATION}\n        env:\n          RECIPE_DEV_AUTH_USER_ID: '01J'\n`,
        );
        const [, job] = linkageJobs(doc)[0] ?? [];

        expect(envKeys(job as Job)).toContain('RECIPE_DEV_AUTH_USER_ID');
    });

    it('sees every workflow file it claims to (the directory is readable)', () => {
        expect(readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith('.yml')).length).toBeGreaterThan(5);
    });
});
