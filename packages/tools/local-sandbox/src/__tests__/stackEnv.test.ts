/**
 * `stackEnvOutcome` is what the shell door and the lane door read: the facts of the RUNNING stack, as `KEY=value`
 * lines, or one R9 refusal and no line at all. The ports come from what Docker publishes, never from the shell.
 */
import { describe, expect, it } from 'vitest';

import { stackEnvOutcome, STACK_ENV_KEYS, workerEnvFrom } from '../stackEnv.js';
import { stackFrom, type ComposeContainer } from '../stackPorts.js';

const C = '/work/C';
const A = '/work/A';
const at = (project: string, dir: string): ComposeContainer => ({ project, workingDir: `${dir}/.local-sandbox` });
const workerEnv = {
    SQS_ENDPOINT: 'http://localhost:4566',
    RECIPE_PARSE_QUEUE_URL: 'http://localhost:4566/000000000000/kitchensink-recipe-parse-dev',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/kitchensink_recipes_dev',
};
const base = {
    door: 'local:maestro',
    checkout: C,
    canon: (value: string) => value,
    workerEnv,
};
const defaultPublished = { recipes: 3000, identity: 3001, food: 3002, localstack: 4566, postgres: 5432 };
const shiftedPublished = { recipes: 3100, identity: 3101, food: 3102, localstack: 4666, postgres: 5532 };

