/**
 * @module stackEnv — the facts of the RUNNING stack, as `KEY=value` lines for the shell door and the lane door.
 *
 * The ports come from what Docker publishes, so a door never recomputes them from the environment and cannot disagree
 * with the stack. A stack that is not running, or that another checkout runs, is one R9 line and no `KEY=value` at all:
 * the shell must never export half the ports.
 *
 * @pattern Adapter (pure half): `bin/stackEnv.ts` reads Docker and prints these lines; this module decides them.
 */
import { parseEnv } from 'node:util';

import {
    onPublishedPorts,
    labelRefusal,
    refusalLine,
    stackLine,
    type ComposeContainer,
    type Stack,
} from './stackPorts.js';

/** The names the shell door accepts, and nothing else. A line whose key is not here is refused. */
export const STACK_ENV_KEYS = [
    'LOCAL_MAESTRO_POSTGRES_CONTAINER',
    'LOCAL_MAESTRO_RECIPES_CONTAINER',
    'LOCAL_MAESTRO_POSTGRES_PORT',
    'LOCAL_MAESTRO_LOCALSTACK',
    'MAESTRO_LOCAL_RECIPE_HOST_PORT',
    'MAESTRO_LOCAL_IDENTITY_HOST_PORT',
    'MAESTRO_LOCAL_FOOD_HOST_PORT',
    'E2E_SEED_RECIPE_URL',
    'E2E_SEED_IDENTITY_URL',
    'E2E_SEED_FOOD_URL',
    'LOCAL_MAESTRO_WORKER_SQS_ENDPOINT',
    'LOCAL_MAESTRO_WORKER_RECIPE_PARSE_QUEUE_URL',
    'LOCAL_MAESTRO_WORKER_DATABASE_URL',
] as const;

/** The services whose published port a door needs. */
type Published = Partial<Record<'recipes' | 'identity' | 'food' | 'localstack' | 'postgres', number>>;

/** The parse worker's own `.env.development` values that name a host port. */
export interface WorkerEnv {
    readonly SQS_ENDPOINT: string;
    readonly RECIPE_PARSE_QUEUE_URL: string;
    readonly DATABASE_URL: string;
}

/** What {@link stackEnvOutcome} reads. */
export interface StackEnvInput {
    /** The door that asks: `local:maestro` or `maestro:lanes`. */
    readonly door: string;
    readonly stack: Stack;
    readonly checkout: string;
    readonly canon: (value: string) => string;
    /** Every Compose container on the host, stopped ones included. */
    readonly containers: readonly ComposeContainer[];
    /** The host port each service publishes, as `docker port` answered; absent when it answered nothing. */
    readonly published: Published;
    /** The parse worker's values, as its `.env.development` states them (the default stack's ports). */
    readonly workerEnv: WorkerEnv;
}

/** The lines for the shell and the `stack:` line for stderr, or one R9 refusal. */
export type StackEnvOutcome =
    | { readonly ok: true; readonly lines: readonly string[]; readonly stackLine: string }
    | { readonly ok: false; readonly line: string };

const PUBLISHED_SERVICES = ['recipes', 'identity', 'food', 'localstack', 'postgres'] as const;

/**
 * Decide the stack's environment for a door. Pure.
 *
 * @param input - The facts.
 * @returns The `KEY=value` lines and the `stack:` line, or the refusal.
 */
