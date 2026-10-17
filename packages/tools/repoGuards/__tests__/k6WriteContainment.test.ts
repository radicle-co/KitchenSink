/**
 * ⛔ WHAT A k6 RUN MAY WRITE, AND WHERE — the two containment facts that keep load-test data away from real
 * users' data until the production containment policy exists.
 *
 * Owner ruling 2026-09-13: "The k6 and e2e tests need to guarantee that they not only clean up their data but
 * to scope the data such that it won't conflict with real data."
 *
 * ## 1. The prod containment gate
 *
 * `load-test-deployed` loads the stage's Clerk secrets only when `LOAD_TEST_TARGET != 'prod'`, and every step
 * that signs in, provisions, writes or resets is gated on that load. On a production target the job therefore
 * runs ONLY the unauthenticated `deployedOrigin.load.js` probes. That is today's ONLY barrier between the
 * authenticated scenarios — which write recipes, collections, corrections and analytics as pool users — and the
 * production database real users read. It must not be "tidied": a reader who sees a prod run skip every service
 * scenario will be tempted to lift it, and lifting it before containment lands writes test data into prod.
 *
 * Derived, not enumerated: every step in the job that touches a credential (a Clerk key, a token or handles
 * file, the pool, a seeded world or a reset) is EVALUATED in the production world — with the secret load and
 * everything transitively gated on it resolved to skipped — and must come out `false`. A new credentialled step
 * with its own ungated `if:` fails here by construction.
 *
 * The run must also SAY so: a green prod run that measured only probes is indistinguishable from one that
 * measured the service scenarios unless the job summary states it.
 *
 * ## 2. The write shape of every deployed-capable scenario
 *
 * A deployed-capable scenario may be pointed at production by a manual dispatch the day the gate lifts, so its
 * WRITES must already be scoped away from real users:
 *
 *   - every `visibility` it sends is `private` — a public recipe or collection is served to real users'
 *     discovery and search the moment it lands, before any cleanup can run;
 *   - it rates nothing — a rating on a real recipe moves that recipe's aggregate in front of real users;
 *   - it clones only a source it created itself — cloning someone else's content rewrites nothing of theirs,
 *     but pins their row into test data that erasure later has to walk.
 *
 * The scenario set comes from `deployedCapableScripts()` (the `@loadTier` markers), and the helper modules each
 * scenario imports are followed, because `lib/common.js`'s `makeRecipePayload` is where the shared payload lives.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { deployedCapableScripts } from '@kitchensink/loadtest';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import { evaluateCondition, type Truth } from './workflowExpression.js';
import { scalarText } from './workflowScalar.js';

const HEAVY = '.github/workflows/_ci-heavy.yml';

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly steps?: readonly Step[];
}

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

/** The jobs that run k6 AND load a stage's Clerk secrets — the ones that can authenticate a load run. */
function authenticatedK6Jobs(): readonly { readonly name: string; readonly steps: readonly Step[] }[] {
    const doc = parse(read(HEAVY)) as { jobs: Record<string, Job> };

    return Object.entries(doc.jobs)
        .map(([name, job]) => ({ name, steps: job.steps ?? [] }))
        .filter(({ steps }) => steps.some((step) => /\bk6 run\b/u.test(scalarText(step.run))))
        .filter(({ steps }) => steps.some((step) => (step.uses ?? '').includes('actions/load-secrets')));
}

/** A step that handles a credential or writes as a pool user. */
const CREDENTIALLED = /CLERK_SECRET_KEY|_TOKENS_FILE|_HANDLES_FILE|provision:pool|provisionPool|e2e-seed|resetPool/u;

function touchesCredential(step: Step): boolean {
    const env = JSON.stringify(step.env ?? {});

    return (step.uses ?? '').includes('actions/load-secrets') || CREDENTIALLED.test(`${env}\n${scalarText(step.run)}`);
}

/**
 * Evaluate a step's `if:` in the PRODUCTION world.
 *
 * `env.LOAD_TEST_TARGET` is `prod`; a step whose own condition came out `false` is `skipped`, so an outcome atom
 * over it resolves accordingly; liveness outputs are assumed TRUE (the worst case — the origin is serving); status
 * functions are resolved for a job that is still succeeding. Anything else is `unknown`, which the assertion
 * treats as "may run".
 */
function productionTruth(steps: readonly Step[]): ReadonlyMap<Step, Truth> {
    const truth = new Map<Step, Truth>();
    const byId = new Map(steps.filter((step) => step.id !== undefined).map((step) => [step.id, step]));

    for (const step of steps) {
        const condition = scalarText(step.if, 'success()');

        truth.set(
            step,
            evaluateCondition(condition, (atom) => {
                const target = /^env\.LOAD_TEST_TARGET\s*(==|!=)\s*'([a-z]+)'$/u.exec(atom);

                if (target) {
                    return (target[1] === '==') === (target[2] === 'prod') ? 'true' : 'false';
                }

                if (/^(always|success)\(\s*\)$/u.test(atom)) {
                    return 'true';
                }

                if (/^(failure|cancelled)\(\s*\)$/u.test(atom)) {
                    return 'false';
                }

                if (/^steps\.live\.outputs\.[a-z]+\s*==\s*'true'$/u.test(atom)) {
                    return 'true';
                }

                const outcome = /^steps\.([A-Za-z0-9_-]+)\.outcome\s*(==|!=)\s*'([a-z]+)'$/u.exec(atom);
                const referenced = outcome ? byId.get(outcome[1]) : undefined;

                if (outcome && referenced !== undefined && truth.get(referenced) === 'false') {
                    // A skipped step's outcome is `skipped`.
                    return (outcome[2] === '==') === (outcome[3] === 'skipped') ? 'true' : 'false';
                }

                return 'unknown';
            }),
        );
    }

    return truth;
}