function linesOf(outcome: ReturnType<typeof stackEnvOutcome>): Record<string, string> {
    if (!outcome.ok) {
        throw new Error(outcome.line);
    }

    return Object.fromEntries(
        outcome.lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
}

describe("stackEnvOutcome for the default stack: exactly today's values", () => {
    const outcome = stackEnvOutcome({
        ...base,
        stack: stackFrom({}),
        containers: [at('local-sandbox', C)],
        published: defaultPublished,
    });
    const env = linesOf(outcome);

    it('names the project, the containers and the published ports', () => {
        expect(env['LOCAL_MAESTRO_POSTGRES_CONTAINER']).toBe('local-sandbox-postgres');
        expect(env['LOCAL_MAESTRO_RECIPES_CONTAINER']).toBe('local-sandbox-recipes');
        expect(env['MAESTRO_LOCAL_RECIPE_HOST_PORT']).toBe('3000');
        expect(env['MAESTRO_LOCAL_IDENTITY_HOST_PORT']).toBe('3001');
        expect(env['MAESTRO_LOCAL_FOOD_HOST_PORT']).toBe('3002');
        expect(env['LOCAL_MAESTRO_POSTGRES_PORT']).toBe('5432');
        expect(env['LOCAL_MAESTRO_LOCALSTACK']).toBe('http://localhost:4566');
    });

    it("gives the seed URLs and leaves the parse worker's own values as they are", () => {
        expect(env['E2E_SEED_RECIPE_URL']).toBe('http://localhost:3000');
        expect(env['E2E_SEED_IDENTITY_URL']).toBe('http://localhost:3001');
        expect(env['E2E_SEED_FOOD_URL']).toBe('http://localhost:3002');
        expect(env['LOCAL_MAESTRO_WORKER_SQS_ENDPOINT']).toBe('http://localhost:4566');
        expect(env['LOCAL_MAESTRO_WORKER_DATABASE_URL']).toBe(workerEnv.DATABASE_URL);
    });

    it('prints a stack line for stderr', () => {
        expect(outcome.ok && outcome.stackLine).toBe(
            'stack: local-sandbox (recipes 3000, identity 3001, food 3002) from /work/C',
        );
    });
});

describe('stackEnvOutcome for the 3100 stack (AE2, AE10)', () => {
    const outcome = stackEnvOutcome({
        ...base,
        stack: stackFrom({ LOCAL_SANDBOX_PORT: '3100' }),
        containers: [at('local-sandbox-3100', C)],
        published: shiftedPublished,
    });
    const env = linesOf(outcome);

    it('moves every port-bearing value and the container names', () => {
        expect(env['MAESTRO_LOCAL_RECIPE_HOST_PORT']).toBe('3100');
        expect(env['E2E_SEED_IDENTITY_URL']).toBe('http://localhost:3101');
        expect(env['E2E_SEED_FOOD_URL']).toBe('http://localhost:3102');
        expect(env['LOCAL_MAESTRO_LOCALSTACK']).toBe('http://localhost:4666');
        expect(env['LOCAL_MAESTRO_POSTGRES_PORT']).toBe('5532');
        expect(env['LOCAL_MAESTRO_POSTGRES_CONTAINER']).toBe('local-sandbox-3100-postgres');
    });

    it("moves the parse worker's three values with onPublishedPorts", () => {
        expect(env['LOCAL_MAESTRO_WORKER_SQS_ENDPOINT']).toBe('http://localhost:4666');
        expect(env['LOCAL_MAESTRO_WORKER_RECIPE_PARSE_QUEUE_URL']).toBe(
            'http://localhost:4666/000000000000/kitchensink-recipe-parse-dev',
        );
        expect(env['LOCAL_MAESTRO_WORKER_DATABASE_URL']).toBe(
            'postgres://postgres:postgres@localhost:5532/kitchensink_recipes_dev',
        );
    });

    it('the stack line shows the published ports (AE10)', () => {
        expect(outcome.ok && outcome.stackLine).toBe(
            'stack: local-sandbox-3100 (recipes 3100, identity 3101, food 3102) from /work/C',
        );
    });

    it('every key it prints is in the fixed set the shell accepts', () => {
        expect(Object.keys(env).sort()).toEqual([...STACK_ENV_KEYS].sort());
    });
});

describe('stackEnvOutcome refuses with one line and no KEY=value', () => {
    it('AE9: another checkout runs the target project', () => {
        const outcome = stackEnvOutcome({
            ...base,
            stack: stackFrom({}),
            containers: [at('local-sandbox', A)],
            published: defaultPublished,
        });

        expect(outcome).toEqual({
            ok: false,
            line:
                'local:maestro refused: project local-sandbox runs from /work/A, not this checkout. ' +
                'Run local:down there.',
        });
    });

    it('a stack that is not running: the project has no container', () => {
        const outcome = stackEnvOutcome({
            ...base,
            stack: stackFrom({ LOCAL_SANDBOX_PORT: '3100' }),
            containers: [],
            published: {},
        });

        expect(outcome).toEqual({
            ok: false,
            line:
                'local:maestro refused: project local-sandbox-3100 has no containers. ' +
                'Run local:up with the same LOCAL_SANDBOX_PORT first.',
        });
    });

    it('a published port that Docker did not answer is a refusal, not a guess', () => {
        const outcome = stackEnvOutcome({
            ...base,
            stack: stackFrom({}),
            containers: [at('local-sandbox', C)],
            published: { ...defaultPublished, identity: undefined },
        });

        expect(outcome).toEqual({
            ok: false,
            line:
                'local:maestro refused: project local-sandbox publishes no identity port. ' +
                'Run local:up, and wait for it to finish.',
        });
    });
});

describe('workerEnvFrom', () => {
    it('reads the three values the way the worker does, with Node env-file rules (quotes, comments, spacing)', () => {
        const text = [
            '# a comment SQS_ENDPOINT=nowhere',
            'SQS_ENDPOINT=http://localhost:4566',
            'RECIPE_PARSE_QUEUE_URL = "http://localhost:4566/000000000000/queue" # trailing comment',
            "DATABASE_URL='postgres://postgres:postgres@localhost:5432/db'",
        ].join('\n');

        expect(workerEnvFrom(text)).toEqual({
            ok: true,
            env: {
                SQS_ENDPOINT: 'http://localhost:4566',
                RECIPE_PARSE_QUEUE_URL: 'http://localhost:4566/000000000000/queue',
                DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/db',
            },
        });
    });

    it('names every key the file does not state', () => {
        expect(workerEnvFrom('SQS_ENDPOINT=http://localhost:4566\n')).toEqual({
            ok: false,
            missing: ['RECIPE_PARSE_QUEUE_URL', 'DATABASE_URL'],
        });
    });

    it('does not take a commented-out key as stated', () => {
        expect(workerEnvFrom('# DATABASE_URL=x\n')).toMatchObject({ ok: false });
    });
});
