// @vitest-environment node
/**
 * Guard for the web e2e suite's SHARED-SESSION split.
 *
 * ## The failure this pins
 *
 * `playwright.config.ts` runs most specs against one Clerk session restored from `storageState`, and a short
 * list (`SESSION_OWNING_SPECS`) in a project with none. Getting a spec's side of that line wrong is a
 * NON-LOCAL failure — the worst kind to debug:
 *
 *   - A session-REVOKING spec placed in the shared project (`signOut.spec.ts` revokes at Clerk;
 *     `accountDangerZone.spec.ts` signs out through the app) destroys the session for every test scheduled
 *     AFTER it. The reported failure is in an innocent, unrelated file, and it moves when sharding reorders
 *     the run.
 *   - A signed-OUT spec placed there (`routeProtection`, `authPages`, `signIn`, `signUp`) is worse than a
 *     failure: it can PASS while asserting nothing it was written to assert, because the surface it expects
 *     to see anonymously is now rendered for a signed-in viewer.
 *   - A spec in NEITHER project simply stops running, silently, which is the same class as the recipe-service
 *     e2e tier that existed for months with no workflow invoking it.
 *
 * ## How it is asserted
 *
 * Against the FILES ON DISK, not a hardcoded list — a new spec is admitted to the run by existing, so the
 * check must be able to see one nobody told it about. Three properties:
 *
 *   1. **Total partition.** Every `*.spec.ts` lands in exactly one project, under the same glob semantics
 *      Playwright applies (`testMatch` on one side, `testIgnore` on the other, from ONE constant).
 *   2. **Nothing session-destroying hides in the shared project.** Detected by SIGNATURE — a spec that
 *      revokes/asserts a revoked session, or that asserts the anonymous surface, has recognisable tells. A
 *      heuristic is the right instrument here precisely because it is not authoritative: it cannot approve
 *      anything, it can only refuse a file that looks dangerous and is not declared, which forces a human to
 *      classify it.
 *   3. **Snapshot owners stay in `chromium`.** Playwright bakes the project name into baseline filenames
 *      (`recipe-detail-desktop-chromium-linux.png`), so moving such a spec to `own-session` invalidates its
 *      baselines without any assertion noticing.
 *
 * The cookie predicate is unit-tested separately below: it is what decides, at runtime, whether a context is
 * restored or fresh, so a wrong answer either sends every spec down the slow path (silent cost) or skips the
 * sign-in a fresh context needed (loud, but in the wrong place).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { authStatePath, hasClerkSessionCookie, SESSION_OWNING_SPECS } from '../authState';

const E2E_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Every Playwright spec in the suite. `auth.setup.ts` is not a `.spec.ts`, so it is naturally excluded. */
const specFiles = (): readonly string[] =>
    readdirSync(E2E_DIR)
        .filter((name) => name.endsWith('.spec.ts'))
        .sort();

const readSpec = (name: string): string => readFileSync(join(E2E_DIR, name), 'utf8');

/**
 * Tells that a spec cannot share a session, and what each one means.
 *
 * Deliberately over-inclusive on the destructive side: a false positive costs one line in
 * `SESSION_OWNING_SPECS` plus a sign-in, while a false negative costs a non-local, order-dependent failure.
 */
