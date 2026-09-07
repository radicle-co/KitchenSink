/**
 * ⛔ THE POOL'S TOKENS MUST BE ADMISSIBLE, AND ITS USERS MUST BE RECLAIMABLE.
 *
 * `provision-pool.mjs` minted its tokens through Clerk's BACKEND API (`POST /sessions`, then
 * `POST /sessions/{id}/tokens`) precisely because that path is not per-IP throttled. Those tokens carry no
 * `azp`, and an `azp`-less token is admitted only by `isNativeClientToken` — the `client_type: 'native'`
 * claim the mobile app's own JWT template mints. Measured against the live `pr-91` stage: **401 from both
 * food and recipe**. Every k6 script the three `tests/load/README.md` files call "still runnable by hand"
 * was therefore unrunnable by hand against any stage carrying the pattern guard.
 *
 * So the pool signs in through the FRONTEND API, which is what stamps `azp`. That path costs a per-IP rate
 * limit, which is the whole reason the backend shortcut existed — and the mitigation is that SIGN-IN and
 * MINT are separate operations (`establishSession` / `remintFromSession`): a stored handle re-mints
 * without signing in again, so only a name with no handle pays the throttled call.
 *
 * ## What is asserted here, and why from DISK
 *
 * Two facts about the pool cannot be checked by anything that runs at pool time:
 *
 *   1. A pool address that is not a `+clerk_test` subaddress cannot complete the email-code first factor at
 *      all, so the roster is fed to the REAL `assertTestAddress` rather than a re-typed rule.
 *   2. A pool address that `sweep.mjs` does not match is a user that is never reclaimed from the SHARED dev
 *      instance. That regex is read out of `sweep.mjs` itself, because a copy of it here would keep
 *      agreeing with a rename that orphans every user.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { assertTestAddress } from '@kitchensink/e2e-fixtures';
import { describe, expect, it } from 'vitest';

import { POOL_NAMES, partitionHandles, poolEmail, poolUserPayload, poolUsername } from '@kitchensink/loadtest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LOADTEST = 'packages/tools/loadtest';

const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** `sweep.mjs`'s OWN reclamation pattern, lifted from its source rather than restated. */
function sweepPattern(): RegExp {
    const source = read(`${LOADTEST}/sweep.mjs`);
    const match = /const TEST_EMAIL = \/(.+)\/;/u.exec(source);

    if (!match?.[1]) {
        throw new Error('sweep.mjs no longer declares `const TEST_EMAIL = /…/;` — this guard cannot read it');
    }

    return new RegExp(match[1], 'u');
}

describe('the k6 pool roster', () => {
    it('⛔ is entirely Clerk TEST addresses, or the sign-in cannot complete', () => {
        // Fed to the shipped assertion, not a copy of its rule.
        expect(POOL_NAMES.length).toBeGreaterThan(0);

        for (const name of POOL_NAMES) {
            expect(() => assertTestAddress(poolEmail(name, 'radcile.com'))).not.toThrow();
        }
    });

    it('⛔ is entirely reclaimable by sweep.mjs, so no pool user is orphaned on the SHARED instance', () => {
        const pattern = sweepPattern();

        for (const name of [...POOL_NAMES, 'admin']) {
            expect(pattern.test(poolEmail(name, 'radcile.com')), `${name} would never be swept`).toBe(true);
        }
    });

    it('⚠️ refuses a domain sweep.mjs does not cover, rather than silently littering', () => {
        // The mutation this kills: widening EMAIL_DOMAIN to a host the sweeper's pattern excludes.
        expect(sweepPattern().test(poolEmail('alfa', 'example.org'))).toBe(false);
    });
});

describe('the pool username', () => {
    // ⛔ MEASURED FAILURE, run 34017385400 (2026-09-06). The first live provision died on
    // `422 form_identifier_exists / param_name: username`: the address moved to a `+clerk_test`
    // subaddress while the username stayed `test_${name}`, so the OLD pool users — same username, plain
    // address — still held it. Find-by-email missed; create-by-username collided. Username is unique in
    // Clerk, so the two identifiers must be derived from the SAME input or they drift apart exactly here.
    it('⛔ is derived from the same address the email is, so the two cannot disagree', () => {
        for (const name of POOL_NAMES) {
            const email = poolEmail(name, 'radcile.com');
            const local = email.slice(0, email.indexOf('@')).replace(/[^a-z0-9]+/gu, '_');

            expect(poolUsername(name), `${name}'s username is not derived from its address`).toBe(local);
        }
    });

    it('⛔ never collides with the PREVIOUS pool namespace, which still exists on the shared instance', () => {
        // The old provisioner minted `test_alfa`; those users are still there until `npm run sweep`
        // reclaims them. A new username equal to an old one is the 422 above, on every future cold run.
        for (const name of POOL_NAMES) {
            expect(poolUsername(name)).not.toBe(`test_${name}`);
        }
    });

    it("⚠️ stays inside Clerk's username charset — letters, digits and underscore only", () => {
        for (const name of POOL_NAMES) {
            expect(poolUsername(name)).toMatch(/^[a-z0-9_]+$/u);
        }
    });
});