describe('the prod containment gate on the deployed k6 job', () => {
    const jobs = authenticatedK6Jobs();

    it('finds the authenticated k6 job (non-vacuity)', () => {
        expect(jobs.map((job) => job.name)).toContain('load-test-deployed');
    });

    it.each(jobs.map((job) => [job.name, job] as const))(
        '⛔ %s: no credentialled step can run against a production target',
        (_, job) => {
            const truth = productionTruth(job.steps);
            const credentialled = job.steps.filter(touchesCredential);
            const reachable = credentialled
                .filter((step) => truth.get(step) !== 'false')
                .map((step) => `${step.name ?? step.id ?? '(unnamed)'} → ${truth.get(step) ?? '?'}`);

            expect(credentialled.length, 'the job has credentialled steps to reason about').toBeGreaterThan(2);
            expect(
                reachable,
                'a step that signs in, provisions, writes or resets can run on a prod target — the authenticated ' +
                    'scenarios would write test data into the database real users read',
            ).toStrictEqual([]);
        },
    );

    it.each(jobs.map((job) => [job.name, job] as const))(
        '%s: the gate is NAMED where it stands, so nobody lifts it as an oversight',
        (_, job) => {
            const secrets = job.steps.find((step) => (step.uses ?? '').includes('actions/load-secrets'));
            const text = read(HEAVY);
            const at = text.indexOf(`- name: ${secrets?.name ?? '(no secret-loading step)'}`);
            const preamble = text.slice(Math.max(0, at - 2_500), at);

            expect(at, 'the secret-loading step is findable by name').toBeGreaterThan(0);
            expect(preamble).toMatch(/CONTAINMENT GATE/u);
        },
    );

    it.each(jobs.map((job) => [job.name, job] as const))(
        '%s: a production run SAYS in its job summary that it ran probes only',
        (_, job) => {
            const truth = productionTruth(job.steps);
            const summaries = job.steps.filter(
                (step) =>
                    truth.get(step) !== 'false' &&
                    /GITHUB_STEP_SUMMARY/u.test(scalarText(step.run)) &&
                    /probes only/iu.test(scalarText(step.run)) &&
                    /LOAD_TEST_TARGET/u.test(`${scalarText(step.if)}\n${scalarText(step.run)}`),
            );

            expect(
                summaries.map((step) => step.name),
                'a green prod run that measured only unauthenticated probes must not read like a load test',
            ).not.toHaveLength(0);
        },
    );
});

/** Relative imports a k6 module makes, resolved against it. */
function importsOf(file: string): readonly string[] {
    return [...read(file).matchAll(/^import\s[^;]*?from\s+'(\.{1,2}\/[^']+)';/gmu)].map((match) =>
        path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] ?? '')),
    );
}

/** A scenario plus every relative module it reaches. */
function closure(script: string): readonly string[] {
    const seen = new Set<string>();
    const queue = [script];

    while (queue.length > 0) {
        const next = queue.pop() ?? '';

        if (!seen.has(next)) {
            seen.add(next);
            queue.push(...importsOf(next));
        }
    }

    return [...seen];
}

/** Source with line and block comments blanked, so prose about a public write is not read as one. */
const code = (file: string): string =>
    read(file)
        .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');

/**
 * Clone sites whose SOURCE the scenario created itself, under the same identity, with the reason. Set-equality
 * below: a new clone site fails until it is argued here, and a removed one leaves a stale entry that fails too.
 */
const OWN_SOURCE_CLONES: Readonly<Record<string, string>> = {
    'packages/services/recipe-service/tests/load/pullFromSource.load.js':
        'vuFixture clones the source collection the SAME VU found in, or created into, its own library',
};

describe('the write shape of every deployed-capable k6 scenario', () => {
    const scripts = deployedCapableScripts();
    const modules = [...new Set(scripts.flatMap(closure))].sort();

    it('reasons over the scenarios and their helpers (non-vacuity)', () => {
        expect(scripts.length).toBeGreaterThan(5);
        expect(modules).toContain('packages/services/recipe-service/tests/load/lib/common.js');
    });

    it('⛔ sends no visibility but private', () => {
        const offences = modules.flatMap((file) =>
            [...code(file).matchAll(/visibility\s*:\s*(['"`][^'"`]*['"`]|[A-Za-z_$][\w$.]*)/gu)]
                .filter((match) => match[1] !== "'private'")
                .map((match) => `${file}: visibility: ${match[1] ?? ''}`),
        );

        expect(offences, 'a public write is served to real users before any cleanup can run').toStrictEqual([]);
    });

    it('⛔ rates nothing', () => {
        const offences = modules.filter((file) => /\/ratings?\b/u.test(code(file)));

        expect(offences, 'a rating moves a real recipe’s aggregate in front of real users').toStrictEqual([]);
    });

    it('⛔ clones only a source the scenario created itself, each site argued', () => {
        const cloning = modules.filter((file) => /\/clone\b/u.test(code(file)));

        expect(cloning.sort()).toStrictEqual(Object.keys(OWN_SOURCE_CLONES).sort());
    });

    it('the substring rules above can see a write at all (mutation check on the matcher)', () => {
        const probe = "http.post(`${BASE_URL}/api/v1/recipes/${id}/ratings`, JSON.stringify({ visibility: 'public' }))";

        expect([...probe.matchAll(/visibility\s*:\s*(['"`][^'"`]*['"`])/gu)].map((m) => m[1])).toEqual(["'public'"]);
        expect(/\/ratings?\b/u.test(probe)).toBe(true);
    });
});
