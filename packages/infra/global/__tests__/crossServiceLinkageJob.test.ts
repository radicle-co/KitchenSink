/**
 * Repo-wide guard: the recipe ↔ food LIVE linkage proof exists, runs, and is not vacuous.
 *
 * ## What was wrong before it
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
 *  2. the job stops actually booting food-service, so recipe talks to nothing and the spec's own
 *     assertions are the only thing left standing;
 *  3. the job sets `RECIPE_DEV_AUTH_USER_ID`. That one is the subtle killer: under recipe's dev-auth
 *     bypass there is NO bearer to forward, and recipe calls food AS THE CALLER — so
 *     `FoodCatalogGateway` degrades to `'unavailable'` WITHOUT ISSUING A REQUEST. The job would still
 *     boot both services, and the linkage would still be untested.
 *
 * It also asserts the opposite direction: the pre-existing ABSENT-dependency proofs are still there.
 * "Make the live job pass by deleting the degraded assertions" is not an available move.
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

/** The compiled food-service entrypoint the job must actually launch. */
const FOOD_ENTRYPOINT = 'packages/services/food-service';

/** The compiled recipe-service entrypoint the job must actually launch. */
const RECIPE_ENTRYPOINT = 'packages/services/recipe-service';

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly env?: Readonly<Record<string, unknown>>;
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

describe('the live linkage proof is wired into CI', () => {
    it('_ci.yml has exactly one job that runs the cross-service linkage spec', () => {
        const jobs = linkageJobs(ciDoc());

        expect(
            jobs.map(([id]) => id),
            'no job runs the recipe↔food linkage spec — the success path of every nutrition figure a user ' +
                'sees would go back to being untested',
        ).toHaveLength(1);
    });

    it('the job boots BOTH services, not just one', () => {
        const [, job] = linkageJobs(ciDoc())[0] ?? [];

        expect(job).toBeDefined();

        const bodies = runBodies(job as Job);

        expect(bodies, 'the job never launches food-service').toContain(FOOD_ENTRYPOINT);
        expect(bodies, 'the job never launches recipe-service').toContain(RECIPE_ENTRYPOINT);
    });

    it('the job gives each service its own database against a real Postgres', () => {
        const [, job] = linkageJobs(ciDoc())[0] ?? [];
        const services = Object.keys((job as Job).services ?? {});

        expect(services, 'the job stands up no service containers').toContain('postgres');

        const declared = envKeys(job as Job);

        expect(declared).toContain('FOOD_DATABASE_URL');
        expect(declared).toContain('RECIPE_DATABASE_URL');
        expect(
            (job as Job).env?.['FOOD_DATABASE_URL'],
            'both services would share one schema — each must own its own database',
        ).not.toBe((job as Job).env?.['RECIPE_DATABASE_URL']);
    });

    // ⛔ THE SUBTLE ONE. With the dev bypass on, recipe has no bearer to forward and degrades WITHOUT
    // calling food at all — so the job would boot both services and still prove nothing.
    it('the job never enables recipe-service’s dev-auth bypass', () => {
        const [, job] = linkageJobs(ciDoc())[0] ?? [];

        expect(envKeys(job as Job), 'RECIPE_DEV_AUTH_USER_ID makes the linkage proof vacuous').not.toContain(
            'RECIPE_DEV_AUTH_USER_ID',
        );
        expect(runBodies(job as Job)).not.toContain('RECIPE_DEV_AUTH_USER_ID=');
    });

    it('the spec and its package are present where the job invokes them', () => {
        expect(
            existsSync(join(REPO_ROOT, 'packages/tools/cross-service-e2e/tests/e2e/recipeFoodLinkage.e2e.test.ts')),
        ).toBe(true);

        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'packages/tools/cross-service-e2e/package.json'), 'utf-8'),
        ) as { scripts?: Record<string, string> };

        expect(manifest.scripts?.['test:e2e'], 'the workspace has no test:e2e script for CI to call').toBeDefined();
    });
});

describe('the ABSENT-dependency proofs were not weakened to make the live one pass', () => {
    // These specs assert the degraded reading against a genuinely dead origin. They are correct and
    // valuable; the live job is ADDITIONAL. Deleting them is the cheapest way to make a broken linkage
    // look fine, so they are pinned here.
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

    it('detects a job that runs the spec but boots nothing', () => {
        const doc = docOf(`jobs:\n  linkage:\n    steps:\n      - run: ${SPEC_INVOCATION}\n`);
        const [, job] = linkageJobs(doc)[0] ?? [];

        expect(runBodies(job as Job)).not.toContain(FOOD_ENTRYPOINT);
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
