/**
 * The facts a lane reads from the running stack's environment, which `bin/stackEnv.ts` printed and `localMaestro.sh`
 * exported. Pure: a missing fact is an error that names it, and nothing here states a default port.
 */

/** The host port each service publishes. */
export interface HostPorts {
    readonly recipes: number;
    readonly identity: number;
    readonly food: number;
}

const PORT_VARIABLES = [
    ['recipes', 'MAESTRO_LOCAL_RECIPE_HOST_PORT'],
    ['identity', 'MAESTRO_LOCAL_IDENTITY_HOST_PORT'],
    ['food', 'MAESTRO_LOCAL_FOOD_HOST_PORT'],
] as const;

/**
 * The three published host ports.
 *
 * @param env - The lane's base environment.
 * @returns The ports.
 * @throws {Error} Naming the service whose port is missing or is not a port.
 */
export function hostPortsFromEnv(env: Readonly<Record<string, string | undefined>>): HostPorts {
    const read = (service: (typeof PORT_VARIABLES)[number][0], variable: string): number => {
        const raw = env[variable];

        if (raw === undefined || raw === '') {
            throw new Error(`the stack publishes no ${service} port (${variable} is not set)`);
        }

        const port = Number(raw);

        if (!/^\d+$/u.test(raw) || port < 1 || port > 65_535) {
            throw new Error(`the ${service} port ${JSON.stringify(raw)} (${variable}) is not a port`);
        }

        return port;
    };

    const [recipes, identity, food] = PORT_VARIABLES.map(([service, variable]) => read(service, variable));

    return { recipes: recipes ?? 0, identity: identity ?? 0, food: food ?? 0 };
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