export function stackEnvOutcome(input: StackEnvInput): StackEnvOutcome {
    const { door, stack, published } = input;
    const refusal = labelRefusal({
        door,
        project: stack.project,
        checkout: input.checkout,
        containers: input.containers,
        canon: input.canon,
        fixes: { foreign: 'Run local:down there.', sibling: 'Set LOCAL_SANDBOX_PORT to the port that project uses.' },
    });

    if (refusal !== undefined) {
        return { ok: false, line: refusal };
    }

    if (!input.containers.some((container) => container.project === stack.project)) {
        return {
            ok: false,
            line: refusalLine(
                door,
                `project ${stack.project}`,
                'has no containers',
                'Run local:up with the same LOCAL_SANDBOX_PORT first.',
            ),
        };
    }

    for (const service of PUBLISHED_SERVICES) {
        if (published[service] === undefined) {
            return {
                ok: false,
                line: refusalLine(
                    door,
                    `project ${stack.project}`,
                    `publishes no ${service} port`,
                    'Run local:up, and wait for it to finish.',
                ),
            };
        }
    }

    const { recipes = 0, identity = 0, food = 0, localstack = 0, postgres = 0 } = published;
    const moved = { 4566: localstack, 5432: postgres };
    const pairs: readonly (readonly [(typeof STACK_ENV_KEYS)[number], string])[] = [
        ['LOCAL_MAESTRO_POSTGRES_CONTAINER', stack.containerName('postgres')],
        ['LOCAL_MAESTRO_RECIPES_CONTAINER', stack.containerName('recipes')],
        ['LOCAL_MAESTRO_POSTGRES_PORT', String(postgres)],
        ['LOCAL_MAESTRO_LOCALSTACK', `http://localhost:${String(localstack)}`],
        ['MAESTRO_LOCAL_RECIPE_HOST_PORT', String(recipes)],
        ['MAESTRO_LOCAL_IDENTITY_HOST_PORT', String(identity)],
        ['MAESTRO_LOCAL_FOOD_HOST_PORT', String(food)],
        ['E2E_SEED_RECIPE_URL', `http://localhost:${String(recipes)}`],
        ['E2E_SEED_IDENTITY_URL', `http://localhost:${String(identity)}`],
        ['E2E_SEED_FOOD_URL', `http://localhost:${String(food)}`],
        ['LOCAL_MAESTRO_WORKER_SQS_ENDPOINT', onPublishedPorts(input.workerEnv.SQS_ENDPOINT, moved)],
        [
            'LOCAL_MAESTRO_WORKER_RECIPE_PARSE_QUEUE_URL',
            onPublishedPorts(input.workerEnv.RECIPE_PARSE_QUEUE_URL, moved),
        ],
        ['LOCAL_MAESTRO_WORKER_DATABASE_URL', onPublishedPorts(input.workerEnv.DATABASE_URL, moved)],
    ];

    return {
        ok: true,
        lines: pairs.map(([key, value]) => `${key}=${value}`),
        stackLine: stackLine(stack.project, { recipes, identity, food }, input.checkout),
    };
}

/** What {@link workerEnvFrom} read: the three values, or the names the file does not state. */
export type WorkerEnvRead =
    { readonly ok: true; readonly env: WorkerEnv } | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Read the parse worker's `.env.development` the way the worker does: Node's own env-file rules (`util.parseEnv`), so
 * a quoted value, a trailing comment or a spaced `=` is read the same on both sides. Pure.
 *
 * @param text - The file's text.
 * @returns The three values, or every name the file does not state.
 */
export function workerEnvFrom(text: string): WorkerEnvRead {
    const { SQS_ENDPOINT, RECIPE_PARSE_QUEUE_URL, DATABASE_URL } = parseEnv(text);

    if (SQS_ENDPOINT !== undefined && RECIPE_PARSE_QUEUE_URL !== undefined && DATABASE_URL !== undefined) {
        return { ok: true, env: { SQS_ENDPOINT, RECIPE_PARSE_QUEUE_URL, DATABASE_URL } };
    }

    const stated: readonly (readonly [string, string | undefined])[] = [
        ['SQS_ENDPOINT', SQS_ENDPOINT],
        ['RECIPE_PARSE_QUEUE_URL', RECIPE_PARSE_QUEUE_URL],
        ['DATABASE_URL', DATABASE_URL],
    ];
    const missing = stated.flatMap(([key, value]) => (value === undefined ? [key] : []));

    return { ok: false, missing };
}
