// @vitest-environment node
/**
 * Repo-wide guard: the web Playwright suite drives the DEPLOYED per-PR preview, and serves nothing itself.
 *
 * ⛔ REWRITTEN 2026-09-05 for the owner's ruling of the same day — *an end-to-end test drives the deployed
 * system, or it is skipped*. The file's subject changed underneath it: `e2e-web` no longer runs a web server
 * on the runner at all. What follows keeps the measured history that produced the OLD contract (it is the
 * reason nobody may re-introduce a local server casually) and then states the NEW one and what each case
 * proves now.
 *
 * ## History 1 — the dev server, which turned latency into false test failures (EVIDENCE, KEPT)
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
 * The repair was `E2E_WEB_SERVER: start` plus a `.next` artifact downloaded from the `build` job.
 *
 * ⚠️ THAT HAZARD IS NOW STRUCTURALLY IMPOSSIBLE FOR THIS JOB, which is why the assertion that pinned it is
 * gone rather than weakened. `playwright.config.ts` declares `webServer: process.env.PLAYWRIGHT_BASE_URL ?
 * undefined : {…}`, and `e2e-web` sets `PLAYWRIGHT_BASE_URL` to the resolved preview origin — so Playwright
 * starts NO server, there is no mode to choose between, and no build to serve. The dev-vs-start resolution
 * itself still exists for LOCAL runs and is still pinned by its own unit test
 * (`packages/apps/commise/web/tests/e2e/utils/__tests__/webServerMode.test.ts`); what this file now asserts
 * is that CI never acquires a local server to apply it to. Case 3 below is what notices if one comes back —
 * the whole table above is the cost of getting that wrong, and a reader who re-adds `npm run dev` here
 * would be re-buying it.
 *
 * ## History 2 — a bundle built for a DIFFERENT Clerk instance than the harness signs into (EVIDENCE, KEPT)
 *
 * `NEXT_PUBLIC_*` is inlined by the bundler, so the Clerk instance and the API origins a bundle talks to are
 * FROZEN AT BUILD TIME. While `e2e-web` SERVED the `build` job's artifact, the two configurations could
 * disagree — and the symptom was not "misconfigured", it was clerk-js refusing to initialise, `<SignIn>`
 * never mounting, and `signInWithTicket` timing out. That reads as a test bug, in a spec that is fine. The
 * `build` job's placeholder key `pk_test_bG9jYWxob3N0JA` (it decodes to `localhost$`) was harmless while its
 * output only proved the app compiles, and became a live defect the moment the suite served it.
 *
 * ⚠️ HALF of that pairing is retired and half is LOAD-BEARING, and the difference is which side has a
 * consumer:
 *
 *  - the BUILD side has none. `e2e-web` consumes no artifact; nothing else in the repository references
 *    `web-next-build-*` either (grepped 2026-09-05: the only hit is the upload step itself). The bundle the
 *    `build` job bakes is once again *proof that the app compiles* and is served to nobody, so "it is baked
 *    for the instance the harness signs into" is no longer a property of anything. The cases that asserted
 *    it are DELETED — see the commit message; that coverage went nowhere, because the behaviour it covered
 *    went nowhere.
 *  - the HARNESS side still binds, for a reason that survived the move. `globalSetup` provisions the
 *    run-scoped Clerk fixture through the BACKEND API, and the preview origin `pr-{N}.sandbox.{apex}` is
 *    served by the SANDBOX (dev) instance — Clerk production keys are domain-locked, so a `pk_live` bundle
 *    aborts on any other origin (ADR-0001). Loading `${{ inputs.stage }}` on `main` would provision the
 *    fixture user in the PROD tenant and then try to sign it into a preview served by the sandbox one.
 *    Case 4 pins that.
 *
 * ## What is asserted NOW, and the mutation each case catches
 *
 * | # | Assertion | Mutation it catches |
 * |---|-----------|---------------------|
 * | 1 | the target is `resolve-sandbox`'s `web_origin`, and `resolve-sandbox` is a `needs` | a host literal is typed in, or the origin is taken from a job this one does not depend on (so it reads empty) |
 * | 2 | the job is gated on that job's `live` output | the gate is dropped and every shard drives a stage that is not deployed — 8 shards of red that mean nothing |
 * | 3 | nothing is served on the runner | `E2E_WEB_SERVER`, a `next start`/`next dev`, or a re-added `.next` download brings the local-server tier back with the deployed target still set — two servers, one of them silently unused |
 * | 4 | the Clerk secrets are the SANDBOX ones, whatever the stage | it reverts to `inputs.stage`, so `main` provisions the fixture in the prod tenant and cannot sign into the preview |
 * | 5 | the job states no `NEXT_PUBLIC_*` | a build-time variable is re-added where no bundler runs: read by nothing, and reading as configuration to the next person who "re-points" it at the preview |
 *
 * The predicates are pure and exported-by-use to the fixture block at the bottom, which fires them at
 * deliberately-violating documents — so a passing suite is evidence that they can fail, not evidence that
 * nothing was examined.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci.yml', import.meta.url));

/** The job that resolves the deployed stage and its origins. The ONE authority for a target in this file. */
const RESOLVER_JOB = 'resolve-sandbox';

