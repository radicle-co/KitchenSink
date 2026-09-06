import { describe, it, expect } from 'vitest';

import {
    AUXILIARY_ROLES,
    auxiliaryFixtureEmail,
    auxiliaryFixtureUsername,
    deriveRunKey,
    isRunScopedE2EEmail,
    isThisRunE2EEmail,
    LEAKED_FIXTURE_MAX_AGE_MS,
    MAESTRO_SHARED_FIXTURE_EMAIL,
    planE2EUserCleanup,
    signInFixtureEmail,
    signInFixtureUsername,
    signUpEmail,
    type CleanupCandidate,
} from '../src/runFixtureIdentity.js';

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
            expect(localPart(signInFixtureEmail(key)).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
            expect(localPart(signUpEmail(key, 'mkq3z9xyz')).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
            expect(signInFixtureUsername(key).length).toBeLessThanOrEqual(64);
        }
    });

    it('keeps each shard’s teardown scoped to its OWN users', () => {
        const shardOne = deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '1' }, 'seed');
        const shardTwo = deriveRunKey({ ...shardEnv, COMMISE_E2E_SHARD: '2' }, 'seed');

        // Shard 1's teardown must not claim shard 2's live fixture, in either direction.
        expect(isThisRunE2EEmail(signInFixtureEmail(shardTwo), shardOne)).toBe(false);
        expect(isThisRunE2EEmail(signInFixtureEmail(shardOne), shardTwo)).toBe(false);
        expect(isThisRunE2EEmail(signInFixtureEmail(shardOne), shardOne)).toBe(true);
    });
});

