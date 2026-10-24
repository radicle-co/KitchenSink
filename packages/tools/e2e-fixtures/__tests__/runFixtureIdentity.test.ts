import { describe, expect, it } from 'vitest';

import {
    deriveRunKey,
    isRunScopedE2EEmail,
    isThisRunE2EEmail,
    LEAKED_FIXTURE_MAX_AGE_MS,
    planE2EUserCleanup,
    signUpEmail,
    type CleanupCandidate,
} from '../src/runFixtureIdentity.js';
import { rosterSlots } from '../src/testPool.js';

/** RFC 5321 caps an email local part at 64 chars; Clerk caps a username at 64. */
const MAX_LOCAL_PART = 64;

const localPart = (email: string): string => email.split('@')[0] ?? '';

describe('deriveRunKey', () => {
    it('prefers the explicit override (the channel globalSetup uses to pin one key per run)', () => {
        const key = deriveRunKey(
            { COMMISE_E2E_RUN_KEY: 'pinned-key', GITHUB_RUN_ID: '999', GITHUB_JOB: 'e2e-web' },
            'local-seed',
        );

        expect(key).toBe('pinned-key');
    });

    it('sanitizes an override to the safe charset instead of trusting it verbatim', () => {
        expect(deriveRunKey({ COMMISE_E2E_RUN_KEY: 'Run KEY/#1!' }, 'seed')).toBe('run-key-1');
    });

    it('ignores an override that sanitizes to nothing and falls through to the next source', () => {
        expect(deriveRunKey({ COMMISE_E2E_RUN_KEY: '///', GITHUB_RUN_ID: '36' }, 'seed')).toBe('gh10-1-job');
    });

    it('derives from run id + attempt + job in CI (run id base36-compacted)', () => {
        const key = deriveRunKey(
            { GITHUB_RUN_ID: '16345678901', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'e2e-web' },
            'seed',
        );

        expect(key).toBe(`gh${(16345678901).toString(36)}-2-e2e-web`);
    });

    it('is DIFFERENT for two jobs of the SAME run — the mobile job never shares the web fixture', () => {
        const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
        const web = deriveRunKey({ ...env, GITHUB_JOB: 'e2e-web' }, 'seed');
        const mobile = deriveRunKey({ ...env, GITHUB_JOB: 'e2e-mobile-maestro' }, 'seed');

        expect(web).not.toBe(mobile);
    });

    it('is DIFFERENT for two attempts of the same run, and for two different runs', () => {
        const first = deriveRunKey({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'e2e' }, 's');
        const rerun = deriveRunKey({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'e2e' }, 's');
        const other = deriveRunKey({ GITHUB_RUN_ID: '124', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'e2e' }, 's');

        expect(new Set([first, rerun, other]).size).toBe(3);
    });

    it('defaults a missing attempt to 1 rather than emitting an empty segment', () => {
        expect(deriveRunKey({ GITHUB_RUN_ID: '36', GITHUB_JOB: 'e2e' }, 'seed')).toBe('gh10-1-e2e');
    });

    it('falls back to the caller-supplied local seed when no CI env is present', () => {
        expect(deriveRunKey({}, 'local-4242-mfoo')).toBe('local-4242-mfoo');
    });

    it('falls back to a literal when even the seed is empty (never returns an empty key)', () => {
        expect(deriveRunKey({}, '')).toBe('local');
    });

    it('is deterministic — the same env yields the same key in every process of the run', () => {
        const env = { GITHUB_RUN_ID: '16345678901', GITHUB_RUN_ATTEMPT: '3', GITHUB_JOB: 'e2e-mobile-maestro' };

        expect(deriveRunKey(env, 'a')).toBe(deriveRunKey(env, 'b'));
    });

    it('clamps a long key to 20 chars WITHOUT aliasing two different inputs', () => {
        const long = (job: string): string =>
            deriveRunKey({ GITHUB_RUN_ID: '99999999999', GITHUB_RUN_ATTEMPT: '10', GITHUB_JOB: job }, 's');
        const a = long('integration-recipe-workers-alpha');
        const b = long('integration-recipe-workers-beta');

        expect(a.length).toBeLessThanOrEqual(20);
        expect(b.length).toBeLessThanOrEqual(20);
        expect(a).not.toBe(b);
    });
});

/**
 * The SHARD segment. `e2e-web` runs as a 4-way `--shard` matrix, and every shard is a separate Playwright
 * process that runs `globalSetup` AND `globalTeardown` — so without a per-shard segment all four derive the
 * same key, and the first shard to finish deletes (via `planE2EUserCleanup`'s `own` rule) the sign-in fixture
 * the other three are still authenticating as. That is bbf7ea7c's failure reproduced inside ONE run.
 */
