/**
 * Integration suite for the post-deploy smoke runner — the IMPURE half the pure classifiers cannot cover
 * (issue #124).
 *
 * `infra/__tests__/deployedSmoke.test.ts` proves the classifiers decide correctly given an observation. This
 * proves the observations themselves are gathered correctly, against a REAL HTTP server over a real socket:
 * that the food probe is sent WITHOUT an `authorization` header (so a 401 is what a correctly-wired preview
 * actually produces), that a real transport failure becomes `no-response` rather than an unhandled rejection,
 * that `content-type` is read faithfully enough to tell the shared ALB's `404 text/plain` from the app's JSON
 * 404, and that the CLI's exit status is what makes a deploy job go red.
 *
 * Nothing here is mocked: `fetch`, the sockets, the child process and the CLI's argument parsing are all
 * real. The only thing standing in for the deployed services is a `node:http` server impersonating their
 * responses — which is the point, since the failures under test are *response shapes*.
 *
 * ⚠️  The CLI is spawned ASYNCHRONOUSLY. `spawnSync` would block this process's event loop, so the server
 * below could never answer the child's requests and every probe would time out — the suite would "pass" the
 * unreachable cases for entirely the wrong reason.
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSmoke, type SmokeVerdict } from '../../smoke/deployedSmoke.js';

const CLI = fileURLToPath(new URL('../../smoke/deployedSmoke.ts', import.meta.url));
const WEB_ORIGIN = 'https://pr-73.sandbox.commise.app';

/** How the stub food service should answer `GET /api/v1/foods/search` — swapped per test. */
type FoodBehaviour = 'unauthenticated-401' | 'alb-default-404' | 'app-404' | 'open-200' | 'erroring-503';

let server: Server;
let origin = '';
/** An origin nothing listens on, for the genuine transport-failure case. */
let deadOrigin = '';
let foodBehaviour: FoodBehaviour = 'unauthenticated-401';
/** Headers the stub recorded for the most recent food probe. */
let lastFoodRequestHeaders: Record<string, string | string[] | undefined> = {};
/**
 * How many CORS preflights the stub has answered. The negative assertion needs this: "the preflight was
 * SKIPPED" is a claim about a request that was never sent, which no verdict or exit status can witness — a
 * run that sent the preflight and merely dropped its verdict would look identical from the outside.
 */
let preflightCount = 0;

beforeAll(async () => {
    server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        // `connection: close` so no keep-alive socket outlives a request and holds `server.close()` open.
        const base = { connection: 'close' };

        if (url.pathname === '/health') {
            response.writeHead(200, { ...base, 'content-type': 'application/json' });
            response.end(JSON.stringify({ status: 'ok', service: 'recipe' }));

            return;
        }

        if (url.pathname === '/api/v1/recipes' && request.method === 'OPTIONS') {
            preflightCount += 1;
            response.writeHead(204, { ...base, 'access-control-allow-origin': WEB_ORIGIN });
            response.end();

            return;
        }

        if (url.pathname === '/api/v1/foods/search') {
            lastFoodRequestHeaders = request.headers;

            switch (foodBehaviour) {
                case 'unauthenticated-401':
                    response.writeHead(401, { ...base, 'content-type': 'application/json; charset=utf-8' });
                    response.end(JSON.stringify({ message: 'Valid Clerk session or M2M token required' }));

                    return;
                // Byte-for-byte the shared ALB's default fixed response for a host matching no listener rule.
                case 'alb-default-404':
                    response.writeHead(404, { ...base, 'content-type': 'text/plain; charset=utf-8' });
                    response.end('Not Found');

                    return;
                case 'app-404':
                    response.writeHead(404, { ...base, 'content-type': 'application/json; charset=utf-8' });
                    response.end(JSON.stringify({ message: 'Cannot GET /api/v1/foods/search', statusCode: 404 }));

                    return;
                case 'open-200':
                    response.writeHead(200, { ...base, 'content-type': 'application/json' });
                    response.end(JSON.stringify({ results: [] }));

                    return;
                case 'erroring-503':
                    response.writeHead(503, { ...base, 'content-type': 'application/json' });
                    response.end(JSON.stringify({ message: 'Service Unavailable' }));

                    return;
            }
        }

        response.writeHead(404, base);
        response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

    // Bind, learn the port, release — a connection there now fails for real (ECONNREFUSED).
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
    const spareAddress = spare.address();
    deadOrigin = `http://127.0.0.1:${typeof spareAddress === 'object' && spareAddress !== null ? spareAddress.port : 0}`;
    await new Promise<void>((resolve, reject) => spare.close((error) => (error ? reject(error) : resolve())));
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    server.closeAllConnections();
});

