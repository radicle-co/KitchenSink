// @vitest-environment node
/**
 * The local Playwright lane (`scripts/e2eLocal.sh`) gives the app under test API origins where NO API answers.
 *
 * ## Why
 *
 * Every mocked spec stubs the APIs with `page.route` over every `/api/v1/` path, which reaches only what the BROWSER
 * sends. A
 * page's server-side prefetch runs in the Next server's own process, so the spec holds only when that prefetch FAILS
 * and the page falls back to a client read the mock can answer (`tests/e2e/utils/specTier.ts`,
 * `tests/e2e/ssrPrefetch.spec.ts`). CI gives the build the web server's own origin for the recipe API, where nothing
 * but Next answers. The lane used to bake the local stack's ports instead (`npm run local:up` publishes recipe 3000,
 * identity 3001, food 3002), so with the stack up a page's prefetch reached a real service, and a spec's fixtures could
 * lose to whatever that service held.
 *
 * `NEXT_PUBLIC_*` is inlined at build time on the server too (`src/config/env.ts` reads them as static members), so
 * the value the lane exports IS what every server render calls. The run's own web origin is the only address that is
 * listening and is certainly not an API, whatever else the machine is running.
 *
 * Read as text: the lane is a shell script that checks the machine and builds before it can be run in a test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SERVICE_URL_DEFAULTS, SERVICE_URL_ENV_VARS } from '../../tests/e2e/utils/serviceUrls';

const LANE = readFileSync(fileURLToPath(new URL('../e2eLocal.sh', import.meta.url)), 'utf8');

/** The script without its comment lines, so prose naming a port or a variable is not read as code. */
const CODE = LANE.split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

/** Each API origin the lane exports, with the default it falls back to when the caller set none. */
const bakedDefaults = (): ReadonlyMap<string, string> =>
    new Map(
        [...CODE.matchAll(/^\s*export (NEXT_PUBLIC_[A-Z_]+_API_URL)="\$\{\1:-(.+)\}"$/gmu)].map((match) => [
            match[1] ?? '',
            match[2] ?? '',
        ]),
    );

/** The line indexes of every match of a pattern in the code. */
const linesOf = (pattern: RegExp): readonly number[] =>
    CODE.split('\n').flatMap((line, index) => (pattern.test(line) ? [index] : []));

/** The line index of the first match of a pattern in the code, or -1. */
const lineOf = (pattern: RegExp): number => linesOf(pattern)[0] ?? -1;

describe('the local Playwright lane’s API origins', () => {
    it('exports one for every backend the app calls, and no other', () => {
        expect([...bakedDefaults().keys()].sort()).toEqual(Object.values(SERVICE_URL_ENV_VARS).sort());
    });

    it('defaults every one to the run’s own web server, where no API answers', () => {
        for (const [variable, fallback] of bakedDefaults()) {
            expect(fallback, variable).toBe('http://localhost:${PORT}');
        }
    });

    it('never defaults one to a port the local stack publishes', () => {
        const stackOrigins = new Set(Object.values(SERVICE_URL_DEFAULTS));

        for (const [variable, fallback] of bakedDefaults()) {
            expect(stackOrigins.has(fallback), variable).toBe(false);
        }
    });

    it('sets them after the port is chosen and before either server mode is decided, so dev and start agree', () => {
        const portChosen = lineOf(/^PORT="\$\(find_free_port\)"/u);
        const exports = linesOf(/^\s*export NEXT_PUBLIC_[A-Z_]+_API_URL=/u);
        const modeBranch = lineOf(/^if \[\[ "\$\{MODE\}" == 'start' \]\]/u);

        expect(portChosen).toBeGreaterThanOrEqual(0);
        expect(modeBranch).toBeGreaterThanOrEqual(0);
        expect(exports).toHaveLength(Object.keys(SERVICE_URL_ENV_VARS).length);

        // EVERY export, not the first: one moved inside the `start` branch would leave `dev` on the stack's port.
        for (const line of exports) {
            expect(line).toBeGreaterThan(portChosen);
            expect(line).toBeLessThan(modeBranch);
        }
    });
});