const SESSION_HOSTILE_SIGNATURES: readonly { readonly pattern: RegExp; readonly meaning: string }[] = [
    { pattern: /clerkSessionStatus\(/, meaning: 'asserts a session status at Clerk (i.e. that it was revoked)' },
    { pattern: /clerk\.signOut\(/, meaning: 'signs out through @clerk/testing' },
    { pattern: /name: 'Sign out of your account'/, meaning: 'clicks the app sign-out control' },
    { pattern: /account\/erasure/, meaning: 'drives the erasure flow, which ends in a sign-out' },
];

/**
 * Specs that MATCH a hostile signature but are verified safe to share the session, with the reason.
 *
 * The signatures above are deliberately over-inclusive, which makes an escape hatch necessary — but an escape
 * hatch that merely silences the check would restore the failure the check exists to catch. This one cannot
 * rot: an entry whose spec no longer matches any signature FAILS (so a stale exemption cannot sit here quietly
 * re-admitting a file that has since become dangerous), and an entry that is also declared session-owning
 * FAILS (the two lists cannot contradict each other). Adding a line therefore costs a human a real look at the
 * spec, which is the entire point.
 */
const SESSION_SAFE_ACKNOWLEDGED: Readonly<Record<string, string>> = {
    // Asserts the sign-out control is VISIBLE and is the shared design-system Button. Never clicks it, so the
    // session survives. Verified by reading the spec, 2026-08-11.
    'accountShell.spec.ts': 'asserts the sign-out button is visible; never clicks it',
};

describe('the shared-session split covers every spec exactly once', () => {
    const owned = new Set(SESSION_OWNING_SPECS);

    it('has at least one spec on each side, so neither project is dead', () => {
        const all = specFiles();

        // Without this, an empty `own-session` project (or an empty suite) would satisfy every other
        // assertion here vacuously.
        expect(all.length).toBeGreaterThan(10);
        expect(SESSION_OWNING_SPECS.length).toBeGreaterThan(0);
        expect(all.filter((name) => !owned.has(name)).length).toBeGreaterThan(0);
    });

    it('names only specs that exist, so a renamed file cannot silently leave the list', () => {
        const all = new Set(specFiles());
        const missing = SESSION_OWNING_SPECS.filter((name) => !all.has(name));

        expect(
            missing,
            `SESSION_OWNING_SPECS names ${missing.join(', ')}, which no longer exist. A renamed spec keeps ` +
                `running — in the SHARED-session project, which is exactly where it must not be.`,
        ).toEqual([]);
    });

    it('places no session-destroying or signed-out spec in the shared-session project', () => {
        const offenders = specFiles()
            .filter((name) => !owned.has(name) && SESSION_SAFE_ACKNOWLEDGED[name] === undefined)
            .flatMap((name) => {
                const source = readSpec(name);

                return SESSION_HOSTILE_SIGNATURES.filter(({ pattern }) => pattern.test(source)).map(
                    ({ meaning }) => `${name} (${meaning})`,
                );
            });

        expect(
            offenders,
            `these specs share the run's ONE Clerk session but look like they end it: ${offenders.join('; ')}. ` +
                `A spec that revokes the shared session breaks every test scheduled after it, in a file that ` +
                `has nothing to do with the cause. Add it to SESSION_OWNING_SPECS (tests/e2e/utils/authState.ts).`,
        ).toEqual([]);
    });

    it('holds no stale or contradictory acknowledgement', () => {
        for (const [name, reason] of Object.entries(SESSION_SAFE_ACKNOWLEDGED)) {
            const source = readSpec(name);
            const stillMatches = SESSION_HOSTILE_SIGNATURES.some(({ pattern }) => pattern.test(source));

            // A no-longer-matching entry is not harmless: it is a standing exemption for a file that could
            // acquire a real sign-out tomorrow and never be flagged.
            expect(
                stillMatches,
                `${name} is acknowledged as safe ("${reason}") but no longer matches any hostile signature — ` +
                    `delete the acknowledgement so the guard can flag it if that changes again`,
            ).toBe(true);
            expect(owned.has(name), `${name} is both acknowledged-safe and session-owning — pick one`).toBe(false);
        }
    });

    it('keeps every screenshot-owning spec in the `chromium` project', () => {
        // Playwright resolves a baseline as `<name>-<project>-<platform>.png`, so the project name is part of
        // the file path. Moving such a spec to `own-session` makes its baselines unreachable.
        const snapshotOwners = readdirSync(E2E_DIR)
            .filter((name) => name.endsWith('.spec.ts-snapshots'))
            .map((name) => name.replace(/-snapshots$/, ''));

        expect(
            snapshotOwners.length,
            'no snapshot directories found — this guard would pass vacuously',
        ).toBeGreaterThan(0);

        for (const spec of snapshotOwners) {
            expect(
                owned.has(spec),
                `${spec} owns screenshot baselines named for the \`chromium\` project; running it in ` +
                    `\`own-session\` would silently orphan them`,
            ).toBe(false);
        }
    });
});

describe('authStatePath', () => {
    it('scopes the state file to the run key', () => {
        // A fixed filename would let one shard restore a session belonging to another shard's Clerk user —
        // a user that shard's teardown deletes at the end of its run.
        expect(authStatePath('gh1abc-1-e2e-web-s1')).not.toBe(authStatePath('gh1abc-1-e2e-web-s2'));
        expect(authStatePath('gh1abc-1-e2e-web-s1')).toMatch(/gh1abc-1-e2e-web-s1\.json$/);
    });

    it('writes inside a gitignored `.auth/` directory', () => {
        // The file is a live Clerk session; the repo-root .gitignore rule is what keeps it out of history.
        expect(authStatePath('anything')).toMatch(/[/\\]\.auth[/\\]anything\.json$/);
    });
});

describe('hasClerkSessionCookie', () => {
    it('recognises each cookie Clerk may use to carry the session', () => {
        // `__clerk_db_jwt` is the one that matters most here: the suite runs against a Clerk DEVELOPMENT
        // instance, where the dev-browser token is what survives a `storageState` round trip.
        expect(hasClerkSessionCookie([{ name: '__session' }])).toBe(true);
        expect(hasClerkSessionCookie([{ name: '__client_uat' }])).toBe(true);
        expect(hasClerkSessionCookie([{ name: '__clerk_db_jwt' }])).toBe(true);
    });

    it('is false for a blank context', () => {
        // The fresh path depends on this: a wrong `true` here skips the sign-in a blank context needed.
        expect(hasClerkSessionCookie([])).toBe(false);
    });

    it('is not fooled by unrelated or merely similar cookie names', () => {
        expect(hasClerkSessionCookie([{ name: 'NEXT_LOCALE' }, { name: 'ph_session' }])).toBe(false);
        // Prefix-matching `__clerk` would make a telemetry or handshake cookie look like a live session.
        expect(hasClerkSessionCookie([{ name: '__clerk_handshake' }])).toBe(false);
    });

    it('finds the session cookie among many', () => {
        expect(hasClerkSessionCookie([{ name: 'NEXT_LOCALE' }, { name: '__clerk_db_jwt' }])).toBe(true);
    });
});
