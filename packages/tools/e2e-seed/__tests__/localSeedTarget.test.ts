/**
 * The needs-review seed writes a verdict row straight into the recipe database, which is something no deployed stage
 * may ever receive. `requireLocalSeedTarget` is the only thing standing between a mis-set environment and that write,
 * so every refusal below is a way the environment can lie, and each one must fail the guard by HOST, never by a flag.
 *
 * Written before the guard (TDD): the cases are the ways a remote target can dress as a local one.
 */
import { describe, expect, it } from 'vitest';

import {
    isNonLocalSeedTargetError,
    RECIPE_DATABASE_URL,
    requireLocalSeedTarget,
    type LocalSeedEnvironment,
} from '../src/localSeedTarget.js';

const LOCAL: LocalSeedEnvironment = {
    E2E_SEED_RECIPE_URL: 'http://localhost:3000',
    E2E_SEED_FOOD_URL: 'http://localhost:3002',
    [RECIPE_DATABASE_URL]: 'postgres://postgres:postgres@127.0.0.1:5432/recipe_local',
};

/** The environment a local run sets, with one value replaced. */
const with_ = (over: LocalSeedEnvironment): LocalSeedEnvironment => ({ ...LOCAL, ...over });

describe('requireLocalSeedTarget — admits a local stack', () => {
    it('returns the database URL when the database and both origins are loopback', () => {
        expect(requireLocalSeedTarget(LOCAL)).toEqual({ databaseUrl: LOCAL[RECIPE_DATABASE_URL] });
    });

    it.each(['localhost', '127.0.0.1', '[::1]'])('admits %s as the database host', (host) => {
        expect(() =>
            requireLocalSeedTarget(
                with_({ [RECIPE_DATABASE_URL]: `postgres://postgres:postgres@${host}:5432/recipe` }),
            ),
        ).not.toThrow();
    });
});

describe('requireLocalSeedTarget — ⛔ refuses by HOST', () => {
    const REMOTE_DATABASES: readonly (readonly [string, string])[] = [
        ['a sandbox host', 'postgres://u:p@recipe.sandbox.commise.app:5432/recipe'],
        ['a prod host', 'postgres://u:p@recipe.commise.app:5432/recipe'],
        ['an RDS endpoint', 'postgres://u:p@kitchensink.abc123.eu-west-1.rds.amazonaws.com:5432/recipe'],
        ['a private-network IP that is not loopback', 'postgres://u:p@10.1.0.12:5432/recipe'],
        ['a public IP', 'postgres://u:p@203.0.113.9:5432/recipe'],
        ['0.0.0.0, which listens everywhere', 'postgres://u:p@0.0.0.0:5432/recipe'],
        ['a bare compose service name, which is a DNS lookup', 'postgres://u:p@postgres:5432/recipe'],
        ['a host that merely STARTS with localhost', 'postgres://u:p@localhost.evil.example:5432/recipe'],
        ['userinfo that names localhost while the host is remote', 'postgres://localhost:5432@evil.example/recipe'],
        [
            'a `host=` query that pg honours over the authority',
            'postgres://u:p@localhost:5432/recipe?host=evil.example',
        ],
        ['a unix-socket style URL with no host', 'postgres:///recipe?host=/var/run/postgresql'],
    ];

    it.each(REMOTE_DATABASES)('refuses %s', (_label, url) => {
        expect(() => requireLocalSeedTarget(with_({ [RECIPE_DATABASE_URL]: url }))).toThrow(
            expect.objectContaining({ name: 'NonLocalSeedTargetError' }),
        );
    });

    it('⛔ refuses a remote recipe API even when the database is local', () => {
        expect(() =>
            requireLocalSeedTarget(with_({ E2E_SEED_RECIPE_URL: 'https://recipe-pr-91.commise.app' })),
        ).toThrow(/E2E_SEED_RECIPE_URL/u);
    });

    it('⛔ refuses a remote food API, because the seed authors a food there', () => {
        expect(() => requireLocalSeedTarget(with_({ E2E_SEED_FOOD_URL: 'https://food.commise.app' }))).toThrow(
            /E2E_SEED_FOOD_URL/u,
        );
    });

    it.each([
        ['a missing recipe URL', { E2E_SEED_RECIPE_URL: undefined }],
        ['a blank recipe URL', { E2E_SEED_RECIPE_URL: '   ' }],
        ['a missing food URL', { E2E_SEED_FOOD_URL: undefined }],
        ['a missing database URL', { [RECIPE_DATABASE_URL]: undefined }],
        ['a blank database URL', { [RECIPE_DATABASE_URL]: '' }],
        ['an unparseable database URL', { [RECIPE_DATABASE_URL]: 'not a url' }],
        ['an unparseable recipe URL', { E2E_SEED_RECIPE_URL: '://nope' }],
    ] as const)('refuses %s', (_label, over) => {
        expect(() => requireLocalSeedTarget(with_(over))).toThrow(
            expect.objectContaining({ name: 'NonLocalSeedTargetError' }),
        );
    });

    it('refuses a database URL of another scheme, so an https origin cannot stand in for a database', () => {
        expect(() => requireLocalSeedTarget(with_({ [RECIPE_DATABASE_URL]: 'http://localhost:5432/recipe' }))).toThrow(
            /postgres/u,
        );
    });

    /**
     * The reason this guard reads the HOST and nothing else: a flag is something a CI job sets for its own reasons.
     * Every flag the local tooling uses is set here, beside a remote host, and the guard must still refuse.
     */
    it('⛔ refuses a remote host however many "this is local" flags are set', () => {
        const flagged: LocalSeedEnvironment = {
            ...with_({ [RECIPE_DATABASE_URL]: 'postgres://u:p@kitchensink.abc.rds.amazonaws.com:5432/recipe' }),
            MAESTRO_LOCAL: '1',
            E2E_POOL_NAMESPACE: 'local',
            CI: undefined,
            NODE_ENV: 'development',
        };

        expect(() => requireLocalSeedTarget(flagged)).toThrow(
            expect.objectContaining({ name: 'NonLocalSeedTargetError' }),
        );
    });

    it('names the offending variable and host, and never the database password', () => {
        let message = '';

        try {
            requireLocalSeedTarget(with_({ [RECIPE_DATABASE_URL]: 'postgres://u:hunter2@10.1.0.12:5432/recipe' }));
        } catch (error) {
            message = error instanceof Error ? error.message : '';
        }

        expect(message).toContain(RECIPE_DATABASE_URL);
        expect(message).toContain('10.1.0.12');
        expect(message).not.toContain('hunter2');
    });
});

describe('isNonLocalSeedTargetError', () => {
    it('recognises the refusal and nothing else', () => {
        let refusal: unknown;

        try {
            requireLocalSeedTarget({});
        } catch (error) {
            refusal = error;
        }

        expect(isNonLocalSeedTargetError(refusal)).toBe(true);
        expect(isNonLocalSeedTargetError(new Error('x'))).toBe(false);
    });
});
