// @vitest-environment node
/**
 * Repo-wide guard: the web Playwright suite runs the PRODUCTION BUILD, and runs it under the SAME
 * configuration that build was made with.
 *
 * ## Failure 1 — the dev server, which turns latency into false test failures
 *
 * `e2e-web` used to drive `npm run dev`, so CI compiled each route ON DEMAND, inside the test that first
 * requested it. Measured on one shard's blob report, on specs that only click a link and read a heading:
 *
 * | duration | spec |
 * |---------:|------|
 * | 18 264 ms | `recipeSourceTabs` — /recipes ⇄ /discover round trip |
 * | 14 377 ms | `recipeOwnerActions` — Edit is a real link |
 * | 10 606 ms | `recipeOwnerActions` — Delete confirms |
 *
 * The suite therefore ran AT its assertion budgets, and on commit 6e40d66a all three attempts of
 * `recipeSourceTabs.spec.ts` failed: `expect(page).toHaveURL(/\/discover/)` read `/en/recipes` fourteen
 * times. The link, the href and the locale were all correct — the navigation had simply not committed
 * within 5s. Reproduced locally, twice, by running the same two specs in each mode on one machine: `dev`
 * took 56.4s with that spec failing and being rescued by a retry; `start` took 27.0s with nothing flaky.
 *
 * Reverting the selection is SILENT — the suite still passes, just slowly and flakily again — so this
 * guard is what notices. The mode itself is resolved by `tests/e2e/utils/webServerMode.ts`, whose own unit
 * test pins the resolution logic; what is checked HERE is the CI wiring that logic depends on.
 *
 * ## Failure 2 — a bundle built for a DIFFERENT Clerk instance than the harness signs into
 *
 * This is the expensive half, and it is invisible to every other gate. `NEXT_PUBLIC_*` is inlined by the
 * bundler, so the Clerk instance and the API origins a bundle talks to are FROZEN AT BUILD TIME. Serving a
 * pre-built artifact therefore introduces a way for the built configuration and the harness configuration
 * to disagree — and the symptom is not "misconfigured", it is clerk-js refusing to initialise, `<SignIn>`
 * never mounting, and `signInWithTicket` timing out. That reads as a test bug, in a spec that is fine.
 *
 * The `build` job used to bake the placeholder key `pk_test_bG9jYWxob3N0JA` (it decodes to `localhost$`),
 * which was harmless while its output was only ever proof that the app compiles. The moment `e2e-web`
 * SERVES that output, the placeholder is a live defect: the suite authenticates against the real sandbox
 * development instance, which `e2e-web`'s own `load-secrets` step loads and which
 * `docs/architecture/decisions/0001-sandbox-front-end-addressing.md` and that step's comment require
 * (Clerk PRODUCTION keys are domain-locked and abort on localhost, so the web E2E must use the sandbox
 * instance regardless of the pipeline stage).
 *
 * So both jobs must resolve their Clerk key from the SAME place — `kitchensink/sandbox/identity/keys` via
 * the `load-secrets` composite — and neither may override it afterwards. Checking that they agree on a
 * literal string would be weaker: two literals can be equal and both stale.
 *
 * ## What is asserted, and the mutation that each assertion catches
 *
 * | # | Assertion | Mutation it catches |
 * |---|-----------|---------------------|
 * | 1 | `e2e-web` runs with `E2E_WEB_SERVER: start` | the mode reverts to `dev`; the suite goes slow + flaky again |
 * | 2 | `e2e-web` downloads the artifact `build` uploads | the download is dropped; `next start` cannot find a build |
 * | 3 | the web build UPLOADS that artifact | the upload is dropped; the download silently yields an empty directory (an unmatched `download-artifact` does not fail) |
 * | 4 | both jobs load their Clerk key from `load-secrets` with `stage: sandbox` | the build reverts to `inputs.stage`, so `main` bakes a `pk_live` key into the bundle the suite must sign into on localhost |
 * | 5 | neither job overrides `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` after loading it | the placeholder (or any literal) comes back and the baked instance stops being the harness's instance |
 * | 6 | the API origins the build bakes equal the ones `e2e-web` sets at runtime | one side is repointed; the browser calls an origin the specs' `page.route('**\/api\/v1\/**')` mock still intercepts, so it passes for the wrong reason, while SSR hits something real |
 *
 * Assertions 4 and 5 are the pair that matters: either alone can be satisfied by a broken pipeline.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci.yml', import.meta.url));

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly needs?: string | readonly string[];
    readonly steps?: readonly Step[];
}

interface Document {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** The real `_ci.yml`, parsed. */
function ciWorkflow(): Document {
    return parse(readFileSync(CI_WORKFLOW, 'utf8')) as Document;
}

/** A job by name, or a failure that names it rather than a cryptic undefined dereference. */
function job(name: string): Job {
    const found = ciWorkflow().jobs?.[name];

    if (found === undefined) {
        throw new Error(`_ci.yml has no job \`${name}\` — this guard's subject was renamed or removed.`);
    }

    return found;
}

