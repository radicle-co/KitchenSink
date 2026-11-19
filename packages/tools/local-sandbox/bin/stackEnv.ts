/**
 * `tsx bin/stackEnv.ts <door>` — print the facts of the running local stack, for the shell door and the lane door.
 *
 * stdout holds `KEY=value` lines (the names are fixed in `src/stackEnv.ts`) and stderr holds the `stack:` line. A
 * refusal is one R9 line on stderr, a non-zero exit and nothing on stdout, so a reader never exports half the ports.
 *
 * @sideEffect Runs `docker ps -a` and `docker port`; reads the parse worker's `.env.development`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalPath } from '../src/canonicalPath.js';
import { stackEnvOutcome, type WorkerEnv } from '../src/stackEnv.js';
import {
    dockerReadRefusal,
    isDockerReadError,
    isInvalidStackPortError,
    refusalLine,
    stackFrom,
} from '../src/stackPorts.js';
import { dockerContainers, dockerPublishedPort, REPO_ROOT } from './adapters.js';

const door = process.argv[2] ?? 'local:maestro';
const WORKER_ENV_FILE = path.join(REPO_ROOT, 'packages/services/recipe-workers/.env.development');

/** One value of the worker's own env file, which is the one source of its names. `undefined` when it states none. */
function workerValue(text: string, key: string): string | undefined {
    return text
        .split('\n')
        .find((candidate) => candidate.startsWith(`${key}=`))
        ?.slice(key.length + 1)
        .trim();
}

/**
 * The port each service listens on inside its container. Every service holds 3000, whatever host port it publishes on
 * (`3001->3000` for identity), and LocalStack and Postgres hold their own. Docker answers `docker port` with an error
 * for any other port, so a wrong value here refuses the run: `tests/stackEnv.integration.test.ts` runs it.
 */
const CONTAINER_PORTS = { recipes: 3000, identity: 3000, food: 3000, localstack: 4566, postgres: 5432 } as const;

function main(): number {
    let stack;

    try {
        stack = stackFrom(process.env);
    } catch (error) {
        if (isInvalidStackPortError(error)) {
            process.stderr.write(`${refusalLine(door, error.refused, error.why, error.fix)}\n`);

            return 1;
        }

        throw error;
    }

    const workerText = readFileSync(WORKER_ENV_FILE, 'utf8');
    const sqs = workerValue(workerText, 'SQS_ENDPOINT');
    const queue = workerValue(workerText, 'RECIPE_PARSE_QUEUE_URL');
    const database = workerValue(workerText, 'DATABASE_URL');

    if (sqs === undefined || queue === undefined || database === undefined) {
        const missing = [
            ['SQS_ENDPOINT', sqs],
            ['RECIPE_PARSE_QUEUE_URL', queue],
            ['DATABASE_URL', database],
        ].flatMap(([key, value]) => (value === undefined ? [key] : []));

        process.stderr.write(
            `${refusalLine(door, WORKER_ENV_FILE, `states no ${missing.join(', ')}`, 'Restore the file from git.')}\n`,
        );

        return 1;
    }

    const workerEnv: WorkerEnv = { SQS_ENDPOINT: sqs, RECIPE_PARSE_QUEUE_URL: queue, DATABASE_URL: database };
    const outcome = stackEnvOutcome({
        door,
        stack,
        checkout: REPO_ROOT,
        canon: canonicalPath,
        containers: dockerContainers(),
        published: {
            recipes: dockerPublishedPort(stack.containerName('recipes'), CONTAINER_PORTS.recipes),
            identity: dockerPublishedPort(stack.containerName('identity'), CONTAINER_PORTS.identity),
            food: dockerPublishedPort(stack.containerName('food'), CONTAINER_PORTS.food),
            localstack: dockerPublishedPort(stack.containerName('localstack'), CONTAINER_PORTS.localstack),
            postgres: dockerPublishedPort(stack.containerName('postgres'), CONTAINER_PORTS.postgres),
        },
        workerEnv,
    });

    if (!outcome.ok) {
        process.stderr.write(`${outcome.line}\n`);

        return 1;
    }

    process.stderr.write(`${outcome.stackLine}\n`);
    process.stdout.write(`${outcome.lines.join('\n')}\n`);

    return 0;
}

try {
    process.exitCode = main();
} catch (error) {
    if (!isDockerReadError(error)) {
        throw error;
    }

    process.stderr.write(`${dockerReadRefusal(door, error)}\n`);
    process.exitCode = 1;
}