/** The verdict whose reason mentions the given origin — the ecosystem checks name the host they probed. */
const verdictFor = (verdicts: readonly SmokeVerdict[], needle: string): SmokeVerdict => {
    const found = verdicts.filter((verdict) => verdict.reason.includes(needle));

    expect(
        found.length,
        `expected a verdict mentioning ${needle} in:\n${verdicts.map((v) => v.reason).join('\n')}`,
    ).toBeGreaterThan(0);

    return found[found.length - 1] as SmokeVerdict;
};

describe('runSmoke — the ecosystem checks against a real HTTP dependency', () => {
    it('reports every check green for a fully wired preview (food answers 401)', async () => {
        foodBehaviour = 'unauthenticated-401';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            expectedImageTag: 'pr-73-abc',
            runningImageTag: 'pr-73-abc',
            foodOrigin: origin,
            configuredFoodOrigin: origin,
        });

        expect(verdicts).toHaveLength(5);
        expect(
            verdicts.every((verdict) => verdict.ok),
            verdicts.map((v) => v.reason).join('\n'),
        ).toBe(true);
    });

    // The probe MUST be unauthenticated: that is what makes a 401 the expected answer, and sending a token
    // would turn the assertion into something a preview cannot satisfy from CI.
    it('sends the food probe with NO authorization header', async () => {
        foodBehaviour = 'unauthenticated-401';
        lastFoodRequestHeaders = {};
        await runSmoke({ baseUrl: origin, webOrigin: WEB_ORIGIN, foodOrigin: origin, configuredFoodOrigin: origin });

        expect(Object.keys(lastFoodRequestHeaders)).not.toContain('authorization');
    });

    it('skips both ecosystem checks when no food origin is supplied', async () => {
        const verdicts = await runSmoke({ baseUrl: origin, webOrigin: WEB_ORIGIN });

        expect(verdicts).toHaveLength(2);
        expect(verdicts.some((verdict) => verdict.reason.includes('food'))).toBe(false);
    });

    // The issue-#124 state: recipe is healthy and current, but its food host does not exist.
    it('fails the reachability check on a real connection failure, leaving the others green', async () => {
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: deadOrigin,
            configuredFoodOrigin: deadOrigin,
        });

        const reachability = verdictFor(verdicts, deadOrigin);

        expect(reachability.ok).toBe(false);
        expect(reachability.reason).toMatch(/did not answer/i);
        // Everything that is not the reachability verdict still passes — the point being that the SERVICE is
        // fine and only the ECOSYSTEM is broken, which is precisely why nothing caught this before.
        expect(verdicts.filter((verdict) => !verdict.ok)).toHaveLength(1);
    });

    it('fails on the shared ALB default 404, naming the missing listener rule', async () => {
        foodBehaviour = 'alb-default-404';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: origin,
            configuredFoodOrigin: origin,
        });

        const reachability = verdictFor(verdicts, 'ALB');

        expect(reachability.ok).toBe(false);
        expect(reachability.reason).toMatch(/listener rule/i);
    });

    it("distinguishes the app's own JSON 404 from the ALB default", async () => {
        foodBehaviour = 'app-404';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: origin,
            configuredFoodOrigin: origin,
        });
        const reachability = verdictFor(verdicts, 'routed but answered 404');

        expect(reachability.ok).toBe(false);
        expect(reachability.reason).not.toMatch(/listener rule/i);
    });

    it('fails when the catalog answers an unauthenticated probe with 200', async () => {
        foodBehaviour = 'open-200';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: origin,
            configuredFoodOrigin: origin,
        });

        expect(verdictFor(verdicts, 'UNAUTHENTICATED').ok).toBe(false);
    });

    it('fails when the food service is erroring', async () => {
        foodBehaviour = 'erroring-503';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: origin,
            configuredFoodOrigin: origin,
        });

        expect(verdictFor(verdicts, '503').ok).toBe(false);
    });

    it('fails the wiring check when the running task points at a DIFFERENT food service', async () => {
        foodBehaviour = 'unauthenticated-401';
        const verdicts = await runSmoke({
            baseUrl: origin,
            webOrigin: WEB_ORIGIN,
            foodOrigin: origin,
            configuredFoodOrigin: 'https://food.commise.app',
        });

        expect(verdictFor(verdicts, 'https://food.commise.app').ok).toBe(false);
        // Reachability still passes: the host we SHOULD be calling is up. Only the wiring is wrong.
        expect(verdicts.filter((verdict) => !verdict.ok)).toHaveLength(1);
    });

    it('fails the wiring check when the running task carries no food origin at all', async () => {
        foodBehaviour = 'unauthenticated-401';
        const verdicts = await runSmoke({ baseUrl: origin, webOrigin: WEB_ORIGIN, foodOrigin: origin });

        expect(verdictFor(verdicts, 'FOOD_SERVICE_URL').ok).toBe(false);
    });
});

