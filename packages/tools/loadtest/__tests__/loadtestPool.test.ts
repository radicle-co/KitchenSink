/**
 * ⛔ THE k6 POOL IS LEASED FROM THE FIXED TEST POOL — ITS TOKENS MUST BE ADMISSIBLE, AND NO RUN CREATES OR SWEEPS A USER.
 *
 * `provision-pool.mjs` minted through Clerk's BACKEND API (`POST /sessions`), whose tokens carry no `azp` and
 * answered 401 from both food and recipe on `pr-91`. So the pool signs in through the FRONTEND API, which stamps
 * `azp` — per-IP throttled, which is why a stored handle is re-minted rather than signed in again.
 *
 * ## ⛔ REWRITTEN for the fixed pool (owner ruling 2026-09-13)
 *
 * This suite used to assert that the provisioner CREATED its users at `+clerk_test` addresses and that
 * `sweep.mjs`'s reclamation regex matched every one of them. Both premises are reversed: no test run creates a
 * Clerk user (`poolAdmin` is the only creator — see `@kitchensink/e2e-fixtures`), and a sweeper that matches the
 * pool is a sweeper that deletes it. Where the deleted assertions' coverage went:
 *
 *   - the roster's addresses, the username derived from the same id, and uniqueness → `e2e-fixtures`
 *     `__tests__/testPool.test.ts`;
 *   - the random per-user creation password (and the committed one only where a flow types it) →
 *     `e2e-fixtures` `__tests__/poolAdmin.test.ts`;
 *   - "no tooling creates a user" → `packages/infra/global/__tests__/runtimeUserCreation.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { assertPoolMember, k6VuSlots, slotFor } from '@kitchensink/e2e-fixtures/testPool';
import { describe, expect, it } from 'vitest';

import { partitionHandles } from '@kitchensink/loadtest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LOADTEST = 'packages/tools/loadtest';

const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

describe('the k6 pool roster', () => {
    it('⛔ is entirely test-pool members, or establishSession refuses to sign in', () => {
        // Fed to the shipped gate, not a copy of its rule.
        for (const slot of [...k6VuSlots(20), slotFor('k6', 'admin')]) {
            expect(() => assertPoolMember(slot.email)).not.toThrow();
        }
    });

    it('⛔ has no sweeper — sweep.mjs matched `test-*+clerk_test@radcile.com` and would delete the pool', () => {
        expect(existsSync(join(REPO_ROOT, LOADTEST, 'sweep.mjs'))).toBe(false);
        expect(read(`${LOADTEST}/package.json`)).not.toMatch(/sweep/u);
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
    it('⛔ LEASES the pool: it creates no Clerk user and writes no metadata', () => {
        const source = read(`${LOADTEST}/provisionPool.ts`);

        expect(source).toMatch(/leaseSession|resolvePoolUser/u);
        expect(source).not.toMatch(/createUser|\/users'|\/metadata|public_metadata/u);
    });

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