describe('deriveRunKey — per-shard isolation', () => {
    const shardEnv = { GITHUB_RUN_ID: '31514368684', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'e2e-web' };

    it('gives every shard of ONE job a DISTINCT key (else shard 1 deletes shard 2-4’s fixture)', () => {
        const keys = ['1', '2', '3', '4'].map((shard) =>
            deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: shard }, 'seed'),
        );

        expect(new Set(keys).size).toBe(4);
    });

    it('leaves the key BYTE-IDENTICAL when no shard is set — every other job is unaffected', () => {
        // The regression guard for the unsharded callers (e2e-mobile-maestro, the k6 jobs, local runs):
        // adding the segment must not renumber their fixtures.
        expect(deriveRunKey(shardEnv, 'seed')).toBe(`gh${(31514368684).toString(36)}-1-e2e-web`);
        expect(deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '' }, 'seed')).toBe(deriveRunKey(shardEnv, 'seed'));
    });

    it('never lets a shard key alias the UNSHARDED key of the same job', () => {
        const bare = deriveRunKey(shardEnv, 'seed');

        for (const shard of ['1', '2', '3', '4']) {
            expect(deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: shard }, 'seed')).not.toBe(bare);
        }
    });

    it('sanitizes a shard value rather than trusting the matrix verbatim', () => {
        expect(deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: ' 2/4 ' }, 'seed')).toBe(
            deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '2-4' }, 'seed'),
        );
    });

    it('still lets the explicit override win — globalSetup pins the resolved key for the workers', () => {
        expect(deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '3', COMMISE_E2E_RUN_KEY: 'pinned' }, 's')).toBe(
            'pinned',
        );
    });

    it('keeps a clamped shard key distinct AND inside every downstream length budget', () => {
        const worst = (shard: string): string =>
            deriveRunKey(
                {
                    GITHUB_RUN_ID: '99999999999',
                    GITHUB_RUN_ATTEMPT: '10',
                    GITHUB_JOB: 'e2e-web',
                    COMMISE_E2E_SHARD: shard,
                },
                's',
            );
        const keys = ['1', '2', '3', '4'].map(worst);

        expect(new Set(keys).size).toBe(4);

        for (const key of keys) {
            expect(key.length).toBeLessThanOrEqual(20);
            expect(localPart(signUpEmail(key, 'mkq3z9xyz')).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
        }
    });

    it('keeps each shard’s sign-up cleanup scoped to its OWN users', () => {
        const shardOne = deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '1' }, 'seed');
        const shardTwo = deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '2' }, 'seed');

        expect(isThisRunE2EEmail(signUpEmail(shardTwo, 'a'), shardOne)).toBe(false);
        expect(isThisRunE2EEmail(signUpEmail(shardOne, 'a'), shardTwo)).toBe(false);
        expect(isThisRunE2EEmail(signUpEmail(shardOne, 'a'), shardOne)).toBe(true);
    });
});

/**
 * ⛔ REWRITTEN for the fixed Clerk test pool (owner ruling 2026-09-13: "We should have a pool of test users for
 * clerk so that we don't need to create ones"). This module used to derive the web sign-in fixture and the
 * Maestro signer/co-author/erasure identities from the run key — one `createUser` per identity per run — and these
 * tests pinned those derivations. Every sign-in identity is now a roster slot (`testPool.ts`, asserted in
 * `testPool.test.ts`); what remains here is the ONE carve-out that still mints a user per run — the web sign-UP
 * spec, whose subject is registration itself — and the cleanup rules that keep its sweep away from the pool.
 */
describe('no run-minted sign-in identity survives', () => {
    it('exports no run-scoped sign-in fixture or auxiliary identity', async () => {
        const module = (await import('../src/runFixtureIdentity.js')) as Record<string, unknown>;

        for (const retired of [
            'signInFixtureEmail',
            'signInFixtureUsername',
            'auxiliaryFixtureEmail',
            'auxiliaryFixtureUsername',
            'AUXILIARY_ROLES',
            'MAESTRO_SHARED_FIXTURE_EMAIL',
        ]) {
            expect(module[retired], `${retired} still exported`).toBeUndefined();
        }
    });
});

