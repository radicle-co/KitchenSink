// @vitest-environment node
/**
 * Repo-wide guard: the queue URLs a service reads in LOCAL development must name queues the local sandbox
 * actually creates.
 *
 * ## The failure this pins
 *
 * `recipe-service/.env.development` declared `RECIPE_PARSE_QUEUE_URL=…/recipe-parse-line` and
 * `INGREDIENT_VERIFICATION_QUEUE_URL=…/recipe-verification`. Neither name exists anywhere in the
 * repository. `npm run local:up` synthesises every CDK app at STAGE=`dev` and provisions each queue under
 * the `queueName` in the template — `kitchensink-recipe-parse-dev` and `kitchensink-recipe-verification-dev`
 * — so the queue the dev-script service sent to and the queue the sandbox stood up were different queues.
 *
 * It stayed invisible for two compounding reasons, and both are why this is a GUARD rather than a fixed
 * typo. `ParseJobsService.enqueueOrMark` catches a send failure, warns, and marks the lines
 * `failed_retryable` — so the API answers 2xx and the damage is a row state, not an error. And only the
 * `npm run dev` (vite-node) path reads this file at all; the container path `local:up` builds resolves the
 * same variables from SSM, so whichever path a developer ran, the broken one was the other one.
 *
 * ## Why it is asserted this way
 *
 * Both sides are DERIVED. The local names come from parsing the committed env file, and the deployed names
 * from the `queueName:` template literals in the infra tree with the stage the local runner actually uses
 * substituted in — never from a list, because a list of "the queues that exist" is the artefact that went
 * stale here. A queue added tomorrow is covered the day its stack declares it.
 *
 * ⛔ The check is one-directional on purpose: every LOCAL queue URL must name a DECLARED queue, but a
 * declared queue need not appear in any `.env.development`. Most queues are consumed only by Lambdas, which
 * never read these files, and requiring an entry per queue would be a made-up rule that fails on the next
 * worker to ship.
 *
 * ⚠️ The stage is read from the local runner rather than written down here, so the day `local:up` stops
 * synthesising at `dev` this guard moves with it instead of quietly comparing against the wrong stage.
 *
 * DESIGN PATTERN: Specification module — {@link unmatchedQueueNames} is a pure verdict over the two derived
 * sets, so it is fired at a deliberately-violating fake below (the exact pre-fix values) as well as at the
 * working tree. Without that negative control a guard that discovered nothing on either side would pass.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';

/** The local runner whose synth stage decides which queue names the sandbox creates. */
const LOCAL_RUNNER = 'packages/tools/local-sandbox/bin/adapters.ts';

