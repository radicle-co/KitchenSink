// @vitest-environment node
/**
 * Guard for WHERE the app under test sends its API calls during a browser run.
 *
 * ## The failure this pins
 *
 * `playwright.config.ts` used to pass its web server nothing but `PORT`, so the service origins the app
 * compiled against came from whatever `.env.local` / `.env.development` happened to say on the machine
 * running the suite. Two consequences, both silent:
 *
 *   1. A suite pointed at a locally-booted stack could not be pointed anywhere else without editing an
 *      untracked file, and
 *   2. a stale value in that file (identity on `:4000`, a port nothing has bound since the service's own
 *      schema defaulted it to `:3001`) sent every identity call into a refused connection, which surfaces
 *      as a generic assertion timeout rather than as a configuration error.
 *
 * The resolution is therefore a DECISION with a stated default, not a constant, and it is pinned here so
 * the two ways of getting it wrong — losing the override, or losing the default — both fail loudly.
 *
 * Every case below fails if the resolution logic is broken in the obvious ways: a copy-pasted key that
 * makes one variable move the wrong service, a bare `??` that lets an empty string through as an origin,
 * a dropped protocol constraint, or a default that silently names a deployed host.
 */
import { describe, expect, it } from 'vitest';

import {
    isInvalidServiceUrlError,
    resolveServiceUrls,
    serviceUrlEnv,
    SERVICE_URL_DEFAULTS,
    SERVICE_URL_ENV_VARS,
    type ServiceName,
} from '../serviceUrls';

describe('SERVICE_URL_DEFAULTS', () => {
    it('names only local origins, so an unconfigured run can never reach a deployed stage', () => {
        // The property that matters is not "these exact ports" but "nothing here is a real host". A
        // default naming a sandbox origin would make an unconfigured suite mutate shared data.
        for (const url of Object.values(SERVICE_URL_DEFAULTS)) {
            expect(url).toMatch(/^http:\/\/localhost:\d+$/);
        }
    });

    it('names the ports the services themselves default to, so `local:up` needs no configuration', () => {
        // Pinned against the services' own schemas: recipe-service `config.types.ts` defaults PORT to
        // 3000, identity `env.schema.ts` to 3001. A swap here is invisible at run time — each service
        // answers *something* on the other's port — so it is asserted rather than trusted.
        expect(SERVICE_URL_DEFAULTS).toStrictEqual({
            recipe: 'http://localhost:3000',
            identity: 'http://localhost:3001',
        });
    });

    it('declares a variable for every service, so a new service cannot be silently unconfigurable', () => {
        expect(Object.keys(SERVICE_URL_ENV_VARS).sort()).toStrictEqual(Object.keys(SERVICE_URL_DEFAULTS).sort());
    });

    it('reads the variables the app itself reads, rather than inventing a second name for one fact', () => {
        // `src/config/env.ts` is the app's own contract. A suite-only alias would be a second spelling of
        // the same knowledge, and the mapping between them a third place to get it wrong.
        expect(SERVICE_URL_ENV_VARS).toStrictEqual({
            recipe: 'NEXT_PUBLIC_RECIPE_API_URL',
            identity: 'NEXT_PUBLIC_IDENTITY_API_URL',
        });
    });
});

