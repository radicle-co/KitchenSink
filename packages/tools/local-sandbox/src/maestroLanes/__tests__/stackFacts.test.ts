/**
 * What a lane reads from the running stack's environment (`MAESTRO_LOCAL_*_HOST_PORT`, `LOCAL_MAESTRO_WORKER_*`, which
 * `stackEnv` printed): the host ports of the three services, and the parse worker's overrides. A fact that is missing is a
 * refusal that names it, never a default.
 */
import { describe, expect, it } from 'vitest';

import { hostPortsFromEnv, parseWorkerEnvFrom } from '../stackFacts.js';

const ports = {
    MAESTRO_LOCAL_RECIPE_HOST_PORT: '3110',
    MAESTRO_LOCAL_IDENTITY_HOST_PORT: '3111',
    MAESTRO_LOCAL_FOOD_HOST_PORT: '3112',
};

describe('hostPortsFromEnv', () => {
    it('reads the three published ports, each to its own service', () => {
        expect(hostPortsFromEnv(ports)).toEqual({ recipes: 3110, identity: 3111, food: 3112 });
    });

    it.each([
        ['MAESTRO_LOCAL_RECIPE_HOST_PORT', 'recipes'],
        ['MAESTRO_LOCAL_IDENTITY_HOST_PORT', 'identity'],
        ['MAESTRO_LOCAL_FOOD_HOST_PORT', 'food'],
    ])('refuses when %s is missing, and names the %s service', (variable, service) => {
        const env: Record<string, string> = { ...ports };
        delete env[variable];

        expect(() => hostPortsFromEnv(env)).toThrow(`the stack publishes no ${service} port (${variable} is not set)`);
    });

    it('refuses a value that is not a port, and names the service', () => {
        expect(() => hostPortsFromEnv({ ...ports, MAESTRO_LOCAL_FOOD_HOST_PORT: 'abc' })).toThrow(/food port/u);
        expect(() => hostPortsFromEnv({ ...ports, MAESTRO_LOCAL_FOOD_HOST_PORT: '0' })).toThrow(/food port/u);
    });
});

describe('parseWorkerEnvFrom', () => {
    const worker = {
        LOCAL_MAESTRO_WORKER_SQS_ENDPOINT: 'http://localhost:4666',
        LOCAL_MAESTRO_WORKER_RECIPE_PARSE_QUEUE_URL: 'http://localhost:4666/000000000000/q',
        LOCAL_MAESTRO_WORKER_DATABASE_URL: 'postgres://u:p@localhost:5532/d',
    };

    it('maps the three values onto the names the worker reads', () => {
        expect(parseWorkerEnvFrom(worker)).toEqual({
            SQS_ENDPOINT: 'http://localhost:4666',
            RECIPE_PARSE_QUEUE_URL: 'http://localhost:4666/000000000000/q',
            DATABASE_URL: 'postgres://u:p@localhost:5532/d',
        });
    });

    it('refuses when one is missing, and names it', () => {
        expect(() => parseWorkerEnvFrom({ ...worker, LOCAL_MAESTRO_WORKER_DATABASE_URL: undefined })).toThrow(
            /LOCAL_MAESTRO_WORKER_DATABASE_URL/u,
        );
    });
});
