/**
 * `tsx bin/stackEnv.ts <door>` — print the facts of the running local stack, for the shell door and the lane door.
 *
 * stdout holds `KEY=value` lines (the names are fixed in `src/stackEnv.ts`) and stderr holds the `stack:` line. A
 * refusal is one R9 line on stderr, a non-zero exit and nothing on stdout, so a reader never exports half the ports.
 *
 * @sideEffect Runs `docker ps -a` and `docker port`; reads the parse worker's `.env.development`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalPath } from '../src/canonicalPath.js';
import { stackEnvOutcome, type WorkerEnv } from '../src/stackEnv.js';
import {
    composeContainersFrom,
    isInvalidStackPortError,
    publishedHostPort,
    refusalLine,
    stackFrom,
} from '../src/stackPorts.js';
import { REPO_ROOT } from './adapters.js';

const door = process.argv[2] ?? 'local:maestro';
const WORKER_ENV_FILE = path.join(REPO_ROOT, 'packages/services/recipe-workers/.env.development');

/** One value of the worker's own env file, which is the one source of its names. */
function workerValue(text: string, key: string): string {
    const line = text.split('\n').find((candidate) => candidate.startsWith(`${key}=`));

    if (line === undefined) {
        throw new Error(`${WORKER_ENV_FILE} states no ${key}`);
    }

    return line.slice(key.length + 1).trim();
}

/** The host port a container publishes, or `undefined` when Docker answers nothing. */
function published(container: string): number | undefined {
    const result = spawnSync('docker', ['port', container], { encoding: 'utf8' });

    return result.status === 0 ? publishedHostPort(result.stdout ?? '') : undefined;
}

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
    const workerEnv: WorkerEnv = {
        SQS_ENDPOINT: workerValue(workerText, 'SQS_ENDPOINT'),
        RECIPE_PARSE_QUEUE_URL: workerValue(workerText, 'RECIPE_PARSE_QUEUE_URL'),
        DATABASE_URL: workerValue(workerText, 'DATABASE_URL'),
    };
    const containers = composeContainersFrom(
        spawnSync(
            'docker',
            [
                'ps',
                '-a',
                '--format',
                '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}',
            ],
            { encoding: 'utf8' },
        ).stdout ?? '',
    );
    const outcome = stackEnvOutcome({
        door,
        stack,
        checkout: REPO_ROOT,
        canon: canonicalPath,
        containers,
        published: {
            recipes: published(stack.containerName('recipes')),
            identity: published(stack.containerName('identity')),
            food: published(stack.containerName('food')),
            localstack: published(stack.containerName('localstack')),
            postgres: published(stack.containerName('postgres')),
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

process.exitCode = main();