describe('derived identities', () => {
    const runKey = deriveRunKey({ GITHUB_RUN_ID: '16345678901', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'e2e-web' }, 's');

    it('keeps the `+clerk_test` tag on the sign-in address (the 424242 magic-code contract)', () => {
        expect(signInFixtureEmail(runKey).endsWith('+clerk_test@example.com')).toBe(true);
        expect(signInFixtureEmail(runKey)).toContain(runKey);
    });

    it('keeps the `+clerk_test` tag on a sign-up address', () => {
        expect(signUpEmail(runKey, 'm1x2').endsWith('+clerk_test@example.com')).toBe(true);
    });

    it('keeps every derived local part inside the 64-char limit, even for a clamped key', () => {
        const worst = deriveRunKey({ GITHUB_RUN_ID: '99999999999', GITHUB_JOB: 'a-very-long-job-name' }, 's');

        expect(localPart(signInFixtureEmail(worst)).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
        expect(localPart(signUpEmail(worst, 'mkq3z9xyz')).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
    });

    it('emits a username in Clerk’s charset, unique per run, within 64 chars', () => {
        const username = signInFixtureUsername(runKey);

        expect(username).toMatch(/^[a-z0-9_]+$/);
        expect(username.length).toBeLessThanOrEqual(64);
        expect(username).not.toBe(signInFixtureUsername('other-key'));
    });

    it('mints distinct sign-up addresses for distinct unique parts', () => {
        expect(signUpEmail(runKey, 'aaa1')).not.toBe(signUpEmail(runKey, 'aaa2'));
    });
});

describe('isRunScopedE2EEmail', () => {
    it('matches the addresses this module mints', () => {
        expect(isRunScopedE2EEmail(signInFixtureEmail('gh1-1-e2e-web'))).toBe(true);
        expect(isRunScopedE2EEmail(signUpEmail('gh1-1-e2e-web', 'abc'))).toBe(true);
    });

    it('NEVER matches the fixed Maestro fixture — the mobile job’s user must survive every sweep', () => {
        expect(isRunScopedE2EEmail(MAESTRO_SHARED_FIXTURE_EMAIL)).toBe(false);
        expect(isRunScopedE2EEmail(MAESTRO_SHARED_FIXTURE_EMAIL.toUpperCase())).toBe(false);
    });

    it('never matches an unrelated account, and is anchored at both ends', () => {
        expect(isRunScopedE2EEmail('webb.c.brandon@gmail.com')).toBe(false);
        expect(isRunScopedE2EEmail('not-commise-e2e-signin-x+clerk_test@example.com')).toBe(false);
        expect(isRunScopedE2EEmail('commise-e2e-signin-x+clerk_test@example.com.evil.test')).toBe(false);
        expect(isRunScopedE2EEmail('commise-e2e-other-x+clerk_test@example.com')).toBe(false);
    });
});

describe('isThisRunE2EEmail', () => {
    it('claims this run’s sign-in fixture and sign-up users', () => {
        expect(isThisRunE2EEmail(signInFixtureEmail('gh9-1-web'), 'gh9-1-web')).toBe(true);
        expect(isThisRunE2EEmail(signUpEmail('gh9-1-web', 'z1'), 'gh9-1-web')).toBe(true);
    });

    it('is delimiter-aware — run key `a` never claims run key `ab`’s users (the pr-1/pr-15 lesson)', () => {
        expect(isThisRunE2EEmail(signInFixtureEmail('ab'), 'a')).toBe(false);
        expect(isThisRunE2EEmail(signUpEmail('ab', 'z1'), 'a')).toBe(false);
    });

    it('never claims the fixed Maestro fixture', () => {
        expect(isThisRunE2EEmail(MAESTRO_SHARED_FIXTURE_EMAIL, 'gh9-1-web')).toBe(false);
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

    it('deletes this run’s own fixture and sign-up users regardless of age', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({ id: 'own_signin', emails: [signInFixtureEmail(RUN)] }),
                candidate({ id: 'own_signup', emails: [signUpEmail(RUN, 'k1')], createdAtMs: NOW - 5_000 }),
            ],
            ctx,
        );

        expect(plan.ownFixtureIds).toEqual(['own_signin', 'own_signup']);
        expect(plan.leakedIds).toEqual([]);
    });

    it('LEAVES a concurrent run’s fresh fixture alone — the whole point of the fix', () => {
        const plan = planE2EUserCleanup(
            [candidate({ id: 'other_live', emails: [signInFixtureEmail('gh9-1-heavy')], createdAtMs: NOW - 60_000 })],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: [], leakedIds: [] });
    });

    it('sweeps another run’s leftover once it is older than the threshold', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({
                    id: 'leaked',
                    emails: [signInFixtureEmail('gh8-1-e2e-web')],
                    createdAtMs: NOW - LEAKED_FIXTURE_MAX_AGE_MS - 1,
                }),
            ],
            ctx,
        );

        expect(plan.leakedIds).toEqual(['leaked']);
        expect(plan.ownFixtureIds).toEqual([]);
    });

    it('does not sweep AT the threshold (strictly older only)', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({
                    id: 'edge',
                    emails: [signInFixtureEmail('gh8-1-e2e-web')],
                    createdAtMs: NOW - LEAKED_FIXTURE_MAX_AGE_MS,
                }),
            ],
            ctx,
        );

        expect(plan.leakedIds).toEqual([]);
    });

    it('never touches the fixed Maestro fixture, however ancient', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({
                    id: 'maestro',
                    emails: [MAESTRO_SHARED_FIXTURE_EMAIL],
                    createdAtMs: NOW - 365 * 24 * 60 * 60 * 1_000,
                }),
            ],
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
            [candidate({ id: 'multi', emails: ['alias@example.com', signInFixtureEmail(RUN)] })],
            ctx,
        );

        expect(plan.ownFixtureIds).toEqual(['multi']);
    });

    it('classifies a mixed list exactly once each, own taking precedence over the age rule', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({ id: 'own', emails: [signInFixtureEmail(RUN)], createdAtMs: NOW - 999_999_999 }),
                candidate({ id: 'live', emails: [signInFixtureEmail('gh9-1-other')] }),
                candidate({
                    id: 'old',
                    emails: [signUpEmail('gh7-1-old', 'q')],
                    createdAtMs: NOW - LEAKED_FIXTURE_MAX_AGE_MS - 1_000,
                }),
                candidate({ id: 'maestro', emails: [MAESTRO_SHARED_FIXTURE_EMAIL], createdAtMs: 0 }),
            ],
            ctx,
        );

        expect(plan).toEqual({ ownFixtureIds: ['own'], leakedIds: ['old'] });
    });
});

/**
 * The Maestro tier needs THREE identities per run, not one — a signer, a co-author whose public recipe the
 * signer does not own (which is the entire premise of `discover-clone` and `rating`), and a subject the
 * erasure flow really deletes.
 *
 * ⛔ They are derived THROUGH `signUpEmail`, not as a new address shape, and that is the whole safety
 * argument. `planE2EUserCleanup`'s two predicates are what stop one run deleting another run's LIVE user;
 * a fourth address shape would mean editing them, and every rule below exists to prove that editing them
 * is unnecessary — the auxiliary identities are already own-matched, already leak-swept, and still cannot
 * collide with the fixed Maestro fixture.
 */