/** A `queueName:` property whose value is a template literal, e.g. `` `kitchensink-recipe-parse-${x}` ``. */
const QUEUE_NAME = /queueName:\s*`([^`]+)`/gu;

/** Any `…_QUEUE_URL=<url>` assignment in a committed env file. */
const QUEUE_URL = /^\s*([A-Z0-9_]*QUEUE_URL)\s*=\s*(\S+)\s*$/gmu;

/** A `${…stage…}` interpolation inside a queue-name template literal. */
const STAGE_INTERPOLATION = /\$\{[^}]*[Ss]tage[^}]*\}/gu;

/** One queue URL a service reads during local development. */
interface LocalQueue {
    /** Repo-relative env file that declares it. */
    readonly file: string;
    /** The variable name, so a failure says which setting to fix. */
    readonly variable: string;
    /** The queue name — the URL's last path segment. */
    readonly queueName: string;
}

/**
 * The stage `local:up` synthesises every CDK app at.
 *
 * Read from the runner rather than hard-coded: this guard compares against whatever the local sandbox
 * actually uses, so a change there cannot leave it silently checking the wrong names.
 *
 * @returns The stage token. Impure.
 * @sideEffect Reads the local runner's source.
 * @throws When the runner no longer states a stage, rather than defaulting to one and passing vacuously.
 */
function localStage(): string {
    const source = readFileSync(path.join(repoRoot, LOCAL_RUNNER), 'utf8');
    const match = /STAGE:\s*'([^']+)'/u.exec(source);

    if (match?.[1] === undefined) {
        throw new Error(`${LOCAL_RUNNER} no longer declares a synth STAGE — this guard cannot derive one.`);
    }

    return match[1];
}

/**
 * Every queue name any CDK stack declares, with `stage` resolved to the local runner's.
 *
 * @param stage - The stage to substitute for the templates' stage interpolation.
 * @returns The declared names. Impure.
 * @sideEffect Shells out to git and reads the infra tree.
 */
function declaredQueueNames(stage: string): ReadonlySet<string> {
    const names = [...trackedFiles('packages')]
        .filter((file) => /(?:^|\/)infra\/lib\//u.test(file) && file.endsWith('.ts'))
        .flatMap((file) => [...readFileSync(path.join(repoRoot, file), 'utf8').matchAll(QUEUE_NAME)])
        .map(([, template]) => (template ?? '').replace(STAGE_INTERPOLATION, stage));

    return new Set(names);
}

/**
 * Every queue URL declared in a committed local-development env file.
 *
 * `.env.development` is the committed, non-secret local default; `.env.local` is gitignored and personal,
 * so it is correctly invisible to `git ls-files` here.
 *
 * @returns One entry per queue URL setting. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function localQueues(): readonly LocalQueue[] {
    return trackedFiles('packages')
        .filter((file) => file.endsWith('.env.development'))
        .flatMap((file) =>
            [...readFileSync(path.join(repoRoot, file), 'utf8').matchAll(QUEUE_URL)].map(([, variable, url]) => ({
                file,
                variable: variable ?? '',
                queueName: (url ?? '').split('/').at(-1) ?? '',
            })),
        );
}

/**
 * The local queue settings that name a queue nothing declares.
 *
 * @param queues - The local settings.
 * @param declared - The names the infra tree declares at the local stage.
 * @returns One message per mismatch, empty when every setting resolves. Pure.
 */
function unmatchedQueueNames(queues: readonly LocalQueue[], declared: ReadonlySet<string>): readonly string[] {
    return queues
        .filter(({ queueName }) => !declared.has(queueName))
        .map(({ file, variable, queueName }) => `${file}: ${variable} names '${queueName}', which no stack declares`);
}

describe('local queue name parity', () => {
    it('derives both sides — neither discovery has gone vacuous', () => {
        expect(
            localQueues().length,
            'no local queue URL found — the env-file discovery has stopped working',
        ).toBeGreaterThan(0);
        expect(
            declaredQueueNames(localStage()).size,
            'no queueName found in the infra tree — the stack discovery has stopped working',
        ).toBeGreaterThan(0);
    });

    it('points every local queue URL at a queue the local sandbox creates', () => {
        expect(
            unmatchedQueueNames(localQueues(), declaredQueueNames(localStage())),
            'A local queue URL names a queue nothing in the repository creates. `npm run local:up` provisions ' +
                'queues under the `queueName` in each synthesized template at its own stage, so a hand-written ' +
                'name here sends every local message to a queue that does not exist — and the producer catches ' +
                'the failure, so nothing fails loudly.',
        ).toEqual([]);
    });

    it('⛔ NEGATIVE CONTROL: reports the exact names this guard was written for', () => {
        // The literal pre-fix values. If the predicate ever stops reporting these, it has been broken open
        // and the assertion above would pass on the very defect it exists to catch.
        const stale: readonly LocalQueue[] = [
            {
                file: 'packages/services/recipe-service/.env.development',
                variable: 'RECIPE_PARSE_QUEUE_URL',
                queueName: 'recipe-parse-line',
            },
            {
                file: 'packages/services/recipe-service/.env.development',
                variable: 'INGREDIENT_VERIFICATION_QUEUE_URL',
                queueName: 'recipe-verification',
            },
        ];

        expect(unmatchedQueueNames(stale, declaredQueueNames(localStage()))).toHaveLength(2);
    });
});
