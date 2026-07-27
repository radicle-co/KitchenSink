import { describe, it, expect } from 'vitest';

import {
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
} from '../runFixtureIdentity.js';

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