describe('auxiliary run-scoped identities', () => {
    const RUN = 'gh42-1-maestro';
    const NOW = 1_800_000_000_000;
    const candidate = (over: Partial<CleanupCandidate> & { id: string }): CleanupCandidate => ({
        emails: [],
        createdAtMs: NOW,
        ...over,
    });

    it('covers exactly the roles the Maestro tier provisions', () => {
        expect([...AUXILIARY_ROLES]).toEqual(['author', 'erasure']);
    });

    it.each([...AUXILIARY_ROLES])('derives a distinct, run-scoped %s address', (role) => {
        const email = auxiliaryFixtureEmail(RUN, role);

        expect(email).toContain('+clerk_test@');
        expect(email).not.toBe(signInFixtureEmail(RUN));
        expect(localPart(email).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
        expect(auxiliaryFixtureUsername(RUN, role).length).toBeLessThanOrEqual(MAX_LOCAL_PART);
    });

    it('gives the two roles different addresses and different usernames', () => {
        expect(auxiliaryFixtureEmail(RUN, 'author')).not.toBe(auxiliaryFixtureEmail(RUN, 'erasure'));
        expect(auxiliaryFixtureUsername(RUN, 'author')).not.toBe(auxiliaryFixtureUsername(RUN, 'erasure'));
    });

    it('is deterministic — the same run key derives the same identity in every process', () => {
        expect(auxiliaryFixtureEmail(RUN, 'author')).toBe(auxiliaryFixtureEmail(RUN, 'author'));
        expect(auxiliaryFixtureUsername(RUN, 'author')).toBe(auxiliaryFixtureUsername(RUN, 'author'));
    });

    it('produces a Clerk-legal username — underscores and alphanumerics only', () => {
        for (const role of AUXILIARY_ROLES) {
            expect(auxiliaryFixtureUsername(RUN, role)).toMatch(/^[a-z0-9_]+$/);
        }
    });

    it('is claimed by THIS run, and by no other run', () => {
        for (const role of AUXILIARY_ROLES) {
            const email = auxiliaryFixtureEmail(RUN, role);

            expect(isThisRunE2EEmail(email, RUN)).toBe(true);
            expect(isThisRunE2EEmail(email, `${RUN}x`)).toBe(false);
            expect(isThisRunE2EEmail(auxiliaryFixtureEmail(`${RUN}x`, role), RUN)).toBe(false);
        }
    });

    it('is swept as a leak when a run crashes, exactly like the sign-in fixture', () => {
        expect(AUXILIARY_ROLES.every((role) => isRunScopedE2EEmail(auxiliaryFixtureEmail(RUN, role)))).toBe(true);
    });

    it('NEVER matches the fixed Maestro fixture, whatever the run key', () => {
        for (const role of AUXILIARY_ROLES) {
            expect(auxiliaryFixtureEmail(RUN, role)).not.toBe(MAESTRO_SHARED_FIXTURE_EMAIL);
            expect(isThisRunE2EEmail(MAESTRO_SHARED_FIXTURE_EMAIL, RUN)).toBe(false);
        }
    });

    it('is deleted by teardown alongside the signer, with the cleanup predicates UNCHANGED', () => {
        const plan = planE2EUserCleanup(
            [
                candidate({ id: 'signer', emails: [signInFixtureEmail(RUN)] }),
                candidate({ id: 'author', emails: [auxiliaryFixtureEmail(RUN, 'author')] }),
                candidate({ id: 'erasure', emails: [auxiliaryFixtureEmail(RUN, 'erasure')] }),
                // A CONCURRENT run's fresh auxiliary user: the case the age gate must protect.
                candidate({ id: 'other', emails: [auxiliaryFixtureEmail('gh99-1-x', 'author')] }),
            ],
            { runKey: RUN, nowMs: NOW, maxAgeMs: LEAKED_FIXTURE_MAX_AGE_MS },
        );

        expect(plan).toEqual({ ownFixtureIds: ['signer', 'author', 'erasure'], leakedIds: [] });
    });
});