/**
 * Run the smoke CLI as the deploy workflow does.
 *
 * @param args - Flags to pass.
 * @returns Exit status and combined output.
 * @sideEffect Spawns `tsx`, performs HTTP requests.
 */
const runCli = async (...args: readonly string[]): Promise<{ status: number; output: string }> => {
    const child = spawn('npx', ['tsx', CLI, ...args], { env: process.env });
    let output = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
        output += chunk;
    });

    const status = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    return { status, output };
};

describe('deployedSmoke CLI — the exit status is what turns a deploy red', () => {
    it('exits 0 and prints one line per check when the ecosystem is wired', async () => {
        foodBehaviour = 'unauthenticated-401';
        const result = await runCli(
            '--base-url',
            origin,
            '--web-origin',
            WEB_ORIGIN,
            '--food-origin',
            origin,
            '--configured-food-origin',
            origin,
        );

        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain('answered 401');
        expect(result.output).not.toContain('FAIL');
    }, 60_000);

    it("exits 1 when this stage's food service is unreachable", async () => {
        const result = await runCli(
            '--base-url',
            origin,
            '--web-origin',
            WEB_ORIGIN,
            '--food-origin',
            deadOrigin,
            '--configured-food-origin',
            deadOrigin,
        );

        expect(result.status).toBe(1);
        expect(result.output).toContain('did not answer');
        expect(result.output).toContain('::error::');
    }, 60_000);

    // A flag typo must not degrade to "ran fewer checks and passed" — the whole class of bug this file
    // exists to catch is a check that silently did not run.
    it('exits 2 on an unknown flag rather than silently skipping checks', async () => {
        const result = await runCli('--base-url', origin, '--web-origin', WEB_ORIGIN, '--food-orgin', origin);

        expect(result.status).toBe(2);
        expect(result.output).toMatch(/usage/i);
    }, 60_000);

    // `--base-url` is the ONLY required flag. `--web-origin` became optional in #152 so food — which has no
    // `app.enableCors(…)` because nothing outside the cluster calls it — can take the rest of the smoke
    // without being asked to prove a browser reaches it. Which deploy legs still OWE the preflight is not
    // left to the caller's discretion: `prodDeploySmokeDepth.test.ts` derives it from whether the
    // service's `main.ts` enables CORS.
    it('exits 2 when --base-url, the only required flag, is missing', async () => {
        const result = await runCli('--web-origin', WEB_ORIGIN);

        expect(result.status).toBe(2);
        expect(result.output).toMatch(/usage/i);
    }, 60_000);

    // The other half of #152, and the half a unit test of `runSmoke` structurally cannot reach: the omission
    // is expressed as an ABSENT CLI FLAG, so only the real argument parser can be asked whether it accepts it.
    it('accepts --base-url ALONE, sending no preflight and still exiting 0', async () => {
        const before = preflightCount;

        const result = await runCli('--base-url', origin);

        expect(result.status, result.output).toBe(0);
        expect(result.output).not.toContain('FAIL');
        // The skip is STATED, so a deploy log says which assertion did not apply and why — a check that
        // silently stopped running is the whole failure class this file exists to catch.
        expect(result.output).toMatch(/preflight skipped/i);
        // ...and it really was not sent. On the exit status alone, a run that fired the preflight with an
        // `undefined` origin and merely dropped its verdict would be indistinguishable from a real skip.
        expect(preflightCount).toBe(before);
    }, 60_000);
});