describe('resolveServiceUrls', () => {
    it('falls back to the local stack when nothing is configured', () => {
        expect(resolveServiceUrls({})).toStrictEqual(SERVICE_URL_DEFAULTS);
    });

    it('proves the defaults survive its own validation', () => {
        // A default that could not pass the check below would turn every unconfigured run into a config
        // error. The case above asserts the VALUE; this one asserts the defaults are legal.
        expect(() => resolveServiceUrls({})).not.toThrow();
    });

    it('lets the recipe variable move the recipe origin and nothing else', () => {
        const resolved = resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.example.test' });

        expect(resolved.recipe).toBe('https://recipe.example.test');
        expect(resolved.identity).toBe(SERVICE_URL_DEFAULTS.identity);
    });

    it('lets the identity variable move the identity origin and nothing else', () => {
        // The mirror case: one key copy-pasted into both slots passes the test above and fails this one.
        const resolved = resolveServiceUrls({ NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.example.test' });

        expect(resolved.identity).toBe('https://identity.example.test');
        expect(resolved.recipe).toBe(SERVICE_URL_DEFAULTS.recipe);
    });

    it('resolves every service independently in one call', () => {
        expect(
            resolveServiceUrls({
                NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.example.test',
                NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.example.test',
            }),
        ).toStrictEqual({ recipe: 'https://recipe.example.test', identity: 'https://identity.example.test' });
    });

    it('treats a blank value as absent rather than as an origin', () => {
        // A declared-but-empty CI variable, or a `KEY=` line in a dotenv file, arrives as ''. A bare `??`
        // would pass it through, and the app's own validation would then fail INSIDE the spawned server —
        // reported as a 120s web-server timeout with no cause.
        expect(resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: '' }).recipe).toBe(SERVICE_URL_DEFAULTS.recipe);
    });

    it('treats a whitespace-only value as absent', () => {
        expect(resolveServiceUrls({ NEXT_PUBLIC_IDENTITY_API_URL: '   ' }).identity).toBe(
            SERVICE_URL_DEFAULTS.identity,
        );
    });

    it('trims a value, because a dotenv line or a shell export can carry stray whitespace', () => {
        expect(resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: '  https://recipe.example.test  ' }).recipe).toBe(
            'https://recipe.example.test',
        );
    });

    it('rejects a relative URL, naming the variable that holds it', () => {
        // A relative path resolves against the PAGE in a browser, so it "works" on the app's own origin
        // and fails nowhere a config check would see it.
        expect(() => resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: '/api/v1' })).toThrow(
            /NEXT_PUBLIC_RECIPE_API_URL/,
        );
    });

    it('rejects a host with no scheme', () => {
        expect(() => resolveServiceUrls({ NEXT_PUBLIC_IDENTITY_API_URL: 'identity.example.test' })).toThrow(
            /NEXT_PUBLIC_IDENTITY_API_URL/,
        );
    });

    it('rejects a non-http(s) protocol, matching the app’s own endpoint rule', () => {
        // `src/config/env.ts` validates endpoints as `z.url({ protocol: /^https?$/ })`. Dropping the
        // protocol constraint here would admit values the app then rejects at module load.
        expect(() => resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: 'ftp://recipe.example.test' })).toThrow(
            /NEXT_PUBLIC_RECIPE_API_URL/,
        );
    });

    it('raises an error its own guard recognises', () => {
        let caught: unknown;

        try {
            resolveServiceUrls({ NEXT_PUBLIC_RECIPE_API_URL: 'not a url' });
        } catch (error) {
            caught = error;
        }

        expect(isInvalidServiceUrlError(caught)).toBe(true);
    });

    it('does not claim an unrelated error as its own', () => {
        expect(isInvalidServiceUrlError(new Error('unrelated'))).toBe(false);
    });
});

describe('serviceUrlEnv', () => {
    it('emits exactly the variables the app reads, carrying the resolved values', () => {
        expect(
            serviceUrlEnv({ recipe: 'https://recipe.example.test', identity: 'https://identity.example.test' }),
        ).toStrictEqual({
            NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.example.test',
            NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.example.test',
        });
    });

    it('covers every declared service, so a new one reaches the web server without a second edit', () => {
        // Derived from the same record `resolveServiceUrls` reads. A hand-listed spread here would be the
        // second place to remember, and the one that gets forgotten.
        const names = Object.keys(SERVICE_URL_ENV_VARS) as ServiceName[];
        const emitted = serviceUrlEnv(SERVICE_URL_DEFAULTS);

        expect(Object.keys(emitted).sort()).toStrictEqual(names.map((name) => SERVICE_URL_ENV_VARS[name]).sort());
    });
});
