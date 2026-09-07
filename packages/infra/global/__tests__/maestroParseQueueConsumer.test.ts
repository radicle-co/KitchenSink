// @vitest-environment node
/**
 * Repo-wide guard: a job that PRODUCES parse-line messages must also stand up something that CONSUMES them.
 *
 * ⛔ PARTLY REWRITTEN 2026-09-05 for the owner's ruling of the same day — *an end-to-end test drives the
 * deployed system, or it is skipped*. `e2e-mobile-maestro` no longer boots recipe-service on the runner: it
 * drives a deployed `pr-{N}` stage, whose queue is drained by `RecipeWorkersStack`'s real Lambda. So the
 * Maestro job enqueues nothing HERE and is owed no consumer HERE, and the two cases that named it by hand
 * are gone. What replaced them, and where their coverage went:
 *
 * | Retired case | Where its property lives now |
 * |---|---|
 * | `the producer and the consumer name the SAME queue, byte for byte` | {@link auditParsePath}'s `consumer-on-a-different-queue` finding, applied to EVERY job by the census case, and mutation-proved by the `drifted` fixture below. The property was never really about the Maestro job — it is about any producer/consumer pair — and pinning it to one job name is what made it die with that job. |
 * | `the consumer is started BEFORE the flows that depend on it` | the `consumer-after-the-flows` finding, likewise applied to every job, and now carrying its OWN fixture (it previously had none, and leaned on the real file — so with the real file's consumer gone it would have been an assertion over nothing). |
 *
 * ⚠️ NEITHER retirement weakens the guard, and this is the part to check rather than take on faith: the
 * invariant that matters — *a future job that enqueues parse-line messages without draining them is caught*
 * — is asserted by the census case over EVERY job in the file, not by either retired case. `load-test` is
 * still a live producer, so that case still has a real subject. A THIRD case now pins the mobile tier's
 * silence directly: it must not re-acquire a local parse path, because its target is a deployment.
 *
 * ## The defect this pins
 *
 * `_ci-heavy.yml`'s Maestro job has booted the recipe-service with
 * `RECIPE_PARSE_QUEUE_URL=http://localhost:4566/000000000000/recipe-parse-line` since U9 shipped, while its
 * `services:` block declared Postgres and nothing else. Port 4566 is LocalStack's; nothing listened on it.
 *
 * ⛔ AND THE FAILURE WAS NOT "THE QUEUE FILLED AND NOTHING DRAINED IT", which is the natural guess and is one
 * layer too far in. `ParseJobsService.enqueueOrMark` CONVERTS a send failure into a `202` whose job is
 * `partial` and whose every line is `failed_retryable` — so no message was ever enqueued, the API answered
 * normally, the review screen rendered, and only the COUNT was wrong (`failed_retryable` is not settled, per
 * `features/recipes/src/parse/model.ts`). Run 33924615847's own container log is the record:
 *
 *     WARN [ParseJobsService] parse-job 50b1621d-…: enqueue failed, marking 2 line(s) failed_retryable
 *     — parse-job enqueue: 1 of 2 messages were not delivered — batch 0 failed:
 *     AggregateError [ECONNREFUSED]
 *
 * `recipes/parse-ingredients` therefore failed on `Assert that "2 of 2 lines read" is visible`, twice, after
 * ~50 minutes of emulator and Gradle — the most expensive red available, on the one tier whose stated
 * purpose is to prove that "THE POLL ADVANCES WHILE THE APP IS FOREGROUNDED".
 *
 * ## Why FOUR things, not one
 *
 * The broker alone is not enough, and this is the part a reader gets wrong. With LocalStack up but an empty
 * account the enqueue still fails (`NonExistentQueue` instead of `ECONNREFUSED`). With the queue created but
 * no consumer, the lines land `pending` and stay there — `RecipeWorkersStack` attaches the queue to a Lambda
 * and nothing in CI deploys a Lambda, so `src/local/main.ts` is the only drain there is. With a consumer but
 * no CRF engine, `crfInvoke` throws, `handlers/parseLine.ts` classifies everything an ENGINE throws as
 * TRANSIENT and re-throws BEFORE any landing (deliberately — ADR-0026's 2026-08-31 update), the message
 * redelivers, and the line is `pending` again. Every one of those four states renders the SAME wrong number
 * on the phone, so a reader who repairs one and re-runs buys another 50-minute red.
 *
 * ## How it is asserted
 *
 * {@link auditParsePath} ENUMERATES NOTHING — no allowlist of job names, no list of expected steps. It
 * discovers the producer as the step whose body sets `RECIPE_PARSE_QUEUE_URL=`, reads the port and the queue
 * NAME out of that URL, and asks whether a service container publishes the port, whether some step creates a
 * queue by that name, and whether a step starting `@kitchensink/recipe-workers` is pointed at the SAME URL,
 * byte for byte. So a renamed queue, a moved port or a producer/consumer divergence is caught without
 * anybody updating a list here — the failure mode `serviceInfraWiringInvariants`' own docstring names ("a
 * copy of a list cannot detect that the list is incomplete").
 *
 * ## Mutation evidence — MEASURED, not predicted
 *
 * The fixtures below are the Maestro job's ACTUAL historical shapes: the one that shipped (broker absent),
 * and the three intermediate repairs a reader would stop at (broker but no queue, queue but no consumer,
 * consumer but no engine). Each is asserted to produce its own finding.
 *
 * The guard was then pointed at the REAL pre-fix `_ci-heavy.yml` (`git show HEAD:…`, 2026-09-05) and run.
 * It reported, verbatim:
 *
 *     e2e-mobile-maestro: no-broker, queue-not-created, undeclared-parse-path
 *
 * and reported NOTHING for `load-test` — which is the second half of the claim, because `load-test` also
 * enqueues parse-line messages and its correctness depends on nobody draining them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));

/** The engine pin every install step must reference — stated once, derived nowhere else (ADR-0025). */
const CRF_REQUIREMENTS = 'packages/services/ingredient-parser/requirements.txt';