describe('sign-up identities', () => {
    const runKey = deriveRunKey({ GITHUB_RUN_ID: '16345678901', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'e2e-web' }, 's');

    it('keeps the `+clerk_test` tag on a sign-up address (the 424242 magic-code contract)', () => {
        expect(signUpEmail(runKey, 'm1x2').endsWith('+clerk_test@example.com')).toBe(true);
        expect(signUpEmail(runKey, 'm1x2')).toContain(runKey);
    });

    it('keeps every sign-up local part inside the 64-char limit, even for a clamped key', () => {
        const worst = deriveRunKey({ GITHUB_RUN_ID: '99999999999', GITHUB_JOB: 'a-very-long-job-name' }, 's');

        expect(localPart(signUpEmail(worst, 'mkq3z9xyz')).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
    });

    it('mints distinct sign-up addresses for distinct unique parts', () => {
        expect(signUpEmail(runKey, 'aaa1')).not.toBe(signUpEmail(runKey, 'aaa2'));
    });
});

/** A pre-cutover run-minted sign-in fixture, as it still exists on the shared instance until swept. */
const LEGACY_SIGN_IN = 'commise-e2e-signin-gh8-1-e2e-web+clerk_test@example.com';

describe('isRunScopedE2EEmail', () => {
    it('matches a sign-up address, and a pre-cutover sign-in fixture the age-gated sweep still reclaims', () => {
        expect(isRunScopedE2EEmail(signUpEmail('gh1-1-e2e-web', 'abc'))).toBe(true);
        expect(isRunScopedE2EEmail(LEGACY_SIGN_IN)).toBe(true);
    });

    it('⛔ NEVER matches a test-pool slot — a sweep that matched the pool would delete it', () => {
        for (const slot of rosterSlots()) {
            expect(isRunScopedE2EEmail(slot.email), slot.email).toBe(false);
        }
    });

    it('never matches an unrelated account, and is anchored at both ends', () => {
        expect(isRunScopedE2EEmail('webb.c.brandon@gmail.com')).toBe(false);
        expect(isRunScopedE2EEmail('commise-e2e-signin+clerk_test@example.com')).toBe(false);
        expect(isRunScopedE2EEmail('not-commise-e2e-signin-x+clerk_test@example.com')).toBe(false);
        expect(isRunScopedE2EEmail('commise-e2e-signin-x+clerk_test@example.com.evil.test')).toBe(false);
        expect(isRunScopedE2EEmail('commise-e2e-other-x+clerk_test@example.com')).toBe(false);
    });
});

describe('isThisRunE2EEmail', () => {
    it('claims this run’s sign-up users', () => {
        expect(isThisRunE2EEmail(signUpEmail('gh9-1-web', 'z1'), 'gh9-1-web')).toBe(true);
    });

    it('is delimiter-aware — run key `a` never claims run key `ab`’s users (the pr-1/pr-15 lesson)', () => {
        expect(isThisRunE2EEmail(signUpEmail('ab', 'z1'), 'a')).toBe(false);
    });

    it('never claims a pool slot or a legacy fixture as THIS run’s', () => {
        expect(isThisRunE2EEmail(LEGACY_SIGN_IN, 'gh8-1-e2e-web')).toBe(false);
        expect(rosterSlots().some((slot) => isThisRunE2EEmail(slot.email, 'gh9-1-web'))).toBe(false);
    });
});

describe('planE2EUserCleanup', () => {
    const NOW = 1_800_000_000_000;
    const RUN = 'gh9-1-e2e-web';
    const ctx = { runKey: RUN, nowMs: NOW, maxAgeMs: LEAKED_FIXTURE_MAX_AGE_MS };

    const candidate = (over: Partial<CleanupCandidate> & { id: string }): CleanupCandidate => ({
        emails: [],
        createdAtMs: NOW,
        ...over,
    });

    it('deletes this run’s own sign-up users regardless of age', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'own_signup', emails: [signUpEmail(RUN, 'k1')], createdAtMs: NOW - 5_000 })],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: ['own_signup'], leakedIds: [] });
    });

    it('LEAVES a concurrent run’s fresh sign-up user alone', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'other_live', emails: [signUpEmail('gh9-1-heavy', 'q')], createdAtMs: NOW - 60_000 })],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: [], leakedIds: [] });
    });

    it('sweeps another run’s leftover once it is older than the threshold', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'leaked', emails: [LEGACY_SIGN_IN], createdAtMs: NOW - LEAKED_FIXTURE_MAX_AGE_MS - 1 })],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: [], leakedIds: ['leaked'] });
    });

    it('does not sweep AT the threshold (strictly older only)', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'edge', emails: [LEGACY_SIGN_IN], createdAtMs: NOW - LEAKED_FIXTURE_MAX_AGE_MS })],
            ctx,
        );

        expect(plan.leakedIds).toEqual([]);
    });

    it('⛔ never touches a test-pool slot, however ancient', () => {
        const plan = planE2EUserCleanup(
            rosterSlots().map((slot) => candidate({ id: slot.id, emails: [slot.email], createdAtMs: 0 })),
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: [], leakedIds: [] });
    });

    it('never touches a real account that merely surfaced in the query', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'human', emails: ['someone@commise.app'], createdAtMs: 0 })],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: [], leakedIds: [] });
    });

    it('matches on ANY address of a multi-address user', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'multi', emails: ['alias@example.com', signUpEmail(RUN, 'm')] })],
            ctx,
        );

        expect(plan.ownFixtureIds).toEqual(['multi']);
    });
});