/** The expression that must supply the browser's target — the resolver's output, never a literal. */
const WEB_ORIGIN_EXPRESSION = `\${{ needs.${RESOLVER_JOB}.outputs.web_origin }}`;

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly needs?: string | readonly string[];
    readonly steps?: readonly Step[];
}

interface Document {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** A workflow document parsed from text. */
function docOf(yaml: string): Document {
    return parse(yaml) as Document;
}

/** The real `_ci.yml`, parsed. */
function ciWorkflow(): Document {
    return docOf(readFileSync(CI_WORKFLOW, 'utf8'));
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

/** The jobs a job depends on, as a set — `needs:` is a scalar or a sequence. */
function needsOf(subject: Job): ReadonlySet<string> {
    const declared = subject.needs ?? [];

    return new Set(typeof declared === 'string' ? [declared] : declared);
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
 * The origin the Playwright browser is pointed at, as that step sees it.
 *
 * @param subject - The parsed job.
 * @returns The `PLAYWRIGHT_BASE_URL` value, or `undefined` when the job states none. Pure.
 */
function deployedTarget(subject: Job): unknown {
    return envFor(subject, playwrightStep(subject), 'PLAYWRIGHT_BASE_URL');
}

/** Every way a job can end up serving the web app from the runner instead of driving the deployment. */
type LocalServingFinding = 'chooses-a-web-server-mode' | 'runs-a-next-server' | 'downloads-a-build-artifact';

/**
 * Audit one job for the local-server tier this ruling removed.
 *
 * ⛔ ALL THREE, not the first: a half-reverted job — say, a `.next` download with no `next start` — is not
 * "nearly fine", it is a 30 MB download feeding a server that never runs, and the reader needs to see every
 * limb that came back rather than repair one and re-run.
 *
 * @param subject - The parsed job.
 * @param builtArtifacts - Artifact names some other job uploads, i.e. what a download here could restore.
 * @returns The findings, sorted. Empty when the job serves nothing itself. Pure.
 */
function auditLocalServing(subject: Job, builtArtifacts: readonly string[]): readonly LocalServingFinding[] {
    const steps = subject.steps ?? [];
    const findings: LocalServingFinding[] = [];
    const statesMode = [subject.env ?? {}, ...steps.map((step) => step.env ?? {})].some(
        (block) => 'E2E_WEB_SERVER' in block,
    );

    if (statesMode) {
        findings.push('chooses-a-web-server-mode');
    }

    // `next start`/`next dev` directly, or through the workspace scripts that wrap them.
    const bodies = steps.map((step) => step.run ?? '').join('\n');

    if (
        /\bnext\s+(?:start|dev)\b/u.test(bodies) ||
        /\brun\s+(?:start|dev)\s+--workspace=@commise\/web\b/u.test(bodies)
    ) {
        findings.push('runs-a-next-server');
    }

    const restored = artifactSteps(subject, 'download').map((step) => String(step.with?.['name'] ?? ''));

    if (restored.some((name) => builtArtifacts.includes(name))) {
        findings.push('downloads-a-build-artifact');
    }

    return [...findings].sort();
}

/**
 * Every `NEXT_PUBLIC_*` key a job states, at job level or on any step.
 *
 * These are BUILD-TIME values, inlined by the bundler. A job that compiles nothing and serves nothing can
 * only mislead by stating one.
 *
 * @param subject - The parsed job.
 * @returns The key names, sorted. Pure.
 */
function buildTimeVars(subject: Job): readonly string[] {
    const blocks = [subject.env ?? {}, ...(subject.steps ?? []).map((step) => step.env ?? {})];

    return [...new Set(blocks.flatMap((block) => Object.keys(block)))]
        .filter((key) => key.startsWith('NEXT_PUBLIC_'))
        .sort();
}

describe('the web Playwright suite drives the deployed preview', () => {
    /**
     * REWRITTEN 2026-09-05 (owner ruling: e2e drives the deployment or skips).
     *
     * WAS: `runs Playwright in 'start' mode, not against the dev server` — it pinned `E2E_WEB_SERVER: start`
     * on a job that ran its own server. NOW: it pins where the target comes from, which is the question that
     * replaced it. A host literal here would rot silently (the preview subdomain moves with the PR number),
     * and taking the output of a job that is not in `needs:` yields an EMPTY string, which Playwright reads
     * as "no base URL" and every spec then fails on a relative navigation — a failure that looks like the
     * app, not like the wiring.
     */
    it('takes its target from the resolver job, and types no host literal', () => {
        const e2e = job('e2e-web');

        expect(deployedTarget(e2e), 'e2e-web no longer drives the resolved preview origin').toBe(WEB_ORIGIN_EXPRESSION);
        expect(needsOf(e2e), `the target comes from ${RESOLVER_JOB}, so it must be a dependency`).toContain(
            RESOLVER_JOB,
        );
    });

    /**
     * NEW 2026-09-05, and it is the ruling's other half: a tier that targets a deployment must SKIP when
     * there is none. Without this gate every shard drives an origin that does not resolve and reports eight
     * reds that say nothing about the commit — which is precisely the "false status" the ruling removes.
     */
    it('skips, rather than running, when nothing is deployed at that stage', () => {
        expect(String(job('e2e-web').if ?? ''), 'e2e-web is not gated on the resolver’s liveness verdict').toContain(
            `needs.${RESOLVER_JOB}.outputs.live == 'true'`,
        );
    });

    /**
     * REWRITTEN 2026-09-05, replacing THREE cases at once — `downloads a build artifact that the build job
     * uploads`, `unpacks that artifact into the web app's own .next directory`, and the `E2E_WEB_SERVER`
     * half of the mode assertion. Each of those pinned a limb of a local-server tier that no longer exists.
     *
     * It now proves the INVERSE, which is the live property: nothing is served here. That is not a weaker
     * claim — it is the claim that keeps History 1 above from being re-bought, because a re-added
     * `npm run dev` beside a set `PLAYWRIGHT_BASE_URL` would boot a second server that Playwright ignores,
     * so the flakiness would come back with no signal that anything changed.
     */
    it('serves nothing on this runner — no server, no mode, no build artifact', () => {
        const built = artifactSteps(job('build'), 'upload').map((step) => String(step.with?.['name'] ?? ''));

        expect(
            auditLocalServing(job('e2e-web'), built),
            'the local web-server tier came back: Playwright takes its baseURL from PLAYWRIGHT_BASE_URL and ' +
                'declares NO webServer when it is set, so anything started here is an unused process and any ' +
                'artifact downloaded here is an unread payload',
        ).toEqual([]);
    });
});

describe('the harness signs into the Clerk instance that serves the preview', () => {
    /**
     * REWRITTEN 2026-09-05. WAS: `builds the web app with the SANDBOX Clerk keys, exactly as the Playwright
     * job loads them` — it looped over `['build', 'e2e-web']` and required both to agree.
     *
     * The `build` half is DELETED: that job's bundle is consumed by nobody now (no job downloads
     * `web-next-build-*`), so which instance it bakes is not a property of any running system. The `e2e-web`
     * half is kept and re-argued: the preview origin is served by the SANDBOX instance, so the fixture user
     * `globalSetup` provisions through Clerk's Backend API has to live in that same tenant — `inputs.stage`
     * would provision it in the prod tenant on `main` and then fail to sign it in, 30s later, inside
     * `waitForTestUserExternalId`.
     */
    it('loads the SANDBOX Clerk secrets, whatever the pipeline stage says', () => {
        const loads = secretLoads(job('e2e-web'));

        expect(loads, 'e2e-web loads no stage secrets — it cannot provision its Clerk fixture').toHaveLength(1);
        expect(loads[0]?.with?.['stage'], 'e2e-web loads the wrong stage').toBe('sandbox');
    });

    /**
     * REWRITTEN 2026-09-05, replacing `bakes the same API origins the Playwright job serves under` and the
     * `e2e-web` half of `does not override the loaded Clerk key in either job`.
     *
     * Both asserted an AGREEMENT between a bundle and the server that served it. There is no such server, so
     * the new claim is that this job states no build-time variable at all: `NEXT_PUBLIC_*` is inlined by the
     * bundler, nothing here runs one, and the preview's own Vercel build states its own values. A value on
     * this job would be read by nothing while reading as configuration — the shape that invites the next
     * reader to "re-point it at the preview" and believe they changed something.
     */
    it('states no NEXT_PUBLIC_* build-time variable — nothing on this runner compiles or serves the app', () => {
        expect(
            buildTimeVars(job('e2e-web')),
            'a NEXT_PUBLIC_* value here is inlined by no bundler and read by no server',
        ).toEqual([]);
    });
});

describe('the guard itself can fail', () => {
    // Fired at deliberately-violating documents, so a passing suite is evidence the predicates work rather
    // than evidence that nothing was examined.
    const PLAYWRIGHT_RUN = 'npm run test:e2e --workspace=@commise/web -- --reporter=blob';

    /** A minimal `e2e-web`-shaped job that satisfies every case above. */
    const COMPLIANT: Job = {
        if: `needs.${RESOLVER_JOB}.outputs.live == 'true'`,
        needs: ['build-ui', RESOLVER_JOB],
        env: { PLAYWRIGHT_BASE_URL: WEB_ORIGIN_EXPRESSION },
        steps: [{ name: 'Run web e2e tests', run: PLAYWRIGHT_RUN }],
    };

    it('accepts the compliant shape (so the rejections below are about the mutation, not the fixture)', () => {
        expect(deployedTarget(COMPLIANT)).toBe(WEB_ORIGIN_EXPRESSION);
        expect(auditLocalServing(COMPLIANT, ['web-next-build-sandbox'])).toEqual([]);
        expect(buildTimeVars(COMPLIANT)).toEqual([]);
    });

    it('sees a target typed in as a host literal instead of resolved', () => {
        const mutated: Job = { ...COMPLIANT, env: { PLAYWRIGHT_BASE_URL: 'https://pr-91.sandbox.commise.app' } };

        expect(deployedTarget(mutated)).not.toBe(WEB_ORIGIN_EXPRESSION);
    });

    it('sees the resolver dropped from `needs:` while its output is still read', () => {
        const mutated: Job = { ...COMPLIANT, needs: 'build-ui' };

        expect(needsOf(mutated)).not.toContain(RESOLVER_JOB);
    });

    it('sees the liveness gate removed', () => {
        const mutated: Job = { ...COMPLIANT, if: "github.event_name == 'pull_request'" };

        expect(String(mutated.if ?? '')).not.toContain(`needs.${RESOLVER_JOB}.outputs.live == 'true'`);
    });

    it('reports every limb of a re-introduced local server, not just the first', () => {
        const reverted: Job = {
            ...COMPLIANT,
            env: { PLAYWRIGHT_BASE_URL: WEB_ORIGIN_EXPRESSION, E2E_WEB_SERVER: 'start' },
            steps: [
                {
                    name: 'Download the web production build',
                    uses: 'actions/download-artifact@v4',
                    with: { name: 'web-next-build-sandbox', path: 'packages/apps/commise/web/.next' },
                },
                { name: 'Serve it', run: 'npx next start --port 3000' },
                { name: 'Run web e2e tests', run: PLAYWRIGHT_RUN },
            ],
        };

        expect(auditLocalServing(reverted, ['web-next-build-sandbox'])).toEqual([
            'chooses-a-web-server-mode',
            'downloads-a-build-artifact',
            'runs-a-next-server',
        ]);
    });

    it('sees a dev server started through the workspace script rather than the binary', () => {
        const mutated: Job = {
            ...COMPLIANT,
            steps: [{ name: 'Boot', run: 'npm run dev --workspace=@commise/web &' }, ...(COMPLIANT.steps ?? [])],
        };

        expect(auditLocalServing(mutated, [])).toEqual(['runs-a-next-server']);
    });

    it('ignores a download of something the build job never produced (a report, not a bundle)', () => {
        const reports: Job = {
            ...COMPLIANT,
            steps: [
                {
                    name: 'Download blob reports',
                    uses: 'actions/download-artifact@v4',
                    with: { name: 'e2e-web-blob-sandbox-1' },
                },
                ...(COMPLIANT.steps ?? []),
            ],
        };

        expect(auditLocalServing(reports, ['web-next-build-sandbox'])).toEqual([]);
    });

    it('sees a re-added build-time variable, at job level or on the step', () => {
        expect(buildTimeVars({ ...COMPLIANT, env: { NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3000' } })).toEqual([
            'NEXT_PUBLIC_RECIPE_API_URL',
        ]);
        expect(
            buildTimeVars({
                ...COMPLIANT,
                steps: [{ run: PLAYWRIGHT_RUN, env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' } }],
            }),
        ).toEqual(['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']);
    });
});