/** Every step in `job` that uses the `load-secrets` composite action. */
function secretLoads(subject: Job): readonly Step[] {
    return (subject.steps ?? []).filter((step) => (step.uses ?? '').includes('load-secrets'));
}

/** Every step in `job` that uses `actions/<action>-artifact`. */
function artifactSteps(subject: Job, action: 'upload' | 'download'): readonly Step[] {
    return (subject.steps ?? []).filter((step) => (step.uses ?? '').includes(`actions/${action}-artifact`));
}

/** The value of `name` visible to a step, preferring its own `env:` over the job's. */
function envFor(subject: Job, step: Step, name: string): unknown {
    return step.env?.[name] ?? subject.env?.[name];
}

/** The step that actually runs the Playwright suite. */
function playwrightStep(subject: Job): Step {
    const found = (subject.steps ?? []).find((step) => (step.run ?? '').includes('test:e2e --workspace=@commise/web'));

    if (found === undefined) {
        throw new Error('_ci.yml::e2e-web no longer runs `npm run test:e2e --workspace=@commise/web`.');
    }

    return found;
}

/**
 * The step that builds THIS leg of the `build` matrix.
 *
 * Matched on the `$WORKSPACE` indirection rather than on `npm run build --workspace`, because the job also
 * carries a `@commise/ui` fallback build whose command matches the looser pattern and would shadow this one.
 */
function buildStep(subject: Job): Step {
    const found = (subject.steps ?? []).find((step) =>
        (step.run ?? '').includes('npm run build --workspace="$WORKSPACE"'),
    );

    if (found === undefined) {
        throw new Error('_ci.yml::build no longer runs `npm run build --workspace="$WORKSPACE"`.');
    }

    return found;
}

describe('the web Playwright suite serves a production build', () => {
    it('runs Playwright in `start` mode, not against the dev server', () => {
        const e2e = job('e2e-web');

        expect(envFor(e2e, playwrightStep(e2e), 'E2E_WEB_SERVER')).toBe('start');
    });

    it('downloads a build artifact that the `build` job uploads', () => {
        const downloads = artifactSteps(job('e2e-web'), 'download').map((step) => String(step.with?.['name'] ?? ''));
        const uploads = artifactSteps(job('build'), 'upload').map((step) => String(step.with?.['name'] ?? ''));

        // The `.next` payload, not the blob/visual/trace reports the suite produces afterwards.
        const shared = downloads.filter((name) => uploads.includes(name));

        expect(
            shared,
            `e2e-web downloads ${JSON.stringify(downloads)}; build uploads ${JSON.stringify(uploads)}`,
        ).not.toHaveLength(0);
    });

    it('unpacks that artifact into the web app`s own .next directory', () => {
        const uploads = artifactSteps(job('build'), 'upload').map((step) => String(step.with?.['name'] ?? ''));
        const download = artifactSteps(job('e2e-web'), 'download').find((step) =>
            uploads.includes(String(step.with?.['name'] ?? '')),
        );

        expect(String(download?.with?.['path'] ?? '')).toBe('packages/apps/commise/web/.next');
    });

    it('refuses to publish an empty build artifact', () => {
        // `if-no-files-found` defaults to `warn`. A warning here would hand `e2e-web` an empty directory and
        // `next start` a "could not find a production build" whose cause is two jobs away.
        const upload = artifactSteps(job('build'), 'upload').find((step) =>
            String(step.with?.['path'] ?? '').includes('.next'),
        );

        expect(upload?.with?.['if-no-files-found']).toBe('error');
    });
});

describe('the bundle the suite serves is built for the instance the suite signs into', () => {
    it('builds the web app with the SANDBOX Clerk keys, exactly as the Playwright job loads them', () => {
        // Not `${{ inputs.stage }}`: on `main` that is `prod`, and a `pk_live` key baked into a bundle served
        // on localhost makes clerk-js abort with "Production Keys are only allowed for domain …".
        for (const name of ['build', 'e2e-web']) {
            const loads = secretLoads(job(name));

            expect(loads, `${name} loads no stage secrets`).toHaveLength(1);
            expect(loads[0]?.with?.['stage'], `${name} loads the wrong stage`).toBe('sandbox');
        }
    });

    it('does not override the loaded Clerk key in either job', () => {
        const build = job('build');
        const e2e = job('e2e-web');

        expect(envFor(build, buildStep(build), 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')).toBeUndefined();
        expect(envFor(e2e, playwrightStep(e2e), 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')).toBeUndefined();
    });

    it('bakes the same API origins the Playwright job serves under', () => {
        const build = job('build');
        const e2e = job('e2e-web');
        const built = buildStep(build);
        const run = playwrightStep(e2e);

        for (const name of ['NEXT_PUBLIC_RECIPE_API_URL', 'NEXT_PUBLIC_IDENTITY_API_URL']) {
            const baked = envFor(build, built, name);

            expect(baked, `${name} is not stated for the build`).toBeDefined();
            expect(envFor(e2e, run, name), `${name} differs between the build and the run`).toBe(baked);
        }
    });
});