describe('the pool user create payload', () => {
    // ⛔ MEASURED, run 34038871033 (2026-09-06): `422 form_data_missing — ["password"] data doesn't match
    // user requirements set for this instance`. The rewrite dropped the password because the FAPI sign-in
    // uses the email-code first factor and never needs one — but the INSTANCE requires a password at
    // creation regardless. The two facts are independent, and only one of them is visible from the code.
    it('⛔ carries a password, which the instance requires even though sign-in never uses it', () => {
        expect(poolUserPayload('alfa', 'radcile.com').password).toBeTruthy();
    });

    it('⛔ makes it RANDOM per user, never a committed pattern', () => {
        // A static pattern would let anyone with access to the shared sandbox Clerk instance sign in as
        // every pool user. The old provisioner recorded this reasoning; it survives the rewrite.
        const a = poolUserPayload('alfa', 'radcile.com').password;
        const b = poolUserPayload('alfa', 'radcile.com').password;

        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThanOrEqual(16);
    });

    it('carries the derived address and username, so one input drives all three', () => {
        const payload = poolUserPayload('bravo', 'radcile.com');

        expect(payload.email_address).toStrictEqual([poolEmail('bravo', 'radcile.com')]);
        expect(payload.username).toBe(poolUsername('bravo'));
    });
});

describe('partitionHandles', () => {
    it('signs in only for the names with no stored handle', () => {
        const { reuse, establish } = partitionHandles({ alfa: 's1', charlie: 's3' }, ['alfa', 'bravo', 'charlie']);

        expect(reuse).toStrictEqual(['alfa', 'charlie']);
        expect(establish).toStrictEqual(['bravo']);
    });

    it('⛔ partitions TOTALLY and DISJOINTLY — a name in neither set is a token nobody mints', () => {
        const names = ['alfa', 'bravo', 'charlie', 'delta'];
        const { reuse, establish } = partitionHandles({ bravo: 's2', zulu: 'stale' }, names);

        expect([...reuse, ...establish].sort()).toStrictEqual([...names].sort());
        expect(reuse.filter((name) => establish.includes(name))).toStrictEqual([]);
    });

    it('⚠️ ignores a stored handle for a name no longer in the roster', () => {
        // A shrunk POOL_SIZE must not resurrect a name the run did not ask for.
        expect(partitionHandles({ zulu: 's' }, ['alfa']).reuse).toStrictEqual([]);
    });
});

describe('the provisioner itself', () => {
    it('⛔ every file it writes is gitignored — the outputs are live bearer tokens', () => {
        // DERIVED from the source, not a list: `handles.json` was added carrying session ids and
        // dev-browser JWTs and was NOT ignored, which is a credential commit one `git add` away. A guard
        // that enumerated the three known outputs would have agreed with that. `git check-ignore` is the
        // authority — it answers what git will actually do, including rules inherited from the root file.
        const source = read(`${LOADTEST}/provisionPool.ts`);
        const written = [...source.matchAll(/writeFileSync\(\s*(?:handlesPath|join\(outDir, '([^']+)'\))/gu)].map(
            (match) => match[1] ?? 'handles.json',
        );

        expect(written.length, 'no writeFileSync call was found — this guard has gone blind').toBeGreaterThan(0);

        for (const file of new Set(written)) {
            const status = execFileSync('git', ['check-ignore', '-q', `${LOADTEST}/${file}`], {
                cwd: REPO_ROOT,
                stdio: 'pipe',
            });

            expect(status, `${file} is written by the provisioner but is not gitignored`).toBeDefined();
        }
    });

    it('⛔ no longer mints through the azp-less Backend-API session route', () => {
        // A SOURCE assertion, on the precedent of the ParseEngine guard: the defect is the PRESENCE of a
        // call, and nothing at runtime distinguishes "minted the wrong way" from "minted the right way"
        // until a deployed service answers 401 — which is what this replaces.
        const source = read(`${LOADTEST}/provisionPool.ts`);

        expect(source).not.toMatch(/\/sessions\/\$\{[^}]+\}\/tokens/u);
        expect(source).not.toMatch(/'\/sessions'/u);
    });

    it('⛔ the old azp-less provisioner is gone, not merely bypassed', () => {
        const tracked = read('.gitignore'); // touch the repo so a bad REPO_ROOT fails loudly rather than silently

        expect(tracked.length).toBeGreaterThan(0);
        expect(() => read(`${LOADTEST}/provision-pool.mjs`)).toThrow();
    });
});
