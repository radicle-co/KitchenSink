/**
 * The Playwright suite spends Clerk's EMAIL-CODE verification in exactly two places, and only on purpose.
 *
 * ## Why this is a budget
 *
 * The deployed k6 pool failed on Clerk refusing its email-code steps (`too_many_requests`), and the counter
 * behind that refusal has an unmeasured window and scope — a CI run once pushed twelve through, so the per-IP
 * reading was refuted and it may be instance-wide, shared by every job that signs in against the sandbox dev
 * instance. Every spec that only needs a signed-in browser therefore signs in by TICKET (`signInWithTicket`,
 * or the `setup` project's restored `storageState`), which consumes no verification at all.
 *
 * What is left are the product's own auth UX tests, which must keep driving the real UI:
 *
 *   - `signIn.spec.ts` — email → password → the NEW-DEVICE email code (`sign_ins … prepare_second_factor`);
 *   - `signUp.spec.ts` — the registration form → email verification (`sign_ups … prepare_verification`).
 *
 * `playwright.config.ts` puts both in the `own-session` project, which `--shard` distributes by FILE, so each
 * runs in ONE shard of the deployed tier: two verifications per run, at most six with `retries: 2`, and — now
 * that a refused step fails at once instead of falling into the Resend recovery — never a second spend inside
 * an attempt that Clerk has already refused. Neither spec imports `mockRecipeApi`, so the stubbed tier runs
 * neither (measured with `playwright test --list`: shard 5 holds `signIn`, shard 8 `signUp`, the stubbed tier 0).
 *
 * ## What this pins, discovered from disk
 *
 * A new spec that reaches for the password + email-code UI to get a session — the easy mistake, since
 * `testUser.ts` exports the password — fails here and is pointed at `signInWithTicket`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UTILS_DIR = join(E2E_DIR, 'utils');

/** The sanctioned spenders, each with the one email-code UI it exists to exercise. */
const EMAIL_CODE_SPENDERS: Readonly<Record<string, string>> = {
    'signIn.spec.ts': 'the password + new-device email-code sign-in UI',
    'signUp.spec.ts': 'the registration + email-verification UI',
};

const read = (path: string): string => readFileSync(path, 'utf8');
const specs = (): readonly string[] => readdirSync(E2E_DIR).filter((name) => name.endsWith('.spec.ts'));
const count = (source: string, pattern: RegExp): number => [...source.matchAll(pattern)].length;

describe('the Playwright email-code verification budget', () => {
    it('discovers specs at all', () => {
        expect(specs().length).toBeGreaterThan(20);
    });

    it('spends it only in the sanctioned auth UX specs, exactly once each', () => {
        const spending = Object.fromEntries(
            specs()
                .map((name) => [name, count(read(join(E2E_DIR, name)), /submitClerkEmailCode\(/gu)] as const)
                .filter(([, calls]) => calls > 0),
        );

        expect(
            spending,
            'a spec that only needs a session must sign in with signInWithTicket — the email-code UI spends a ' +
                'shared, unmeasured Clerk verification budget',
        ).toEqual(Object.fromEntries(Object.keys(EMAIL_CODE_SPENDERS).map((name) => [name, 1])));
    });

    it('types the password only where the credential UI is the subject', () => {
        const typing = specs().filter((name) => read(join(E2E_DIR, name)).includes('TEST_USER_PASSWORD'));

        expect(typing.sort()).toEqual(Object.keys(EMAIL_CODE_SPENDERS).sort());
    });

    it('keeps the fixed test code as a VALUE in ONE module, so nothing drives the code step around the refusal check', () => {
        // A quoted literal, not a mention: several comments explain what the dev instance accepts.
        const holders = [
            ...specs().map((name) => join(E2E_DIR, name)),
            ...readdirSync(UTILS_DIR)
                .filter((name) => name.endsWith('.ts'))
                .map((name) => join(UTILS_DIR, name)),
        ].filter((path) => /['"`]424242['"`]/u.test(read(path)));

        expect(holders.map((path) => path.slice(E2E_DIR.length + 1))).toEqual(['utils/clerkEmailCode.ts']);
    });

    it('fails a refused email-code step at once rather than re-sending into the limit', () => {
        const helper = read(join(UTILS_DIR, 'clerkEmailCode.ts'));
        const recovery = helper.indexOf("answered === 'not-prepared'");

        expect(
            recovery,
            'the Resend recovery moved — re-check that a refusal is still consulted before it',
        ).toBeGreaterThan(0);
        expect(helper.lastIndexOf('await throwIfRefused()', recovery)).toBeGreaterThan(helper.indexOf('Promise.race'));
    });
});