/** The workspace whose `dev` entry (`src/local/main.ts`) is the only thing that drains the parse queue. */
const CONSUMER_WORKSPACE = '@kitchensink/recipe-workers';

interface WorkflowStep {
    readonly name?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowService {
    readonly image?: string;
    readonly ports?: readonly string[];
}

interface WorkflowJob {
    readonly services?: Readonly<Record<string, WorkflowService>>;
    readonly steps?: readonly WorkflowStep[];
}

/** Every finding {@link auditParsePath} can report. A job with none of these accounts for what it enqueues. */
type ParsePathFinding =
    | 'no-broker'
    | 'queue-not-created'
    | 'undeclared-parse-path'
    | 'consumer-defeats-the-depth-assertion'
    | 'consumer-on-a-different-queue'
    | 'consumer-after-the-flows'
    | 'no-crf-install'
    | 'crf-install-not-asserted';

/** The producer's queue URL, as the boot step's own `docker run -e` spells it. */
function producedQueueUrl(steps: readonly WorkflowStep[]): string | undefined {
    for (const step of steps) {
        const match = /RECIPE_PARSE_QUEUE_URL=(\S+)/u.exec(step.run ?? '');

        if (match?.[1] !== undefined) {
            return match[1];
        }
    }

    return undefined;
}

/** The host port a service container publishes, or `undefined` when it publishes none. */
function publishedHostPorts(job: WorkflowJob): readonly string[] {
    return Object.values(job.services ?? {}).flatMap((service) =>
        (service.ports ?? []).map((mapping) => String(mapping).split(':')[0] ?? ''),
    );
}

/**
 * Audit one job's parse-line wiring.
 *
 * ⛔ THERE ARE TWO LEGITIMATE MODES, AND THE JOB DECLARES ITS OWN — no allowlist of job names lives here,
 * because a list of exceptions cannot tell you that it is missing one. A job that enqueues parse-line
 * messages either DRAINS them (it starts the worker, and therefore owes a queue, an agreeing URL and a CRF
 * engine) or it MEASURES THE UNDRAINED DEPTH (`ApproximateNumberOfMessages`, and therefore owes the exact
 * opposite: no consumer at all). `load-test` is the second kind on purpose — its own comment says the
 * fan-out proof "is the DEPTH of an SQS queue nothing drains" — so a consumer there would not improve it,
 * it would DELETE its assertion. A producer that does neither has messages that simply vanish, which is the
 * shape this whole guard exists to name.
 *
 * ⛔ Returns EVERY finding rather than the first: a reader repairing this needs the whole list, because
 * fixing only the broker leaves the lines `pending` and looks, from the phone, exactly the same.
 *
 * @param job - The parsed workflow job.
 * @returns The findings, sorted. Empty when the job accounts for what it enqueues. Pure.
 */
export function auditParsePath(job: WorkflowJob): readonly ParsePathFinding[] {
    const steps = job.steps ?? [];
    const producedUrl = producedQueueUrl(steps);

    if (producedUrl === undefined) {
        // Nothing enqueues, so nothing is owed a consumer. Not a finding — this is what every other job in
        // the file looks like, and a guard that demanded a worker of them would be noise.
        return [];
    }

    const findings: ParsePathFinding[] = [];
    const url = new URL(producedUrl);
    const queueName = url.pathname.split('/').filter(Boolean).at(-1) ?? '';

    if (!publishedHostPorts(job).includes(url.port)) {
        findings.push('no-broker');
    }

    const createsQueue = steps.some((step) =>
        new RegExp(`create-queue[^\\n]*--queue-name\\s+${queueName}\\b`, 'u').test(step.run ?? ''),
    );

    if (!createsQueue) {
        findings.push('queue-not-created');
    }

    const consumerIndex = steps.findIndex((step) => (step.run ?? '').includes(CONSUMER_WORKSPACE));
    const measuresDepth = steps.some((step) => (step.run ?? '').includes('ApproximateNumberOfMessages'));

    if (consumerIndex === -1 && !measuresDepth) {
        findings.push('undeclared-parse-path');
    }

    if (consumerIndex !== -1 && measuresDepth) {
        findings.push('consumer-defeats-the-depth-assertion');
    }

    if (consumerIndex !== -1 && String(steps[consumerIndex]?.env?.['RECIPE_PARSE_QUEUE_URL'] ?? '') !== producedUrl) {
        // ⛔ The one finding that is about AGREEMENT rather than presence. A worker polling a queue nobody
        // writes to reports an empty queue, not an error — it looks healthy forever while every line stays
        // `pending`, which is the exact trap `.env.development`'s own docstring warns about.
        findings.push('consumer-on-a-different-queue');
    }

    const flowsIndex = steps.findIndex((step) => (step.uses ?? '').includes('android-emulator-runner'));

    if (consumerIndex !== -1 && flowsIndex !== -1 && consumerIndex > flowsIndex) {
        findings.push('consumer-after-the-flows');
    }

    // The engine is owed by the DRAINING mode only: a job that never consumes a message never invokes the
    // CRF, so demanding a 102 MB install of it would be pure cost for no observation.
    if (consumerIndex !== -1) {
        if (!steps.some((step) => (step.run ?? '').includes(CRF_REQUIREMENTS))) {
            findings.push('no-crf-install');
        }

        // A `pip install` that half-failed leaves an interpreter that cannot `import ingredient_parser`, and
        // the consequence is a stalled queue 20 minutes later rather than a red install. `_ci.yml` carries
        // the same observation in three jobs, each with an `::error::` saying not to pass without it.
        const assertsImport = steps.some(
            (step) => (step.run ?? '').includes('import ingredient_parser') && (step.run ?? '').includes('::error::'),
        );

        if (!assertsImport) {
            findings.push('crf-install-not-asserted');
        }
    }

    return [...findings].sort();
}

/** The Maestro job's shape as it SHIPPED: a producer, one Postgres, and nothing else. */
const SHIPPED_BROKEN: WorkflowJob = {
    services: { postgres: { image: 'postgres:18', ports: ['5432:5432'] } },
    steps: [
        {
            name: 'Boot recipe-service',
            run: 'docker run -e RECIPE_PARSE_QUEUE_URL=http://localhost:4566/000000000000/recipe-parse-line img',
        },
        { name: 'Run Maestro flows on emulator', uses: 'reactivecircus/android-emulator-runner@sha' },
    ],
};

/** The first repair a reader stops at: the broker is up, but the account is empty and nothing drains. */
const BROKER_ONLY: WorkflowJob = {
    services: {
        postgres: { image: 'postgres:18', ports: ['5432:5432'] },
        localstack: { image: 'localstack/localstack:4.4.0', ports: ['4566:4566'] },
    },
    steps: SHIPPED_BROKEN.steps,
};

/** Broker + queue, still no consumer — the state in which every line lands `pending` and stays there. */
const QUEUE_BUT_NO_CONSUMER: WorkflowJob = {
    services: BROKER_ONLY.services,
    steps: [
        { name: 'Bootstrap', run: 'aws sqs create-queue --queue-name recipe-parse-line' },
        ...(SHIPPED_BROKEN.steps ?? []),
    ],
};

/** Everything but the engine — `crfInvoke` throws, `parseLine.ts` re-throws it, the line is `pending` again. */
const CONSUMER_BUT_NO_ENGINE: WorkflowJob = {
    services: BROKER_ONLY.services,
    steps: [
        { name: 'Bootstrap', run: 'aws sqs create-queue --queue-name recipe-parse-line' },
        {
            name: 'Boot recipe-service',
            run: 'docker run -e RECIPE_PARSE_QUEUE_URL=http://localhost:4566/000000000000/recipe-parse-line img',
        },
        {
            name: 'Start the parse-line worker',
            run: `npm run dev --workspace=${CONSUMER_WORKSPACE}`,
            env: { RECIPE_PARSE_QUEUE_URL: 'http://localhost:4566/000000000000/recipe-parse-line' },
        },
        { name: 'Run Maestro flows on emulator', uses: 'reactivecircus/android-emulator-runner@sha' },
    ],
};

describe('a CI job that enqueues parse-line messages can drain them', () => {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as { readonly jobs: Readonly<Record<string, WorkflowJob>> };

    it('⛔ every job in _ci-heavy.yml that boots a parse producer stands up its whole parse path', () => {
        const offenders = Object.entries(doc.jobs)
            .map(([name, job]) => ({ name, findings: auditParsePath(job) }))
            .filter(({ findings }) => findings.length > 0);

        expect(
            offenders,
            'a job that hands recipe-service a RECIPE_PARSE_QUEUE_URL must say what becomes of the messages: ' +
                "either it DRAINS them (start src/local/main.ts — RecipeWorkersStack's Lambda is not deployed " +
                'in CI, so nothing else can) or it MEASURES THE UNDRAINED DEPTH, which load-test does on ' +
                "purpose. Findings: no-broker = nothing listens on the URL's port; queue-not-created = " +
                'LocalStack starts with an empty account; undeclared-parse-path = the messages vanish; ' +
                'no-crf-install = handler.py cannot import its engine, so parseLine.ts re-throws forever and ' +
                'the line stays pending. Every one of those renders the SAME wrong number on the phone ' +
                '("0 of 2 lines read"), so fixing only the first finding buys another 50-minute red.',
        ).toEqual([]);
    });

    /**
     * NEW 2026-09-05, and it is what the two retired real-file cases were replaced BY rather than merely
     * replaced with — see the table in this file's header.
     *
     * The mobile tier's target is now a DEPLOYED `pr-{N}` stage, whose parse queue is drained by
     * `RecipeWorkersStack`'s Lambda. Re-acquiring any limb of the local parse path here would be worse than
     * the defect this file was written about: a broker on the runner, a queue created in an empty LocalStack
     * account and a worker polling it would all come up green while the phone talks to the DEPLOYED service
     * and its own queue — a complete, healthy-looking parse path that no assertion in this run ever touches.
     *
     * ⛔ It is asserted through {@link producedQueueUrl} and the service block rather than by scanning for a
     * job name inside step bodies, so a renamed step or a moved boot command cannot slip past it.
     */
    it('⛔ the mobile tier enqueues nothing on this runner — the deployed stage owns its own queue', () => {
        const maestro = doc.jobs['e2e-mobile-maestro'] as WorkflowJob | undefined;

        expect(maestro, '_ci-heavy.yml has no `e2e-mobile-maestro` job — this case lost its subject').toBeDefined();
        expect(
            producedQueueUrl(maestro?.steps ?? []),
            'the Maestro job hands a RECIPE_PARSE_QUEUE_URL to something on this runner again — its target ' +
                'is a deployed stage, so a local parse path would run in parallel with the real one and be ' +
                'observed by nothing',
        ).toBeUndefined();
        expect(
            (maestro?.steps ?? []).some((step) => (step.run ?? '').includes(CONSUMER_WORKSPACE)),
            'the Maestro job starts a local parse-line worker, which would drain a queue the deployed ' +
                'service never writes to',
        ).toBe(false);
        expect(Object.keys(maestro?.services ?? {}), 'the Maestro job stands up service containers again').toEqual([]);
    });

    // ── Mutation evidence: the audit detects the absence of each leg ─────────────────────────────────────

    it('reports the whole defect for the shape that actually shipped', () => {
        expect(auditParsePath(SHIPPED_BROKEN)).toEqual(['no-broker', 'queue-not-created', 'undeclared-parse-path']);
    });

    it('still reports a missing queue and an unaccounted path once only the broker is added', () => {
        expect(auditParsePath(BROKER_ONLY)).toContain('queue-not-created');
        expect(auditParsePath(BROKER_ONLY)).toContain('undeclared-parse-path');
        expect(auditParsePath(BROKER_ONLY)).not.toContain('no-broker');
    });

    it('still reports an unaccounted path once the queue exists — the pending-forever state', () => {
        expect(auditParsePath(QUEUE_BUT_NO_CONSUMER)).toContain('undeclared-parse-path');
        expect(auditParsePath(QUEUE_BUT_NO_CONSUMER)).not.toContain('queue-not-created');
    });

    it("accepts a job that MEASURES the undrained depth instead of draining — load-test's deliberate shape", () => {
        const measuring: WorkflowJob = {
            services: BROKER_ONLY.services,
            steps: [
                { name: 'Bootstrap', run: 'aws sqs create-queue --queue-name recipe-parse-line' },
                ...(SHIPPED_BROKEN.steps ?? []),
                {
                    name: 'Assert the fan-out',
                    run: 'aws sqs get-queue-attributes --attribute-names ApproximateNumberOfMessages',
                },
            ],
        };

        expect(auditParsePath(measuring)).toEqual([]);
    });

    it('refuses a job that both drains and measures the depth — the consumer would delete the assertion', () => {
        const both: WorkflowJob = {
            services: BROKER_ONLY.services,
            steps: [
                ...(CONSUMER_BUT_NO_ENGINE.steps ?? []),
                {
                    name: 'Assert the fan-out',
                    run: 'aws sqs get-queue-attributes --attribute-names ApproximateNumberOfMessages',
                },
            ],
        };

        expect(auditParsePath(both)).toContain('consumer-defeats-the-depth-assertion');
    });

    it('still reports a missing engine once the consumer is running', () => {
        expect(auditParsePath(CONSUMER_BUT_NO_ENGINE)).toEqual(['crf-install-not-asserted', 'no-crf-install']);
    });

    it('catches a consumer pointed at a DIFFERENT queue — the shape that polls happily forever', () => {
        const drifted: WorkflowJob = {
            services: BROKER_ONLY.services,
            steps: (CONSUMER_BUT_NO_ENGINE.steps ?? []).map((step) =>
                step.env === undefined
                    ? step
                    : {
                          ...step,
                          env: {
                              RECIPE_PARSE_QUEUE_URL: 'http://localhost:4566/000000000000/kitchensink-recipe-parse-dev',
                          },
                      },
            ),
        };

        expect(auditParsePath(drifted)).toContain('consumer-on-a-different-queue');
    });

    /**
     * MOVED HERE 2026-09-05 from the real-file case `the consumer is started BEFORE the flows that depend on
     * it`, which is retired: with the Maestro job no longer producing OR consuming, that case asserted the
     * absence of a finding on a job the audit already returns `[]` for — an assertion over nothing.
     *
     * The ordering finding had never carried a fixture of its own, so this is where it gains one and the
     * census case is what re-applies it to any future job. A worker started AFTER the flows drains a queue
     * nobody is watching any more: the flows have already read `0 of 2 lines`, failed, and gone.
     */
    it('catches a consumer started AFTER the flows that depend on it', () => {
        const steps = CONSUMER_BUT_NO_ENGINE.steps ?? [];
        const late: WorkflowJob = {
            services: BROKER_ONLY.services,
            steps: [
                ...steps.filter((step) => step.uses !== undefined),
                ...steps.filter((step) => step.uses === undefined),
            ],
        };

        expect(auditParsePath(late)).toContain('consumer-after-the-flows');
        expect(auditParsePath(CONSUMER_BUT_NO_ENGINE)).not.toContain('consumer-after-the-flows');
    });

    it('says nothing about a job that enqueues no parse-line messages', () => {
        expect(auditParsePath({ services: {}, steps: [{ name: 'Install', run: 'npm ci' }] })).toEqual([]);
    });
});
