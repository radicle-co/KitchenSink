/**
 * The facts a lane reads from the running stack's environment, which `bin/stackEnv.ts` printed and `localMaestro.sh`
 * exported. Pure: a missing fact is an error that names it, and nothing here states a default port.
 */
import { z } from 'zod';

/** The host port each service publishes. */
export interface HostPorts {
    readonly recipes: number;
    readonly identity: number;
    readonly food: number;
}

/** The runner variable that carries each service's published host port. The one place the names are written. */
export const HOST_PORT_VARIABLES: Readonly<Record<keyof HostPorts, string>> = {
    recipes: 'MAESTRO_LOCAL_RECIPE_HOST_PORT',
    identity: 'MAESTRO_LOCAL_IDENTITY_HOST_PORT',
    food: 'MAESTRO_LOCAL_FOOD_HOST_PORT',
};

const portSchema = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(1).max(65_535));

/**
 * The three published host ports.
 *
 * @param env - The lane's base environment.
 * @returns The ports.
 * @throws {Error} Naming the service whose port is missing or is not a port.
 */
export function hostPortsFromEnv(env: Readonly<Record<string, string | undefined>>): HostPorts {
    const read = (service: keyof HostPorts): number => {
        const variable = HOST_PORT_VARIABLES[service];
        const raw = env[variable];

        if (raw === undefined || raw === '') {
            throw new Error(`the stack publishes no ${service} port (${variable} is not set)`);
        }

        const port = portSchema.safeParse(raw);

        if (!port.success) {
            throw new Error(`the ${service} port ${JSON.stringify(raw)} (${variable}) is not a port`);
        }

        return port.data;
    };

    return { recipes: read('recipes'), identity: read('identity'), food: read('food') };
}

const WORKER_VARIABLES = [
    ['SQS_ENDPOINT', 'LOCAL_MAESTRO_WORKER_SQS_ENDPOINT'],
    ['RECIPE_PARSE_QUEUE_URL', 'LOCAL_MAESTRO_WORKER_RECIPE_PARSE_QUEUE_URL'],
    ['DATABASE_URL', 'LOCAL_MAESTRO_WORKER_DATABASE_URL'],
] as const;

/**
 * The parse worker's three overrides, named as the worker reads them.
 *
 * @param env - The lane's base environment.
 * @returns The overrides for the worker's process environment.
 * @throws {Error} Naming the missing variable.
 */
export function parseWorkerEnvFrom(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
    return Object.fromEntries(
        WORKER_VARIABLES.map(([name, variable]) => {
            const value = env[variable];

            if (value === undefined || value === '') {
                throw new Error(`the parse worker has no ${name} (${variable} is not set)`);
            }

            return [name, value] as const;
        }),
    );
}

/**
 * The host LocalStack address of the running stack.
 *
 * @param env - The lane's base environment.
 * @returns The address.
 * @throws {Error} Naming the variable when it is missing, because a client with no endpoint talks to real AWS.
 */
export function localstackFromEnv(env: Readonly<Record<string, string | undefined>>): string {
    const value = env['LOCAL_MAESTRO_LOCALSTACK'];

    if (value === undefined || value === '') {
        throw new Error('the stack publishes no LocalStack (LOCAL_MAESTRO_LOCALSTACK is not set)');
    }

    return value;
}
