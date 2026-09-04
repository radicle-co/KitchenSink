/**
 * The integration tier's database-selection guard — the pure decision and the impure reading of it.
 *
 * ⛔ WHY THIS EXISTS. Every `__tests__/integration/**` suite in this package DROPs tables, DELETEs rows and
 * recreates the schema it is testing, against whatever URL it is handed. They read `DATABASE_URL` — the
 * application's own connection variable, the one `.env.development` points at the LOCAL SANDBOX's live
 * database — with no check that the target is disposable. A developer running `npm run test:integration` in
 * a shell that has sourced the app's env would have `verificationSpend.integration.test.ts` drop the live
 * spend ledger. The guard makes that impossible: a URL is admitted only when it names a loopback host AND a
 * database whose name ends in `_test`, and a URL that is SET but fails that test FAILS the run loudly rather
 * than skipping it — a silently skipped tier is how the spend ledger once had zero executed coverage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DISPOSABLE_DATABASE_NAME_SUFFIX,
    decideDatabaseUrl,
    disposableDatabaseUrl,
    isNonDisposableDatabaseError,
} from './integration/disposableDatabaseUrl.js';

/** The literal `_ci.yml` hands the `integration-recipe-workers` job — the contract this guard must admit. */
const CI_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/recipe_workers_test';

describe('decideDatabaseUrl', () => {
    it('is ABSENT when neither variable is set, so a machine without the harness skips in lockstep', () => {
        expect(decideDatabaseUrl({})).toEqual({ kind: 'absent' });
        expect(decideDatabaseUrl({ DATABASE_URL: '', TEST_DATABASE_URL: '' })).toEqual({ kind: 'absent' });
    });

    it('admits the exact URL CI provides', () => {
        expect(decideDatabaseUrl({ DATABASE_URL: CI_DATABASE_URL })).toEqual({
            kind: 'disposable',
            url: CI_DATABASE_URL,
        });
    });

    it.each([
        ['127.0.0.1', 'postgresql://postgres:postgres@127.0.0.1:55432/recipe_workers_test'],
        ['an IPv6 loopback', 'postgresql://postgres:postgres@[::1]:5432/recipe_workers_test'],
        ['localhost without a port', 'postgresql://postgres@localhost/anything_test'],
    ])('admits %s naming a *_test database', (_label, url) => {
        expect(decideDatabaseUrl({ DATABASE_URL: url })).toEqual({ kind: 'disposable', url });
    });

    it('prefers TEST_DATABASE_URL over DATABASE_URL, so an explicitly test-named variable wins', () => {
        // The application's variable is the one most likely to be pointing somewhere real. When both are
        // set, the one whose NAME says "test" is the one a developer meant for this tier.
        const test = 'postgresql://postgres@localhost:55432/workers_test';
        const app = 'postgresql://postgres@localhost:5432/kitchensink_recipes';

        expect(decideDatabaseUrl({ DATABASE_URL: app, TEST_DATABASE_URL: test })).toEqual({
            kind: 'disposable',
            url: test,
        });
    });

    it('REFUSES the local sandbox database even though it is on localhost — the name does not say disposable', () => {
        // ⛔ The case this guard exists for: `.env.development`'s URL is loopback, and it is LIVE.
        const decision = decideDatabaseUrl({
            DATABASE_URL: 'postgresql://postgres@localhost:5432/kitchensink_recipes',
        });

        expect(decision.kind).toBe('refused');
        expect(decision.kind === 'refused' && decision.reason).toMatch(DISPOSABLE_DATABASE_NAME_SUFFIX);
    });

    it('REFUSES a remote host even when the database is named *_test', () => {
        // A `_test` database on the shared sandbox RDS is still somebody else's database, reached through a
        // tunnel or a VPN; nothing in this tier should be able to DROP a table there.
        const decision = decideDatabaseUrl({
            DATABASE_URL:
                'postgresql://app@kitchensink-sandbox.abc123.us-east-1.rds.amazonaws.com:5432/recipe_workers_test',
        });

        expect(decision.kind).toBe('refused');
        expect(decision.kind === 'refused' && decision.reason).toMatch(/loopback/u);
    });

    it('REFUSES a URL it cannot parse, and one that names no database', () => {
        expect(decideDatabaseUrl({ DATABASE_URL: 'not a url' }).kind).toBe('refused');
        expect(decideDatabaseUrl({ DATABASE_URL: 'postgresql://postgres@localhost:5432/' }).kind).toBe('refused');
    });

    it('carries the refused URL back so the failure names the target, not just the rule', () => {
        const url = 'postgresql://postgres@localhost:5432/kitchensink_recipes';
        const decision = decideDatabaseUrl({ DATABASE_URL: url });

        expect(decision.kind === 'refused' && decision.url).toBe(url);
    });
});

describe('disposableDatabaseUrl', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns undefined when nothing is set — the suites skip', () => {
        vi.stubEnv('DATABASE_URL', '');
        vi.stubEnv('TEST_DATABASE_URL', '');

        expect(disposableDatabaseUrl()).toBeUndefined();
    });

    it('returns the URL when it is disposable', () => {
        vi.stubEnv('DATABASE_URL', CI_DATABASE_URL);
        vi.stubEnv('TEST_DATABASE_URL', '');

        expect(disposableDatabaseUrl()).toBe(CI_DATABASE_URL);
    });

    it('THROWS when the URL is set but not disposable — a misconfigured tier fails, it does not skip', () => {
        // ⛔ Skipping here would be the quiet failure: thirteen green SKIPs and a live database untouched only
        // by luck. The suite must not even reach `describe.skipIf`; the module throws on import.
        vi.stubEnv('DATABASE_URL', 'postgresql://postgres@localhost:5432/kitchensink_recipes');
        vi.stubEnv('TEST_DATABASE_URL', '');

        const thrown = (() => {
            try {
                disposableDatabaseUrl();

                return undefined;
            } catch (error: unknown) {
                return error;
            }
        })();

        expect(isNonDisposableDatabaseError(thrown)).toBe(true);
        expect(isNonDisposableDatabaseError(thrown) && thrown.message).toMatch(/kitchensink_recipes/u);
    });
});
